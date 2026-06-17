/**
 * Test mode helpers: console commands and scripted effect runs without Twitch.
 */

export const TEST_CONSOLE_COMMANDS: Record<string, string> = {
  "hide-hud": "citadel_hud_visible 0",
  "show-hud": "citadel_hud_visible 1",
  "roster-infernus": "citadel_hero_roster_high_priority 1",
  "roster-clear": "citadel_hero_roster_high_priority 0",
  "disconnect": "disconnect",
  "parry": "+in_helditem; -in_helditem",
};

export const TEST_EFFECT_ALIASES: Record<string, { effectId: string; durationSec: number }> = {
  "hide-hud": { effectId: "hud_hide", durationSec: 45 },
  "crosshair": { effectId: "crosshair_chaos", durationSec: 30 },
  "roster": { effectId: "roster_high_priority_set", durationSec: 120 },
  "minimap": { effectId: "minimap_customize", durationSec: 60 },
  "minimap-spin": { effectId: "minimap_spin", durationSec: 30 },
  "parry": { effectId: "melee_parry_press", durationSec: 1 },
};

export function printTestModeHelp(): void {
  console.log("");
  console.log("=== TEST MODE ===");
  console.log("Twitch is disabled. Use the in-game control panel:");
  console.log("  http://127.0.0.1:3920/control");
  console.log("");
  console.log("API examples:");
  console.log('  curl -X POST http://127.0.0.1:3920/api/test-effect -H "Content-Type: application/json" -d "{\\"effectId\\":\\"hud_hide\\",\\"durationSec\\":30}"');
  console.log('  curl -X POST http://127.0.0.1:3920/api/test-effect -H "Content-Type: application/json" -d "{\\"effectId\\":\\"roster_high_priority_set\\",\\"userInput\\":\\"инфернус\\"}"');
  console.log("");
  console.log("Manual game console commands (F7 in Deadlock):");
  for (const [alias, command] of Object.entries(TEST_CONSOLE_COMMANDS)) {
    console.log(`  ${alias.padEnd(16)} -> ${command}`);
  }
  console.log("");
}
