import assert from "node:assert/strict";
import test from "node:test";
import { GameEventBus } from "../game/game-event-bus.js";
import {
  ShopVoteController,
  maxAffordableTierFromSouls,
  parseShopCategory,
  parseShopTier,
  tallyPercents,
} from "./shop-vote-controller.js";
import type { GameCommandClient } from "../game/game-command-client.js";

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
});

test("beginTierVote keeps category tallies for post-vote HUD", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 30,
    tierDurationMs: 60_000,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("weapon");
  ctrl.cast("weapon");
  await new Promise((r) => setTimeout(r, 80));
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
});

test("vote tallies survive waiting_shop until purchase", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 30,
    tierDurationMs: 30,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("weapon");
  ctrl.cast("weapon");
  await new Promise((r) => setTimeout(r, 50));
  // Now in voting_tier (or applying if tier also finished)
  const mid = ctrl.getSnapshot();
  if (mid.stage === "voting_tier") {
    ctrl.cast("2");
    ctrl.cast("2");
  }
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
});

test("failed purchase clears vote tallies", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 30,
    tierDurationMs: 30,
    mockBotIntervalMs: 60_000,
  });

  await ctrl.start("full");
  ctrl.cast("weapon");
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
});

test("autoStart after purchase waits then starts a new full vote", async () => {
  const bus = new GameEventBus();
  const ctrl = new ShopVoteController(makeFakeClient(), bus, {
    categoryDurationMs: 60_000,
    tierDurationMs: 60_000,
    restartDelayMs: 40,
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
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(ctrl.getSnapshot().stage, "voting_category");
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
  assert.equal(ctrl.getSnapshot().stage, "voting_category");
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
  assert.equal(ctrl.getSnapshot().stage, "voting_category");
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
});
