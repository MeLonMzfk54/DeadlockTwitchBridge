import type { EffectsCatalog } from "../types.js";
import type { HeroResolver } from "../heroes/hero-resolver.js";
import { crosshairChaosEffect } from "./crosshair-chaos.js";
import { hudHideEffect } from "./hud-hide.js";
import { disconnectEffect } from "./disconnect.js";
import { minimapCustomizeEffect } from "./minimap-customize.js";
import { minimapSpinEffect } from "./minimap-spin.js";
import { minimapSpinCenterEffect } from "./minimap-spin-center.js";
import { meleeParryPressEffect } from "./melee-parry.js";
import { createRosterHighPriorityEffect } from "./roster-high-priority.js";
import { randomSensitivityEffect } from "./random-sensitivity.js";
import type { GameEffect } from "./types.js";
import {
  skill1CastEffect,
  skill2CastEffect,
  skill3CastEffect,
  skill4CastEffect,
} from "./skill-cast.js";

export function createEffectRegistry(
  catalog: EffectsCatalog,
  heroResolver: HeroResolver,
): Map<string, GameEffect> {
  const builtinEffects: GameEffect[] = [
    hudHideEffect,
    crosshairChaosEffect,
    skill1CastEffect,
    skill2CastEffect,
    skill3CastEffect,
    skill4CastEffect,
    randomSensitivityEffect,
    createRosterHighPriorityEffect(heroResolver),
    minimapCustomizeEffect,
    minimapSpinEffect,
    minimapSpinCenterEffect,
    disconnectEffect,
    meleeParryPressEffect,
  ];

  const registry = new Map<string, GameEffect>();

  for (const effect of builtinEffects) {
    registry.set(effect.id, effect);
  }

  for (const entry of catalog.effects) {
    const existing = registry.get(entry.id);
    if (existing) {
      existing.name = entry.name;
      existing.defaultDurationSec = entry.defaultDurationSec;
      existing.retailSafe = entry.retailSafe;
      if (typeof entry.cfgBindSafe === "boolean") existing.cfgBindSafe = entry.cfgBindSafe;
      if (entry.category) existing.category = entry.category;
      if (typeof entry.oneShot === "boolean") existing.oneShot = entry.oneShot;
      if (typeof entry.experimental === "boolean") existing.experimental = entry.experimental;
      if (typeof entry.destructive === "boolean") existing.destructive = entry.destructive;
      if (typeof entry.requiresUserInput === "boolean") {
        existing.requiresUserInput = entry.requiresUserInput;
      }
      if (entry.userInputHint) existing.userInputHint = entry.userInputHint;
      if (entry.defaultParams) existing.defaultParams = entry.defaultParams;
    }
  }

  return registry;
}

export function listEffects(registry: Map<string, GameEffect>): GameEffect[] {
  return [...registry.values()];
}
