import assert from "node:assert/strict";
import test from "node:test";
import { GameEventBus } from "../game/game-event-bus.js";
import type { GameCommandClient } from "../game/game-command-client.js";
import {
  ShopVoteController,
  maxAffordableTierFromSouls,
  parseShopCategory,
  parseShopTier,
  pickItemWinnerIndex,
  tallyPercents,
} from "./shop-vote-controller.js";

function makeFakeClient(sent?: string[][]): GameCommandClient {
  return {
    sendCommand: async () => undefined,
    sendCommands: async (cmds) => {
      if (sent) sent.push([...cmds]);
    },
  };
}

test("tallyPercents: zero total → all 0", () => {
  const pct = tallyPercents({ weapon: 0, vitality: 0, spirit: 0 }, ["weapon", "vitality", "spirit"]);
  assert.deepEqual(pct, { weapon: 0, vitality: 0, spirit: 0 });
});

test("tallyPercents: 1/1/2 → 25/25/50", () => {
  const pct = tallyPercents({ weapon: 1, vitality: 1, spirit: 2 }, ["weapon", "vitality", "spirit"]);
  assert.deepEqual(pct, { weapon: 25, vitality: 25, spirit: 50 });
  assert.equal(pct.weapon + pct.vitality + pct.spirit, 100);
});

test("tallyPercents: largest remainder sums to 100", () => {
  const pct = tallyPercents({ "1": 1, "2": 1, "3": 1 }, ["1", "2", "3"]);
  assert.equal(pct["1"] + pct["2"] + pct["3"], 100);
  assert.ok(Object.values(pct).every((n) => n === 33 || n === 34));
});

test("vote start writes banner png; immediate restart does not", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });
  await ctrl.start("category");
  const started = ctrl.getSnapshot();
  assert.equal(started.stage, "voting_category");
  assert.equal(started.bannerSeq, 1);
  assert.equal(started.bannerKind, 1);
  assert.equal(started.bannerWin, 0);

  await ctrl.start("category");
  const restartedSoon = ctrl.getSnapshot();
  assert.equal(restartedSoon.bannerSeq, 1);
  assert.equal(restartedSoon.bannerKind, 1);

  ctrl.cancel();
  const ended = ctrl.getSnapshot();
  assert.equal(ended.stage, "idle");
  assert.equal(ended.bannerKind, 4);
  assert.equal(ended.bannerSeq, 2);
});

test("banner test png does not change shop stage or apply seq", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });
  const before = ctrl.getSnapshot();
  const result = await ctrl.showTestBanner(4, 11);
  const after = ctrl.getSnapshot();
  assert.deepEqual(result, { seq: 1, kind: 4, win: 11 });
  assert.equal(after.stage, before.stage);
  assert.equal(after.lastSeq, before.lastSeq);
  assert.equal(after.bannerSeq, 1);
  assert.equal(after.bannerKind, 4);
  assert.equal(after.bannerWin, 11);
  assert.equal(sent.length, 0);
  ctrl.cancel();
});

test("parseShopCategory / parseShopTier", () => {
  assert.equal(parseShopCategory("weapon"), "weapon");
  assert.equal(parseShopCategory(2), "vitality");
  assert.equal(parseShopTier("3"), 3);
  assert.equal(parseShopTier(9), null);
});

test("vote apply stays pending when shop closed; cmd kept in getShopCmd", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 50,
    tierDurationMs: 50,
    mockBotIntervalMs: 10_000,
  });

  assert.equal(ctrl.getSnapshot().shopOpen, false);
  await ctrl.apply("weapon", 2);
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "applying");
  assert.equal(snap.pending, true);
  assert.equal(snap.lastCfg?.cat, 1);
  assert.equal(snap.lastCfg?.tier, 2);
  const cmd = ctrl.getShopCmd();
  assert.ok(cmd.seq > 0);
  assert.equal(cmd.pending, true);
  ctrl.cancel();
});

test("direct apply clears leftover vote tallies to 0%", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("spirit");
  ctrl.cast("spirit");
  ctrl.cast("weapon");
  // Simulate leftover by applying mid-vote (clears timers + tallies).
  await ctrl.apply("spirit", 1);
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "applying");
  assert.deepEqual(snap.categoryPct, { weapon: 0, vitality: 0, spirit: 0 });
  assert.deepEqual(snap.tierPct, { "1": 0, "2": 0, "3": 0, "4": 0 });
  assert.equal(snap.winnerCategory, "spirit");
  assert.equal(snap.winnerTier, 1);
  ctrl.cancel();
});

test("beginTierVote keeps category tallies for post-vote HUD", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 30,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("category");
  ctrl.cast("weapon");
  ctrl.cast("weapon");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(ctrl.getSnapshot().stage, "idle");
  assert.equal(ctrl.getSnapshot().winnerCategory, "weapon");
  assert.ok(ctrl.getSnapshot().categoryPct.weapon > 0);

  await ctrl.start("tier");
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "voting_tier");
  assert.equal(snap.winnerCategory, "weapon");
  assert.ok(snap.categoryPct.weapon > 0);
  ctrl.cancel();
});

test("shop_rolled goes to waiting_shop; shop_cmd alone does not ack", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);

  await ctrl.apply("spirit", 1);

  bus.ingest(
    { v: 1, id: "cmd-early", tsMs: Date.now(), type: "shop_cmd", payload: { seq: 1 } },
    "http",
  );
  assert.equal(ctrl.getSnapshot().cmdReceived, false);
  assert.equal(ctrl.getSnapshot().stage, "applying");

  bus.ingest(
    {
      v: 1,
      id: "rolled-1",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Extra Charge", cls: "extraCharge", tier: 1 },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");
  assert.equal(ctrl.getSnapshot().cmdReceived, true);
  assert.equal(ctrl.getSnapshot().lastWaiting?.reason, "awaiting_shop_range");

  bus.ingest(
    {
      v: 1,
      id: "wait-1",
      tsMs: Date.now(),
      type: "shop_purchase_waiting",
      payload: { reason: "out_of_range", name: "Extra Charge" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");
  assert.equal(ctrl.getSnapshot().lastWaiting?.reason, "out_of_range");

  bus.ingest(
    { v: 1, id: "close-1", tsMs: Date.now(), type: "shop_closed", payload: { open: false } },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");
  assert.equal(ctrl.getSnapshot().shopOpen, false);

  bus.ingest(
    { v: 1, id: "open-1", tsMs: Date.now(), type: "shop_open", payload: { open: true } },
    "http",
  );
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");

  bus.ingest(
    {
      v: 1,
      id: "buy-1",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: true, name: "Extra Charge" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "purchased");
  assert.equal(ctrl.getSnapshot().lastPurchase?.ok, true);
  assert.deepEqual(ctrl.getSnapshot().categoryPct, { weapon: 0, vitality: 0, spirit: 0 });
  assert.deepEqual(ctrl.getSnapshot().tierPct, { "1": 0, "2": 0, "3": 0, "4": 0 });
  assert.equal(ctrl.getSnapshot().winnerCategory, null);
  assert.equal(ctrl.getSnapshot().winnerTier, null);
  ctrl.cancel();
});

test("vote tallies survive waiting_shop until purchase", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 40,
    tierDurationMs: 40,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cast("weapon");
  ctrl.cast("weapon");
  ctrl.cast("2");
  ctrl.cast("2");
  await new Promise((r) => setTimeout(r, 80));

  bus.ingest(
    {
      v: 1,
      id: "rolled-keep",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Rapid Rounds", cls: "rapidRounds", tier: 2 },
    },
    "http",
  );
  const waiting = ctrl.getSnapshot();
  assert.equal(waiting.stage, "waiting_shop");
  // Tallies from vote must still be visible (not cleared until purchase).
  assert.ok(
    waiting.categoryPct.weapon > 0 ||
      waiting.tierPct["1"] > 0 ||
      waiting.tierPct["2"] > 0 ||
      waiting.tierPct["3"] > 0 ||
      waiting.tierPct["4"] > 0 ||
      waiting.winnerCategory != null,
    "expected vote results to remain while waiting_shop",
  );

  bus.ingest(
    {
      v: 1,
      id: "buy-keep",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: true, name: "Rapid Rounds" },
    },
    "http",
  );
  const bought = ctrl.getSnapshot();
  assert.equal(bought.stage, "purchased");
  assert.deepEqual(bought.categoryPct, { weapon: 0, vitality: 0, spirit: 0 });
  assert.deepEqual(bought.tierPct, { "1": 0, "2": 0, "3": 0, "4": 0 });
  assert.equal(bought.winnerCategory, null);
  assert.equal(bought.winnerTier, null);
  ctrl.cancel();
});

test("dom_not_ready is soft wait, not failed", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);
  await ctrl.apply("weapon", 1);
  bus.ingest(
    {
      v: 1,
      id: "dom-1",
      tsMs: Date.now(),
      type: "shop_error",
      payload: { reason: "dom_not_ready", seq: 1 },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");
  assert.equal(ctrl.getSnapshot().lastWaiting?.reason, "dom_not_ready");
  ctrl.cancel();
});

test("shop_closed does not cancel active voting or applying", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("category");
  assert.equal(ctrl.getSnapshot().stage, "voting_category");
  bus.ingest(
    { v: 1, id: "o1", tsMs: Date.now(), type: "shop_open", payload: {} },
    "http",
  );
  bus.ingest(
    { v: 1, id: "c1", tsMs: Date.now(), type: "shop_closed", payload: {} },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "voting_category");
  assert.equal(ctrl.getSnapshot().shopOpen, false);

  await ctrl.apply("weapon", 1);
  assert.equal(ctrl.getSnapshot().stage, "applying");
  bus.ingest(
    { v: 1, id: "c2", tsMs: Date.now(), type: "shop_closed", payload: {} },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "applying");
  ctrl.cancel();
});

test("GameEventBus tracks shopOpen from shop_open/shop_closed", () => {
  const bus = new GameEventBus();
  bus.ingest(
    { v: 1, id: "so", tsMs: Date.now(), type: "shop_open", payload: {} },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, true);
  assert.equal(bus.getModStatus().match.phase, "shop");

  bus.ingest(
    { v: 1, id: "sc", tsMs: Date.now(), type: "shop_closed", payload: {} },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, false);
});

test("syncFromMatchPhase prefers shopOpen hint", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);
  ctrl.syncFromMatchPhase("in_match", true);
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  ctrl.syncFromMatchPhase("shop", false);
  assert.equal(ctrl.getSnapshot().shopOpen, false);
  ctrl.cancel();
});

test("shop_open survives heartbeat phase=in_match without shopOpen", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);

  bus.ingest(
    { v: 1, id: "so", tsMs: Date.now(), type: "shop_open", payload: {} },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, true);
  assert.equal(ctrl.getSnapshot().shopOpen, true);

  // Heartbeat without shopOpen must not wipe shop_open.
  bus.ingest(
    {
      v: 1,
      id: "hb-1",
      tsMs: Date.now(),
      type: "heartbeat",
      payload: { phase: "in_match" },
    },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, true);
  ctrl.syncFromMatchPhase(
    bus.getModStatus().match.phase || "",
    bus.getModStatus().match.shopOpen,
  );
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  ctrl.cancel();
});

test("syncFromMatchPhase null hint does not force-close", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);
  ctrl.syncFromMatchPhase("shop", true);
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  ctrl.syncFromMatchPhase("in_match", null);
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  ctrl.syncFromMatchPhase("in_match", undefined);
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  ctrl.cancel();
});

test("explicit shopOpen false in heartbeat closes shop", () => {
  const bus = new GameEventBus();
  bus.ingest(
    { v: 1, id: "so2", tsMs: Date.now(), type: "shop_open", payload: {} },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, true);
  bus.ingest(
    {
      v: 1,
      id: "hb-close",
      tsMs: Date.now(),
      type: "heartbeat",
      payload: { phase: "in_match", shopOpen: false },
    },
    "http",
  );
  assert.equal(bus.getModStatus().match.shopOpen, false);
});

test("start() does not enable mock bot automatically", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 20,
  });

  await ctrl.start("full");
  const snap = ctrl.getSnapshot();
  assert.equal(snap.mockBotEnabled, false);
  assert.equal(snap.mockBotActive, false);
  ctrl.cast("weapon");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(ctrl.getSnapshot().categoryTally, { weapon: 1, vitality: 0, spirit: 0 });
  ctrl.cancel();
});

test("same userId changing vote does not increment total", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("weapon", "alice");
  ctrl.cast("vitality", "alice");
  const snap = ctrl.getSnapshot();
  assert.equal(snap.categoryTally.weapon, 0);
  assert.equal(snap.categoryTally.vitality, 1);
  assert.equal(snap.categoryTally.spirit, 0);
  assert.equal(snap.categoryTally.weapon + snap.categoryTally.vitality + snap.categoryTally.spirit, 1);

  ctrl.cast("spirit");
  ctrl.cast("spirit");
  const afterClicks = ctrl.getSnapshot();
  assert.equal(afterClicks.categoryTally.vitality, 1);
  assert.equal(afterClicks.categoryTally.spirit, 2);
  assert.equal(
    afterClicks.categoryTally.weapon + afterClicks.categoryTally.vitality + afterClicks.categoryTally.spirit,
    3,
  );
  ctrl.cancel();
});

test("skip clears pending and returns to idle", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus);

  await ctrl.apply("weapon", 1);
  assert.equal(ctrl.getSnapshot().stage, "applying");
  assert.equal(ctrl.getSnapshot().pending, true);

  bus.ingest(
    {
      v: 1,
      id: "rolled-skip",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Extra Charge", cls: "extraCharge", tier: 1 },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");

  await ctrl.skip();
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "idle");
  assert.equal(snap.pending, false);
  assert.equal(snap.lastCfg?.cat, 0);
  assert.equal(snap.lastCfg?.tier, 0);
  assert.ok(snap.lastSeq > 0);
  const shopCmd = ctrl.getShopCmd();
  assert.equal(shopCmd.seq, snap.lastSeq);
  assert.equal(shopCmd.cat, 0);
  assert.equal(shopCmd.tier, 0);
  assert.equal(shopCmd.pending, false);
  const skipCmds = sent.find((cmds) => cmds.includes("bridge_shop_cat 0"));
  assert.ok(skipCmds, "expected skip cfg cat=0 / tier=0 / bumped seq");
  assert.ok(skipCmds.some((c) => c.startsWith("bridge_shop_seq ")));
  assert.ok(skipCmds.includes("bridge_shop_tier 0"));

  bus.ingest(
    {
      v: 1,
      id: "rolled-after-skip",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Should Ignore", cls: "ignored", tier: 1 },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "idle");
  assert.equal(ctrl.getSnapshot().pending, false);
  ctrl.cancel();
});

test("failed purchase clears vote tallies", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 40,
    tierDurationMs: 40,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("weapon");
  ctrl.cast("1");
  await new Promise((r) => setTimeout(r, 80));
  bus.ingest(
    {
      v: 1,
      id: "rolled-fail",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Rapid Rounds", cls: "rapidRounds", tier: 1 },
    },
    "http",
  );
  bus.ingest(
    {
      v: 1,
      id: "buy-fail",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: false, name: "Rapid Rounds" },
    },
    "http",
  );
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "failed");
  assert.deepEqual(snap.categoryPct, { weapon: 0, vitality: 0, spirit: 0 });
  assert.deepEqual(snap.tierPct, { "1": 0, "2": 0, "3": 0, "4": 0 });
  assert.equal(snap.winnerCategory, null);
  assert.equal(snap.winnerTier, null);
  ctrl.cancel();
});

test("full start opens voting_combined; independent last-wins per axis", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");

  ctrl.cast("weapon", "alice");
  ctrl.cast("1", "alice");
  ctrl.cast("vitality", "alice");
  ctrl.cast("2", "alice");
  const snap = ctrl.getSnapshot();
  assert.equal(snap.categoryTally.weapon, 0);
  assert.equal(snap.categoryTally.vitality, 1);
  assert.equal(snap.tierTally["1"], 0);
  assert.equal(snap.tierTally["2"], 1);

  // Same choice again is a no-op
  ctrl.cast("vitality", "alice");
  ctrl.cast("2", "alice");
  assert.equal(ctrl.getSnapshot().categoryTally.vitality, 1);
  assert.equal(ctrl.getSnapshot().tierTally["2"], 1);
  ctrl.cancel();
});

test("voting_combined finishes with both winners and applies", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    categoryDurationMs: 40,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("spirit");
  ctrl.cast("spirit");
  ctrl.cast("3");
  ctrl.cast("3");
  await new Promise((r) => setTimeout(r, 80));
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "applying");
  assert.equal(snap.winnerCategory, "spirit");
  assert.equal(snap.winnerTier, 3);
  assert.ok(sent.length >= 1);
  ctrl.cancel();
});

test("autoStart after purchase waits then starts a new full vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });

  ctrl.setAutoStart(true);
  await ctrl.apply("weapon", 1);
  // Shop may be closed — auto-restart must still fire.
  assert.equal(ctrl.getSnapshot().shopOpen, false);
  bus.ingest(
    {
      v: 1,
      id: "rolled-restart",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Extra Charge", cls: "extraCharge", tier: 1 },
    },
    "http",
  );
  bus.ingest(
    {
      v: 1,
      id: "buy-restart",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: true, name: "Extra Charge" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "purchased");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart after item skip waits then starts a new full vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });

  ctrl.setAutoStart(true);
  await ctrl.apply("weapon", 1);
  bus.ingest(
    {
      v: 1,
      id: "rolled-skip-restart",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Extra Charge", cls: "extraCharge", tier: 1 },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "waiting_shop");
  bus.ingest(
    {
      v: 1,
      id: "hud-skip-restart",
      tsMs: Date.now(),
      type: "shop_vote_skip",
      payload: { source: "hud" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "idle");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart after failed purchase waits then starts a new full vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });

  ctrl.setAutoStart(true);
  await ctrl.apply("weapon", 1);
  bus.ingest(
    {
      v: 1,
      id: "rolled-fail-restart",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { name: "Extra Charge", cls: "extraCharge", tier: 1 },
    },
    "http",
  );
  bus.ingest(
    {
      v: 1,
      id: "buy-fail-restart",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: false, name: "Extra Charge" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "failed");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart on in_match schedules first vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });
  ctrl.setAutoStart(true);
  assert.equal(ctrl.getSnapshot().stage, "idle");
  bus.ingest(
    {
      v: 1,
      id: "phase-pregame",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "pregame" },
    },
    "http",
  );
  assert.equal(ctrl.getSnapshot().stage, "idle");
  bus.ingest(
    {
      v: 1,
      id: "phase-in-match",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "in_match" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart schedules when enabling mid-match via syncFromMatchPhase", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });
  ctrl.syncFromMatchPhase("in_match", false);
  assert.equal(ctrl.getSnapshot().stage, "idle");
  ctrl.setAutoStart(true);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart schedules on paused→in_match (custom lobby false pause)", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 100,
    autoStartIntervalMaxMs: 100,
    mockBotIntervalMs: 60_000,
  });
  ctrl.setAutoStart(true);
  // False pause first — still "inside" match for auto-start (paused is active).
  bus.ingest(
    {
      v: 1,
      id: "phase-paused-first",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "paused" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("autoStart cancelled on match_end", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    autoStartIntervalMinMs: 200,
    autoStartIntervalMaxMs: 200,
    mockBotIntervalMs: 60_000,
  });
  ctrl.setAutoStart(true);
  bus.ingest(
    {
      v: 1,
      id: "phase-in-match-2",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "in_match" },
    },
    "http",
  );
  bus.ingest(
    {
      v: 1,
      id: "phase-end",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "match_end" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(ctrl.getSnapshot().stage, "idle");
  ctrl.cancel();
});

test("start clears recentVotes", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });
  await ctrl.start("full");
  ctrl.cast("weapon");
  assert.ok(ctrl.getSnapshot().recentVotes.length >= 1);
  await ctrl.start("full");
  assert.equal(ctrl.getSnapshot().recentVotes.length, 0);
  ctrl.cancel();
});

test("autoStart does not start vote when shop opens", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });
  ctrl.setAutoStart(true);
  assert.equal(ctrl.getSnapshot().stage, "idle");
  bus.ingest(
    { v: 1, id: "open-no-autostart", tsMs: Date.now(), type: "shop_open", payload: {} },
    "http",
  );
  assert.equal(ctrl.getSnapshot().shopOpen, true);
  assert.equal(ctrl.getSnapshot().stage, "idle");
  ctrl.cancel();
});

test("shop_vote_start starts a full vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });
  bus.ingest(
    {
      v: 1,
      id: "hud-start-1",
      tsMs: Date.now(),
      type: "shop_vote_start",
      payload: { source: "hud" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  ctrl.cancel();
});

test("shop_vote_start ignored when allowHudStart is false", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
    settings: { allowHudStart: false },
  });
  bus.ingest(
    {
      v: 1,
      id: "hud-start-blocked",
      tsMs: Date.now(),
      type: "shop_vote_start",
      payload: { source: "hud" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctrl.getSnapshot().stage, "idle");
  ctrl.cancel();
});

test("shop_vote_start during vote ignored when hudCanRestart is false", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
    settings: { hudCanRestart: false },
  });
  await ctrl.start("full");
  ctrl.cast("weapon");
  bus.ingest(
    {
      v: 1,
      id: "hud-restart-blocked",
      tsMs: Date.now(),
      type: "shop_vote_start",
      payload: { source: "hud" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctrl.getSnapshot().stage, "voting_combined");
  assert.ok((ctrl.getSnapshot().categoryTally.weapon ?? 0) >= 1);
  ctrl.cancel();
});

test("shop_vote_skip aborts applying pipeline", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus);
  await ctrl.apply("weapon", 1);
  assert.equal(ctrl.getSnapshot().stage, "applying");
  bus.ingest(
    {
      v: 1,
      id: "hud-skip-1",
      tsMs: Date.now(),
      type: "shop_vote_skip",
      payload: { source: "hud" },
    },
    "http",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctrl.getSnapshot().stage, "idle");
  ctrl.cancel();
});

test("shop cmd seq wraps at 200 so PNG levels stay encodable", async () => {
  const ctrl = new ShopVoteController(makeFakeClient(), new GameEventBus());
  for (let i = 0; i < 200; i++) {
    await ctrl.apply("weapon", 1);
  }
  assert.equal(ctrl.getSnapshot().lastSeq, 200);
  assert.equal(ctrl.getShopCmd().seq, 200);
  await ctrl.apply("vitality", 2);
  assert.equal(ctrl.getSnapshot().lastSeq, 1);
  assert.equal(ctrl.getShopCmd().seq, 1);
  assert.equal(ctrl.getShopCmd().cat, 2);
  assert.equal(ctrl.getShopCmd().tier, 2);
  ctrl.cancel();
});

test("maxAffordableTierFromSouls uses hardcoded TIER_COSTS", () => {
  assert.equal(maxAffordableTierFromSouls(null), null);
  assert.equal(maxAffordableTierFromSouls(-1), null);
  assert.equal(maxAffordableTierFromSouls(0), null);
  assert.equal(maxAffordableTierFromSouls(799), null);
  assert.equal(maxAffordableTierFromSouls(800), 1);
  assert.equal(maxAffordableTierFromSouls(1600), 2);
  assert.equal(maxAffordableTierFromSouls(5000), 3);
  assert.equal(maxAffordableTierFromSouls(6400), 4);
});

test("mock bot respects maxAffordableTier when set; unrestricted by default", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 15,
    mockBotVotesPerTick: 3,
    mockBotEnabled: true,
    maxAffordableTier: 2,
  });

  assert.equal(ctrl.getSnapshot().maxAffordableTier, 2);
  await ctrl.start("tier");
  assert.equal(ctrl.getSnapshot().stage, "voting_tier");
  await new Promise((r) => setTimeout(r, 80));
  const tally = ctrl.getSnapshot().tierTally;
  assert.equal(tally["3"], 0);
  assert.equal(tally["4"], 0);
  assert.ok(tally["1"] + tally["2"] > 0, "expected mock votes on T1/T2 only");

  ctrl.setMaxAffordableTier(null);
  assert.equal(ctrl.getSnapshot().maxAffordableTier, null);
  ctrl.cancel();
});

test("cast ignores disabled categories and tiers", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
    settings: {
      enabledCategories: ["weapon", "spirit"],
      minTier: 2,
      maxTier: 3,
    },
  });
  await ctrl.start("full");
  ctrl.cast("vitality", "alice");
  assert.equal(ctrl.getSnapshot().categoryTally.vitality, 0);
  ctrl.cast("weapon", "alice");
  assert.equal(ctrl.getSnapshot().categoryTally.weapon, 1);
  ctrl.cancel();

  await ctrl.start("tier");
  ctrl.cast("1", "bob");
  assert.equal(ctrl.getSnapshot().tierTally["1"], 0);
  ctrl.cast("4", "bob");
  assert.equal(ctrl.getSnapshot().tierTally["4"], 0);
  ctrl.cast("2", "bob");
  assert.equal(ctrl.getSnapshot().tierTally["2"], 1);
  ctrl.cancel();
});

test("skips category stage when only one category enabled", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
    settings: { enabledCategories: ["spirit"] },
  });
  await ctrl.start("full");
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "voting_tier");
  assert.equal(snap.winnerCategory, "spirit");
  ctrl.cancel();
});

test("skips tier stage when only one tier enabled and applies", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
    settings: {
      enabledCategories: ["weapon"],
      minTier: 2,
      maxTier: 2,
      applyDelayMs: 0,
    },
  });
  await ctrl.start("full");
  assert.equal(ctrl.getSnapshot().stage, "applying");
  assert.equal(ctrl.getSnapshot().winnerCategory, "weapon");
  assert.equal(ctrl.getSnapshot().winnerTier, 2);
  assert.ok(sent.length >= 1);
  ctrl.cancel();
});

test("applyDelayMs waits before sendCfg", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    categoryDurationMs: 30,
    tierDurationMs: 30,
    mockBotIntervalMs: 60_000,
    settings: {
      enabledCategories: ["weapon"],
      minTier: 1,
      maxTier: 1,
      applyDelayMs: 60,
    },
  });
  await ctrl.start("full");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(sent.length >= 1);
  assert.equal(ctrl.getSnapshot().stage, "applying");
  ctrl.cancel();
});

test("applySettings updates snapshot.settings and defaultStartMode", () => {
  const ctrl = new ShopVoteController(makeFakeClient(), new GameEventBus());
  ctrl.applySettings({
    defaultStartMode: "tier",
    requireBangPrefix: true,
    overlayHoldMs: 5000,
    allowHudStart: false,
    hudCanRestart: false,
  });
  const s = ctrl.getSettings();
  assert.equal(s.defaultStartMode, "tier");
  assert.equal(s.requireBangPrefix, true);
  assert.equal(s.overlayHoldMs, 5000);
  assert.equal(s.allowHudStart, false);
  assert.equal(s.hudCanRestart, false);
  assert.equal(ctrl.getSnapshot().settings.overlayHoldMs, 5000);
  ctrl.cancel();
});

test("items mode starts voting_items and applies winner by class_name", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    settings: {
      itemDurationMs: 50,
      applyDelayMs: 0,
      mockBotEnabled: false,
      defaultStartMode: "items",
    },
    mockBotIntervalMs: 60_000,
  });
  await ctrl.start("items");
  assert.equal(ctrl.getSnapshot().stage, "voting_items");
  assert.equal(ctrl.getSnapshot().catalogItems.length, 0);
  assert.ok(!sent.some((cmds) => cmds.some((c) => c.startsWith("bridge_shop_scan "))));

  ctrl.cast("class:upgrade_stamina", "alice", {
    category: "vitality",
    tier: 1,
    name: "Extra Stamina",
  });
  assert.equal(ctrl.getSnapshot().catalogItems.length, 1);
  assert.equal(ctrl.getSnapshot().itemTally[0], 1);

  await new Promise((r) => setTimeout(r, 80));
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "applying");
  assert.equal(snap.winnerItemIndex, 0);
  assert.equal(snap.winnerCategory, "vitality");
  assert.equal(snap.winnerTier, 1);
  assert.equal(snap.lastCfg?.cls, "upgrade_stamina");
  assert.ok(sent.some((cmds) => cmds.includes("bridge_shop_cls upgrade_stamina")));
  ctrl.cancel();
});

test("pickItemWinnerIndex random_among_voted ignores zero-vote items", () => {
  const tally = [0, 3, 0, 1, 0];
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const idx = pickItemWinnerIndex(tally, "random_among_voted", () => i / 40);
    seen.add(idx);
    assert.ok(idx === 1 || idx === 3, `unexpected winner ${idx}`);
  }
  assert.ok(seen.has(1) && seen.has(3));
});

test("pickItemWinnerIndex random_among_voted with no votes picks any catalog index", () => {
  const tally = [0, 0, 0];
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) {
    seen.add(pickItemWinnerIndex(tally, "random_among_voted", () => i / 30));
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test("pickItemWinnerIndex plurality picks highest tally", () => {
  assert.equal(pickItemWinnerIndex([1, 5, 2], "plurality", () => 0), 1);
  // ties among leaders
  const tied = pickItemWinnerIndex([3, 1, 3], "plurality", () => 0.9);
  assert.ok(tied === 0 || tied === 2);
});

test("items vote random_among_voted never picks zero-vote item", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    settings: {
      itemDurationMs: 40,
      applyDelayMs: 0,
      mockBotEnabled: false,
      defaultStartMode: "items",
      itemWinnerMode: "random_among_voted",
    },
    mockBotIntervalMs: 60_000,
  });
  await ctrl.start("items");
  ctrl.cast("class:upgrade_a", "u1", { category: "weapon", tier: 1, name: "A" });
  ctrl.cast("class:upgrade_c", "u2", { category: "spirit", tier: 2, name: "C" });
  // Register B with no lasting vote (switch away).
  ctrl.cast("class:upgrade_b", "u3", { category: "weapon", tier: 1, name: "B" });
  ctrl.cast("class:upgrade_a", "u3", { category: "weapon", tier: 1, name: "A" });
  await new Promise((r) => setTimeout(r, 70));
  const snap = ctrl.getSnapshot();
  assert.equal(snap.stage, "applying");
  const winnerCls = snap.catalogItems[snap.winnerItemIndex ?? -1]?.cls;
  assert.ok(winnerCls === "upgrade_a" || winnerCls === "upgrade_c");
  assert.notEqual(winnerCls, "upgrade_b");
  ctrl.cancel();
});

test("items vote plurality still picks top tally", async () => {
  const sent: string[][] = [];
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(sent), bus, {
    settings: {
      itemDurationMs: 40,
      applyDelayMs: 0,
      mockBotEnabled: false,
      defaultStartMode: "items",
      itemWinnerMode: "plurality",
    },
    mockBotIntervalMs: 60_000,
  });
  await ctrl.start("items");
  ctrl.cast("class:upgrade_a", "u1", { category: "weapon", tier: 1, name: "A" });
  ctrl.cast("class:upgrade_b", "u2", { category: "vitality", tier: 1, name: "B" });
  ctrl.cast("class:upgrade_b", "u3", { category: "vitality", tier: 1, name: "B" });
  await new Promise((r) => setTimeout(r, 70));
  const snap = ctrl.getSnapshot();
  assert.equal(snap.catalogItems[snap.winnerItemIndex ?? -1]?.cls, "upgrade_b");
  assert.equal(snap.winnerCategory, "vitality");
  ctrl.cancel();
});

test("shop_owned all/category/add updates ownedClasses", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    mockBotIntervalMs: 60_000,
  });
  bus.ingest(
    {
      v: 1,
      id: "owned-all",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: {
        scope: "all",
        classes: ["closeRange", "upgrade_health"],
        classCategories: { closeRange: "weapon", upgrade_health: "vitality" },
      },
    },
    "log",
  );
  assert.deepEqual(ctrl.getSnapshot().ownedClasses, [
    "upgrade_close_range",
    "upgrade_health",
  ]);

  bus.ingest(
    {
      v: 1,
      id: "owned-cat",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: {
        scope: "category",
        category: "weapon",
        classes: ["berserker"],
      },
    },
    "log",
  );
  assert.deepEqual(ctrl.getSnapshot().ownedClasses, [
    "upgrade_berserker",
    "upgrade_health",
  ]);

  bus.ingest(
    {
      v: 1,
      id: "owned-add",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: {
        scope: "add",
        category: "spirit",
        classes: ["extraCharge"],
      },
    },
    "log",
  );
  assert.deepEqual(ctrl.getSnapshot().ownedClasses, [
    "upgrade_berserker",
    "upgrade_extra_charge",
    "upgrade_health",
  ]);
  ctrl.cancel();
});

test("owned class rejects item vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    settings: {
      itemDurationMs: 60_000,
      applyDelayMs: 0,
      mockBotEnabled: false,
      defaultStartMode: "items",
    },
    mockBotIntervalMs: 60_000,
  });
  bus.ingest(
    {
      v: 1,
      id: "owned-1",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: { scope: "add", classes: ["reinforcingCasings"], category: "vitality" },
    },
    "log",
  );
  await ctrl.start("items");
  assert.throws(
    () =>
      ctrl.cast("class:reinforcingCasings", "alice", {
        category: "vitality",
        tier: 1,
        name: "Reinforcing Casings",
      }),
    /item already owned/,
  );
  // Overlay votes with Assets API class_name — must alias-match Panorama id.
  assert.throws(
    () =>
      ctrl.cast("class:upgrade_reinforcing_casings", "bob", {
        category: "vitality",
        tier: 1,
        name: "Reinforcing Casings",
      }),
    /item already owned/,
  );
  ctrl.cancel();
});

test("owned classes clear when leaving match", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    mockBotIntervalMs: 60_000,
  });
  bus.ingest(
    {
      v: 1,
      id: "ph-in",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "in_match" },
    },
    "log",
  );
  bus.ingest(
    {
      v: 1,
      id: "owned-m",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: { scope: "all", classes: ["closeRange"] },
    },
    "log",
  );
  assert.deepEqual(ctrl.getSnapshot().ownedClasses, ["upgrade_close_range"]);
  bus.ingest(
    {
      v: 1,
      id: "ph-out",
      tsMs: Date.now(),
      type: "phase",
      payload: { phase: "hideout" },
    },
    "log",
  );
  assert.deepEqual(ctrl.getSnapshot().ownedClasses, []);
  ctrl.cancel();
});

test("shop_purchase ok adds owned class", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    settings: {
      categoryDurationMs: 40,
      tierDurationMs: 40,
      applyDelayMs: 0,
      mockBotEnabled: false,
    },
    mockBotIntervalMs: 60_000,
  });
  ctrl.setShopOpen(true);
  await ctrl.start("full");
  ctrl.cast("weapon");
  ctrl.cast("1");
  await new Promise((r) => setTimeout(r, 100));
  bus.ingest(
    {
      v: 1,
      id: "rolled-o",
      tsMs: Date.now(),
      type: "shop_rolled",
      payload: { cls: "closeRange", name: "Close Range", tier: 1 },
    },
    "log",
  );
  bus.ingest(
    {
      v: 1,
      id: "buy-o",
      tsMs: Date.now(),
      type: "shop_purchase",
      payload: { ok: true, cls: "closeRange", listId: "ShopModsListWeapon" },
    },
    "log",
  );
  assert.ok(ctrl.getSnapshot().ownedClasses.includes("upgrade_close_range"));
  ctrl.cancel();
});

test("owned map does not collapse surgingPower to Vampiric Burst", () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    mockBotIntervalMs: 60_000,
  });
  bus.ingest(
    {
      v: 1,
      id: "owned-fury",
      tsMs: Date.now(),
      type: "shop_owned",
      payload: {
        scope: "all",
        classes: ["surgingPower", "bulletShield", "bulletShield1"],
        classCategories: {
          surgingPower: "vitality",
          bulletShield: "vitality",
          bulletShield1: "vitality",
        },
      },
    },
    "log",
  );
  const owned = ctrl.getSnapshot().ownedClasses;
  assert.deepEqual(owned, [
    "upgrade_fury_trance",
    "upgrade_grit",
    "upgrade_regenerating_bullet_shield",
  ]);
  assert.ok(!owned.includes("upgrade_surging_power"));
  ctrl.cancel();
});
