import { createSolidPng, encodeLevel } from "../shop/shop-vote-png.js";

/** Levels fit the 1020px host: dim = level * 9 + 15, max 100 → 915px. */
export const HUD_HIDE_LEVEL_MAX = 100;

export interface HudHideState {
  /** 0 = HUD visible, 1–100 = hide. Wraps so a new apply is visible. */
  seq: number;
}

let seq = 0;

export function getHudHideState(): HudHideState {
  return { seq };
}

export function beginHudHide(): HudHideState {
  seq = seq >= HUD_HIDE_LEVEL_MAX ? 1 : seq + 1;
  return getHudHideState();
}

export function endHudHide(): HudHideState {
  seq = 0;
  return getHudHideState();
}

/** Width is seq. Height is always 0. seq > 0 means hide. */
export function hudHideLevels(state: HudHideState = getHudHideState()): {
  w: number;
  h: number;
} {
  if (state.seq <= 0) return { w: 0, h: 0 };
  return { w: state.seq, h: 0 };
}

export function getHudHidePng(state: HudHideState = getHudHideState()): Buffer {
  const levels = hudHideLevels(state);
  return createSolidPng(
    encodeLevel(levels.w, HUD_HIDE_LEVEL_MAX),
    encodeLevel(levels.h, HUD_HIDE_LEVEL_MAX),
  );
}
