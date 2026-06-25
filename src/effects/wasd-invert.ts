import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import { startWasdInvertHook, stopWasdInvertHook } from "../game/wasd-invert-hook.js";
import {
  assertWindowsPlatform,
  isGameProcessRunning,
} from "../game/win-key-sender.js";
import type { GameEffect } from "./types.js";

interface MovementKey {
  key: string;
}

interface MovementKeys {
  forward: MovementKey;
  back: MovementKey;
  left: MovementKey;
  right: MovementKey;
}

const DEFAULT_MOVEMENT: MovementKeys = {
  forward: { key: "w" },
  back: { key: "s" },
  left: { key: "a" },
  right: { key: "d" },
};

function loadMovementKeys(): MovementKeys {
  const path = join(projectRoot, "config", "input-binds.json");
  if (!existsSync(path)) {
    return DEFAULT_MOVEMENT;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { movement?: Partial<MovementKeys> };
  const movement = raw.movement ?? {};
  return {
    forward: { ...DEFAULT_MOVEMENT.forward, ...movement.forward },
    back: { ...DEFAULT_MOVEMENT.back, ...movement.back },
    left: { ...DEFAULT_MOVEMENT.left, ...movement.left },
    right: { ...DEFAULT_MOVEMENT.right, ...movement.right },
  };
}

function gameTargetFromEnv(): { processName: string; windowTitleContains: string } {
  return {
    processName: process.env.DEADLOCK_PROCESS_NAME ?? "deadlock",
    windowTitleContains: process.env.DEADLOCK_WINDOW_TITLE ?? "",
  };
}

export const wasdInvertEffect: GameEffect = {
  id: "wasd_invert",
  name: "Инверсия WASD",
  category: "other",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  async apply(_client: GameCommandClient): Promise<void> {
    assertWindowsPlatform();

    const movement = loadMovementKeys();
    const { processName, windowTitleContains } = gameTargetFromEnv();

    const gameState = await isGameProcessRunning(processName, windowTitleContains);
    if (!gameState.processRunning) {
      throw new Error(
        `Deadlock process "${processName}" not found. Start the game or set DEADLOCK_PROCESS_NAME in .env.`,
      );
    }

    await startWasdInvertHook({
      processName,
      windowTitleContains,
      keys: {
        forward: movement.forward.key,
        back: movement.back.key,
        left: movement.left.key,
        right: movement.right.key,
      },
    });

    console.log(
      `[game] wasd-invert: Windows keyboard hook started (W->S, S->W, A->D, D->A: ${movement.forward.key}/${movement.back.key}/${movement.left.key}/${movement.right.key})`,
    );
  },
  async revert(_client: GameCommandClient): Promise<void> {
    stopWasdInvertHook();
    console.log("[game] wasd-invert: Windows keyboard hook stopped");
  },
};
