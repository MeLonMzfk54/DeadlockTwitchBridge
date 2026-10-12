import { EventEmitter } from "node:events";
import type { GameCommandClient } from "../game/game-command-client.js";
import type { GameEventBus } from "../game/game-event-bus.js";
import type { StoredGameEvent } from "../types.js";
import {
  defaultShopVoteSettings,
  enabledTiersFromSettings,
  mergeShopVoteSettings,
  randomAutoStartDelayMs,
  type ShopItemWinnerMode,
  type ShopStartMode,
  type ShopVoteSettings,
} from "./shop-vote-settings.js";
import { sanitizeHelpClassName } from "./shop-help.js";
import { toOwnedApiClassName } from "./panorama-owned-map.js";

export type ShopVoteStage =
  | "idle"
  | "voting_category"
  | "voting_tier"
  | "voting_combined"
  | "awaiting_catalog"
  | "voting_items"
  | "applying"
  | "rolled"
  | "waiting_shop"
  | "purchased"
  | "failed";

/** Stages where chat/control may cast votes. */
export function isShopVotingStage(stage: ShopVoteStage | string): boolean {
  return (
    stage === "voting_category" ||
    stage === "voting_tier" ||
    stage === "voting_combined" ||
    stage === "voting_items"
  );
}

export interface ShopCatalogItem {
  index: number;
  name: string;
  category: ShopCategory;
  tier: ShopTier;
  cls: string;
}

export type ShopCategory = "weapon" | "vitality" | "spirit";
export type ShopTier = 1 | 2 | 3 | 4;

export const SHOP_CATEGORIES: ShopCategory[] = ["weapon", "vitality", "spirit"];
export const SHOP_TIERS: ShopTier[] = [1, 2, 3, 4];

/** Hardcoded tier prices (souls). HUD may override from panels; bridge has no live souls signal yet. */
export const SHOP_TIER_COSTS: Record<ShopTier, number> = {
  1: 800,
  2: 1600,
  3: 3200,
  4: 6400,
};

/**
 * Highest tier affordable for `souls`, or null if souls unknown / unrestricted.
 * Chat affordability filter is skipped until Panorama emits a souls signal (none today).
 */
export function maxAffordableTierFromSouls(souls: number | null | undefined): ShopTier | null {
  if (souls == null || !Number.isFinite(souls) || souls < 0) return null;
  let max: ShopTier | null = null;
  for (const t of SHOP_TIERS) {
    if (souls >= SHOP_TIER_COSTS[t]) max = t;
  }
  return max;
}

/** Default vote lengths. Auto-start interval defaults live in shop-vote-settings. */
export const DEFAULT_SHOP_VOTE_CATEGORY_MS = 25_000;
export const DEFAULT_SHOP_VOTE_TIER_MS = 25_000;
/** @deprecated Use autoStartIntervalMinMs/MaxMs defaults. Kept for env seed alias. */
export const DEFAULT_SHOP_VOTE_RESTART_MS = 25_000;

const MATCH_ACTIVE_PHASES = new Set([
  "in_match",
  "shop",
  "scoreboard",
  "paused",
  "match_start",
  "pregame_countdown",
]);

const MATCH_OUTSIDE_PHASES = new Set([
  "match_end",
  "hideout",
  "pregame",
  "unknown",
]);

const CATEGORY_TO_CV: Record<ShopCategory, number> = {
  weapon: 1,
  vitality: 2,
  spirit: 3,
};

const CV_TO_CATEGORY: Record<number, ShopCategory> = {
  1: "weapon",
  2: "vitality",
  3: "spirit",
};

const WAITING_REASONS = new Set([
  "cant_afford",
  "shop_closed",
  "shop_ui_closed",
  "out_of_range",
  "souls_unknown",
  "awaiting_shop_range",
  "dom_not_ready",
  "roll_timeout",
]);

const ROLL_PIPELINE_STAGES = new Set<ShopVoteStage>(["applying", "rolled", "waiting_shop"]);

/** Seq range for PNG cmd slot + cfg; wraps so levels stay encodable. */
export const SHOP_CMD_SEQ_MAX = 200;

export interface ShopVoteOptions {
  categoryDurationMs?: number;
  tierDurationMs?: number;
  /** @deprecated Prefer autoStartIntervalMinMs/MaxMs. Maps to both when set alone. */
  restartDelayMs?: number;
  autoStartIntervalMinMs?: number;
  autoStartIntervalMaxMs?: number;
  mockBotIntervalMs?: number;
  mockBotVotesPerTick?: number;
  mockBotEnabled?: boolean;
  /** Optional soft cap for mock tier votes (1–4). Null = unrestricted. No live souls from game yet. */
  maxAffordableTier?: ShopTier | null;
  /** Full prefs (from config/shop-vote.json). Overrides individual duration fields when set. */
  settings?: Partial<ShopVoteSettings>;
}

export interface ShopRecentVote {
  option: string;
  userId: string | null;
  at: number;
}

export interface ShopVoteSnapshot {
  stage: ShopVoteStage;
  shopOpen: boolean;
  autoStart: boolean;
  stageEndsAt: number | null;
  stageStartedAt: number | null;
  categoryTally: Record<ShopCategory, number>;
  tierTally: Record<"1" | "2" | "3" | "4", number>;
  categoryPct: Record<ShopCategory, number>;
  tierPct: Record<"1" | "2" | "3" | "4", number>;
  winnerCategory: ShopCategory | null;
  winnerTier: ShopTier | null;
  lastSeq: number;
  lastCfg: { seq: number; cat: number; tier: number; pick: number; cls: string } | null;
  pending: boolean;
  cmdReceived: boolean;
  hero: string;
  lastRolled: Record<string, unknown> | null;
  lastPurchase: Record<string, unknown> | null;
  lastWaiting: Record<string, unknown> | null;
  lastError: Record<string, unknown> | null;
  pipeline: string[];
  mockBotActive: boolean;
  mockBotEnabled: boolean;
  /** Soft cap for mock tier votes; null = unrestricted (no souls signal from game). */
  maxAffordableTier: ShopTier | null;
  categoryDurationMs: number;
  tierDurationMs: number;
  autoStartIntervalMinMs: number;
  autoStartIntervalMaxMs: number;
  /** @deprecated Alias of autoStartIntervalMaxMs for older clients. */
  restartDelayMs: number;
  recentVotes: ShopRecentVote[];
  /** Persistent prefs (also mirrored in flat fields above for older clients). */
  settings: ShopVoteSettings;
  /** One-shot banner command for the PNG `banner` slot. 0 = none. */
  bannerSeq: number;
  /** 1 category, 2 tier, 3 combined, 4 end. */
  bannerKind: number;
  /** Winner pack cat*10+tier, or 0. */
  bannerWin: number;
  /**
   * Items that received at least one vote this round (built from overlay class votes).
   * `catalogSeq` kept for Extension API compat; unused for scan.
   */
  catalogSeq: number;
  catalogItems: ShopCatalogItem[];
  itemTally: number[];
  itemPct: number[];
  winnerItemIndex: number | null;
  /** Streamer-owned (or used-as-component) class_names for overlay greying. */
  ownedClasses: string[];
}

/** Optional meta when casting `class:<ClassName>` (first vote registers the item). */
export interface ShopCastMeta {
  category?: string | null;
  tier?: number | string | null;
  name?: string | null;
}

export interface ShopCmdPayload {
  seq: number;
  cat: number;
  tier: number;
  /** 1-based catalog index; 0 = random roll within cat/tier (or class pick). */
  pick: number;
  /** Item class_name for apply; empty = random / pick-index path. */
  cls: string;
  pending: boolean;
  stage: ShopVoteStage;
  categoryPct: Record<ShopCategory, number>;
  tierPct: Record<"1" | "2" | "3" | "4", number>;
  winnerCategory: ShopCategory | null;
  winnerTier: ShopTier | null;
}

function emptyCategoryTally(): Record<ShopCategory, number> {
  return { weapon: 0, vitality: 0, spirit: 0 };
}

function emptyTierTally(): Record<"1" | "2" | "3" | "4", number> {
  return { "1": 0, "2": 0, "3": 0, "4": 0 };
}

function normalizeMaxAffordableTier(max: number | null | undefined): ShopTier | null {
  if (max == null || !Number.isFinite(max)) return null;
  const n = Math.floor(Number(max));
  if (n < 1) return null;
  if (n > 4) return 4;
  return n as ShopTier;
}

/** Integer percents via largest-remainder so they sum to 100 when total > 0. */
export function tallyPercents<T extends string>(
  tally: Record<T, number>,
  options: readonly T[],
): Record<T, number> {
  const result = {} as Record<T, number>;
  let total = 0;
  for (const opt of options) {
    total += tally[opt] ?? 0;
  }
  if (total <= 0) {
    for (const opt of options) result[opt] = 0;
    return result;
  }

  const exact: { opt: T; floor: number; frac: number }[] = [];
  let floorSum = 0;
  for (const opt of options) {
    const raw = ((tally[opt] ?? 0) * 100) / total;
    const floor = Math.floor(raw);
    floorSum += floor;
    exact.push({ opt, floor, frac: raw - floor });
  }
  exact.sort((a, b) => b.frac - a.frac || options.indexOf(a.opt) - options.indexOf(b.opt));
  let remain = 100 - floorSum;
  for (const row of exact) {
    result[row.opt] = row.floor + (remain > 0 ? 1 : 0);
    if (remain > 0) remain -= 1;
  }
  return result;
}

function itemTallyPercents(tally: number[]): number[] {
  if (tally.length === 0) return [];
  const keys = tally.map((_, i) => String(i));
  const rec: Record<string, number> = {};
  for (let i = 0; i < tally.length; i++) rec[String(i)] = tally[i] ?? 0;
  const pct = tallyPercents(rec, keys);
  return keys.map((k) => pct[k] ?? 0);
}

function pickWeightedIndex(tally: number[], random: () => number = Math.random): number {
  if (tally.length === 0) return 0;
  let max = -1;
  const tied: number[] = [];
  for (let i = 0; i < tally.length; i++) {
    const n = tally[i] ?? 0;
    if (n > max) {
      max = n;
      tied.length = 0;
      tied.push(i);
    } else if (n === max) {
      tied.push(i);
    }
  }
  if (tied.length === 0) return 0;
  if (max <= 0) return Math.floor(random() * tally.length);
  return tied[Math.floor(random() * tied.length)];
}

/**
 * Choose the winning catalog index for an items vote.
 * - `random_among_voted`: uniform among tally > 0; empty tally → uniform over catalog
 * - `plurality`: highest tally (ties random); empty tally → uniform over catalog
 */
export function pickItemWinnerIndex(
  tally: number[],
  mode: ShopItemWinnerMode = "random_among_voted",
  random: () => number = Math.random,
): number {
  if (tally.length === 0) return 0;
  if (mode === "plurality") {
    return pickWeightedIndex(tally, random);
  }
  const voted: number[] = [];
  for (let i = 0; i < tally.length; i++) {
    if ((tally[i] ?? 0) > 0) voted.push(i);
  }
  if (voted.length === 0) {
    return Math.floor(random() * tally.length);
  }
  return voted[Math.floor(random() * voted.length)]!;
}

function pickWeightedWinner<T extends string>(tally: Record<T, number>, options: T[]): T {
  let max = -1;
  const tied: T[] = [];
  for (const opt of options) {
    const n = tally[opt] ?? 0;
    if (n > max) {
      max = n;
      tied.length = 0;
      tied.push(opt);
    } else if (n === max) {
      tied.push(opt);
    }
  }
  if (tied.length === 0) return options[0];
  if (max <= 0) return options[Math.floor(Math.random() * options.length)];
  return tied[Math.floor(Math.random() * tied.length)];
}

const MAX_CATALOG_ITEMS = 80;

export class ShopVoteController extends EventEmitter<{
  update: [ShopVoteSnapshot];
  /** Fired when a real voting stage begins (not when skipped for a single option). */
  vote_stage_start: [
    {
      stage: "voting_category" | "voting_tier" | "voting_combined" | "voting_items";
      snapshot: ShopVoteSnapshot;
    },
  ];
}> {
  private stage: ShopVoteStage = "idle";
  private shopOpen = false;
  private stageEndsAt: number | null = null;
  private stageStartedAt: number | null = null;
  private categoryTally = emptyCategoryTally();
  private tierTally = emptyTierTally();
  private winnerCategory: ShopCategory | null = null;
  private winnerTier: ShopTier | null = null;
  private lastSeq = 0;
  /** Separate from shop apply seq — banner test must not bump a pending roll. */
  private lastBannerSeq = 0;
  private lastBannerKind = 0;
  private lastBannerWin = 0;
  /** True after a start banner until the matching end banner. */
  private bannerCycleOpen = false;
  /** Stage/end captured at start(), so a same-stage restart can refire the banner. */
  private bannerRestart: { stage: ShopVoteStage; endsAt: number | null } | null = null;
  private lastCfg: { seq: number; cat: number; tier: number; pick: number; cls: string } | null =
    null;
  private cmdReceived = false;
  private lastRolled: Record<string, unknown> | null = null;
  private lastPurchase: Record<string, unknown> | null = null;
  private lastWaiting: Record<string, unknown> | null = null;
  private lastError: Record<string, unknown> | null = null;
  private pipeline: string[] = [];
  private mockBotActive = false;
  /** Soft cap for mock tier votes; null = unrestricted (no souls signal from game events). */
  private maxAffordableTier: ShopTier | null = null;
  private runMode: ShopStartMode | null = null;
  private stageTimer: NodeJS.Timeout | null = null;
  private applyDelayTimer: NodeJS.Timeout | null = null;
  private mockTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private categoryVotes = new Map<string, ShopCategory>();
  private tierVotes = new Map<string, "1" | "2" | "3" | "4">();
  private itemVotes = new Map<string, number>();
  private recentVotes: ShopRecentVote[] = [];
  /** Last known match phase from Panorama (empty until first phase event). */
  private matchPhase = "";
  private catalogSeq = 0;
  private catalogItems: ShopCatalogItem[] = [];
  private itemTally: number[] = [];
  private winnerItemIndex: number | null = null;
  /** class_name → category (null when unknown / from full scan without tag). */
  private ownedClassCats = new Map<string, ShopCategory | null>();

  private settings: ShopVoteSettings;
  private readonly mockBotVotesPerTick: number;

  constructor(
    private readonly gameClient: GameCommandClient,
    private readonly gameEventBus: GameEventBus,
    options: ShopVoteOptions = {},
  ) {
    super();
    const seed = defaultShopVoteSettings({
      categoryDurationMs: options.categoryDurationMs,
      tierDurationMs: options.tierDurationMs,
      restartDelayMs: options.restartDelayMs,
      autoStartIntervalMinMs: options.autoStartIntervalMinMs,
      autoStartIntervalMaxMs: options.autoStartIntervalMaxMs,
    });
    if (typeof options.mockBotIntervalMs === "number") {
      seed.mockBotIntervalMs = options.mockBotIntervalMs;
    }
    if (typeof options.mockBotEnabled === "boolean") {
      seed.mockBotEnabled = options.mockBotEnabled;
    }
    this.settings = options.settings
      ? mergeShopVoteSettings(seed, options.settings)
      : seed;
    this.mockBotVotesPerTick = options.mockBotVotesPerTick ?? 1;
    this.maxAffordableTier = normalizeMaxAffordableTier(options.maxAffordableTier ?? null);

    this.gameEventBus.on("event", (evt) => this.onGameEvent(evt));
  }

  private get autoStart(): boolean {
    return this.settings.autoStart;
  }
  private get mockBotEnabled(): boolean {
    return this.settings.mockBotEnabled;
  }
  private get categoryDurationMs(): number {
    return this.settings.categoryDurationMs;
  }
  private get tierDurationMs(): number {
    return this.settings.tierDurationMs;
  }
  private get autoStartIntervalMinMs(): number {
    return this.settings.autoStartIntervalMinMs;
  }
  private get autoStartIntervalMaxMs(): number {
    return this.settings.autoStartIntervalMaxMs;
  }
  private get mockBotIntervalMs(): number {
    return this.settings.mockBotIntervalMs;
  }

  getSettings(): ShopVoteSettings {
    return {
      ...this.settings,
      enabledCategories: [...this.settings.enabledCategories],
    };
  }

  /** Merge prefs, restart mock bot if interval/enabled changed mid-vote. */
  applySettings(partial: Partial<ShopVoteSettings> | Record<string, unknown>): ShopVoteSnapshot {
    const prevInterval = this.settings.mockBotIntervalMs;
    const prevMock = this.settings.mockBotEnabled;
    this.settings = mergeShopVoteSettings(this.settings, partial);
    this.push("settings updated");

    if (!this.settings.autoStart) {
      this.clearRestartTimer();
    } else if (
      (this.stage === "purchased" || this.stage === "idle") &&
      this.isMatchActiveForAutoStart()
    ) {
      this.push("autoStart enabled — scheduling");
      this.scheduleAutoRestart();
    }

    if (
      isShopVotingStage(this.stage) &&
      (this.settings.mockBotEnabled !== prevMock ||
        this.settings.mockBotIntervalMs !== prevInterval)
    ) {
      if (this.settings.mockBotEnabled) this.startMockBot();
      else this.stopMockBot();
    }

    this.emitUpdate();
    return this.getSnapshot();
  }

  private enabledCategories(): ShopCategory[] {
    return this.settings.enabledCategories.filter((c): c is ShopCategory =>
      SHOP_CATEGORIES.includes(c as ShopCategory),
    );
  }

  private enabledTiers(): ShopTier[] {
    return enabledTiersFromSettings(this.settings) as ShopTier[];
  }

  private isCategoryEnabled(cat: ShopCategory): boolean {
    return this.enabledCategories().includes(cat);
  }

  private isTierEnabled(tier: ShopTier | string): boolean {
    const n = typeof tier === "string" ? Number(tier) : tier;
    return this.enabledTiers().includes(n as ShopTier);
  }

  getSnapshot(): ShopVoteSnapshot {
    const categoryPct = tallyPercents(this.categoryTally, SHOP_CATEGORIES);
    const tierPct = tallyPercents(this.tierTally, ["1", "2", "3", "4"] as const);
    const itemPct = itemTallyPercents(this.itemTally);
    return {
      stage: this.stage,
      shopOpen: this.shopOpen,
      autoStart: this.autoStart,
      stageEndsAt: this.stageEndsAt,
      stageStartedAt: this.stageStartedAt,
      categoryTally: { ...this.categoryTally },
      tierTally: { ...this.tierTally },
      categoryPct,
      tierPct,
      winnerCategory: this.winnerCategory,
      winnerTier: this.winnerTier,
      lastSeq: this.lastSeq,
      lastCfg: this.lastCfg ? { ...this.lastCfg } : null,
      pending: this.isPurchasePending(),
      cmdReceived: this.cmdReceived,
      hero: this.gameEventBus.getModStatus().match.hero || "",
      lastRolled: this.lastRolled ? { ...this.lastRolled } : null,
      lastPurchase: this.lastPurchase ? { ...this.lastPurchase } : null,
      lastWaiting: this.lastWaiting ? { ...this.lastWaiting } : null,
      lastError: this.lastError ? { ...this.lastError } : null,
      pipeline: [...this.pipeline],
      mockBotActive: this.mockBotActive,
      mockBotEnabled: this.mockBotEnabled,
      maxAffordableTier: this.maxAffordableTier,
      categoryDurationMs: this.categoryDurationMs,
      tierDurationMs: this.tierDurationMs,
      autoStartIntervalMinMs: this.autoStartIntervalMinMs,
      autoStartIntervalMaxMs: this.autoStartIntervalMaxMs,
      restartDelayMs: this.autoStartIntervalMaxMs,
      recentVotes: this.recentVotes.map((v) => ({ ...v })),
      settings: this.getSettings(),
      bannerSeq: this.lastBannerSeq,
      bannerKind: this.lastBannerKind,
      bannerWin: this.lastBannerWin,
      catalogSeq: this.catalogSeq,
      catalogItems: this.catalogItems.map((it) => ({ ...it })),
      itemTally: [...this.itemTally],
      itemPct,
      winnerItemIndex: this.winnerItemIndex,
      ownedClasses: [...this.ownedClassCats.keys()].sort(),
    };
  }

  getShopCmd(): ShopCmdPayload {
    const snap = this.getSnapshot();
    if (!this.lastCfg) {
      return {
        seq: 0,
        cat: 0,
        tier: 0,
        pick: 0,
        cls: "",
        pending: false,
        stage: snap.stage,
        categoryPct: snap.categoryPct,
        tierPct: snap.tierPct,
        winnerCategory: snap.winnerCategory,
        winnerTier: snap.winnerTier,
      };
    }
    return {
      seq: this.lastCfg.seq,
      cat: this.lastCfg.cat,
      tier: this.lastCfg.tier,
      pick: this.lastCfg.pick,
      cls: this.lastCfg.cls || "",
      pending: this.isPurchasePending(),
      stage: snap.stage,
      categoryPct: snap.categoryPct,
      tierPct: snap.tierPct,
      winnerCategory: snap.winnerCategory,
      winnerTier: snap.winnerTier,
    };
  }

  setAutoStart(enabled: boolean): void {
    this.applySettings({ autoStart: enabled });
  }

  setMockBotEnabled(enabled: boolean): void {
    this.applySettings({ mockBotEnabled: enabled });
  }

  /**
   * Soft-cap mock tier votes to tiers with cost ≤ souls.
   * No live souls from game events yet — leave null (unrestricted) unless set manually.
   * Chat votes are not filtered (would need a souls signal from Panorama).
   */
  setMaxAffordableTier(max: number | null): void {
    this.maxAffordableTier = normalizeMaxAffordableTier(max);
    this.push(
      this.maxAffordableTier == null
        ? "maxAffordableTier unrestricted"
        : `maxAffordableTier T${this.maxAffordableTier}`,
    );
    this.emitUpdate();
  }

  /** Derive mock tier cap from souls using SHOP_TIER_COSTS; null/negative → unrestricted. */
  setMaxSouls(souls: number | null): void {
    this.setMaxAffordableTier(maxAffordableTierFromSouls(souls));
  }

  setDurations(options: {
    categoryDurationMs?: number;
    tierDurationMs?: number;
    autoStartIntervalMinMs?: number;
    autoStartIntervalMaxMs?: number;
    /** @deprecated Maps to both min and max when interval fields omitted. */
    restartDelayMs?: number;
  }): ShopVoteSnapshot {
    return this.applySettings({
      categoryDurationMs: options.categoryDurationMs,
      tierDurationMs: options.tierDurationMs,
      autoStartIntervalMinMs: options.autoStartIntervalMinMs,
      autoStartIntervalMaxMs: options.autoStartIntervalMaxMs,
      ...(options.restartDelayMs != null ? { restartDelayMs: options.restartDelayMs } : {}),
    } as Partial<ShopVoteSettings> & { restartDelayMs?: number });
  }

  async start(mode: ShopStartMode = "full"): Promise<ShopVoteSnapshot> {
    this.bannerRestart = { stage: this.stage, endsAt: this.stageEndsAt };
    this.clearTimers();
    this.runMode = mode;
    this.clearUserVotes();
    this.recentVotes = [];
    this.lastRolled = null;
    this.lastPurchase = null;
    this.lastWaiting = null;
    this.lastError = null;
    this.pipeline = [];
    this.winnerItemIndex = null;
    this.itemTally = [];
    this.catalogItems = [];

    if (mode === "items") {
      this.winnerCategory = null;
      this.winnerTier = null;
      this.beginItemsVote();
    } else if (mode === "tier") {
      if (!this.winnerCategory || !this.isCategoryEnabled(this.winnerCategory)) {
        this.winnerCategory = this.enabledCategories()[0] ?? "weapon";
      }
      this.beginTierVote();
    } else if (mode === "category") {
      this.winnerCategory = null;
      this.winnerTier = null;
      this.beginCategoryVote();
    } else {
      // full: one window for category + tier in parallel
      this.winnerCategory = null;
      this.winnerTier = null;
      this.beginCombinedVote();
    }
    return this.getSnapshot();
  }

  cancel(): ShopVoteSnapshot {
    if (isShopVotingStage(this.stage)) this.closeVoteBanner();
    this.bannerRestart = null;
    this.clearTimers();
    this.runMode = null;
    this.clearUserVotes();
    this.setStage("idle");
    this.push("cancelled");
    this.emitUpdate();
    return this.getSnapshot();
  }

  /**
   * Abort a pending roll/purchase and return to idle.
   * Signals the mod via cfg: bump `bridge_shop_seq` and set cat=0, tier=0.
   * Compatible with Phase 3 PNG cmd slot (`w=seq`, `h=cat*10+tier`; `h=0` = skip → RandomShopCancelRoll).
   * Current mod: a newer seq while already rolled calls RandomShopCancelRoll; cat=0 does not ForceRoll.
   */
  async skip(): Promise<ShopVoteSnapshot> {
    const shouldSignal =
      ROLL_PIPELINE_STAGES.has(this.stage) || Boolean(this.lastCfg && this.lastCfg.cat > 0);
    if (isShopVotingStage(this.stage)) this.closeVoteBanner();
    this.bannerRestart = null;
    this.clearTimers();
    this.runMode = null;
    this.clearUserVotes();
    this.clearVoteResults();
    this.lastWaiting = null;
    this.lastError = null;
    this.setStage("idle");
    this.push("skipped");
    if (shouldSignal) {
      await this.sendSkipCfg();
    } else {
      this.emitUpdate();
    }
    // Item skip ends the roll the same way a purchase does: keep the next vote queued.
    this.scheduleAutoRestart();
    return this.getSnapshot();
  }

  /** Last-vote-wins when `userId` is set; anonymous casts (control panel) always increment. */
  cast(option: string, userId?: string, meta?: ShopCastMeta): ShopVoteSnapshot {
    if (this.applyDelayResolve || this.applyDelayTimer) {
      return this.getSnapshot();
    }
    const normalized = option.trim().toLowerCase();
    const uid = typeof userId === "string" ? userId.trim() : "";

    if (this.stage === "voting_items") {
      const className = parseClassVoteOption(option);
      if (className) {
        return this.castItemByClass(className, uid, meta);
      }
      const itemIndex = parseItemVoteOption(normalized, this.catalogItems.length);
      if (itemIndex == null) {
        throw new Error(`Invalid item option: ${option}`);
      }
      return this.castItem(itemIndex, uid);
    }

    if (this.stage === "voting_category" || this.stage === "voting_combined") {
      if (normalized === "weapon" || normalized === "vitality" || normalized === "spirit") {
        if (this.stage === "voting_combined" && this.enabledCategories().length <= 1) {
          return this.getSnapshot();
        }
        return this.castCategory(normalized, uid);
      }
      if (this.stage === "voting_category") {
        throw new Error(`Invalid category option: ${option}`);
      }
      // voting_combined: fall through to try tier
    }

    if (this.stage === "voting_tier" || this.stage === "voting_combined") {
      if (normalized === "1" || normalized === "2" || normalized === "3" || normalized === "4") {
        if (this.stage === "voting_combined" && this.enabledTiers().length <= 1) {
          return this.getSnapshot();
        }
        return this.castTier(normalized, uid);
      }
      if (this.stage === "voting_tier") {
        throw new Error(`Invalid tier option: ${option}`);
      }
    }

    if (this.stage === "voting_combined") {
      throw new Error(`Invalid combined option: ${option}`);
    }
    throw new Error(`Cannot cast vote in stage: ${this.stage}`);
  }

  private castItem(index: number, uid: string): ShopVoteSnapshot {
    if (index < 0 || index >= this.catalogItems.length) {
      return this.getSnapshot();
    }
    if (uid) {
      const prev = this.itemVotes.get(uid);
      if (prev === index) {
        return this.getSnapshot();
      }
      if (prev != null && prev >= 0 && prev < this.itemTally.length) {
        this.itemTally[prev] = Math.max(0, (this.itemTally[prev] ?? 0) - 1);
      }
      this.itemVotes.set(uid, index);
    }
    this.itemTally[index] = (this.itemTally[index] ?? 0) + 1;
    const cls = this.catalogItems[index]?.cls;
    this.recordRecentVote(cls ? `class:${cls}` : `item:${index}`, uid || null);
    this.emitUpdate();
    return this.getSnapshot();
  }

  /** True if cls matches an owned Assets API class_name (via explicit map). */
  private isClassOwned(cls: string): boolean {
    if (!cls || this.ownedClassCats.size === 0) return false;
    if (this.ownedClassCats.has(cls)) return true;
    const api = toOwnedApiClassName(cls);
    return !!(api && this.ownedClassCats.has(api));
  }

  /** Normalize game/Panorama id → API class_name for ownedClasses. */
  private normalizeOwnedClass(
    cls: string,
    category: ShopCategory | null,
  ): string {
    return toOwnedApiClassName(cls, category) ?? toOwnedApiClassName(cls) ?? cls;
  }

  /** Register overlay item on first vote, then tally by index. */
  private castItemByClass(cls: string, uid: string, meta?: ShopCastMeta): ShopVoteSnapshot {
    if (this.isClassOwned(cls)) {
      throw new Error("item already owned");
    }
    let idx = this.catalogItems.findIndex((it) => it.cls === cls);
    if (idx < 0) {
      const category = parseShopCategory(meta?.category ?? null);
      const tier = parseShopTier(meta?.tier ?? null);
      if (!category || !tier) {
        throw new Error("category and tier required for class vote");
      }
      if (this.catalogItems.length >= MAX_CATALOG_ITEMS) {
        throw new Error("item catalog full");
      }
      const name = String(meta?.name ?? cls)
        .trim()
        .slice(0, 48) || cls;
      idx = this.catalogItems.length;
      this.catalogItems.push({ index: idx, name, category, tier, cls });
      this.itemTally.push(0);
      this.catalogSeq = this.catalogSeq >= SHOP_CMD_SEQ_MAX ? 1 : this.catalogSeq + 1;
    }
    return this.castItem(idx, uid);
  }

  private castCategory(normalized: ShopCategory, uid: string): ShopVoteSnapshot {
    if (!this.isCategoryEnabled(normalized)) {
      return this.getSnapshot();
    }
    if (uid) {
      const prev = this.categoryVotes.get(uid);
      if (prev === normalized) {
        return this.getSnapshot();
      }
      if (prev) {
        this.categoryTally[prev] = Math.max(0, this.categoryTally[prev] - 1);
      }
      this.categoryVotes.set(uid, normalized);
    }
    this.categoryTally[normalized] += 1;
    this.recordRecentVote(normalized, uid || null);
    this.emitUpdate();
    return this.getSnapshot();
  }

  private castTier(normalized: "1" | "2" | "3" | "4", uid: string): ShopVoteSnapshot {
    if (!this.isTierEnabled(normalized)) {
      return this.getSnapshot();
    }
    if (uid) {
      const prev = this.tierVotes.get(uid);
      if (prev === normalized) {
        return this.getSnapshot();
      }
      if (prev) {
        this.tierTally[prev] = Math.max(0, this.tierTally[prev] - 1);
      }
      this.tierVotes.set(uid, normalized);
    }
    this.tierTally[normalized] += 1;
    this.recordRecentVote(normalized, uid || null);
    this.emitUpdate();
    return this.getSnapshot();
  }

  async apply(category: ShopCategory, tier: ShopTier): Promise<ShopVoteSnapshot> {
    this.clearTimers();
    this.runMode = null;
    this.clearUserVotes();
    // Direct apply is not a vote — clear leftover tallies so HUD/PNG show 0%.
    this.categoryTally = emptyCategoryTally();
    this.tierTally = emptyTierTally();
    this.winnerCategory = category;
    this.winnerTier = tier;
    this.winnerItemIndex = null;
    await this.sendCfg(category, tier, 0);
    return this.getSnapshot();
  }

  /** Explicit shop-open signal from Panorama (preferred over phase string). */
  setShopOpen(open: boolean, source = "api"): void {
    this.applyShopOpen(open, source);
  }

  /** Legacy game scan events are ignored — overlay votes register items by class_name. */
  private handleShopCatalog(_payload: Record<string, unknown>): void {
    this.push("ignored shop_catalog (overlay catalog)");
  }

  /**
   * Inventory snapshot from open shop UI (owned / usedAsComponent cards).
   * scope=all replaces; scope=category replaces that category; scope=add merges.
   */
  private handleShopOwned(payload: Record<string, unknown>): void {
    const scopeRaw = String(payload.scope ?? "all").toLowerCase();
    const scope =
      scopeRaw === "category" || scopeRaw === "add" ? scopeRaw : "all";
    const category = parseShopCategory(payload.category ?? null);
    const classes = parseOwnedClassList(payload.classes);
    const classCategories = parseOwnedClassCategories(payload.classCategories);

    const before = this.ownedClassCats.size;
    const beforeSig = [...this.ownedClassCats.keys()].sort().join(",");

    if (scope === "all") {
      this.ownedClassCats.clear();
      for (const cls of classes) {
        const hint = classCategories.get(cls) ?? null;
        const cat = this.resolveOwnedCategory(cls, hint);
        const api = this.normalizeOwnedClass(cls, cat);
        this.ownedClassCats.set(api, cat);
      }
    } else if (scope === "category") {
      if (!category) {
        this.push("ignored shop_owned category (missing category)");
        return;
      }
      for (const [cls, cat] of [...this.ownedClassCats.entries()]) {
        if (cat === category) this.ownedClassCats.delete(cls);
      }
      for (const cls of classes) {
        const api = this.normalizeOwnedClass(cls, category);
        this.ownedClassCats.set(api, category);
      }
    } else {
      // add — union; upgrade null category when we learn one
      for (const cls of classes) {
        const hint = classCategories.get(cls) ?? category;
        const next = this.resolveOwnedCategory(cls, hint);
        const api = this.normalizeOwnedClass(cls, next);
        const prev = this.ownedClassCats.get(api);
        if (prev === undefined || (prev == null && next != null)) {
          this.ownedClassCats.set(api, next);
        }
      }
    }

    const afterNames = [...this.ownedClassCats.keys()].sort();
    const afterSig = afterNames.join(",");
    if (afterSig === beforeSig && this.ownedClassCats.size === before) {
      return;
    }
    this.push(
      `owned ${scope}${category ? `:${category}` : ""} → ${afterNames.join(", ") || "(none)"} (${afterNames.length})`,
    );
    this.emitUpdate();
  }

  private addOwnedClassFromPurchase(payload: Record<string, unknown>): void {
    const cls = sanitizeHelpClassName(
      typeof payload.cls === "string" ? payload.cls : null,
    );
    if (!cls) return;
    const fromList = listIdToShopCategory(
      typeof payload.listId === "string" ? payload.listId : null,
    );
    const cat =
      fromList ||
      parseShopCategory(payload.category ?? null) ||
      this.resolveOwnedCategory(cls, null);
    const api = this.normalizeOwnedClass(cls, cat);
    if (!this.ownedClassCats.has(api) || this.ownedClassCats.get(api) == null) {
      this.ownedClassCats.set(api, cat);
    }
  }

  private resolveOwnedCategory(
    cls: string,
    hint: ShopCategory | null,
  ): ShopCategory | null {
    if (hint) return hint;
    const fromCatalog = this.catalogItems.find((it) => it.cls === cls);
    if (fromCatalog) return fromCatalog.category;
    const prev = this.ownedClassCats.get(cls);
    return prev ?? null;
  }

  /** HUD Start/Restart button → shop_vote_start event. */
  private handleHudVoteStart(): void {
    if (!this.settings.allowHudStart) {
      this.push("ignored shop_vote_start (allowHudStart=false)");
      this.emitUpdate();
      return;
    }
    if (isShopVotingStage(this.stage) && !this.settings.hudCanRestart) {
      this.push("ignored shop_vote_start (hudCanRestart=false, vote active)");
      this.emitUpdate();
      return;
    }
    // Skip/apply pipeline: START is ignored — HUD shows SKIP for those stages.
    if (ROLL_PIPELINE_STAGES.has(this.stage)) {
      this.push(`ignored shop_vote_start (stage=${this.stage}; use skip)`);
      this.emitUpdate();
      return;
    }
    this.push("HUD shop_vote_start");
    void this.start(this.settings.defaultStartMode);
  }

  /** HUD Skip button during apply/roll/wait → shop_vote_skip event. */
  private handleHudVoteSkip(): void {
    if (!this.settings.allowHudStart) {
      this.push("ignored shop_vote_skip (allowHudStart=false)");
      this.emitUpdate();
      return;
    }
    this.push("HUD shop_vote_skip");
    void this.skip();
  }

  /** Parallel category + tier vote (start mode `full`). Uses categoryDurationMs. */
  private beginCombinedVote(): void {
    this.categoryVotes.clear();
    this.tierVotes.clear();
    this.categoryTally = emptyCategoryTally();
    this.tierTally = emptyTierTally();

    const cats = this.enabledCategories();
    const tiers = this.enabledTiers();

    if (cats.length <= 1) {
      this.winnerCategory = cats[0] ?? "weapon";
      this.push(`skip category axis (only ${this.winnerCategory})`);
    } else {
      this.winnerCategory = null;
    }
    if (tiers.length <= 1) {
      this.winnerTier = tiers[0] ?? 1;
      this.push(`skip tier axis (only T${this.winnerTier})`);
    } else {
      this.winnerTier = null;
    }

    if (cats.length <= 1 && tiers.length <= 1) {
      this.bannerRestart = null;
      void this.scheduleApply(this.winnerCategory!, this.winnerTier!);
      return;
    }

    // Only one axis contested → reuse single-stage flow for HUD/announce clarity.
    if (cats.length <= 1) {
      this.beginTierVote();
      return;
    }
    if (tiers.length <= 1) {
      this.beginCategoryVote();
      return;
    }

    this.setStage("voting_combined");
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + this.categoryDurationMs;
    this.announceVoteStart(3);
    this.push("voting combined (category + tier)");
    this.startMockBot();
    this.stageTimer = setTimeout(() => {
      void this.finishCombinedVote();
    }, this.categoryDurationMs);
    this.emitUpdate();
    this.emit("vote_stage_start", {
      stage: "voting_combined",
      snapshot: this.getSnapshot(),
    });
  }

  private beginCategoryVote(): void {
    this.categoryVotes.clear();
    this.tierVotes.clear();
    this.categoryTally = emptyCategoryTally();
    this.tierTally = emptyTierTally();

    const cats = this.enabledCategories();
    if (cats.length <= 1) {
      this.winnerCategory = cats[0] ?? "weapon";
      this.push(`skip category vote (only ${this.winnerCategory})`);
      if (this.runMode === "category") {
        this.bannerRestart = null;
        this.setStage("idle");
        this.stageEndsAt = null;
        this.emitUpdate();
        return;
      }
      // full path with locked tier already set, or legacy → apply / tier
      if (this.runMode === "full" && this.winnerTier != null) {
        void this.scheduleApply(this.winnerCategory, this.winnerTier);
        return;
      }
      this.beginTierVote();
      return;
    }

    this.setStage("voting_category");
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + this.categoryDurationMs;
    this.announceVoteStart(1);
    this.push("voting category");
    this.startMockBot();
    this.stageTimer = setTimeout(() => {
      void this.finishCategoryVote();
    }, this.categoryDurationMs);
    this.emitUpdate();
    this.emit("vote_stage_start", {
      stage: "voting_category",
      snapshot: this.getSnapshot(),
    });
  }

  private beginTierVote(): void {
    // Keep category tallies for voting_tier + post-vote HUD (winner category chrome).
    this.tierVotes.clear();
    this.tierTally = emptyTierTally();

    const tiers = this.enabledTiers();
    if (tiers.length <= 1) {
      this.winnerTier = tiers[0] ?? 1;
      this.push(`skip tier vote (only T${this.winnerTier})`);
      if (!this.winnerCategory) {
        this.winnerCategory = this.enabledCategories()[0] ?? "weapon";
      }
      if (this.runMode === "category") {
        this.bannerRestart = null;
        this.setStage("idle");
        this.stageEndsAt = null;
        this.emitUpdate();
        return;
      }
      void this.scheduleApply(this.winnerCategory, this.winnerTier);
      return;
    }

    this.setStage("voting_tier");
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + this.tierDurationMs;
    this.announceVoteStart(2);
    this.push(`voting tier (cat=${this.winnerCategory})`);
    this.startMockBot();
    this.stageTimer = setTimeout(() => {
      void this.finishTierVote();
    }, this.tierDurationMs);
    this.emitUpdate();
    this.emit("vote_stage_start", {
      stage: "voting_tier",
      snapshot: this.getSnapshot(),
    });
  }

  private async finishCategoryVote(): Promise<void> {
    this.stopMockBot();
    const cats = this.enabledCategories();
    this.winnerCategory = pickWeightedWinner(this.categoryTally, cats);
    this.push(`winner category=${this.winnerCategory}`);
    if (this.runMode === "category") {
      this.closeVoteBanner();
      this.setStage("idle");
      this.stageEndsAt = null;
      this.emitUpdate();
      return;
    }
    // full with pre-locked single tier (from beginCombinedVote skip path)
    if (this.runMode === "full" && this.winnerTier != null && this.enabledTiers().length <= 1) {
      this.closeVoteBanner();
      await this.scheduleApply(this.winnerCategory, this.winnerTier);
      return;
    }
    this.beginTierVote();
  }

  private async finishTierVote(): Promise<void> {
    this.stopMockBot();
    const tiers = this.enabledTiers();
    const tierKeys = tiers.map((t) => String(t) as "1" | "2" | "3" | "4");
    const tierKey = pickWeightedWinner(this.tierTally, tierKeys);
    this.winnerTier = Number(tierKey) as ShopTier;
    this.push(`winner tier=${this.winnerTier}`);
    if (!this.winnerCategory) {
      this.winnerCategory = this.enabledCategories()[0] ?? "weapon";
    }
    this.closeVoteBanner();
    await this.scheduleApply(this.winnerCategory, this.winnerTier);
  }

  /** Open items vote immediately; overlay registers cards via class votes. */
  private beginItemsVote(): void {
    this.catalogItems = [];
    this.itemVotes.clear();
    this.itemTally = [];
    this.winnerItemIndex = null;
    const duration = this.settings.itemDurationMs || this.categoryDurationMs;
    this.setStage("voting_items");
    this.stageStartedAt = Date.now();
    this.stageEndsAt = Date.now() + duration;
    this.announceVoteStart(3);
    this.push("voting items (overlay catalog)");
    this.startMockBot();
    this.stageTimer = setTimeout(() => {
      void this.finishItemsVote();
    }, duration);
    this.emitUpdate();
    this.emit("vote_stage_start", {
      stage: "voting_items",
      snapshot: this.getSnapshot(),
    });
  }

  private async finishItemsVote(): Promise<void> {
    this.stopMockBot();
    const votedCount = this.itemTally.filter((n) => n > 0).length;
    if (this.catalogItems.length === 0 || votedCount === 0) {
      this.closeVoteBanner();
      this.lastError = { reason: "no_items" };
      this.setStage("failed");
      this.stageEndsAt = null;
      this.push("no item votes — failed");
      this.emitUpdate();
      this.scheduleAutoRestart();
      return;
    }
    const mode = this.settings.itemWinnerMode ?? "random_among_voted";
    const idx = pickItemWinnerIndex(this.itemTally, mode);
    const item = this.catalogItems[idx];
    this.winnerItemIndex = idx;
    this.winnerCategory = item.category;
    this.winnerTier = item.tier;
    this.push(
      `winner item=${idx} ${item.name} cls=${item.cls} (${item.category} T${item.tier}) mode=${mode} voted=${votedCount}`,
    );
    this.closeVoteBanner();
    await this.scheduleApply(item.category, item.tier, 0, item.cls);
  }

  private async finishCombinedVote(): Promise<void> {
    this.stopMockBot();
    const cats = this.enabledCategories();
    const tiers = this.enabledTiers();
    if (cats.length > 1 || this.winnerCategory == null) {
      this.winnerCategory = pickWeightedWinner(this.categoryTally, cats);
    }
    this.push(`winner category=${this.winnerCategory}`);
    if (tiers.length > 1 || this.winnerTier == null) {
      const tierKeys = tiers.map((t) => String(t) as "1" | "2" | "3" | "4");
      const tierKey = pickWeightedWinner(this.tierTally, tierKeys);
      this.winnerTier = Number(tierKey) as ShopTier;
    }
    this.push(`winner tier=${this.winnerTier}`);
    this.closeVoteBanner();
    await this.scheduleApply(this.winnerCategory!, this.winnerTier!);
  }

  /** Optional pause so HUD/overlay can show winners before PNG/cfg apply. */
  private applyDelayGeneration = 0;
  private applyDelayResolve: (() => void) | null = null;

  private async scheduleApply(
    category: ShopCategory,
    tier: ShopTier,
    pick = 0,
    cls = "",
  ): Promise<void> {
    const delay = this.settings.applyDelayMs;
    if (delay <= 0) {
      await this.sendCfg(category, tier, pick, cls);
      return;
    }
    this.clearApplyDelayTimer();
    const gen = ++this.applyDelayGeneration;
    this.stageEndsAt = Date.now() + delay;
    this.push(`apply delay ${Math.round(delay / 1000)}s`);
    this.emitUpdate();
    await new Promise<void>((resolve) => {
      this.applyDelayResolve = resolve;
      this.applyDelayTimer = setTimeout(() => {
        this.applyDelayTimer = null;
        this.applyDelayResolve = null;
        resolve();
      }, delay);
    });
    if (gen !== this.applyDelayGeneration) return;
    await this.sendCfg(category, tier, pick, cls);
  }

  private clearApplyDelayTimer(): void {
    this.applyDelayGeneration += 1;
    if (this.applyDelayTimer) {
      clearTimeout(this.applyDelayTimer);
      this.applyDelayTimer = null;
    }
    if (this.applyDelayResolve) {
      const resolve = this.applyDelayResolve;
      this.applyDelayResolve = null;
      resolve();
    }
  }

  /**
   * Next seq in 1..SHOP_CMD_SEQ_MAX. After wrap, PNG/mod treat forward distance
   * in the circle as newer (see isNewerShopSeq in twitch_bridge_shop.js).
   */
  private bumpSeq(): number {
    this.lastSeq = this.lastSeq >= SHOP_CMD_SEQ_MAX ? 1 : this.lastSeq + 1;
    return this.lastSeq;
  }

  /**
   * One-shot HUD banner on the PNG `banner` slot. The top bar decodes that image.
   * kind: 1 category, 2 tier, 3 combined, 4 end. win is cat*10+tier (0 = none).
   */
  async showTestBanner(kind: 1 | 2 | 3 | 4, win = 0): Promise<{ seq: number; kind: number; win: number }> {
    const safeWin = win >= 0 && win <= 34 ? win : 0;
    const seq = this.publishBanner(kind, safeWin);
    return { seq, kind, win: safeWin };
  }

  /** kind: 1 category, 2 tier, 3 combined, 4 end. win is cat*10+tier. */
  private publishBanner(kind: 1 | 2 | 3 | 4, win = 0): number {
    const seq = this.lastBannerSeq >= SHOP_CMD_SEQ_MAX ? 1 : this.lastBannerSeq + 1;
    const safeWin = win >= 0 && win <= 34 ? win : 0;
    this.lastBannerSeq = seq;
    this.lastBannerKind = kind;
    this.lastBannerWin = safeWin;
    this.push(`banner png seq=${seq} kind=${kind} win=${safeWin}`);
    this.emitUpdate();
    return seq;
  }

  /**
   * Start toast. Suppressed when category hands off to tier in the same cycle.
   * A same-stage restart refires only if stageEndsAt moved more than 4s later.
   */
  private announceVoteStart(kind: 1 | 2 | 3): void {
    const pending = this.bannerRestart;
    this.bannerRestart = null;
    if (this.bannerCycleOpen) {
      const grew =
        pending != null &&
        pending.stage === this.stage &&
        pending.endsAt != null &&
        this.stageEndsAt != null &&
        this.stageEndsAt > pending.endsAt + 4000;
      const switched = pending != null && pending.stage !== this.stage;
      if (!grew && !switched) return;
    }
    this.bannerCycleOpen = true;
    this.publishBanner(kind, 0);
  }

  private closeVoteBanner(): void {
    if (!this.bannerCycleOpen) return;
    this.bannerCycleOpen = false;
    const cat = this.winnerCategory ? CATEGORY_TO_CV[this.winnerCategory] : 0;
    const tier = this.winnerTier ?? 0;
    const win = cat >= 1 && tier >= 1 && tier <= 4 ? cat * 10 + tier : 0;
    this.publishBanner(4, win);
  }

  private async sendCfg(
    category: ShopCategory,
    tier: ShopTier,
    pick = 0,
    cls = "",
  ): Promise<void> {
    this.setStage("applying");
    this.stageEndsAt = null;
    const seq = this.bumpSeq();
    const cat = CATEGORY_TO_CV[category];
    const safePick = Number.isFinite(pick) && pick > 0 ? Math.round(pick) : 0;
    const safeCls = sanitizeHelpClassName(cls) || "";
    const cfg = { seq, cat, tier, pick: safePick, cls: safeCls };
    this.lastCfg = cfg;
    this.cmdReceived = false;
    this.lastWaiting = null;
    this.push(
      `pending seq=${cfg.seq} cat=${category} tier=${tier}` +
        (safePick > 0 ? ` pick=${safePick}` : "") +
        (safeCls ? ` cls=${safeCls}` : ""),
    );
    this.emitUpdate();
    try {
      await this.gameClient.sendCommands([
        `bridge_shop_cat ${cat}`,
        `bridge_shop_tier ${tier}`,
        `bridge_shop_pick ${safePick}`,
        `bridge_shop_cls ${safeCls || "0"}`,
        `bridge_shop_seq ${cfg.seq}`,
      ]);
      this.push("cfg backup sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push(`cfg backup skipped: ${message}`);
    }
    // PNG cmd slot is primary apply; cfg-bind remains backup (cls/pick via convar).
    this.emitUpdate();
  }

  /**
   * Skip/cancel: bump seq with cat=0, tier=0.
   * PNG cmd: w=seq, h=0 → RandomShopCancelRoll; cfg backup still sent.
   */
  private async sendSkipCfg(): Promise<void> {
    const seq = this.bumpSeq();
    const cfg = { seq, cat: 0, tier: 0, pick: 0, cls: "" };
    this.lastCfg = cfg;
    this.cmdReceived = false;
    this.push(`skip cfg seq=${cfg.seq} cat=0 tier=0`);
    this.emitUpdate();
    try {
      await this.gameClient.sendCommands([
        "bridge_shop_cat 0",
        "bridge_shop_tier 0",
        "bridge_shop_pick 0",
        "bridge_shop_cls 0",
        `bridge_shop_seq ${cfg.seq}`,
      ]);
      this.push("skip cfg sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push(`skip cfg skipped: ${message}`);
    }
    this.emitUpdate();
  }

  private applyShopOpen(open: boolean, source: string): void {
    const wasOpen = this.shopOpen;
    if (open === wasOpen) return;
    this.shopOpen = open;
    if (open && !wasOpen) {
      this.push(`shop opened (${source})`);
      // Do not cancel rolled/waiting — opening enables UI fallback purchase.
      // Auto-start is purchase-only (not on shop open); use HUD /control to start.
      if (this.stage === "waiting_shop" || this.stage === "rolled") {
        this.push("shop open — awaiting purchase confirm");
      }
      // Resend cfg so convars hit already-registered cvars after shop HUD boots.
      if (this.lastCfg && this.isPurchasePending()) {
        void this.resendPendingCfg();
      }
    }
    if (!open && wasOpen) {
      this.push(`shop closed (${source})`);
      // Keep voting alive — player often opens/closes shop during a vote to watch %.
      // Apply/rolled/waiting_shop were already kept alive; voting joins them.
    }
    this.emitUpdate();
  }

  /** Re-push last pending shop cmd via cfg-bind (HTTP remains primary). */
  private async resendPendingCfg(): Promise<void> {
    const cfg = this.lastCfg;
    if (!cfg || !this.isPurchasePending()) return;
    this.push(`resend cfg seq=${cfg.seq}`);
    try {
      await this.gameClient.sendCommands([
        `bridge_shop_cat ${cfg.cat}`,
        `bridge_shop_tier ${cfg.tier}`,
        `bridge_shop_pick ${cfg.pick ?? 0}`,
        `bridge_shop_cls ${cfg.cls || "0"}`,
        `bridge_shop_seq ${cfg.seq}`,
      ]);
      this.push("cfg resend sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push(`cfg resend skipped: ${message}`);
    }
    this.emitUpdate();
  }

  private onGameEvent(evt: StoredGameEvent): void {
    if (evt.type === "shop_catalog") {
      this.handleShopCatalog(evt.payload);
      return;
    }
    if (evt.type === "shop_owned") {
      this.handleShopOwned(evt.payload);
      return;
    }
    if (evt.type === "shop_vote_start") {
      this.handleHudVoteStart();
      return;
    }
    if (evt.type === "shop_vote_skip") {
      this.handleHudVoteSkip();
      return;
    }

    if (evt.type === "shop_open") {
      this.applyShopOpen(true, "event");
      return;
    }
    if (evt.type === "shop_closed") {
      this.applyShopOpen(false, "event");
      return;
    }

    if (evt.type === "phase") {
      const phase = typeof evt.payload.phase === "string" ? evt.payload.phase : "";
      // Prefer dedicated shop_open/shop_closed; phase only opens, never closes.
      if (phase === "shop") this.applyShopOpen(true, "phase");
      this.handleMatchPhase(phase);
      return;
    }

    if (evt.type === "shop_rolled") {
      if (!ROLL_PIPELINE_STAGES.has(this.stage)) {
        this.push("ignored shop_rolled (not in apply pipeline)");
        return;
      }
      this.cmdReceived = true;
      this.lastRolled = { ...evt.payload };
      this.lastWaiting = {
        reason: "awaiting_shop_range",
        name: evt.payload.name,
        cls: evt.payload.cls,
        tier: evt.payload.tier,
      };
      this.setStage("waiting_shop");
      this.push(`rolled ${String(evt.payload.name || evt.payload.cls || "?")} — approach shop`);
      this.emitUpdate();
      return;
    }
    if (evt.type === "shop_purchase_waiting") {
      if (!ROLL_PIPELINE_STAGES.has(this.stage)) return;
      this.lastWaiting = { ...evt.payload };
      if (this.stage === "applying" || this.stage === "rolled" || this.stage === "waiting_shop") {
        this.setStage("waiting_shop");
      }
      const reason = String(evt.payload.reason || "waiting");
      this.push(`waiting purchase: ${reason}`);
      this.emitUpdate();
      return;
    }
    if (evt.type === "shop_purchase") {
      if (!ROLL_PIPELINE_STAGES.has(this.stage)) return;
      this.lastPurchase = { ...evt.payload };
      this.lastWaiting = null;
      const ok = evt.payload.ok === true;
      this.setStage(ok ? "purchased" : "failed");
      this.push(ok ? "purchase ok" : "purchase failed");
      this.stopMockBot();
      if (ok) {
        this.addOwnedClassFromPurchase(evt.payload);
      }
      // Clear vote chrome after purchase/fail so leftover % / winner highlights do not stick.
      // Keep tallies through waiting_shop / rolled so a vote without buy still shows %.
      this.clearVoteResults();
      this.push(ok ? "vote tallies cleared after purchase" : "vote tallies cleared after fail");
      this.emitUpdate();
      this.scheduleAutoRestart();
      return;
    }
    if (evt.type === "shop_error") {
      const reason = String(evt.payload.reason || "unknown");
      if (!ROLL_PIPELINE_STAGES.has(this.stage)) {
        this.push(`ignored shop_error ${reason} (stage=${this.stage})`);
        return;
      }
      // Soft waits — purchase/roll may still complete when player opens shop / lists populate.
      if (WAITING_REASONS.has(reason) || reason === "roll_busy") {
        this.lastWaiting = { ...evt.payload };
        if (this.stage === "applying" || this.stage === "rolled") {
          this.setStage("waiting_shop");
        }
        this.push(`${reason} (waiting)`);
        this.emitUpdate();
        return;
      }
      this.lastError = { ...evt.payload };
      this.setStage("failed");
      this.push(`error ${reason}`);
      this.stopMockBot();
      this.clearVoteResults();
      this.push("vote tallies cleared after fail");
      this.emitUpdate();
      this.scheduleAutoRestart();
      return;
    }
    if (evt.type === "shop_cmd") {
      // Informational only — cmdReceived requires shop_rolled (actual visible roll).
      this.push(`shop_cmd ack seq=${String(evt.payload.seq ?? "?")}`);
      this.emitUpdate();
      return;
    }
    if (evt.type === "shop_cmd_poll") {
      // Diagnostics from Panorama poll — surface while stuck in applying.
      if (this.stage === "applying" || this.stage === "waiting_shop") {
        const pendingSeq = evt.payload.pendingSeq ?? evt.payload.seq;
        const busy = evt.payload.busy;
        const domReady = evt.payload.domReady;
        const parts = [`poll seq=${String(pendingSeq ?? "?")}`];
        if (busy === true) parts.push("busy");
        if (domReady === false) parts.push("dom_not_ready");
        if (evt.payload.httpOk === false) parts.push("http_fail");
        this.lastWaiting = {
          reason: domReady === false ? "dom_not_ready" : "awaiting_apply",
          ...evt.payload,
        };
        this.push(parts.join(" "));
        this.emitUpdate();
      }
    }
  }

  /** Sync shopOpen + match phase (heartbeat / status poll). Drives auto-start. */
  syncFromMatchPhase(phase: string, shopOpenHint?: boolean | null): void {
    if (phase) {
      this.handleMatchPhase(phase);
    }
    if (typeof shopOpenHint === "boolean") {
      this.applyShopOpen(shopOpenHint, "match.shopOpen");
      return;
    }
    // null/undefined hint: only open from phase===shop; never force-close.
    if (phase === "shop") {
      this.applyShopOpen(true, "match.phase");
    }
  }

  private startMockBot(): void {
    this.stopMockBot();
    if (!this.mockBotEnabled) return;
    this.mockBotActive = true;
    this.mockTimer = setInterval(() => {
      let changed = false;
      if (this.stage === "voting_items" && this.catalogItems.length > 0) {
        const idx = Math.floor(Math.random() * this.catalogItems.length);
        for (let i = 0; i < this.mockBotVotesPerTick; i++) {
          this.itemTally[idx] = (this.itemTally[idx] ?? 0) + 1;
        }
        changed = true;
      }
      if (this.stage === "voting_category" || this.stage === "voting_combined") {
        const cats = this.enabledCategories();
        if (cats.length > 1 || this.stage === "voting_category") {
          if (cats.length > 0) {
            const opt = cats[Math.floor(Math.random() * cats.length)];
            for (let i = 0; i < this.mockBotVotesPerTick; i++) {
              this.categoryTally[opt] += 1;
            }
            changed = true;
          }
        }
      }
      if (this.stage === "voting_tier" || this.stage === "voting_combined") {
        if (this.stage !== "voting_combined" || this.enabledTiers().length > 1) {
          let pool = this.enabledTiers();
          if (this.maxAffordableTier != null) {
            pool = pool.filter((t) => t <= this.maxAffordableTier!);
          }
          const tiers = pool.length > 0 ? pool : this.enabledTiers();
          if (tiers.length > 0) {
            const opt = tiers[Math.floor(Math.random() * tiers.length)];
            const key = String(opt) as "1" | "2" | "3" | "4";
            for (let i = 0; i < this.mockBotVotesPerTick; i++) {
              this.tierTally[key] += 1;
            }
            changed = true;
          }
        }
      }
      if (changed) this.emitUpdate();
    }, this.mockBotIntervalMs);
  }

  private stopMockBot(): void {
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    this.mockBotActive = false;
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private isMatchActiveForAutoStart(): boolean {
    // Unknown until first heartbeat — allow schedule (purchase path / tests).
    if (!this.matchPhase) return true;
    if (MATCH_OUTSIDE_PHASES.has(this.matchPhase)) return false;
    return MATCH_ACTIVE_PHASES.has(this.matchPhase);
  }

  private isMatchOutsidePhase(phase: string): boolean {
    return !phase || MATCH_OUTSIDE_PHASES.has(phase);
  }

  private isMatchInsidePhase(phase: string): boolean {
    return MATCH_ACTIVE_PHASES.has(phase);
  }

  private handleMatchPhase(phase: string): void {
    if (!phase) return;
    const prev = this.matchPhase;
    if (prev === phase) return;
    this.matchPhase = phase;

    if (this.isMatchOutsidePhase(phase)) {
      this.clearRestartTimer();
      if (this.ownedClassCats.size > 0) {
        this.ownedClassCats.clear();
        this.push(`match phase=${phase}; owned classes cleared`);
        this.emitUpdate();
      }
      this.push(`match phase=${phase}; auto-start cancelled`);
      return;
    }

    // Entering match from outside (incl. false-paused custom lobbies → in_match).
    const enteredMatch =
      this.isMatchOutsidePhase(prev) && this.isMatchInsidePhase(phase);
    if (enteredMatch && this.autoStart && (this.stage === "idle" || this.stage === "purchased")) {
      this.push(`match phase=${phase}; scheduling auto-start`);
      this.scheduleAutoRestart();
    }
  }

  private scheduleAutoRestart(): void {
    this.clearRestartTimer();
    if (!this.autoStart) return;
    if (!this.isMatchActiveForAutoStart()) {
      this.push(`auto-restart skipped (phase=${this.matchPhase || "unknown"})`);
      return;
    }
    const delayMs = randomAutoStartDelayMs(this.settings);
    this.push(`auto-restart in ${Math.round(delayMs / 1000)}s`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.autoStart) return;
      if (!this.isMatchActiveForAutoStart()) {
        this.push(`auto-restart aborted (phase=${this.matchPhase || "unknown"})`);
        return;
      }
      if (this.stage !== "purchased" && this.stage !== "idle" && this.stage !== "failed") return;
      void this.start(this.settings.defaultStartMode);
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
    this.clearApplyDelayTimer();
    this.clearRestartTimer();
    this.stopMockBot();
    this.stageEndsAt = null;
    this.stageStartedAt = null;
  }

  private setStage(stage: ShopVoteStage): void {
    this.stage = stage;
  }

  private clearUserVotes(): void {
    this.categoryVotes.clear();
    this.tierVotes.clear();
    this.itemVotes.clear();
  }

  private clearVoteResults(): void {
    this.categoryTally = emptyCategoryTally();
    this.tierTally = emptyTierTally();
    this.winnerCategory = null;
    this.winnerTier = null;
    this.winnerItemIndex = null;
    this.itemTally = [];
    this.catalogItems = [];
  }

  private isPurchasePending(): boolean {
    return Boolean(this.lastCfg) && this.lastCfg!.cat > 0 && !this.cmdReceived;
  }

  private recordRecentVote(option: string, userId: string | null): void {
    this.recentVotes.unshift({ option, userId, at: Date.now() });
    if (this.recentVotes.length > 10) this.recentVotes.length = 10;
  }

  private push(msg: string): void {
    const stamp = new Date().toLocaleTimeString();
    this.pipeline.unshift(`[${stamp}] ${msg}`);
    if (this.pipeline.length > 40) this.pipeline.length = 40;
  }

  /** Append a pipeline note (e.g. chat announce result) and refresh listeners. */
  note(msg: string): void {
    this.push(msg);
    this.emitUpdate();
  }

  private emitUpdate(): void {
    this.emit("update", this.getSnapshot());
  }
}

export function parseShopCategory(value: unknown): ShopCategory | null {
  if (typeof value === "number" && CV_TO_CATEGORY[value]) return CV_TO_CATEGORY[value];
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "weapon" || v === "1") return "weapon";
  if (v === "vitality" || v === "armor" || v === "2") return "vitality";
  if (v === "spirit" || v === "tech" || v === "3") return "spirit";
  return null;
}

/** Map RandomShop listId / Panorama nav id → category. */
export function listIdToShopCategory(listId: string | null | undefined): ShopCategory | null {
  if (!listId) return null;
  const v = listId.trim().toLowerCase();
  if (v.includes("weapon")) return "weapon";
  if (v.includes("armor") || v.includes("vital")) return "vitality";
  if (v.includes("tech") || v.includes("spirit")) return "spirit";
  return parseShopCategory(listId);
}

export function parseOwnedClassList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const cls = sanitizeHelpClassName(typeof entry === "string" ? entry : null);
    if (!cls || seen.has(cls)) continue;
    seen.add(cls);
    out.push(cls);
  }
  return out;
}

export function parseOwnedClassCategories(
  raw: unknown,
): Map<string, ShopCategory> {
  const out = new Map<string, ShopCategory>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cls = sanitizeHelpClassName(key);
    const cat = parseShopCategory(value);
    if (cls && cat) out.set(cls, cat);
  }
  return out;
}

export function parseShopTier(value: unknown): ShopTier | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}

/** Accept `item:3`, `item:3` with bang, or bare index when catalogSize > 4. */
export function parseItemVoteOption(text: string, catalogSize: number): number | null {
  if (catalogSize <= 0) return null;
  const raw = text.trim().toLowerCase().replace(/^!+/, "");
  let n: number | null = null;
  const m = /^item[:\s#_-]*(\d+)$/.exec(raw);
  if (m) {
    n = Number.parseInt(m[1], 10);
  } else if (/^\d+$/.test(raw)) {
    n = Number.parseInt(raw, 10);
  }
  if (n == null || !Number.isFinite(n)) return null;
  // Allow 0-based or 1-based: if n === catalogSize treat as 0-based last index only when n < size.
  if (n >= 0 && n < catalogSize) return n;
  if (n >= 1 && n <= catalogSize) return n - 1;
  return null;
}

/** Accept `class:upgrade_foo` (preserves class_name casing via sanitize). */
export function parseClassVoteOption(text: string): string | null {
  const raw = String(text ?? "")
    .trim()
    .replace(/^!+/, "");
  const m = /^class[:\s#_-]+(.+)$/i.exec(raw);
  if (!m) return null;
  return sanitizeHelpClassName(m[1].trim());
}
