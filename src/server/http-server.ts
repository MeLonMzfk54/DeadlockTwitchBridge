import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { EffectManager } from "../queue/effect-manager.js";
import type { GameEffect } from "../effects/types.js";
import type { BridgeStatus } from "../types.js";
import { publicDir } from "../config.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

export interface HttpServerContext {
  effectManager: EffectManager;
  effects: Map<string, GameEffect>;
  getStatus: () => BridgeStatus;
}

export function startHttpServer(host: string, port: number, ctx: HttpServerContext): void {
  const server = createServer((req, res) => {
    void handleRequest(req, res, ctx);
  });

  server.listen(port, host, () => {
    console.log(`[http] Control panel: http://${host}:${port}/control`);
    console.log(`[http] OBS overlay:   http://${host}:${port}/overlay`);
    console.log(`[http] API status:    http://${host}:${port}/api/status`);
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

    if (pathname === "/control" || pathname === "/overlay") {
      const file = pathname === "/control" ? "control.html" : "overlay.html";
      return serveStatic(res, join(publicDir, file));
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
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
