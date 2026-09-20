import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryPctFromCats,
  CMD_SEQ_MAX,
  createSolidPng,
  decodeCmdHeight,
  decodeLevel,
  decodeWinnerCode,
  encodeLevel,
  encodeWinnerCode,
  getHudSlotPng,
  getProbePng,
  levelToStage,
  levelsForSlot,
  parseHudSlot,
  PNG_BASE,
  PNG_STEP,
  PROBE_H,
  PROBE_W,
  stageToLevel,
  tierPctFromSlots,
  timerSecondsFromSnapshot,
} from "./shop-vote-png.js";
import type { ShopVoteSnapshot } from "./shop-vote-controller.js";
import { SHOP_CMD_SEQ_MAX } from "./shop-vote-controller.js";

function fakeSnap(partial: Partial<ShopVoteSnapshot>): ShopVoteSnapshot {
  return {
    stage: "idle",
    shopOpen: false,
    autoStart: false,
    stageEndsAt: null,
    stageStartedAt: null,
    categoryTally: { weapon: 0, vitality: 0, spirit: 0 },
    tierTally: { "1": 0, "2": 0, "3": 0, "4": 0 },
    categoryPct: { weapon: 0, vitality: 0, spirit: 0 },
    tierPct: { "1": 0, "2": 0, "3": 0, "4": 0 },
    winnerCategory: null,
    winnerTier: null,
    lastSeq: 0,
    lastCfg: null,
    pending: false,
    cmdReceived: false,
    hero: "",
    lastRolled: null,
    lastPurchase: null,
    lastWaiting: null,
    lastError: null,
    pipeline: [],
    mockBotActive: false,
    mockBotEnabled: false,
    maxAffordableTier: null,
    categoryDurationMs: 25_000,
    tierDurationMs: 25_000,
    restartDelayMs: 25_000,
    recentVotes: [],
    settings: {
      autoStart: false,
      mockBotEnabled: false,
      categoryDurationMs: 25_000,
      tierDurationMs: 25_000,
      restartDelayMs: 25_000,
      defaultStartMode: "full",
      enabledCategories: ["weapon", "vitality", "spirit"],
      minTier: 1,
      maxTier: 4,
      requireBangPrefix: false,
      applyDelayMs: 0,
      mockBotIntervalMs: 900,
      overlayHoldMs: 8_000,
    },
    ...partial,
  };
}

/** Read IHDR width/height from a PNG buffer. */
function readPngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(buf.toString("ascii", 12, 16), "IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

test("encodeLevel / decodeLevel round-trip with STEP/BASE", () => {
  for (let level = 0; level <= 100; level++) {
    const dim = encodeLevel(level);
    assert.equal(dim, level * PNG_STEP + PNG_BASE);
    assert.equal(decodeLevel(dim, 1), level);
  }
  // ±2px engine noise must not cross a level boundary
  assert.equal(decodeLevel(encodeLevel(42) + 2, 1), 42);
  assert.equal(decodeLevel(encodeLevel(42) - 2, 1), 42);
});

test("decodeLevel respects UI scale", () => {
  const dim = encodeLevel(25);
  const scale = 0.75;
  const measured = dim * scale;
  assert.equal(decodeLevel(measured, scale), 25);
});

test("probe PNG is exactly 600x1000", () => {
  const png = getProbePng();
  const size = readPngSize(png);
  assert.equal(size.width, PROBE_W);
  assert.equal(size.height, PROBE_H);
  assert.equal(getProbePng(), png); // cached
});

test("createSolidPng writes valid IHDR size", () => {
  const size = readPngSize(createSolidPng(33, 99));
  assert.equal(size.width, 33);
  assert.equal(size.height, 99);
});

test("levelsForSlot matches snapshot percents and meta", () => {
  const snap = fakeSnap({
    stage: "voting_tier",
    categoryPct: { weapon: 40, vitality: 35, spirit: 25 },
    tierPct: { "1": 10, "2": 20, "3": 30, "4": 40 },
    stageEndsAt: Date.now() + 4500,
  });
  // Cats stay visible during voting_tier so HUD can keep winning category chrome.
  assert.deepEqual(levelsForSlot(snap, "cats"), { w: 40, h: 35 });
  assert.deepEqual(levelsForSlot(snap, "t12"), { w: 10, h: 20 });
  assert.deepEqual(levelsForSlot(snap, "t34"), { w: 30, h: 40 });
  const meta = levelsForSlot(snap, "meta");
  assert.equal(meta.w, stageToLevel("voting_tier"));
  assert.ok(meta.h >= 4 && meta.h <= 5);
});

test("levelsForSlot zeros percents outside matching vote stage", () => {
  // Post-vote keeps tallies so winner % stay visible on HUD.
  const applying = fakeSnap({
    stage: "applying",
    categoryPct: { weapon: 40, vitality: 35, spirit: 25 },
    tierPct: { "1": 38, "2": 25, "3": 25, "4": 12 },
    winnerCategory: "spirit",
    winnerTier: 1,
  });
  assert.deepEqual(levelsForSlot(applying, "cats"), { w: 40, h: 35 });
  assert.deepEqual(levelsForSlot(applying, "t12"), { w: 38, h: 25 });
  assert.deepEqual(levelsForSlot(applying, "t34"), { w: 25, h: 12 });
  assert.equal(levelsForSlot(applying, "meta").w, stageToLevel("applying"));

  // Direct apply / idle leftovers: zero tallies → zero slots.
  const directApply = fakeSnap({
    stage: "applying",
    categoryPct: { weapon: 0, vitality: 0, spirit: 0 },
    tierPct: { "1": 0, "2": 0, "3": 0, "4": 0 },
    winnerCategory: "spirit",
    winnerTier: 1,
  });
  assert.deepEqual(levelsForSlot(directApply, "cats"), { w: 0, h: 0 });
  assert.deepEqual(levelsForSlot(directApply, "t12"), { w: 0, h: 0 });

  const idle = fakeSnap({
    stage: "idle",
    categoryPct: { weapon: 40, vitality: 35, spirit: 25 },
    tierPct: { "1": 10, "2": 20, "3": 30, "4": 40 },
  });
  assert.deepEqual(levelsForSlot(idle, "cats"), { w: 0, h: 0 });
  assert.deepEqual(levelsForSlot(idle, "t12"), { w: 0, h: 0 });

  const purchased = fakeSnap({
    stage: "purchased",
    categoryPct: { weapon: 0, vitality: 0, spirit: 0 },
    tierPct: { "1": 0, "2": 0, "3": 0, "4": 0 },
    winnerCategory: null,
    winnerTier: null,
  });
  assert.deepEqual(levelsForSlot(purchased, "cats"), { w: 0, h: 0 });
  assert.deepEqual(levelsForSlot(purchased, "t12"), { w: 0, h: 0 });
  assert.deepEqual(levelsForSlot(purchased, "t34"), { w: 0, h: 0 });
  assert.equal(levelsForSlot(purchased, "meta").w, stageToLevel("purchased"));
  assert.equal(levelsForSlot(purchased, "meta").h, 0);

  const catVote = fakeSnap({
    stage: "voting_category",
    categoryPct: { weapon: 50, vitality: 25, spirit: 25 },
    tierPct: { "1": 10, "2": 20, "3": 30, "4": 40 },
  });
  assert.deepEqual(levelsForSlot(catVote, "cats"), { w: 50, h: 25 });
  assert.deepEqual(levelsForSlot(catVote, "t12"), { w: 0, h: 0 });
  assert.deepEqual(levelsForSlot(catVote, "t34"), { w: 0, h: 0 });
});

test("hud slot PNG encodes levels as pixel size", () => {
  const snap = fakeSnap({
    stage: "voting_category",
    categoryPct: { weapon: 50, vitality: 25, spirit: 25 },
  });
  const png = getHudSlotPng(snap, "cats");
  const size = readPngSize(png);
  assert.equal(size.width, encodeLevel(50));
  assert.equal(size.height, encodeLevel(25));
});

test("meta slot encodes stage and timer during voting", () => {
  const snap = fakeSnap({
    stage: "voting_tier",
    stageEndsAt: Date.now() + 4500,
    winnerCategory: "weapon",
    winnerTier: 2,
  });
  const meta = levelsForSlot(snap, "meta");
  assert.equal(meta.w, stageToLevel("voting_tier"));
  assert.ok(meta.h >= 4 && meta.h <= 5); // timer, not winner
});

test("meta slot encodes winner code after voting", () => {
  const snap = fakeSnap({
    stage: "applying",
    stageEndsAt: null,
    winnerCategory: "spirit",
    winnerTier: 4,
  });
  const png = getHudSlotPng(snap, "meta");
  const size = readPngSize(png);
  assert.equal(size.width, encodeLevel(stageToLevel("applying"), 7));
  assert.equal(size.height, encodeLevel(encodeWinnerCode("spirit", 4), 60));
  assert.equal(levelToStage(decodeLevel(size.width, 1, 7)), "applying");
  const decoded = decodeWinnerCode(decodeLevel(size.height, 1, 60));
  assert.deepEqual(decoded, { category: "spirit", tier: 4 });
});

test("encodeWinnerCode / decodeWinnerCode round-trip", () => {
  assert.equal(encodeWinnerCode("weapon", 1), 11);
  assert.equal(encodeWinnerCode("vitality", 3), 23);
  assert.equal(encodeWinnerCode("spirit", 4), 34);
  assert.equal(encodeWinnerCode(null, 2), 0);
  assert.deepEqual(decodeWinnerCode(11), { category: "weapon", tier: 1 });
  assert.deepEqual(decodeWinnerCode(23), { category: "vitality", tier: 3 });
  assert.deepEqual(decodeWinnerCode(0), { category: null, tier: null });
  assert.deepEqual(decodeWinnerCode(5), { category: null, tier: null });
});

test("categoryPctFromCats restores spirit remainder", () => {
  assert.deepEqual(categoryPctFromCats(0, 0), { weapon: 0, vitality: 0, spirit: 0 });
  assert.deepEqual(categoryPctFromCats(40, 35), { weapon: 40, vitality: 35, spirit: 25 });
  assert.deepEqual(categoryPctFromCats(50, 50), { weapon: 50, vitality: 50, spirit: 0 });
});

test("tierPctFromSlots and parseHudSlot", () => {
  assert.deepEqual(tierPctFromSlots(10, 20, 30, 40), {
    "1": 10,
    "2": 20,
    "3": 30,
    "4": 40,
  });
  assert.equal(parseHudSlot("cats"), "cats");
  assert.equal(parseHudSlot("cmd"), "cmd");
  assert.equal(parseHudSlot("nope"), null);
  assert.equal(timerSecondsFromSnapshot({ stageEndsAt: null }), 0);
});

test("cmd slot encodes pending apply as seq + cat*10+tier", () => {
  assert.equal(CMD_SEQ_MAX, SHOP_CMD_SEQ_MAX);
  const snap = fakeSnap({
    stage: "applying",
    lastSeq: 42,
    lastCfg: { seq: 42, cat: 3, tier: 2 },
    pending: true,
    winnerCategory: "spirit",
    winnerTier: 2,
  });
  const levels = levelsForSlot(snap, "cmd");
  assert.deepEqual(levels, { w: 42, h: 32 });
  assert.deepEqual(decodeCmdHeight(levels.h), { cat: 3, tier: 2 });

  const png = getHudSlotPng(snap, "cmd");
  const size = readPngSize(png);
  assert.equal(size.width, encodeLevel(42, CMD_SEQ_MAX));
  assert.equal(size.height, encodeLevel(32, 60));
  assert.equal(decodeLevel(size.width, 1, CMD_SEQ_MAX), 42);
  assert.deepEqual(decodeCmdHeight(decodeLevel(size.height, 1, 60)), { cat: 3, tier: 2 });
});

test("cmd slot encodes skip as h=0 with bumped seq", () => {
  const snap = fakeSnap({
    stage: "idle",
    lastSeq: 7,
    lastCfg: { seq: 7, cat: 0, tier: 0 },
    pending: false,
  });
  const levels = levelsForSlot(snap, "cmd");
  assert.deepEqual(levels, { w: 7, h: 0 });
  assert.deepEqual(decodeCmdHeight(0), { cat: 0, tier: 0 });

  const png = getHudSlotPng(snap, "cmd");
  const size = readPngSize(png);
  assert.equal(size.width, encodeLevel(7, CMD_SEQ_MAX));
  assert.equal(size.height, encodeLevel(0, 60));
  assert.equal(decodeLevel(size.width, 1, CMD_SEQ_MAX), 7);
  assert.equal(decodeLevel(size.height, 1, 60), 0);
});

test("cmd slot is empty when no lastCfg", () => {
  assert.deepEqual(levelsForSlot(fakeSnap({ lastCfg: null }), "cmd"), { w: 0, h: 0 });
});

test("decodeCmdHeight rejects invalid packs", () => {
  assert.deepEqual(decodeCmdHeight(11), { cat: 1, tier: 1 });
  assert.deepEqual(decodeCmdHeight(34), { cat: 3, tier: 4 });
  assert.deepEqual(decodeCmdHeight(5), { cat: 0, tier: 0 });
  assert.deepEqual(decodeCmdHeight(19), { cat: 0, tier: 0 }); // tier 9 invalid
  assert.deepEqual(decodeCmdHeight(45), { cat: 0, tier: 0 }); // cat 4 invalid
});