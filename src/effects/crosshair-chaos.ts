import type { GameCommandClient } from "../game/game-command-client.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";

const CROSSHAIR_VARS = [
  "citadel_crosshair_color_r",
  "citadel_crosshair_color_g",
  "citadel_crosshair_color_b",
  "citadel_crosshair_pip_gap",
  "citadel_crosshair_pip_height",
  "citadel_crosshair_pip_width",
  "citadel_crosshair_pip_outline_gap",
  "citadel_crosshair_pip_outline_border",
  "citadel_crosshair_dot_size",
  "citadel_crosshair_dot_opacity",
  "citadel_crosshair_dot_outline_border",
] as const;

const savedValues = new Map<string, string>();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function queryConVar(client: GameCommandClient, name: string): Promise<string | null> {
  // Source 2 does not return values over VConsole reliably; use archive defaults as fallback.
  void client;
  const defaults: Record<string, string> = {
    citadel_crosshair_color_r: "0",
    citadel_crosshair_color_g: "255",
    citadel_crosshair_color_b: "0",
    citadel_crosshair_pip_gap: "2",
    citadel_crosshair_pip_height: "3",
    citadel_crosshair_pip_width: "1",
    citadel_crosshair_pip_outline_gap: "0",
    citadel_crosshair_pip_outline_border: "2",
    citadel_crosshair_dot_size: "0",
    citadel_crosshair_dot_opacity: "0",
    citadel_crosshair_dot_outline_border: "0",
  };
  return defaults[name] ?? null;
}

export const crosshairChaosEffect: GameEffect = {
  id: "crosshair_chaos",
  name: "Хаотичный прицел",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  async apply(client) {
    savedValues.clear();
    for (const varName of CROSSHAIR_VARS) {
      savedValues.set(varName, (await queryConVar(client, varName)) ?? "0");
    }
    await sendConVars(client, [
      { name: "citadel_crosshair_color_r", value: randomInt(0, 255) },
      { name: "citadel_crosshair_color_g", value: randomInt(0, 255) },
      { name: "citadel_crosshair_color_b", value: randomInt(0, 255) },
      { name: "citadel_crosshair_pip_gap", value: 50 },
      { name: "citadel_crosshair_pip_height", value: 50 },
      { name: "citadel_crosshair_pip_width", value: 50 },
      { name: "citadel_crosshair_dot_size", value: 100 },
      { name: "citadel_crosshair_dot_opacity", value: 1 },
      { name: "citadel_crosshair_dot_outline_border", value: 10 },
    ]);
  },
  async revert(client) {
    const restore = CROSSHAIR_VARS.map((name) => ({
      name,
      value: savedValues.get(name) ?? "0",
    }));
    await sendConVars(client, restore);
    savedValues.clear();
  },
};
