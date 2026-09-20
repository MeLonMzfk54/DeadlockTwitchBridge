import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectRoot } from "../config.js";

export type ShopStartMode = "full" | "category" | "tier";
export type ShopSettingsCategory = "weapon" | "vitality" | "spirit";
export type ShopSettingsTier = 1 | 2 | 3 | 4;

const ALL_CATEGORIES: ShopSettingsCategory[] = ["weapon", "vitality", "spirit"];

/** Twitch chat message hard limit. */
export const TWITCH_CHAT_MESSAGE_MAX_LEN = 500;

export const DEFAULT_CHAT_ANNOUNCE_CATEGORY =
  "Голосование началось! Категория магазина — пишите в чат: {options}. {seconds} сек.";
export const DEFAULT_CHAT_ANNOUNCE_TIER =
  "Голосование за тир ({category})! Пишите в чат: {options}. {seconds} сек.";

export interface ShopVoteSettings {
  /** After a successful purchase, wait restartDelayMs then start a new vote (shop need not be open). */
  autoStart: boolean;
  mockBotEnabled: boolean;
  categoryDurationMs: number;
  tierDurationMs: number;
  restartDelayMs: number;
  /** Mode used by auto-start / auto-restart / HUD start. */
  defaultStartMode: ShopStartMode;
  /** Categories chat/panel may vote for (at least one). */
  enabledCategories: ShopSettingsCategory[];
  minTier: ShopSettingsTier;
  maxTier: ShopSettingsTier;
  /** When true, chat votes must start with `!` (`!w`, `!1`). */
  requireBangPrefix: boolean;
  /** Pause after winners are picked before PNG/cfg apply. */
  applyDelayMs: number;
  mockBotIntervalMs: number;
  /** How long OBS overlay keeps showing after rolled/purchased. */
  overlayHoldMs: number;
  /** Accept shop_vote_start / shop_vote_skip from Random Shop HUD button. */
  allowHudStart: boolean;
  /** When true, HUD START during an active vote restarts the cycle; when false, ignore. */
  hudCanRestart: boolean;
  /** Send a Twitch chat message when a real voting stage starts. */
  chatAnnounceEnabled: boolean;
  /** Template for category-vote announce (empty = skip). Placeholders: {options} {seconds} {prefix} {category}. */
  chatAnnounceCategory: string;
  /** Template for tier-vote announce (empty = skip). */
  chatAnnounceTier: string;
}

export interface ShopVoteSettingsSeed {
  categoryDurationMs?: number;
  tierDurationMs?: number;
  restartDelayMs?: number;
}

export const DEFAULT_SHOP_VOTE_APPLY_DELAY_MS = 0;
export const DEFAULT_SHOP_VOTE_MOCK_INTERVAL_MS = 900;
export const DEFAULT_SHOP_VOTE_OVERLAY_HOLD_MS = 8_000;

export function defaultShopVoteSettings(seed: ShopVoteSettingsSeed = {}): ShopVoteSettings {
  return {
    autoStart: false,
    mockBotEnabled: false,
    categoryDurationMs: seed.categoryDurationMs ?? 25_000,
    tierDurationMs: seed.tierDurationMs ?? 25_000,
    restartDelayMs: seed.restartDelayMs ?? 25_000,
    defaultStartMode: "full",
    enabledCategories: [...ALL_CATEGORIES],
    minTier: 1,
    maxTier: 4,
    requireBangPrefix: false,
    applyDelayMs: DEFAULT_SHOP_VOTE_APPLY_DELAY_MS,
    mockBotIntervalMs: DEFAULT_SHOP_VOTE_MOCK_INTERVAL_MS,
    overlayHoldMs: DEFAULT_SHOP_VOTE_OVERLAY_HOLD_MS,
    allowHudStart: true,
    hudCanRestart: true,
    chatAnnounceEnabled: true,
    chatAnnounceCategory: DEFAULT_CHAT_ANNOUNCE_CATEGORY,
    chatAnnounceTier: DEFAULT_CHAT_ANNOUNCE_TIER,
  };
}

function isPositiveMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseTier(value: unknown, fallback: ShopSettingsTier): ShopSettingsTier {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return fallback;
}

function parseStartMode(value: unknown, fallback: ShopStartMode): ShopStartMode {
  if (value === "full" || value === "category" || value === "tier") return value;
  return fallback;
}

function parseEnabledCategories(
  value: unknown,
  fallback: ShopSettingsCategory[],
): ShopSettingsCategory[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: ShopSettingsCategory[] = [];
  for (const item of value) {
    if (item === "weapon" || item === "vitality" || item === "spirit") {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out.length > 0 ? out : [...fallback];
}

function clampAnnounceText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // Allow empty string (means skip this stage). Cap storage slightly above Twitch max.
  return value.slice(0, TWITCH_CHAT_MESSAGE_MAX_LEN * 2);
}

/** Merge partial JSON / API payload onto a base settings object. */
export function mergeShopVoteSettings(
  base: ShopVoteSettings,
  partial: Partial<ShopVoteSettings> | Record<string, unknown>,
): ShopVoteSettings {
  const next: ShopVoteSettings = { ...base, enabledCategories: [...base.enabledCategories] };

  if (typeof partial.autoStart === "boolean") next.autoStart = partial.autoStart;
  if (typeof partial.mockBotEnabled === "boolean") next.mockBotEnabled = partial.mockBotEnabled;
  if (typeof partial.allowHudStart === "boolean") next.allowHudStart = partial.allowHudStart;
  if (typeof partial.hudCanRestart === "boolean") next.hudCanRestart = partial.hudCanRestart;
  if (typeof partial.chatAnnounceEnabled === "boolean") {
    next.chatAnnounceEnabled = partial.chatAnnounceEnabled;
  }
  if ("chatAnnounceCategory" in partial) {
    next.chatAnnounceCategory = clampAnnounceText(
      partial.chatAnnounceCategory,
      next.chatAnnounceCategory,
    );
  }
  if ("chatAnnounceTier" in partial) {
    next.chatAnnounceTier = clampAnnounceText(partial.chatAnnounceTier, next.chatAnnounceTier);
  }
  if (isPositiveMs(partial.categoryDurationMs)) {
    next.categoryDurationMs = Math.round(partial.categoryDurationMs);
  }
  if (isPositiveMs(partial.tierDurationMs)) {
    next.tierDurationMs = Math.round(partial.tierDurationMs);
  }
  if (isPositiveMs(partial.restartDelayMs)) {
    next.restartDelayMs = Math.round(partial.restartDelayMs);
  }
  if ("defaultStartMode" in partial) {
    next.defaultStartMode = parseStartMode(partial.defaultStartMode, next.defaultStartMode);
  }
  if ("enabledCategories" in partial) {
    next.enabledCategories = parseEnabledCategories(partial.enabledCategories, next.enabledCategories);
  }
  if ("minTier" in partial) next.minTier = parseTier(partial.minTier, next.minTier);
  if ("maxTier" in partial) next.maxTier = parseTier(partial.maxTier, next.maxTier);
  if (typeof partial.requireBangPrefix === "boolean") {
    next.requireBangPrefix = partial.requireBangPrefix;
  }
  if (isNonNegMs(partial.applyDelayMs)) {
    next.applyDelayMs = Math.round(partial.applyDelayMs);
  }
  if (isPositiveMs(partial.mockBotIntervalMs)) {
    next.mockBotIntervalMs = Math.round(partial.mockBotIntervalMs);
  }
  if (isPositiveMs(partial.overlayHoldMs)) {
    next.overlayHoldMs = Math.round(partial.overlayHoldMs);
  }

  if (next.minTier > next.maxTier) {
    const t = next.minTier;
    next.minTier = next.maxTier;
    next.maxTier = t;
  }

  return next;
}

export function shopVoteSettingsPath(): string {
  return join(projectRoot, "config", "shop-vote.json");
}

/**
 * Load settings from disk. Missing file → defaults from seed (env durations).
 * When `createIfMissing` is true, write the defaults so the next boot finds them.
 */
export function loadShopVoteSettings(
  seed: ShopVoteSettingsSeed = {},
  options: { createIfMissing?: boolean; path?: string } = {},
): ShopVoteSettings {
  const path = options.path ?? shopVoteSettingsPath();
  const defaults = defaultShopVoteSettings(seed);

  if (!existsSync(path)) {
    if (options.createIfMissing) {
      saveShopVoteSettings(defaults, path);
    }
    return defaults;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return mergeShopVoteSettings(defaults, raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[shop] Failed to read ${path}: ${message}; using defaults`);
    return defaults;
  }
}

/** Atomically write settings JSON (temp file + rename). */
export function saveShopVoteSettings(settings: ShopVoteSettings, path = shopVoteSettingsPath()): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(settings, null, 2)}\n`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

/** Enabled tiers in [min, max] inclusive. */
export function enabledTiersFromSettings(
  settings: Pick<ShopVoteSettings, "minTier" | "maxTier">,
): ShopSettingsTier[] {
  const out: ShopSettingsTier[] = [];
  for (let t = settings.minTier; t <= settings.maxTier; t++) {
    out.push(t as ShopSettingsTier);
  }
  return out.length > 0 ? out : [1];
}

const CAT_SHORT: Record<ShopSettingsCategory, string> = {
  weapon: "w",
  vitality: "v",
  spirit: "s",
};

const CAT_LABELS: Record<ShopSettingsCategory, string> = {
  weapon: "Weapon",
  vitality: "Vitality",
  spirit: "Spirit",
};

export interface FormatShopChatAnnounceInput {
  stage: "voting_category" | "voting_tier";
  settings: Pick<
    ShopVoteSettings,
    | "chatAnnounceEnabled"
    | "chatAnnounceCategory"
    | "chatAnnounceTier"
    | "requireBangPrefix"
    | "enabledCategories"
    | "minTier"
    | "maxTier"
    | "categoryDurationMs"
    | "tierDurationMs"
  >;
  /** Winning / locked category (for tier stage). */
  category?: ShopSettingsCategory | string | null;
}

/**
 * Build the chat announce string for a voting stage, or null if disabled / empty / no template.
 * Substitutes {options} {seconds} {prefix} {category}; trims to Twitch max length.
 */
export function formatShopChatAnnounce(input: FormatShopChatAnnounceInput): string | null {
  const { stage, settings } = input;
  if (!settings.chatAnnounceEnabled) return null;

  const template =
    stage === "voting_category"
      ? settings.chatAnnounceCategory
      : settings.chatAnnounceTier;
  if (typeof template !== "string" || !template.trim()) return null;

  const prefix = settings.requireBangPrefix ? "!" : "";
  let options: string;
  let seconds: number;

  if (stage === "voting_category") {
    const cats =
      settings.enabledCategories.length > 0
        ? settings.enabledCategories
        : ALL_CATEGORIES;
    options = cats
      .map((c) => (prefix ? `${prefix}${CAT_SHORT[c]}` : c))
      .join(" / ");
    seconds = Math.max(1, Math.round(settings.categoryDurationMs / 1000));
  } else {
    const tiers = enabledTiersFromSettings(settings);
    options = tiers.map((t) => `${prefix}${t}`).join(" / ");
    seconds = Math.max(1, Math.round(settings.tierDurationMs / 1000));
  }

  const catKey = (input.category ?? "") as ShopSettingsCategory;
  const categoryLabel =
    catKey === "weapon" || catKey === "vitality" || catKey === "spirit"
      ? CAT_LABELS[catKey]
      : String(input.category ?? "—");

  const filled = template
    .replaceAll("{options}", options)
    .replaceAll("{seconds}", String(seconds))
    .replaceAll("{prefix}", prefix)
    .replaceAll("{category}", categoryLabel)
    .trim();

  if (!filled) return null;
  return filled.length > TWITCH_CHAT_MESSAGE_MAX_LEN
    ? filled.slice(0, TWITCH_CHAT_MESSAGE_MAX_LEN)
    : filled;
}
