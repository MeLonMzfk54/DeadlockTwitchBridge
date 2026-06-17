import type { VConsoleClient } from "../game/vconsole.js";
import type { GameEffect } from "./types.js";

export const disconnectEffect: GameEffect = {
  id: "disconnect",
  name: "Дисконект из матча",
  category: "other",
  retailSafe: true,
  destructive: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(vc: VConsoleClient): Promise<void> {
    await vc.sendCommand("disconnect");
  },
  async revert(): Promise<void> {
    // irreversible one-shot
  },
};
