export type EffectCategory = "hud" | "skill" | "roster" | "shop" | "other";

export interface GameEffect {
  id: string;
  name: string;
  category?: EffectCategory;
  retailSafe: boolean;
  defaultDurationSec: number;
  oneShot?: boolean;
  experimental?: boolean;
  destructive?: boolean;
  requiresUserInput?: boolean;
  userInputHint?: string;
  defaultParams?: Record<string, unknown>;
  apply(vc: import("../game/vconsole.js").VConsoleClient, params?: Record<string, unknown>): Promise<void>;
  revert(vc: import("../game/vconsole.js").VConsoleClient, params?: Record<string, unknown>): Promise<void>;
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
  defaultDurationSec: number,
  toggle: ConVarToggle,
): GameEffect {
  return {
    id,
    name,
    retailSafe,
    defaultDurationSec,
    async apply(vc) {
      await vc.sendCommand(`${toggle.name} ${formatConVarValue(toggle.onValue)}`);
    },
    async revert(vc) {
      await vc.sendCommand(`${toggle.name} ${formatConVarValue(toggle.offValue)}`);
    },
  };
}

export async function sendConVars(
  vc: import("../game/vconsole.js").VConsoleClient,
  commands: Array<{ name: string; value: string | number | boolean }>,
): Promise<void> {
  for (const cmd of commands) {
    await vc.sendCommand(`${cmd.name} ${formatConVarValue(cmd.value)}`);
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
