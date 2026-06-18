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
  vconsoleHost: string;
  vconsolePort: number;
  vconsoleReconnectMs: number;
  httpHost: string;
  httpPort: number;
  testMode: boolean;
  allowCheatEffects: boolean;
  allowDestructiveEffects: boolean;
  maxQueueSize: number;
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

export interface BridgeStatus {
  twitchConnected: boolean;
  gameConnected: boolean;
  gameProcessRunning: boolean;
  gameCommandMode: GameCommandMode;
  testMode: boolean;
  activeEffects: ActiveEffectState[];
  queueLength: number;
  recentEvents: BridgeEvent[];
}

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

export type EffectActivationSource = "twitch" | "test-ui" | "manual";
