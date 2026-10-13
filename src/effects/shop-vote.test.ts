import assert from "node:assert/strict";
import test from "node:test";
import type { ShopCategory, ShopTier, ShopVoteStage } from "../shop/shop-vote-controller.js";
import type { ShopStartMode } from "../shop/shop-vote-settings.js";
import {
  assertShopRewardIdle,
  bindShopVoteEffects,
  isShopRewardStageIdle,
  pickRandomShopCategory,
  pickRandomShopTier,
  shopBuyRandomEffect,
  shopItemsVoteStartEffect,
  shopVoteStartEffect,
  type ShopVoteEffectTarget,
} from "./shop-vote.js";

function makeShop(opts: {
  stage?: ShopVoteStage;
  defaultStartMode?: ShopStartMode;
  enabledCategories?: string[];
  minTier?: ShopTier;
  maxTier?: ShopTier;
  maxAffordableTier?: ShopTier | null;
}): ShopVoteEffectTarget & {
  starts: ShopStartMode[];
  applies: Array<{ category: ShopCategory; tier: ShopTier }>;
} {
  const starts: ShopStartMode[] = [];
  const applies: Array<{ category: ShopCategory; tier: ShopTier }> = [];
  return {
    starts,
    applies,
    getSnapshot() {
      return {
        stage: opts.stage ?? "idle",
        maxAffordableTier: opts.maxAffordableTier ?? null,
        settings: {
          defaultStartMode: opts.defaultStartMode ?? "full",
          enabledCategories: opts.enabledCategories ?? ["weapon", "vitality", "spirit"],
          minTier: opts.minTier ?? 1,
          maxTier: opts.maxTier ?? 4,
        },
      };
    },
    async start(mode = "full") {
      starts.push(mode);
    },
    async apply(category, tier) {
      applies.push({ category, tier });
    },
  };
}

test("isShopRewardStageIdle allows idle purchased failed only", () => {
  assert.equal(isShopRewardStageIdle("idle"), true);
  assert.equal(isShopRewardStageIdle("purchased"), true);
  assert.equal(isShopRewardStageIdle("failed"), true);
  assert.equal(isShopRewardStageIdle("voting_combined"), false);
  assert.equal(isShopRewardStageIdle("applying"), false);
  assert.equal(isShopRewardStageIdle("rolled"), false);
  assert.equal(isShopRewardStageIdle("waiting_shop"), false);
});

test("pickRandomShopCategory and pickRandomShopTier respect settings", () => {
  assert.equal(pickRandomShopCategory(["spirit"], () => 0), "spirit");
  assert.equal(pickRandomShopTier(2, 3, null, () => 0), 2);
  assert.equal(pickRandomShopTier(1, 4, 2, () => 0.99), 2);
});

test("shop_vote_start calls start with defaultStartMode when idle", async () => {
  const shop = makeShop({ stage: "idle", defaultStartMode: "items" });
  bindShopVoteEffects(shop);
  await shopVoteStartEffect.apply({} as never);
  assert.deepEqual(shop.starts, ["items"]);
  assert.deepEqual(shop.applies, []);
});

test("shop_vote_start rejects busy stage", async () => {
  const shop = makeShop({ stage: "voting_combined" });
  bindShopVoteEffects(shop);
  await assert.rejects(
    () => shopVoteStartEffect.apply({} as never),
    /shop busy \(stage=voting_combined\)/,
  );
  assert.deepEqual(shop.starts, []);
});

test("shop_buy_random applies random cat/tier when idle", async () => {
  const shop = makeShop({
    stage: "purchased",
    enabledCategories: ["vitality"],
    minTier: 3,
    maxTier: 3,
  });
  bindShopVoteEffects(shop);
  await shopBuyRandomEffect.apply({} as never);
  assert.deepEqual(shop.starts, []);
  assert.equal(shop.applies.length, 1);
  assert.equal(shop.applies[0]!.category, "vitality");
  assert.equal(shop.applies[0]!.tier, 3);
});

test("shop_buy_random rejects busy stage", async () => {
  const shop = makeShop({ stage: "waiting_shop" });
  bindShopVoteEffects(shop);
  await assert.rejects(
    () => shopBuyRandomEffect.apply({} as never),
    /shop busy \(stage=waiting_shop\)/,
  );
  assert.deepEqual(shop.applies, []);
});

test("assertShopRewardIdle throws for awaiting_catalog", () => {
  assert.throws(() => assertShopRewardIdle("awaiting_catalog", "shop_vote_start"), /busy/);
});

test("shop_items_vote_start calls start with items when idle", async () => {
  const shop = makeShop({ stage: "failed", defaultStartMode: "full" });
  bindShopVoteEffects(shop);
  await shopItemsVoteStartEffect.apply({} as never);
  assert.deepEqual(shop.starts, ["items"]);
  assert.deepEqual(shop.applies, []);
});

test("shop_items_vote_start rejects busy stage", async () => {
  const shop = makeShop({ stage: "voting_items" });
  bindShopVoteEffects(shop);
  await assert.rejects(
    () => shopItemsVoteStartEffect.apply({} as never),
    /shop busy \(stage=voting_items\)/,
  );
  assert.deepEqual(shop.starts, []);
});
