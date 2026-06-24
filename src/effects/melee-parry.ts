import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import {
  assertWindowsPlatform,
  isGameProcessRunning,
  parseVirtualKeyCode,
  pressVirtualKey,
} from "../game/win-key-sender.js";
import type { GameEffect } from "./types.js";

const DEFAULT_PARRY_KEY = "F";

function loadMeleeParryKey(): string {
  const path = join(projectRoot, "config", "input-binds.json");
  if (!existsSync(path)) {
    return DEFAULT_PARRY_KEY;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { meleeParry?: { key?: string } };
  const key = raw.meleeParry?.key?.trim();
  return key || DEFAULT_PARRY_KEY;
}

function gameTargetFromEnv(): { processName: string; windowTitleContains: string } {
  return {
    processName: process.env.DEADLOCK_PROCESS_NAME ?? "deadlock",
    windowTitleContains: process.env.DEADLOCK_WINDOW_TITLE ?? "",
  };
}

export const meleeParryPressEffect: GameEffect = {
  id: "melee_parry_press",
  name: "Парирование (melee parry)",
  category: "skill",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(_client: GameCommandClient): Promise<void> {
    assertWindowsPlatform();

    const keyName = loadMeleeParryKey();
    const vkCode = parseVirtualKeyCode(keyName);
    const { processName, windowTitleContains } = gameTargetFromEnv();

    const gameState = await isGameProcessRunning(processName, windowTitleContains);
    if (!gameState.processRunning) {
      throw new Error(
        `Deadlock process "${processName}" not found. Start the game or set DEADLOCK_PROCESS_NAME in .env.`,
      );
    }

    const keyResult = await pressVirtualKey(vkCode, { processName, windowTitleContains });
    if (!keyResult.windowFound) {
      throw new Error(`Deadlock window not found for process "${processName}".`);
    }
    if (!keyResult.keySent) {
      throw new Error(`${keyName} key press failed (SendInput=0).`);
    }

    const focusNote = keyResult.focused ? "focused=ok" : "focused=no";
    console.log(
      `[game] melee-parry: ${keyName} pressed (${focusNote}, sendInput=${keyResult.sendInputCount})`,
    );
  },
  async revert(): Promise<void> {
    // oneShot effect: nothing to revert
  },
};
