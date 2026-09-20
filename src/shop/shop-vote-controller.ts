import { EventEmitter } from "node:events";
import type { GameCommandClient } from "../game/game-command-client.js";
import type { GameEventBus } from "../game/game-event-bus.js";
import type { StoredGameEvent } from "../types.js";
import {
  defaultShopVoteSettings,
  enabledTiersFromSettings,
  mergeShopVoteSettings,
  type ShopStartMode,
  type ShopVoteSettings,
} from "./shop-vote-settings.js";

export type ShopVoteStage =
  | "idle"
  | "voting_category"
  | "voting_tier"
  | "voting_combined"
  | "applying"
  | "rolled"
  | "waiting_shop"
  | "purchased"
  | "failed";

/** Stages where chat/control may cast votes. */
export function isShopVotingStage(stage: ShopVoteStage | string): boolean {
  return stage === "voting_category" || stage === "voting_tier" || stage === "voting_combined";
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

/** Default vote / restart lengths (20–30s range). Overridden by env / /control. */
export const DEFAULT_SHOP_VOTE_CATEGORY_MS = 25_000;
export const DEFAULT_SHOP_VOTE_TIER_MS = 25_000;
export const DEFAULT_SHOP_VOTE_RESTART_MS = 25_000;

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
  restartDelayMs?: number;
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
  lastCfg: { seq: number; cat: number; tier: number } | null;
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
  restartDelayMs: number;
  recentVotes: ShopRecentVote[];
  /** Persistent prefs (also mirrored in flat fields above for older clients). */
  settings: ShopVoteSettings;
}

export interface ShopCmdPayload {
  seq: number;
  cat: number;
  tier: number;
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

export class ShopVoteController extends EventEmitter<{
  update: [ShopVoteSnapshot];
  /** Fired when a real voting stage begins (not when skipped for a single option). */
  vote_stage_start: [
    {
      stage: "voting_category" | "voting_tier" | "voting_combined";
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
  private lastCfg: { seq: number; cat: number; tier: number } | null = null;
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
  private recentVotes: ShopRecentVote[] = [];

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
  private get restartDelayMs(): number {
    return this.settings.restartDelayMs;
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
    } else if (this.stage === "purchased") {
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
      restartDelayMs: this.restartDelayMs,
      recentVotes: this.recentVotes.map((v) => ({ ...v })),
      settings: this.getSettings(),
    };
  }

  getShopCmd(): ShopCmdPayload {
    const snap = this.getSnapshot();
    if (!this.lastCfg) {
      return {
        seq: 0,
        cat: 0,
        tier: 0,
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
    restartDelayMs?: number;
  }): ShopVoteSnapshot {
    return this.applySettings({
      categoryDurationMs: options.categoryDurationMs,
      tierDurationMs: options.tierDurationMs,
      restartDelayMs: options.restartDelayMs,
    });
  }

  async start(mode: ShopStartMode = "full"): Promise<ShopVoteSnapshot> {
    this.clearTimers();
    this.runMode = mode;
    this.clearUserVotes();
    this.lastRolled = null;
    this.lastPurchase = null;
    this.lastWaiting = null;
    this.lastError = null;
    this.pipeline = [];

    if (mode === "tier") {
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
    return this.getSnapshot();
  }

  /** Last-vote-wins when `userId` is set; anonymous casts (control panel) always increment. */
  cast(option: string, userId?: string): ShopVoteSnapshot {
    if (this.applyDelayResolve || this.applyDelayTimer) {
      return this.getSnapshot();
    }
    const normalized = option.trim().toLowerCase();
    const uid = typeof userId === "string" ? userId.trim() : "";

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
    this.push(`vote ${normalized}=${this.categoryTally[normalized]}`);
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
    this.push(`vote T${normalized}=${this.tierTally[normalized]}`);
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
    await this.sendCfg(category, tier);
    return this.getSnapshot();
  }

  /** Explicit shop-open signal from Panorama (preferred over phase string). */
  setShopOpen(open: boolean, source = "api"): void {
    this.applyShopOpen(open, source);
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
      this.setStage("idle");
      this.stageEndsAt = null;
      this.emitUpdate();
      return;
    }
    // full with pre-locked single tier (from beginCombinedVote skip path)
    if (this.runMode === "full" && this.winnerTier != null && this.enabledTiers().length <= 1) {
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
    await this.scheduleApply(this.winnerCategory, this.winnerTier);
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
    await this.scheduleApply(this.winnerCategory!, this.winnerTier!);
  }

  /** Optional pause so HUD/overlay can show winners before PNG/cfg apply. */
  private applyDelayGeneration = 0;
  private applyDelayResolve: (() => void) | null = null;

  private async scheduleApply(category: ShopCategory, tier: ShopTier): Promise<void> {
    const delay = this.settings.applyDelayMs;
    if (delay <= 0) {
      await this.sendCfg(category, tier);
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
    await this.sendCfg(category, tier);
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

  private async sendCfg(category: ShopCategory, tier: ShopTier): Promise<void> {
    this.setStage("applying");
    this.stageEndsAt = null;
    const seq = this.bumpSeq();
    const cat = CATEGORY_TO_CV[category];
    const cfg = { seq, cat, tier };
    this.lastCfg = cfg;
    this.cmdReceived = false;
    this.lastWaiting = null;
    this.push(`pending seq=${cfg.seq} cat=${category} tier=${tier}`);
    this.emitUpdate();
    try {
      await this.gameClient.sendCommands([
        `bridge_shop_cat ${cat}`,
        `bridge_shop_tier ${tier}`,
        `bridge_shop_seq ${cfg.seq}`,
      ]);
      this.push("cfg backup sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push(`cfg backup skipped: ${message}`);
    }
    // PNG cmd slot is primary apply; cfg-bind remains backup.
    this.emitUpdate();
  }

  /**
   * Skip/cancel: bump seq with cat=0, tier=0.
   * PNG cmd: w=seq, h=0 → RandomShopCancelRoll; cfg backup still sent.
   */
  private async sendSkipCfg(): Promise<void> {
    const seq = this.bumpSeq();
    const cfg = { seq, cat: 0, tier: 0 };
    this.lastCfg = cfg;
    this.cmdReceived = false;
    this.push(`skip cfg seq=${cfg.seq} cat=0 tier=0`);
    this.emitUpdate();
    try {
      await this.gameClient.sendCommands([
        "bridge_shop_cat 0",
        "bridge_shop_tier 0",
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
      // Clear vote chrome after purchase/fail so leftover % / winner highlights do not stick.
      // Keep tallies through waiting_shop / rolled so a vote without buy still shows %.
      this.clearVoteResults();
      this.push(ok ? "vote tallies cleared after purchase" : "vote tallies cleared after fail");
      this.emitUpdate();
      if (ok) this.scheduleAutoRestart();
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

  /** Sync shopOpen from match snapshot (heartbeat / dedicated field). */
  syncFromMatchPhase(phase: string, shopOpenHint?: boolean | null): void {
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

  private scheduleAutoRestart(): void {
    this.clearRestartTimer();
    if (!this.autoStart) return;
    this.push(`auto-restart in ${Math.round(this.restartDelayMs / 1000)}s`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.autoStart) return;
      if (this.stage !== "purchased" && this.stage !== "idle") return;
      // After purchase: always start — shop need not stay open.
      void this.start(this.settings.defaultStartMode);
    }, this.restartDelayMs);
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
  }

  private clearVoteResults(): void {
    this.categoryTally = emptyCategoryTally();
    this.tierTally = emptyTierTally();
    this.winnerCategory = null;
    this.winnerTier = null;
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

export function parseShopTier(value: unknown): ShopTier | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}
