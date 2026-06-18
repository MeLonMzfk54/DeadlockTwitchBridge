import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import type { GameEffect } from "./types.js";

interface InputBind {
  press: string;
  release: string;
}

function loadMeleeParryBind(): InputBind {
  const path = join(projectRoot, "config", "input-binds.json");
  if (!existsSync(path)) {
    return { press: "+in_helditem", release: "-in_helditem" };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { meleeParry?: InputBind };
  return raw.meleeParry ?? { press: "+in_helditem", release: "-in_helditem" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paramHoldMs(params?: Record<string, unknown>): number {
  const value = params?.holdMs;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 50;
}

export const meleeParryPressEffect: GameEffect = {
  id: "melee_parry_press",
  name: "Парирование (melee parry)",
  category: "skill",
  retailSafe: true,
  cfgBindSafe: false,
  defaultDurationSec: 1,
  oneShot: true,
  defaultParams: { holdMs: 50 },
  async apply(client: GameCommandClient, params?: Record<string, unknown>): Promise<void> {
    const bind = loadMeleeParryBind();
    const holdMs = paramHoldMs(params);
    if (holdMs > 0) {
      await client.sendCommand(bind.press);
      await sleep(holdMs);
      await client.sendCommand(bind.release);
      return;
    }
    await client.sendCommand(`${bind.press}; ${bind.release}`);
  },
  async revert(): Promise<void> {
    // oneShot effect: nothing to revert
  },
};
