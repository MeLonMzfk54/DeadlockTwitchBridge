/**
 * Panorama CSS id (incl. digit suffix) → Assets API class_name for owned overlay.
 * Built from custom_icons.css icons + manual renames; never blind camelCase→upgrade_.
 */
export const PANORAMA_TO_API_OWNED: Readonly<Record<string, string>> = {
  "abilityRefresher": "upgrade_ability_refresher",
  "absorbingArmor": "upgrade_deflecting_armor",
  "absorbingArmor1": "upgrade_absorbing_armor",
  "acolytesGlove": "upgrade_acolytes_glove",
  "activeReload": "upgrade_active_reload",
  "advancedRecharge": "upgrade_magic_tempo",
  "arcaneSurge": "upgrade_arcane_surge",
  "areaImmobilize": "upgrade_aoe_root",
  "armorBreakingBullets": "upgrade_aprounds",
  "bansheeSlugs": "upgrade_banshee_slugs",
  "berserker": "upgrade_berserker",
  "boxingGlove": "upgrade_boxing_glove",
  "bulletArmorReductionAura": "upgrade_bullet_armor_reduction_aura",
  "bulletDamageAura": "upgrade_dps_aura",
  "bulletResistShredder": "upgrade_bullet_resist_shredder",
  "bulletShield": "upgrade_grit",
  "bulletShield1": "upgrade_regenerating_bullet_shield",
  "bulletShield2": "upgrade_spirit_bubble",
  "bulletShield3": "upgrade_weapon_shielding",
  "bulletShield4": "upgrade_diviners_kevlar",
  "cardioCalibrator": "upgrade_cardio_calibrator",
  "clipSize": "upgrade_clip_size",
  "cloakingDevice": "upgrade_cloaking_device_active",
  "closeRange": "upgrade_close_range",
  "closeRange1": "upgrade_weighted_shots",
  "colossus": "upgrade_colossus",
  "critshot": "upgrade_critshot",
  "debuffReducer": "upgrade_debuff_reducer",
  "debuffRemover": "upgrade_reduce_debuff_duration",
  "disarm": "upgrade_greater_withering_whip",
  "durationExtender": "upgrade_duration_extender",
  "electrifiedBullets": "upgrade_capacitor",
  "electrifiedBullets1": "upgrade_chain_lightning",
  "empBullets": "upgrade_silencer",
  "endurance": "upgrade_endurance",
  "escalatingExposure": "upgrade_escalating_exposure",
  "escalatingExposure1": "upgrade_spirit_burn",
  "explosiveBullets": "upgrade_crackshot",
  "extraCharge": "upgrade_extra_charge",
  "fervor": "upgrade_fervor",
  "fireRatePlus": "upgrade_blitz_bullets",
  "fireRatePlus1": "upgrade_ethereal_bullets",
  "fireRatePlusPlus": "upgrade_burst_fire",
  "fleetfootBoots": "upgrade_fleetfoot_boots",
  "focusedSilence": "upgrade_spirit_sap",
  "focusedSilence1": "upgrade_focus_lens",
  "glassCannon": "upgrade_glass_cannon",
  "glitch": "upgrade_glitch",
  "headhunter": "upgrade_headhunter",
  "headshotBooster": "upgrade_headshot_booster",
  "headshotBooster1": "upgrade_headshot_booster2",
  "healbane": "upgrade_healbane",
  "healBuff": "upgrade_healbuff",
  "healingBooster": "upgrade_healing_booster",
  "healthNova": "upgrade_health_nova",
  "healthSstealingBullets": "upgrade_vampire",
  "healthStealingBullets": "upgrade_vampire",
  "healthStealingTech": "upgrade_health_stealing_magic",
  "highVelocityMag": "upgrade_high_velocity_mag",
  "hollowPoint": "upgrade_hollow_point_rounds",
  "iceBlast": "upgrade_cold_front",
  "iceBlast1": "upgrade_arctic_blast",
  "immobilize": "upgrade_containment",
  "improvedBulletArmor": "upgrade_improved_bullet_armor",
  "improvedStamina": "upgrade_improved_stamina",
  "infuser": "upgrade_infuser",
  "inhibitor": "upgrade_inhibitor",
  "intensifyingClip": "upgrade_intensifying_clip",
  "item_gadget": "upgrade_blood_tribute",
  "item_gadget_enemy": "upgrade_non_player_bonus_sacrifice",
  "item_passive": "upgrade_auto_cleanse",
  "item_passive1": "upgrade_spellbreaker",
  "item_passive2": "upgrade_enchanted_holsters",
  "juggernaut": "upgrade_juggernaut",
  "kineticSash": "upgrade_kinetic_sash",
  "knockdown": "upgrade_target_stun",
  "lastStand": "upgrade_return_fire",
  "leech": "upgrade_damage_recycler",
  "lifestrikeGauntlets": "upgrade_lifestrike_gauntlets",
  "longRange": "upgrade_long_range",
  "longshot": "upgrade_sharpshooter",
  "magicBurst": "upgrade_magic_burst",
  "magicCarpet": "upgrade_magic_carpet",
  "magicOverflow": "upgrade_tech_overflow",
  "magicReverb": "upgrade_mystic_reverb",
  "magicShock": "upgrade_magic_shock",
  "magicStorm": "upgrade_magic_storm",
  "medicBeam": "upgrade_rescue_beam",
  "medicBullets": "upgrade_medic_bullets",
  "megaSpirit": "upgrade_boundless_spirit",
  "megaSpirit1": "upgrade_resonant_healing",
  "meleeCharge": "upgrade_melee_charge",
  "meleeCharge1": "upgrade_crushing_fists",
  "metalSkin": "upgrade_metal_skin",
  "parryRebuttal": "upgrade_melee_rebuttal",
  "parryRebuttal1": "upgrade_counterspell",
  "phantomStrike": "upgrade_phantom_strike",
  "pointBlank": "upgrade_close_quarter_combat",
  "powerShard": "upgrade_ability_power_shard",
  "pristineEmblem": "upgrade_pristine_emblem",
  "rapidRecharge": "upgrade_rapid_recharge",
  "rapidRounds": "upgrade_rapid_rounds",
  "reaperRounds": "upgrade_non_player_bonus",
  "reinforcingCasings": "upgrade_reinforcing_casings",
  "restorativeLocket": "upgrade_restorative_locket",
  "revitalizer": "upgrade_chonky",
  "ricochet": "upgrade_ricochet",
  "rocketBooster": "upgrade_rocket_booster",
  "rupture": "upgrade_rupture",
  "rupture1": "upgrade_discord",
  "savior": "upgrade_guardian_ward",
  "savior1": "upgrade_divine_barrier",
  "shiftingShroud": "upgrade_self_bubble",
  "siphon_bullets": "upgrade_siphon_bullets",
  "slowingBullets": "upgrade_slowing_bullets",
  "slowingTech": "upgrade_withering_whip",
  "slowingTech1": "upgrade_magic_slow",
  "soaringSpirit": "upgrade_soaring_spirit",
  "spellslingerHeadshots": "upgrade_spellslinger_headshots",
  "spiritSnatch": "upgrade_spirit_snatch",
  "spiritualDominion": "upgrade_tech_range",
  "spiritualFlow": "upgrade_cooldown_reduction",
  "sprintBooster": "upgrade_sprint_booster",
  "sprintBooster1": "upgrade_trophy_collector",
  "stimPak": "upgrade_health_stimpak",
  "superiorDuration": "upgrade_imbued_duration_extender",
  "superiorStamina": "upgrade_superior_stamina",
  "surgingPower": "upgrade_fury_trance",
  "surgingPower1": "upgrade_surging_power",
  "targetedSilence": "upgrade_targeted_silence",
  "techArmorPulse": "upgrade_magic_shield",
  "techGrenade": "upgrade_thermal_detonator",
  "techPower": "upgrade_improved_spirit",
  "techPower1": "upgrade_goose_egg",
  "techPurge": "upgrade_tech_purge",
  "techRange": "upgrade_magic_reach",
  "techResistShredder": "upgrade_tech_defense_shredders",
  "techVulnerability": "upgrade_magic_vulnerability",
  "titanicMagazine": "upgrade_split_shot",
  "titanicMagazine1": "upgrade_titan_round",
  "tormentAura": "upgrade_tech_damage_pulse",
  "toxicBullets": "upgrade_toxic_bullets",
  "ultimateBurst": "upgrade_ultimate_burst",
  "unstoppable": "upgrade_unstoppable",
  "upgrade_health": "upgrade_health",
  "veilWalker": "upgrade_veil_walker",
  "vexBarrier": "upgrade_vex_barrier",
  "warpStone": "upgrade_warp_stone",
  "weaponJammer": "upgrade_suppressor",
} as const;

/** Same Panorama CSS id can mean different items per shop category. */
const AMBIGUOUS_OWNED_BY_CATEGORY: Readonly<
  Record<string, Partial<Record<"weapon" | "vitality" | "spirit", string>>>
> = {
  absorbingArmor: {
    weapon: "upgrade_rechargingbullets",
    vitality: "upgrade_deflecting_armor",
  },
  endurance: {
    vitality: "upgrade_endurance",
    spirit: "upgrade_mystic_regeneration",
  },
  tormentAura: {
    vitality: "upgrade_cheat_death",
    spirit: "upgrade_tech_damage_pulse",
  },
  fireRatePlus: {
    weapon: "upgrade_blitz_bullets",
    spirit: "upgrade_quick_silver",
  },
  fireRatePlus1: {
    spirit: "upgrade_ethereal_bullets",
  },
  item_passive: {
    weapon: "upgrade_weapon_backstabber",
    vitality: "upgrade_auto_cleanse",
    spirit: "upgrade_transcendent_cooldown",
  },
  item_passive1: {
    weapon: "upgrade_express_shot",
    vitality: "upgrade_spellbreaker",
  },
  item_passive2: {
    weapon: "upgrade_enchanted_holsters",
  },
};

const API_OWNED_VALUES = new Set<string>(Object.values(PANORAMA_TO_API_OWNED));
for (const byCat of Object.values(AMBIGUOUS_OWNED_BY_CATEGORY)) {
  for (const v of Object.values(byCat)) {
    if (v) API_OWNED_VALUES.add(v);
  }
}

export type OwnedMapCategory = "weapon" | "vitality" | "spirit";

/**
 * Map a game/Panorama class id (or already-API name) to the Assets API class_name
 * used for overlay owned badges. Does not invent upgrade_* via camelCase.
 */
export function toOwnedApiClassName(
  raw: string | null | undefined,
  category?: OwnedMapCategory | null,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (API_OWNED_VALUES.has(s)) return s;

  if (category && AMBIGUOUS_OWNED_BY_CATEGORY[s]?.[category]) {
    return AMBIGUOUS_OWNED_BY_CATEGORY[s][category] ?? null;
  }

  const direct = PANORAMA_TO_API_OWNED[s as keyof typeof PANORAMA_TO_API_OWNED];
  if (direct) return direct;

  // Already an API-looking name not in our table — keep as-is if it looks valid.
  if (/^upgrade_[a-z0-9_]+$/i.test(s)) return s;

  return null;
}
