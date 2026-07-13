import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import {
  isScreenFlipHelperActive,
  startScreenFlipHelper,
  stopScreenFlipHelper,
} from "../game/screen-flip-helper.js";
import {
  assertWindowsPlatform,
  isGameProcessRunning,
} from "../game/win-key-sender.js";
import { sendConVars, type GameEffect } from "./types.js";

interface InputConvarMapping {
  mouseInvertX: string | null;
  mYaw: string | null;
  defaults: {
    mouseInvertX?: number;
    m_yaw?: number;
  };
}

interface MovementKey {
  key: string;
}

interface MovementKeys {
  left: MovementKey;
  right: MovementKey;
}

const DEFAULT_MOVEMENT: MovementKeys = {
  left: { key: "a" },
  right: { key: "d" },
};

/** Tracks whether the current activation applied mouse-X sync (for correct revert). */
let appliedSyncInput = false;

function loadMapping(): InputConvarMapping {
  const path = join(projectRoot, "config", "input-convars.json");
  if (!existsSync(path)) {
    return {
      mouseInvertX: null,
      mYaw: "m_yaw",
      defaults: { mouseInvertX: 0, m_yaw: 0.022 },
    };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as InputConvarMapping;
  return {
    mouseInvertX: raw.mouseInvertX ?? null,
    mYaw: raw.mYaw ?? "m_yaw",
    defaults: raw.defaults ?? { mouseInvertX: 0, m_yaw: 0.022 },
  };
}

function loadAdKeys(): MovementKeys {
  const path = join(projectRoot, "config", "input-binds.json");
  if (!existsSync(path)) {
    return DEFAULT_MOVEMENT;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    movement?: Partial<MovementKeys>;
  };
  const movement = raw.movement ?? {};
  return {
    left: { ...DEFAULT_MOVEMENT.left, ...movement.left },
    right: { ...DEFAULT_MOVEMENT.right, ...movement.right },
  };
}

function gameTargetFromEnv(): { processName: string; windowTitleContains: string } {
  return {
    processName:
      process.env.SCREEN_FLIP_PROCESS_NAME?.trim() ||
      process.env.DEADLOCK_PROCESS_NAME?.trim() ||
      "deadlock",
    windowTitleContains:
      process.env.SCREEN_FLIP_WINDOW_TITLE?.trim() ||
      process.env.DEADLOCK_WINDOW_TITLE?.trim() ||
      "",
  };
}

function fpsFromEnv(): number {
  const raw = process.env.SCREEN_FLIP_FPS?.trim();
  if (!raw) return 45;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 45;
  return Math.max(5, Math.min(60, parsed));
}

function monitorIndexFromEnv(): string {
  return process.env.SCREEN_FLIP_MONITOR_INDEX?.trim() ?? "";
}

function resolveSyncInput(params?: Record<string, unknown>): boolean {
  if (params && Object.prototype.hasOwnProperty.call(params, "syncInput")) {
    return Boolean(params.syncInput);
  }
  return true;
}

function resolveAxis(params?: Record<string, unknown>): "horizontal" | "vertical" {
  const axis = typeof params?.axis === "string" ? params.axis.trim().toLowerCase() : "horizontal";
  if (axis === "vertical") return "vertical";
  if (axis && axis !== "horizontal") {
    console.warn(`[game] screen_flip: unsupported axis "${axis}", using horizontal`);
  }
  return "horizontal";
}

function buildMouseXApplyCommands(
  mapping: InputConvarMapping,
): Array<{ name: string; value: string | number }> {
  const commands: Array<{ name: string; value: string | number }> = [];
  const defaults = mapping.defaults ?? {};

  if (mapping.mYaw) {
    const base = defaults.m_yaw ?? 0.022;
    commands.push({ name: mapping.mYaw, value: -Math.abs(base) });
  } else if (mapping.mouseInvertX) {
    commands.push({ name: mapping.mouseInvertX, value: 1 });
  }

  return commands;
}

function buildMouseXRevertCommands(
  mapping: InputConvarMapping,
): Array<{ name: string; value: string | number }> {
  const commands: Array<{ name: string; value: string | number }> = [];
  const defaults = mapping.defaults ?? {};

  if (mapping.mYaw) {
    commands.push({ name: mapping.mYaw, value: Math.abs(defaults.m_yaw ?? 0.022) });
  } else if (mapping.mouseInvertX) {
    commands.push({ name: mapping.mouseInvertX, value: defaults.mouseInvertX ?? 0 });
  }

  return commands;
}

export const screenFlipEffect: GameEffect = {
  id: "screen_flip",
  name: "Зеркало экрана (горизонтально)",
  category: "other",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  defaultParams: {
    syncInput: true,
    axis: "horizontal",
  },
  async apply(client: GameCommandClient, params?: Record<string, unknown>): Promise<void> {
    assertWindowsPlatform();

    const syncInput = resolveSyncInput(params);
    const axis = resolveAxis(params);
    const { processName, windowTitleContains } = gameTargetFromEnv();
    const fps = fpsFromEnv();
    const monitorIndex = monitorIndexFromEnv();
    const adKeys = loadAdKeys();

    // Idempotent: stop any previous helper before starting (EffectManager also reverts first).
    if (isScreenFlipHelperActive()) {
      stopScreenFlipHelper();
    }
    appliedSyncInput = false;

    const gameState = await isGameProcessRunning(processName, windowTitleContains);
    if (!gameState.processRunning) {
      throw new Error(
        `Deadlock process "${processName}" not found. Start the game or set SCREEN_FLIP_PROCESS_NAME / DEADLOCK_PROCESS_NAME in .env.`,
      );
    }

    await startScreenFlipHelper({
      processName,
      windowTitleContains,
      fps,
      axis,
      syncAd: syncInput,
      leftKey: adKeys.left.key,
      rightKey: adKeys.right.key,
      monitorIndex,
    });

    if (syncInput) {
      const mapping = loadMapping();
      const commands = buildMouseXApplyCommands(mapping);
      if (commands.length > 0) {
        await sendConVars(client, commands);
        appliedSyncInput = true;
      } else {
        console.warn(
          "[game] screen_flip: syncInput requested but no mouse X convars in config/input-convars.json",
        );
      }
    }

    console.log(
      `[game] screen_flip: overlay started (fps=${fps}, axis=${axis}, syncInput=${syncInput})`,
    );
  },
  async revert(client: GameCommandClient): Promise<void> {
    stopScreenFlipHelper();

    if (appliedSyncInput) {
      const mapping = loadMapping();
      const commands = buildMouseXRevertCommands(mapping);
      if (commands.length > 0) {
        try {
          await sendConVars(client, commands);
        } catch (error) {
          console.warn(
            "[game] screen_flip: failed to restore mouse X convars:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      appliedSyncInput = false;
    }

    console.log("[game] screen_flip: overlay stopped");
  },
};
