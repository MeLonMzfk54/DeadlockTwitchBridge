import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { EffectManager } from "../queue/effect-manager.js";
import type { GameEffect } from "../effects/types.js";
import type { BridgeStatus } from "../types.js";
import { publicDir } from "../config.js";
import {
  GameEventBus,
  parseIncomingGameEvent,
} from "../game/game-event-bus.js";
import {
  parseShopCategory,
  parseShopTier,
  type ShopVoteController,
} from "../shop/shop-vote-controller.js";
import {
  getHudSlotPng,
  getProbePng,
  parseHudSlot,
} from "../shop/shop-vote-png.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export interface HttpServerContext {
  effectManager: EffectManager;
  effects: Map<string, GameEffect>;
  getStatus: () => BridgeStatus;
  gameEventBus: GameEventBus;
  shopVote: ShopVoteController;
  /** Persist shop prefs after /control or API changes. */
  onShopSettingsChange?: () => void;
}

export function startHttpServer(host: string, port: number, ctx: HttpServerContext): void {
  const server = createServer((req, res) => {
    void handleRequest(req, res, ctx);
  });

  server.listen(port, host, () => {
    console.log(`[http] Control panel: http://${host}:${port}/control`);
    console.log(`[http] OBS overlay:   http://${host}:${port}/overlay`);
    console.log(`[http] Shop overlay:  http://${host}:${port}/overlay/shop`);
    console.log(`[http] API status:    http://${host}:${port}/api/status`);
    console.log(`[http] Game events:   http://${host}:${port}/api/game-events`);
    console.log(`[http] Shop vote:     http://${host}:${port}/api/shop-vote`);
    console.log(`[http] Shop cmd:      http://${host}:${port}/api/shop-cmd`);
    console.log(`[http] Shop probe:    http://${host}:${port}/api/shop-probe.png`);
    console.log(`[http] Shop HUD PNG:  http://${host}:${port}/api/shop-vote-hud.png`);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpServerContext,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      return json(res, 200, ctx.getStatus());
    }

    if (req.method === "GET" && pathname === "/api/effects") {
      return json(
        res,
        200,
        [...ctx.effects.values()].map((e) => ({
          id: e.id,
          name: e.name,
          retailSafe: e.retailSafe,
          cfgBindSafe: e.cfgBindSafe,
          defaultDurationSec: e.defaultDurationSec,
          requiresUserInput: e.requiresUserInput ?? false,
          userInputHint: e.userInputHint ?? "",
          destructive: e.destructive ?? false,
        })),
      );
    }

    if (req.method === "POST" && pathname === "/api/game-event") {
      if (!isLocalRequest(req)) {
        return json(res, 403, { error: "Only localhost is allowed" });
      }
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        // Panorama sometimes form-encodes; try first field / raw unwrap
        const match = body.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            return json(res, 400, { error: "Invalid JSON" });
          }
        } else {
          return json(res, 400, { error: "Invalid JSON" });
        }
      }
      // If Panorama wrapped JSON string inside an object field
      if (parsed && typeof parsed === "object" && !("type" in (parsed as object)) && !("id" in (parsed as object))) {
        const values = Object.values(parsed as Record<string, unknown>);
        for (const value of values) {
          if (typeof value === "string" && value.trim().startsWith("{")) {
            try {
              parsed = JSON.parse(value);
              break;
            } catch {
              /* keep looking */
            }
          } else if (value && typeof value === "object" && ("type" in (value as object) || "id" in (value as object))) {
            parsed = value;
            break;
          }
        }
      }
      const incoming = parseIncomingGameEvent(parsed);
      if (!incoming) {
        return json(res, 400, { error: "Invalid game event payload" });
      }
      const stored = ctx.gameEventBus.ingest(incoming, "http");
      return json(res, 200, { ok: true, accepted: Boolean(stored), id: incoming.id });
    }

    if (req.method === "GET" && pathname === "/api/game-events") {
      const afterSeqRaw = url.searchParams.get("afterSeq");
      const sinceRaw = url.searchParams.get("since");
      const limitRaw = url.searchParams.get("limit");
      const afterSeq = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : undefined;
      const since = sinceRaw ? Number.parseInt(sinceRaw, 10) : undefined;
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
      // Prefer afterSeq; legacy since=receivedAt still works for first paint without cursor
      let events = ctx.gameEventBus.getEvents(
        Number.isFinite(afterSeq) ? afterSeq : undefined,
        Number.isFinite(limit) ? limit : 100,
      );
      if (!Number.isFinite(afterSeq) && Number.isFinite(since)) {
        events = events.filter((e) => e.receivedAt > (since as number));
      }
      return json(res, 200, {
        events,
        ...ctx.gameEventBus.getModStatus(),
      });
    }

    if (req.method === "POST" && pathname === "/api/game-events/clear") {
      ctx.gameEventBus.clear();
      return json(res, 200, { ok: true });
    }

    // Panorama image side-channel (Minigames-style). URL must end in .png.
    if (req.method === "GET" && pathname === "/api/shop-probe.png") {
      return png(res, getProbePng());
    }

    if (req.method === "GET" && pathname === "/api/shop-vote-hud.png") {
      const match = ctx.gameEventBus.getModStatus().match;
      ctx.shopVote.syncFromMatchPhase(match.phase || "", match.shopOpen);
      const slot = parseHudSlot(url.searchParams.get("slot"));
      if (!slot) {
        return json(res, 400, { error: "slot=cats|t12|t34|meta|cmd required" });
      }
      return png(res, getHudSlotPng(ctx.shopVote.getSnapshot(), slot));
    }

    if (req.method === "GET" && pathname === "/api/shop-vote") {
      const match = ctx.gameEventBus.getModStatus().match;
      ctx.shopVote.syncFromMatchPhase(match.phase || "", match.shopOpen);
      return json(res, 200, ctx.shopVote.getSnapshot());
    }

    // POST same as GET — kept for control.html / legacy; game HUD uses PNG side-channel.
    if (req.method === "POST" && pathname === "/api/shop-vote") {
      const match = ctx.gameEventBus.getModStatus().match;
      ctx.shopVote.syncFromMatchPhase(match.phase || "", match.shopOpen);
      return json(res, 200, ctx.shopVote.getSnapshot());
    }

    if (req.method === "GET" && pathname === "/api/shop-cmd") {
      return json(res, 200, ctx.shopVote.getShopCmd());
    }

    // POST same as GET — Panorama AsyncWebRequest often only works reliably with POST.
    if (req.method === "POST" && pathname === "/api/shop-cmd") {
      return json(res, 200, ctx.shopVote.getShopCmd());
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/start") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { stage?: string };
      const stage =
        payload.stage === "category" || payload.stage === "tier" || payload.stage === "full"
          ? payload.stage
          : "full";
      const snap = await ctx.shopVote.start(stage);
      return json(res, 200, snap);
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/cast") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { option?: string; userId?: string };
      if (!payload.option) {
        return json(res, 400, { error: "option is required" });
      }
      try {
        const userId = typeof payload.userId === "string" ? payload.userId : undefined;
        const snap = ctx.shopVote.cast(payload.option, userId);
        return json(res, 200, snap);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(res, 400, { error: message });
      }
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/apply") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { category?: unknown; tier?: unknown };
      const category = parseShopCategory(payload.category);
      const tier = parseShopTier(payload.tier);
      if (!category || !tier) {
        return json(res, 400, { error: "category (weapon|vitality|spirit) and tier (1-4) required" });
      }
      const snap = await ctx.shopVote.apply(category, tier);
      return json(res, 200, snap);
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/cancel") {
      return json(res, 200, ctx.shopVote.cancel());
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/auto-start") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { enabled?: boolean };
      ctx.shopVote.setAutoStart(Boolean(payload.enabled));
      ctx.onShopSettingsChange?.();
      return json(res, 200, ctx.shopVote.getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/mock") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { enabled?: boolean };
      ctx.shopVote.setMockBotEnabled(Boolean(payload.enabled));
      ctx.onShopSettingsChange?.();
      return json(res, 200, ctx.shopVote.getSnapshot());
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/skip") {
      const snap = await ctx.shopVote.skip();
      return json(res, 200, snap);
    }

    if (req.method === "GET" && pathname === "/api/shop-vote/settings") {
      return json(res, 200, ctx.shopVote.getSettings());
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/settings") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as Record<string, unknown>;
      const snap = ctx.shopVote.applySettings(payload);
      ctx.onShopSettingsChange?.();
      return json(res, 200, snap);
    }

    if (req.method === "POST" && pathname === "/api/shop-vote/durations") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as {
        categoryMs?: number;
        tierMs?: number;
        restartMs?: number;
        categorySec?: number;
        tierSec?: number;
        restartSec?: number;
      };
      const categoryDurationMs =
        typeof payload.categoryMs === "number"
          ? payload.categoryMs
          : typeof payload.categorySec === "number"
            ? payload.categorySec * 1000
            : undefined;
      const tierDurationMs =
        typeof payload.tierMs === "number"
          ? payload.tierMs
          : typeof payload.tierSec === "number"
            ? payload.tierSec * 1000
            : undefined;
      const restartDelayMs =
        typeof payload.restartMs === "number"
          ? payload.restartMs
          : typeof payload.restartSec === "number"
            ? payload.restartSec * 1000
            : undefined;
      const snap = ctx.shopVote.setDurations({
        categoryDurationMs,
        tierDurationMs,
        restartDelayMs,
      });
      ctx.onShopSettingsChange?.();
      return json(res, 200, snap);
    }

    if (req.method === "POST" && pathname === "/api/test-effect") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as {
        effectId?: string;
        durationSec?: number;
        params?: Record<string, unknown>;
        userInput?: string;
      };
      if (!payload.effectId) {
        return json(res, 400, { error: "effectId is required" });
      }
      await ctx.effectManager.activateEffect(
        payload.effectId,
        payload.durationSec,
        "test-ui",
        "Manual test",
        payload.params,
        payload.userInput,
        "test-ui",
      );
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/revert-all") {
      await ctx.effectManager.revertAll();
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/revert") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { effectId?: string };
      if (!payload.effectId) {
        return json(res, 400, { error: "effectId is required" });
      }
      await ctx.effectManager.revertEffect(payload.effectId);
      return json(res, 200, { ok: true });
    }

    if (pathname === "/") {
      res.writeHead(302, { Location: "/control" });
      res.end();
      return;
    }

    if (pathname === "/control") {
      return serveStatic(res, join(publicDir, "control.html"));
    }
    if (pathname === "/overlay") {
      return serveStatic(res, join(publicDir, "overlay.html"));
    }
    if (pathname === "/overlay/shop") {
      return serveStatic(res, join(publicDir, "overlay-shop.html"));
    }

    if (pathname.startsWith("/public/")) {
      return serveStatic(res, join(publicDir, pathname.replace("/public/", "")));
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { error: message });
  }
}

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  if (LOCALHOST_HOSTS.has(remote)) return true;
  // Some stacks report IPv4-mapped IPv6
  if (remote.endsWith("127.0.0.1")) return true;
  return false;
}

function serveStatic(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) {
    json(res, 404, { error: "File not found" });
    return;
  }
  const ext = extname(filePath);
  const content = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(content);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function png(res: ServerResponse, body: Buffer): void {
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": body.length,
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
