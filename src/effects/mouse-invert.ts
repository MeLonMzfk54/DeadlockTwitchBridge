import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameCommandClient } from "../game/game-command-client.js";
import { projectRoot } from "../config.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";

interface InputConvarMapping {
  mouseInvertY: string | null;
  mouseInvertX: string | null;
  mPitch: string | null;
  mYaw: string | null;
  defaults: {
    mouseInvertY?: number;
    mouseInvertX?: number;
    m_pitch?: number;
    m_yaw?: number;
  };
}

function loadMapping(): InputConvarMapping {
  const path = join(projectRoot, "config", "input-convars.json");
  if (!existsSync(path)) {
    return {
      mouseInvertY: "mouse_inverty",
      mouseInvertX: null,
      mPitch: "m_pitch",
      mYaw: "m_yaw",
      defaults: { mouseInvertY: 0, mouseInvertX: 0, m_pitch: 0.022, m_yaw: 0.022 },
    };
  }
  return JSON.parse(readFileSync(path, "utf8")) as InputConvarMapping;
}

function buildApplyCommands(mapping: InputConvarMapping): Array<{ name: string; value: string | number }> {
  const commands: Array<{ name: string; value: string | number }> = [];
  const defaults = mapping.defaults ?? {};

  if (mapping.mouseInvertY) {
    commands.push({ name: mapping.mouseInvertY, value: 1 });
  } else if (mapping.mPitch) {
    const base = defaults.m_pitch ?? 0.022;
    commands.push({ name: mapping.mPitch, value: -Math.abs(base) });
  }

  // Deadlock has mouse_inverty but no mouse_invertx — invert X via negated m_yaw.
  if (mapping.mYaw) {
    const base = defaults.m_yaw ?? 0.022;
    commands.push({ name: mapping.mYaw, value: -Math.abs(base) });
  } else if (mapping.mouseInvertX) {
    commands.push({ name: mapping.mouseInvertX, value: 1 });
  }

  return commands;
}

function buildRevertCommands(mapping: InputConvarMapping): Array<{ name: string; value: string | number }> {
  const commands: Array<{ name: string; value: string | number }> = [];
  const defaults = mapping.defaults ?? {};

  if (mapping.mouseInvertY) {
    commands.push({ name: mapping.mouseInvertY, value: defaults.mouseInvertY ?? 0 });
  } else if (mapping.mPitch) {
    commands.push({ name: mapping.mPitch, value: Math.abs(defaults.m_pitch ?? 0.022) });
  }

  if (mapping.mYaw) {
    commands.push({ name: mapping.mYaw, value: Math.abs(defaults.m_yaw ?? 0.022) });
  } else if (mapping.mouseInvertX) {
    commands.push({ name: mapping.mouseInvertX, value: defaults.mouseInvertX ?? 0 });
  }

  return commands;
}

export const mouseInvertEffect: GameEffect = {
  id: "mouse_invert",
  name: "Инверсия мыши (X + Y)",
  category: "other",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  async apply(client: GameCommandClient): Promise<void> {
    const mapping = loadMapping();
    const commands = buildApplyCommands(mapping);
    if (commands.length === 0) {
      throw new Error("mouse_invert: no convars configured in config/input-convars.json");
    }
    await sendConVars(client, commands);
  },
  async revert(client: GameCommandClient): Promise<void> {
    const mapping = loadMapping();
    const commands = buildRevertCommands(mapping);
    if (commands.length === 0) return;
    await sendConVars(client, commands);
  },
};
