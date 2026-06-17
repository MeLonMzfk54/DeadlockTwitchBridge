import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { VConsoleClient } from "../game/vconsole.js";
import { projectRoot } from "../config.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";

export interface MinimapConvarMapping {
  scale: string | null;
  posX: string | null;
  posY: string | null;
  opacity: string | null;
  rotation: string | null;
  iconLocalPlayerWidth: string | null;
  iconPlayerWidth: string | null;
  iconMaxShrink: string | null;
  defaults: Record<string, number>;
}

const savedValues = new Map<string, string>();

function loadMapping(): MinimapConvarMapping {
  const path = join(projectRoot, "config", "minimap-convars.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as MinimapConvarMapping;
  return raw;
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

function buildCommands(
  mapping: MinimapConvarMapping,
  params?: Record<string, unknown>,
): CommandWithDefault[] {
  const defaults = mapping.defaults ?? {};
  const commands: CommandWithDefault[] = [];

  const entries: Array<[keyof MinimapConvarMapping, string, string]> = [
    ["scale", "scale", "scale"],
    ["posX", "centerX", "posX"],
    ["posY", "centerY", "posY"],
    ["opacity", "opacity", "opacity"],
    ["rotation", "rotation", "rotation"],
    ["iconLocalPlayerWidth", "iconLocalPlayerWidth", "iconLocalPlayerWidth"],
    ["iconPlayerWidth", "iconPlayerWidth", "iconPlayerWidth"],
    ["iconMaxShrink", "iconMaxShrink", "iconMaxShrink"],
  ];

  for (const [mappingKey, paramKey, defaultKey] of entries) {
    const convar = mapping[mappingKey];
    if (typeof convar !== "string" || !convar) continue;
    const value = paramNumber(params, paramKey, defaults[defaultKey] ?? 0);
    commands.push({ name: convar, value, defaultKey });
  }

  return commands;
}

type CommandWithDefault = { name: string; value: string | number | boolean; defaultKey: string };

export const minimapCustomizeEffect: GameEffect = {
  id: "minimap_customize",
  name: "Миникарта: размер, центр, прозрачность",
  category: "hud",
  retailSafe: true,
  defaultDurationSec: 60,
  defaultParams: {
    scale: 1.5,
    centerX: 0.5,
    centerY: 0.5,
    opacity: 0.6,
    iconLocalPlayerWidth: 14,
    iconPlayerWidth: 10,
  },
  async apply(vc, params) {
    if (!existsSync(join(projectRoot, "config", "minimap-convars.json"))) {
      throw new Error("Missing config/minimap-convars.json");
    }

    const mapping = loadMapping();
    const commands = buildCommands(mapping, params);
    if (!commands.length) {
      throw new Error("No minimap convars configured. Update config/minimap-convars.json after F7 discovery.");
    }

    savedValues.clear();
    for (const cmd of commands) {
      savedValues.set(cmd.name, String(mapping.defaults[cmd.defaultKey] ?? 0));
    }

    await sendConVars(
      vc,
      commands.map(({ name, value }) => ({ name, value })),
    );
  },
  async revert(vc) {
    const restore = [...savedValues.entries()].map(([name, value]) => ({ name, value }));
    if (restore.length) {
      await sendConVars(vc, restore);
    }
    savedValues.clear();
  },
};
