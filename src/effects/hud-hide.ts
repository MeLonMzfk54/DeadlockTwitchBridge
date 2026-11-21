import type { GameCommandClient } from "../game/game-command-client.js";
import { beginHudHide, endHudHide } from "./hud-hide-png.js";
import type { GameEffect } from "./types.js";

export const hudHideEffect: GameEffect = {
  id: "hud_hide",
  name: "Скрыть HUD",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 45,
  async apply(_client: GameCommandClient) {
    // citadel_hud_visible is unused; the mod reads seq from /api/hud-hide.png.
    beginHudHide();
  },
  async revert(_client: GameCommandClient) {
    endHudHide();
  },
};
