import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";

export interface MinimapFxConvarMapping {
  active: string;
  size: string;
  spinDegPerSec: string;
  opacity: string;
  defaults: Record<string, number>;
}

function loadMapping(): MinimapFxConvarMapping {
  const path = join(projectRoot, "config", "minimap-fx-convars.json");
  return JSON.parse(readFileSync(path, "utf8")) as MinimapFxConvarMapping;
}

function paramNumber(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildApplyCommands(
  mapping: MinimapFxConvarMapping,
  params?: Record<string, unknown>,
): Array<{ name: string; value: string | number | boolean }> {
  const defaults = mapping.defaults ?? {};
  return [
    { name: mapping.active, value: 1 },
    { name: mapping.size, value: paramNumber(params, "size", defaults.size ?? 900) },
    { name: mapping.spinDegPerSec, value: paramNumber(params, "spinDegPerSec", defaults.spinDegPerSec ?? 45) },
    { name: mapping.opacity, value: paramNumber(params, "opacity", defaults.opacity ?? 0.85) },
  ];
}

function buildRevertCommands(
  mapping: MinimapFxConvarMapping,
): Array<{ name: string; value: string | number | boolean }> {
  const defaults = mapping.defaults ?? {};
  return [
    { name: mapping.active, value: defaults.active ?? 0 },
    { name: mapping.spinDegPerSec, value: defaults.spinDegPerSec ?? 0 },
    { name: mapping.size, value: defaults.size ?? 400 },
    { name: mapping.opacity, value: defaults.opacity ?? 1 },
  ];
}

export const minimapSpinCenterEffect: GameEffect = {
  id: "minimap_spin_center",
  name: "Миникарта: крутится по центру",
  category: "hud",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  defaultParams: {
    size: 900,
    spinDegPerSec: 45,
    opacity: 0.85,
  },
  async apply(client, params) {
    const configPath = join(projectRoot, "config", "minimap-fx-convars.json");
    if (!existsSync(configPath)) {
      throw new Error("Missing config/minimap-fx-convars.json");
    }

    const mapping = loadMapping();
    await sendConVars(client, buildApplyCommands(mapping, params));
  },
  async revert(client) {
    const configPath = join(projectRoot, "config", "minimap-fx-convars.json");
    if (!existsSync(configPath)) return;

    const mapping = loadMapping();
    await sendConVars(client, buildRevertCommands(mapping));
  },
};
