import type { GameCommandClient } from "../game/game-command-client.js";
import type { HeroResolver } from "../heroes/hero-resolver.js";
import { sendConVars } from "./types.js";
import type { GameEffect } from "./types.js";

type RosterParams = {
  userInput?: string;
  heroIds?: string[] | string | number[];
};

function extractInput(params?: Record<string, unknown>): string {
  if (!params) return "";
  if (typeof params.userInput === "string") return params.userInput.trim();
  if (params.heroIds !== undefined) {
    if (Array.isArray(params.heroIds)) return params.heroIds.map(String).join(",");
    return String(params.heroIds);
  }
  return "";
}

export function createRosterHighPriorityEffect(heroResolver: HeroResolver): GameEffect {
  return {
    id: "roster_high_priority_set",
    name: "Настроить ростер (high priority)",
    category: "roster",
    retailSafe: true,
    cfgBindSafe: true,
    defaultDurationSec: 120,
    requiresUserInput: true,
    userInputHint: "Имя или ID героя (например: инфернус или 1)",
    async apply(client: GameCommandClient, params?: Record<string, unknown>): Promise<void> {
      const input = extractInput(params);
      if (!input) {
        throw new Error("roster_high_priority_set requires userInput or heroIds");
      }

      const { heroes, errors } = heroResolver.resolveHeroInputs(input);
      if (errors.length) {
        throw new Error(errors.join("; "));
      }
      if (!heroes.length) {
        throw new Error(`Could not resolve hero from input: "${input}"`);
      }

      const listValue = heroes.map((h) => h.id).join(",");
      await sendConVars(client, [{ name: "citadel_hero_roster_high_priority", value: listValue }]);
    },
    async revert(client: GameCommandClient): Promise<void> {
      await sendConVars(client, [{ name: "citadel_hero_roster_high_priority", value: 0 }]);
    },
  };
}
