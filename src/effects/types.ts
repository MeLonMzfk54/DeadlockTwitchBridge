import type { GameCommandClient } from "../game/game-command-client.js";

export type EffectCategory = "hud" | "skill" | "roster" | "shop" | "other";

export interface GameEffect {
  id: string;
  name: string;
  category?: EffectCategory;
  retailSafe: boolean;
  cfgBindSafe: boolean;
  defaultDurationSec: number;
  oneShot?: boolean;
  experimental?: boolean;
  destructive?: boolean;
  requiresUserInput?: boolean;
  userInputHint?: string;
  defaultParams?: Record<string, unknown>;
  apply(client: GameCommandClient, params?: Record<string, unknown>): Promise<void>;
  revert(client: GameCommandClient, params?: Record<string, unknown>): Promise<void>;
}

export interface ConVarToggle {
  name: string;
  onValue: string | number | boolean;
  offValue: string | number | boolean;
}

export function formatConVarValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

export function createToggleEffect(
  id: string,
  name: string,
  retailSafe: boolean,
  cfgBindSafe: boolean,
  defaultDurationSec: number,
  toggle: ConVarToggle,
): GameEffect {
  return {
    id,
    name,
    retailSafe,
    cfgBindSafe,
    defaultDurationSec,
    async apply(client) {
      await client.sendCommand(`${toggle.name} ${formatConVarValue(toggle.onValue)}`);
    },
    async revert(client) {
      await client.sendCommand(`${toggle.name} ${formatConVarValue(toggle.offValue)}`);
    },
  };
}

export async function sendConVars(
  client: GameCommandClient,
  commands: Array<{ name: string; value: string | number | boolean }>,
): Promise<void> {
  for (const cmd of commands) {
    await client.sendCommand(`${cmd.name} ${formatConVarValue(cmd.value)}`);
  }
}

export function mergeEffectParams(
  effect: GameEffect,
  params?: Record<string, unknown>,
  userInput?: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(effect.defaultParams ?? {}),
    ...(params ?? {}),
  };
  if (userInput !== undefined && userInput !== "") {
    merged.userInput = userInput;
  }
  return merged;
}
