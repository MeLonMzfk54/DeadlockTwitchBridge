import type { GameCommandClient } from "../game/game-command-client.js";
import { beginCrosshairChaos, endCrosshairChaos } from "./crosshair-hud.js";
import type { GameEffect } from "./types.js";

export const crosshairChaosEffect: GameEffect = {
  id: "crosshair_chaos",
  name: "Хаотичный прицел",
  retailSafe: true,
  cfgBindSafe: true,
  defaultDurationSec: 30,
  async apply(_client: GameCommandClient) {
    // Size and color convars are developmentonly, so the console never sees them.
    // The mod reads seq plus a packed shape and color from /api/crosshair-hud.png.
    beginCrosshairChaos();
  },
  async revert(_client: GameCommandClient) {
    endCrosshairChaos();
  },
};
