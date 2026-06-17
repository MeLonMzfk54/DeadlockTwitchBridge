import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { VConsoleClient } from "../game/vconsole.js";
import { projectRoot } from "../config.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";
import type { MinimapConvarMapping } from "./minimap-customize.js";

let spinTimer: NodeJS.Timeout | null = null;
let spinRotationConvar: string | null = null;
let savedRotation = "0";

function loadMapping(): MinimapConvarMapping {
  const path = join(projectRoot, "config", "minimap-convars.json");
  return JSON.parse(readFileSync(path, "utf8")) as MinimapConvarMapping;
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

function stopSpin(): void {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
}

export const minimapSpinEffect: GameEffect = {
  id: "minimap_spin",
  name: "Миникарта крутится",
  category: "hud",
  retailSafe: true,
  defaultDurationSec: 30,
  defaultParams: {
    speedDegPerSec: 45,
    opacity: 0.8,
    iconLocalPlayerWidth: 12,
  },
  async apply(vc, params) {
    stopSpin();

    if (!existsSync(join(projectRoot, "config", "minimap-convars.json"))) {
      throw new Error("Missing config/minimap-convars.json");
    }

    const mapping = loadMapping();
    spinRotationConvar = mapping.rotation;

    if (!spinRotationConvar) {
      throw new Error(
        "Rotation convar not configured. Set rotation in config/minimap-convars.json after F7 discovery (find minimap).",
      );
    }

    savedRotation = String(mapping.defaults.rotation ?? 0);

    const speed = paramNumber(params, "speedDegPerSec", 45);
    const intervalMs = 80;
    let angle = 0;

    const extraCommands: Array<{ name: string; value: string | number | boolean }> = [];
    if (mapping.opacity) {
      extraCommands.push({
        name: mapping.opacity,
        value: paramNumber(params, "opacity", mapping.defaults.opacity ?? 0.8),
      });
    }
    if (mapping.iconLocalPlayerWidth) {
      extraCommands.push({
        name: mapping.iconLocalPlayerWidth,
        value: paramNumber(params, "iconLocalPlayerWidth", mapping.defaults.iconLocalPlayerWidth ?? 12),
      });
    }
    if (extraCommands.length) {
      await sendConVars(vc, extraCommands);
    }

    spinTimer = setInterval(() => {
      angle = (angle + speed * (intervalMs / 1000)) % 360;
      void vc.sendCommand(`${spinRotationConvar} ${angle.toFixed(1)}`);
    }, intervalMs);
  },
  async revert(vc) {
    stopSpin();
    if (spinRotationConvar) {
      await vc.sendCommand(`${spinRotationConvar} ${savedRotation}`);
      spinRotationConvar = null;
    }
  },
};
