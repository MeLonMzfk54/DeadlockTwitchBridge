export type { GameCommandMode } from "./game/game-command-client.js";
import type { GameCommandMode } from "./game/game-command-client.js";

export interface AppConfig {
  twitchClientId: string;
  twitchClientSecret: string;
  twitchAccessToken: string;
  twitchRefreshToken: string;
  twitchBroadcasterId: string;
  gameCommandMode: GameCommandMode;
  deadlockCfgDir: string;
  cfgBindFilename: string;
  cfgTriggerKey: string;
  cfgBindCommandDelayMs: number;
  deadlockWindowTitle: string;
  deadlockProcessName: string;
  deadlockGameDir: string;
  deadlockConsoleLog: string;
  vconsoleHost: string;
  vconsolePort: number;
  vconsoleReconnectMs: number;
  httpHost: string;
  httpPort: number;
  testMode: boolean;
  allowCheatEffects: boolean;
  allowDestructiveEffects: boolean;
  maxQueueSize: number;
  shopVoteCategoryMs: number;
  shopVoteTierMs: number;
  shopVoteRestartMs: number;
}

export interface EffectRequest {
  id: string;
  durationSec?: number;
  params?: Record<string, unknown>;
}

export interface RewardConfig {
  name: string;
  effects: EffectRequest[];
  cooldownSec?: number;
  usesUserInput?: boolean;
}

export interface RewardsFile {
  rewards: Record<string, RewardConfig>;
}

export interface EffectCatalogEntry {
  id: string;
  name: string;
  description: string;
  retailSafe: boolean;
  cfgBindSafe?: boolean;
  defaultDurationSec: number;
  category?: "hud" | "skill" | "roster" | "shop" | "other";
  oneShot?: boolean;
  experimental?: boolean;
  requiresUserInput?: boolean;
  userInputHint?: string;
  defaultParams?: Record<string, unknown>;
  destructive?: boolean;
}

export interface EffectsCatalog {
  effects: EffectCatalogEntry[];
}

export interface ActiveEffectState {
  effectId: string;
  viewer?: string;
  rewardName?: string;
  startedAt: number;
  expiresAt: number;
  timer?: NodeJS.Timeout;
}

export interface BridgeEvent {
  type: "effect_applied" | "effect_reverted" | "reward_received" | "error" | "status";
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface ShopVoteStatus {
  stage: string;
  shopOpen: boolean;
  autoStart: boolean;
  stageEndsAt: number | null;
  stageStartedAt: number | null;
  categoryTally: Record<string, number>;
  tierTally: Record<string, number>;
  categoryPct: Record<string, number>;
  tierPct: Record<string, number>;
  winnerCategory: string | null;
  winnerTier: number | null;
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
  maxAffordableTier: number | null;
  categoryDurationMs: number;
  tierDurationMs: number;
  restartDelayMs: number;
  recentVotes: { option: string; userId: string | null; at: number }[];
  settings?: {
    autoStart: boolean;
    mockBotEnabled: boolean;
    categoryDurationMs: number;
    tierDurationMs: number;
    restartDelayMs: number;
    defaultStartMode: "full" | "category" | "tier";
    enabledCategories: string[];
    minTier: number;
    maxTier: number;
    requireBangPrefix: boolean;
    applyDelayMs: number;
    mockBotIntervalMs: number;
    overlayHoldMs: number;
    chatAnnounceCombined?: string;
  };
}

export interface BridgeStatus {
  twitchConnected: boolean;
  /** True when EventSub `channel.chat.message` subscription is active. */
  chatConnected: boolean;
  gameConnected: boolean;
  gameProcessRunning: boolean;
  gameCommandMode: GameCommandMode;
  testMode: boolean;
  activeEffects: ActiveEffectState[];
  queueLength: number;
  recentEvents: BridgeEvent[];
  gameTelemetry: GameTelemetryStatus;
  shopVote: ShopVoteStatus;
}

export type GameEventTransport = "http" | "log";

export interface IncomingGameEvent {
  v: number;
  id: string;
  tsMs: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface StoredGameEvent extends IncomingGameEvent {
  seq: number;
  receivedAt: number;
  transport: GameEventTransport;
}

export interface MatchSnapshot {
  phase: string;
  shopOpen: boolean | null;
  dead: boolean;
  respawnSec: number | null;
  clock: string;
  friendlyKills: number | null;
  enemyKills: number | null;
  lastKill: string;
  hero: string;
  httpOk: boolean | null;
  panelsFound: {
    dataFeed: boolean | null;
    announcements: boolean | null;
    gameEvents: boolean | null;
  };
  updatedAt: number;
}

export interface GameTelemetryStatus {
  modOnline: boolean;
  modLastSeenAt: number;
  lastTransport: GameEventTransport | null;
  lastEventType: string;
  eventCount: number;
  consoleLogPath: string | null;
  consoleLogTailing: boolean;
  lastHeartbeat: Record<string, unknown> | null;
  match: MatchSnapshot;
}

export type EffectActivationSource = "twitch" | "test-ui" | "manual";

export interface TwitchRedemption {
  id: string;
  broadcasterUserId: string;
  broadcasterUserLogin: string;
  userId: string;
  userLogin: string;
  userInput: string;
  status: string;
  reward: {
    id: string;
    title: string;
    cost: number;
  };
  redeemedAt: string;
}

export interface TwitchChatMessage {
  messageId: string;
  broadcasterUserId: string;
  broadcasterUserLogin: string;
  chatterUserId: string;
  chatterUserLogin: string;
  text: string;
}
