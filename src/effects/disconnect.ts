import type { GameCommandClient } from "../game/game-command-client.js";
import type { GameEffect } from "./types.js";

export const disconnectEffect: GameEffect = {
  id: "disconnect",
  name: "Дисконект из матча",
  category: "other",
  retailSafe: true,
  cfgBindSafe: false,
  destructive: true,
  defaultDurationSec: 1,
  oneShot: true,
  async apply(client: GameCommandClient): Promise<void> {
    await client.sendCommand("disconnect");
  },
  async revert(): Promise<void> {
    // irreversible one-shot
  },
};
