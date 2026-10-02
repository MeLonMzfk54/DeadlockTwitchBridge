import { createSolidPng, encodeLevel } from "../shop/shop-vote-png.js";

/** Levels fit the 1020px host: dim = level * 9 + 15, max 100 → 915px. */
export const CROSSHAIR_LEVEL_MAX = 100;

/** 0 huge reticle, 1 stickman, 2 X. */
export const CROSSHAIR_SHAPE_COUNT = 3;

/** Packed with the shape into the PNG height: shape * COLOR_COUNT + color, max 59. */
export const CROSSHAIR_COLOR_COUNT = 20;

export interface CrosshairHudState {
  /** 0 = off, 1–100 = on. Wraps so a new apply is visible. */
  seq: number;
  /** Shape 0–2. Ignored while seq is 0. */
  shapeIndex: number;
  /** Palette index 0–19. Ignored while seq is 0. */
  colorIndex: number;
}

let seq = 0;
let shapeIndex = 0;
let colorIndex = 0;

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > max) return max;
  return Math.floor(value);
}

/** Height level while the effect is on. Stays within 0–59. */
export function packCrosshairHeight(shape: number, color: number): number {
  return (
    clampIndex(shape, CROSSHAIR_SHAPE_COUNT - 1) * CROSSHAIR_COLOR_COUNT +
    clampIndex(color, CROSSHAIR_COLOR_COUNT - 1)
  );
}

export function getCrosshairHudState(): CrosshairHudState {
  return { seq, shapeIndex, colorIndex };
}

export function beginCrosshairChaos(): CrosshairHudState {
  seq = seq >= CROSSHAIR_LEVEL_MAX ? 1 : seq + 1;
  shapeIndex = Math.floor(Math.random() * CROSSHAIR_SHAPE_COUNT);
  colorIndex = Math.floor(Math.random() * CROSSHAIR_COLOR_COUNT);
  return getCrosshairHudState();
}

export function endCrosshairChaos(): CrosshairHudState {
  seq = 0;
  return getCrosshairHudState();
}

/** Width is seq. Height is shape * 20 + color. Both 0 when the effect is off. */
export function crosshairHudLevels(state: CrosshairHudState = getCrosshairHudState()): {
  w: number;
  h: number;
} {
  if (state.seq <= 0) return { w: 0, h: 0 };
  return { w: state.seq, h: packCrosshairHeight(state.shapeIndex, state.colorIndex) };
}

export function getCrosshairHudPng(state: CrosshairHudState = getCrosshairHudState()): Buffer {
  const levels = crosshairHudLevels(state);
  return createSolidPng(
    encodeLevel(levels.w, CROSSHAIR_LEVEL_MAX),
    encodeLevel(levels.h, CROSSHAIR_LEVEL_MAX),
  );
}
