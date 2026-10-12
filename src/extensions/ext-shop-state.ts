import type {
  ShopCatalogItem,
  ShopVoteSnapshot,
} from "../shop/shop-vote-controller.js";

/** Compact public state for Extension panel + PubSub (≤5 KB). */
export interface ExtShopPublicState {
  stage: string;
  stageEndsAt: number | null;
  categoryPct: Record<string, number>;
  tierPct: Record<string, number>;
  itemPct: number[];
  /** Raw vote counts per catalog index (for overlay “in roll pool”). */
  itemTally: number[];
  winnerCategory: string | null;
  winnerTier: number | null;
  winnerItemIndex: number | null;
  catalogSeq: number;
  /** Streamer-owned class_names (grey / non-clickable in overlay). */
  ownedClasses: string[];
  /** Omitted from PubSub when unchanged; always on GET. */
  items?: ShopCatalogItem[];
  settings: {
    enabledCategories: string[];
    minTier: number;
    maxTier: number;
    defaultStartMode: string;
    itemWinnerMode?: string;
  };
}

export function toExtShopPublicState(
  snap: ShopVoteSnapshot,
  options: { includeItems: boolean } = { includeItems: true },
): ExtShopPublicState {
  const itemPct = snap.itemPct ?? [];
  const state: ExtShopPublicState = {
    stage: snap.stage,
    stageEndsAt: snap.stageEndsAt,
    categoryPct: { ...snap.categoryPct },
    tierPct: { ...snap.tierPct },
    itemPct: [...itemPct],
    itemTally: [...(snap.itemTally ?? [])],
    winnerCategory: snap.winnerCategory,
    winnerTier: snap.winnerTier,
    winnerItemIndex: snap.winnerItemIndex ?? null,
    catalogSeq: snap.catalogSeq ?? 0,
    ownedClasses: [...(snap.ownedClasses ?? [])],
    settings: {
      enabledCategories: [...snap.settings.enabledCategories],
      minTier: snap.settings.minTier,
      maxTier: snap.settings.maxTier,
      defaultStartMode: snap.settings.defaultStartMode,
      itemWinnerMode: snap.settings.itemWinnerMode,
    },
  };
  if (options.includeItems) {
    state.items = (snap.catalogItems ?? []).map((it) => ({ ...it }));
  }
  return state;
}

/** PubSub payload: skip bulky item list; panel already has catalog from GET. */
export function toExtShopPubSubMessage(snap: ShopVoteSnapshot): string {
  const state = toExtShopPublicState(snap, { includeItems: false });
  // Include short item names only when catalog just arrived (small lists).
  if (
    snap.stage === "voting_items" &&
    snap.catalogItems &&
    snap.catalogItems.length > 0 &&
    snap.catalogItems.length <= 40
  ) {
    (state as ExtShopPublicState & { itemNames?: string[] }).itemNames = snap.catalogItems.map(
      (it) => it.name.slice(0, 28),
    );
  }
  return JSON.stringify({ t: "shop", ...state });
}
