import { deflateSync } from "node:zlib";
import type { ShopVoteSnapshot, ShopVoteStage } from "./shop-vote-controller.js";

/** Minigames-compatible level encoding: dim = level * STEP + BASE. */
export const PNG_STEP = 9;
export const PNG_BASE = 15;

export const PROBE_W = 600;
export const PROBE_H = 1000;

export type HudSlot = "cats" | "t12" | "t34" | "meta" | "cmd";

export const HUD_SLOTS: readonly HudSlot[] = ["cats", "t12", "t34", "meta", "cmd"];

/** Max seq encoded in the cmd PNG slot (controller wraps 1..200). */
export const CMD_SEQ_MAX = 200;

const STAGE_TO_LEVEL: Record<ShopVoteStage, number> = {
  idle: 0,
  voting_category: 1,
  voting_tier: 2,
  applying: 3,
  rolled: 4,
  waiting_shop: 5,
  purchased: 6,
  failed: 7,
};

const LEVEL_TO_STAGE: Record<number, ShopVoteStage> = {
  0: "idle",
  1: "voting_category",
  2: "voting_tier",
  3: "applying",
  4: "rolled",
  5: "waiting_shop",
  6: "purchased",
  7: "failed",
};

export function clampLevel(level: number, max = 100): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(max, Math.round(level)));
}

export function encodeLevel(level: number, max = 100): number {
  return clampLevel(level, max) * PNG_STEP + PNG_BASE;
}

export function decodeLevel(dim: number, scale = 1, max = 100): number {
  if (!Number.isFinite(dim) || !Number.isFinite(scale) || scale <= 0) return 0;
  return clampLevel((dim / scale - PNG_BASE) / PNG_STEP, max);
}

export function stageToLevel(stage: ShopVoteStage): number {
  return STAGE_TO_LEVEL[stage] ?? 0;
}

export function levelToStage(level: number): ShopVoteStage {
  return LEVEL_TO_STAGE[clampLevel(level, 7)] ?? "idle";
}

export function timerSecondsFromSnapshot(snap: Pick<ShopVoteSnapshot, "stageEndsAt">): number {
  if (snap.stageEndsAt == null || !Number.isFinite(snap.stageEndsAt)) return 0;
  const sec = Math.ceil((snap.stageEndsAt - Date.now()) / 1000);
  return clampLevel(sec, 60);
}

/** Category index for winner pack: weapon=1, vitality=2, spirit=3. */
const CAT_TO_INDEX: Record<string, number> = {
  weapon: 1,
  vitality: 2,
  spirit: 3,
};

const INDEX_TO_CAT: Record<number, "weapon" | "vitality" | "spirit"> = {
  1: "weapon",
  2: "vitality",
  3: "spirit",
};

/** Pack winner as cat*10+tier (11–34). 0 = unknown / not post-vote. */
export function encodeWinnerCode(
  category: string | null | undefined,
  tier: number | null | undefined,
): number {
  const catIdx = category ? CAT_TO_INDEX[category] : 0;
  const t = tier != null && Number.isFinite(Number(tier)) ? Math.round(Number(tier)) : 0;
  if (!catIdx || t < 1 || t > 4) return 0;
  return catIdx * 10 + t;
}

export function decodeWinnerCode(code: number): {
  category: "weapon" | "vitality" | "spirit" | null;
  tier: number | null;
} {
  const n = clampLevel(code, 60);
  if (n < 11) return { category: null, tier: null };
  const catIdx = Math.floor(n / 10);
  const tier = n % 10;
  const category = INDEX_TO_CAT[catIdx] ?? null;
  if (!category || tier < 1 || tier > 4) return { category: null, tier: null };
  return { category, tier };
}

/** Stages where meta.h carries winner pack instead of countdown. */
const POST_VOTE_STAGES = new Set<ShopVoteStage>([
  "applying",
  "rolled",
  "waiting_shop",
  "purchased",
  "failed",
]);

/** meta.h: timer during voting_*; winner code after voting ends. */
export function metaHeightFromSnapshot(snap: ShopVoteSnapshot): number {
  if (POST_VOTE_STAGES.has(snap.stage)) {
    return encodeWinnerCode(snap.winnerCategory, snap.winnerTier);
  }
  return timerSecondsFromSnapshot(snap);
}

export function levelsForSlot(
  snap: ShopVoteSnapshot,
  slot: HudSlot,
): { w: number; h: number } {
  // Cats during category vote, tier vote (frozen winner %), and post-vote results.
  // Tiers during tier vote + post-vote. Zero on idle / purchased / failed.
  const postVote =
    snap.stage === "applying" ||
    snap.stage === "rolled" ||
    snap.stage === "waiting_shop";
  const showCats =
    snap.stage === "voting_category" ||
    snap.stage === "voting_tier" ||
    postVote;
  const showTiers = snap.stage === "voting_tier" || postVote;
  switch (slot) {
    case "cats":
      if (!showCats) return { w: 0, h: 0 };
      return {
        w: clampLevel(snap.categoryPct.weapon),
        h: clampLevel(snap.categoryPct.vitality),
      };
    case "t12":
      if (!showTiers) return { w: 0, h: 0 };
      return {
        w: clampLevel(snap.tierPct["1"]),
        h: clampLevel(snap.tierPct["2"]),
      };
    case "t34":
      if (!showTiers) return { w: 0, h: 0 };
      return {
        w: clampLevel(snap.tierPct["3"]),
        h: clampLevel(snap.tierPct["4"]),
      };
    case "meta":
      return {
        w: stageToLevel(snap.stage),
        h: metaHeightFromSnapshot(snap),
      };
    case "cmd":
      // w=seq (1..200), h=cat*10+tier (11–34) for apply; h=0 = no command / skip.
      if (!snap.lastCfg || snap.lastCfg.seq <= 0) return { w: 0, h: 0 };
      return {
        w: clampLevel(snap.lastCfg.seq, CMD_SEQ_MAX),
        h:
          snap.lastCfg.cat > 0 && snap.lastCfg.tier >= 1 && snap.lastCfg.tier <= 4
            ? snap.lastCfg.cat * 10 + snap.lastCfg.tier
            : 0,
      };
    default:
      return { w: 0, h: 0 };
  }
}

export function parseHudSlot(raw: string | null): HudSlot | null {
  if (!raw) return null;
  if (raw === "cats" || raw === "t12" || raw === "t34" || raw === "meta" || raw === "cmd") {
    return raw;
  }
  return null;
}

/** Decode cmd-slot height into cat/tier. h=0 → skip / no apply. */
export function decodeCmdHeight(h: number): { cat: number; tier: number } {
  const n = clampLevel(h, 60);
  if (n < 11) return { cat: 0, tier: 0 };
  const cat = Math.floor(n / 10);
  const tier = n % 10;
  if (cat < 1 || cat > 3 || tier < 1 || tier > 4) return { cat: 0, tier: 0 };
  return { cat, tier };
}

/** Rebuild categoryPct from cats slot (spirit = remainder when any vote exists). */
export function categoryPctFromCats(weapon: number, vitality: number): Record<string, number> {
  const w = clampLevel(weapon);
  const v = clampLevel(vitality);
  if (w + v <= 0) return { weapon: 0, vitality: 0, spirit: 0 };
  const spirit = clampLevel(100 - w - v);
  return { weapon: w, vitality: v, spirit };
}

export function tierPctFromSlots(
  t1: number,
  t2: number,
  t3: number,
  t4: number,
): Record<"1" | "2" | "3" | "4", number> {
  return {
    "1": clampLevel(t1),
    "2": clampLevel(t2),
    "3": clampLevel(t3),
    "4": clampLevel(t4),
  };
}

// ── Minimal solid grayscale PNG ──────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Solid black 8-bit grayscale PNG of exact pixel size.
 * Panorama reads actuallayoutwidth/height from intrinsic size.
 */
export function createSolidPng(width: number, height: number): Buffer {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline: filter 0 + w zero bytes
  const raw = Buffer.alloc(h * (1 + w), 0);
  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

let cachedProbe: Buffer | null = null;

export function getProbePng(): Buffer {
  if (!cachedProbe) cachedProbe = createSolidPng(PROBE_W, PROBE_H);
  return cachedProbe;
}

function slotMaxLevels(slot: HudSlot): { wMax: number; hMax: number } {
  if (slot === "meta") return { wMax: 7, hMax: 60 };
  if (slot === "cmd") return { wMax: CMD_SEQ_MAX, hMax: 60 };
  return { wMax: 100, hMax: 100 };
}

export function getHudSlotPng(snap: ShopVoteSnapshot, slot: HudSlot): Buffer {
  const levels = levelsForSlot(snap, slot);
  const { wMax, hMax } = slotMaxLevels(slot);
  // meta: w=stage (0-7), h=timer/winner (0-60); cmd: w=seq (0-200), h=pack/skip (0-60); pct: 0-100
  const width = encodeLevel(levels.w, wMax);
  const height = encodeLevel(levels.h, hMax);
  return createSolidPng(width, height);
}
