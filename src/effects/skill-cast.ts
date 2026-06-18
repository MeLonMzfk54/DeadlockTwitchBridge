import type { GameCommandClient } from "../game/game-command-client.js";
import type { GameEffect } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInAbilityCastEffect(slot: 1 | 2 | 3 | 4): GameEffect {
  return {
    id: `skill${slot}_cast`,
    name: `Каст скилла ${slot}`,
    category: "skill",
    retailSafe: true,
    cfgBindSafe: false,
    defaultDurationSec: 1,
    oneShot: true,
    async apply(client: GameCommandClient): Promise<void> {
      await client.sendCommand(`+in_ability${slot}`);
      await sleep(50);
      await client.sendCommand(`-in_ability${slot}`);
    },
    async revert(): Promise<void> {
      // oneShot effect: nothing to revert
    },
  };
}

export const skill1CastEffect = createInAbilityCastEffect(1);
export const skill2CastEffect = createInAbilityCastEffect(2);
export const skill3CastEffect = createInAbilityCastEffect(3);
export const skill4CastEffect = createInAbilityCastEffect(4);
