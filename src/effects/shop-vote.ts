import type {
  ShopCategory,
  ShopTier,
  ShopVoteStage,
} from "../shop/shop-vote-controller.js";
import { SHOP_CATEGORIES } from "../shop/shop-vote-controller.js";
import { enabledTiersFromSettings, type ShopStartMode } from "../shop/shop-vote-settings.js";
import type { GameEffect } from "./types.js";

/** Minimal surface the shop reward effects need from ShopVoteController. */
export interface ShopVoteEffectTarget {
  getSnapshot(): {
    stage: ShopVoteStage | string;
    maxAffordableTier: ShopTier | null;
    settings: {
      defaultStartMode: ShopStartMode;
      enabledCategories: string[];
      minTier: ShopTier | number;
      maxTier: ShopTier | number;
    };
  };
  start(mode?: ShopStartMode): Promise<unknown>;
  apply(category: ShopCategory, tier: ShopTier): Promise<unknown>;
}

/** Stages where a Channel Points shop reward may start a vote or buy. */
const IDLE_STAGES = new Set<string>(["idle", "purchased", "failed"]);

export function isShopRewardStageIdle(stage: string): boolean {
  return IDLE_STAGES.has(stage);
}

export function assertShopRewardIdle(stage: string, effectId: string): void {
  if (!isShopRewardStageIdle(stage)) {
    throw new Error(
      `${effectId}: shop busy (stage=${stage}). Wait for idle/purchased/failed.`,
    );
  }
}

export function pickRandomShopCategory(
  enabled: string[],
  random: () => number = Math.random,
): ShopCategory {
  const cats = enabled.filter((c): c is ShopCategory =>
    (SHOP_CATEGORIES as string[]).includes(c),
  );
  const pool = cats.length > 0 ? cats : (["weapon"] as ShopCategory[]);
  return pool[Math.floor(random() * pool.length)]!;
}

export function pickRandomShopTier(
  minTier: number,
  maxTier: number,
  maxAffordableTier: number | null,
  random: () => number = Math.random,
): ShopTier {
  let tiers = enabledTiersFromSettings({
    minTier: Math.max(1, Math.min(4, Math.round(minTier))) as ShopTier,
    maxTier: Math.max(1, Math.min(4, Math.round(maxTier))) as ShopTier,
  }) as ShopTier[];
  if (maxAffordableTier != null && maxAffordableTier >= 1) {
    const capped = tiers.filter((t) => t <= maxAffordableTier);
    if (capped.length > 0) tiers = capped;
  }
  if (tiers.length === 0) return 1;
  return tiers[Math.floor(random() * tiers.length)]!;
}

let shopTarget: ShopVoteEffectTarget | null = null;

/** Wire effects after ShopVoteController is constructed (registry is created earlier). */
export function bindShopVoteEffects(shop: ShopVoteEffectTarget): void {
  shopTarget = shop;
}

function requireShop(): ShopVoteEffectTarget {
  if (!shopTarget) {
    throw new Error("Shop vote effects are not bound (call bindShopVoteEffects)");
  }
  return shopTarget;
}

export const shopVoteStartEffect: GameEffect = {
  id: "shop_vote_start",
  name: "Запустить голосование магазина",
  category: "shop",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(): Promise<void> {
    const shop = requireShop();
    const snap = shop.getSnapshot();
    assertShopRewardIdle(String(snap.stage), "shop_vote_start");
    await shop.start(snap.settings.defaultStartMode);
  },
  async revert(): Promise<void> {
    // oneShot
  },
};

export const shopBuyRandomEffect: GameEffect = {
  id: "shop_buy_random",
  name: "Купить рандомную шмотку",
  category: "shop",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(): Promise<void> {
    const shop = requireShop();
    const snap = shop.getSnapshot();
    assertShopRewardIdle(String(snap.stage), "shop_buy_random");
    const category = pickRandomShopCategory(snap.settings.enabledCategories);
    const tier = pickRandomShopTier(
      snap.settings.minTier,
      snap.settings.maxTier,
      snap.maxAffordableTier,
    );
    await shop.apply(category, tier);
  },
  async revert(): Promise<void> {
    // oneShot
  },
};

export const shopItemsVoteStartEffect: GameEffect = {
  id: "shop_items_vote_start",
  name: "Запустить голосование за предмет",
  category: "shop",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(): Promise<void> {
    const shop = requireShop();
    const snap = shop.getSnapshot();
    assertShopRewardIdle(String(snap.stage), "shop_items_vote_start");
    await shop.start("items");
  },
  async revert(): Promise<void> {
    // oneShot
  },
};
