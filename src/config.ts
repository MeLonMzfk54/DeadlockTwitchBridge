import { config as loadDotenv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, EffectsCatalog, RewardsFile } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(__dirname, "..");

loadDotenv({ path: join(projectRoot, ".env") });

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function envInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAppConfig(): AppConfig {
  return {
    twitchClientId: process.env.TWITCH_CLIENT_ID ?? "",
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    twitchAccessToken: process.env.TWITCH_ACCESS_TOKEN ?? "",
    twitchRefreshToken: process.env.TWITCH_REFRESH_TOKEN ?? "",
    twitchBroadcasterId: process.env.TWITCH_BROADCASTER_ID ?? "",
    vconsoleHost: process.env.VCONSOLE_HOST ?? "127.0.0.1",
    vconsolePort: envInt("VCONSOLE_PORT", 29000),
    vconsoleReconnectMs: envInt("VCONSOLE_RECONNECT_MS", 5000),
    httpHost: process.env.HTTP_HOST ?? "127.0.0.1",
    httpPort: envInt("HTTP_PORT", 3920),
    testMode: envBool("TEST_MODE", false) || process.argv.includes("--test-mode"),
    allowCheatEffects: envBool("ALLOW_CHEAT_EFFECTS", false),
    allowDestructiveEffects: envBool("ALLOW_DESTRUCTIVE_EFFECTS", false),
    maxQueueSize: envInt("MAX_QUEUE_SIZE", 10),
  };
}

export function loadRewardsConfig(): RewardsFile {
  const path = join(projectRoot, "config", "rewards.json");
  if (!existsSync(path)) {
    const examplePath = join(projectRoot, "config", "rewards.example.json");
    return JSON.parse(readFileSync(examplePath, "utf8")) as RewardsFile;
  }
  return JSON.parse(readFileSync(path, "utf8")) as RewardsFile;
}

export function loadEffectsCatalog(): EffectsCatalog {
  const path = join(projectRoot, "config", "effects.json");
  return JSON.parse(readFileSync(path, "utf8")) as EffectsCatalog;
}

export const publicDir = join(projectRoot, "public");
