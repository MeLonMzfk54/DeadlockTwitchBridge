#!/usr/bin/env node
/**
 * Inserts bridge script includes into a Deadlock hud.xml.
 *
 * Modes:
 *   1) Self-contained addon (default):
 *        node scripts/patch-hud-xml.mjs [vanilla-hud.xml]
 *      → writes Deadlock/content/citadel_addons/twitch_minimap_fx/panorama/layout/hud.xml
 *
 *   2) Coexist with QoLLock / another HUD mod:
 *        node scripts/patch-hud-xml.mjs path/to/QoLLock/hud.xml --in-place
 *      Then rebuild QoLLock VPK. Ship bridge VPK WITHOUT hud.xml (scripts only).
 *
 *   3) Custom output:
 *        node scripts/patch-hud-xml.mjs path/to/hud.xml --out path/to/out/hud.xml
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const defaultOutputPath = join(
  projectRoot,
  "Deadlock/content/citadel_addons/twitch_minimap_fx/panorama/layout/hud.xml",
);

const INCLUDES = [
  {
    marker: "twitch_bridge_events.js",
    line: '\t\t<include src="file://{resources}/scripts/twitch_bridge_events.js" />',
  },
];

const DEFAULT_VANILLA_PATHS = [
  process.env.DEADLOCK_GAME_DIR
    ? join(process.env.DEADLOCK_GAME_DIR, "game/citadel/pak01_dir/panorama/layout/hud.xml")
    : null,
  join(projectRoot, "Deadlock/reference/vanilla_hud.xml"),
  "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml",
  "D:/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml",
  "F:/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml",
  "E:/SteamLibrary/steamapps/common/Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml",
].filter(Boolean);

function parseArgs(argv) {
  const args = { input: null, inPlace: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in-place" || a === "-i") {
      args.inPlace = true;
    } else if (a === "--out" || a === "-o") {
      args.out = argv[++i];
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (!a.startsWith("-") && !args.input) {
      args.input = a;
    }
  }
  return args;
}

function resolveInputPath(cliArg) {
  if (cliArg) {
    const resolved = resolve(cliArg);
    if (!existsSync(resolved)) {
      throw new Error(`hud.xml not found: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of DEFAULT_VANILLA_PATHS) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "hud.xml not found. Pass path as argument or set DEADLOCK_GAME_DIR.\n" +
      'Example (QoLLock): node scripts/patch-hud-xml.mjs "D:/mods/QoLLock/panorama/layout/hud.xml" --in-place',
  );
}

function ensureInclude(source, include) {
  if (source.includes(include.marker)) {
    return { source, inserted: false };
  }

  const scriptsClose = "</scripts>";
  const scriptsCloseIdx = source.indexOf(scriptsClose);

  if (scriptsCloseIdx !== -1) {
    const before = source.slice(0, scriptsCloseIdx);
    const after = source.slice(scriptsCloseIdx);
    const needsNewline = before.endsWith("\n") ? "" : "\n";
    return {
      source: `${before}${needsNewline}${include.line}\n${after}`,
      inserted: true,
    };
  }

  const stylesClose = "</styles>";
  const stylesCloseIdx = source.indexOf(stylesClose);
  if (stylesCloseIdx === -1) {
    throw new Error("Could not find </styles> or </scripts> in hud.xml");
  }

  const insertAt = stylesCloseIdx + stylesClose.length;
  const block = `\n\t<scripts>\n${include.line}\n\t</scripts>`;
  return {
    source: source.slice(0, insertAt) + block + source.slice(insertAt),
    inserted: true,
  };
}

function patchHudXml(source) {
  let result = source;
  const inserted = [];
  const already = [];

  for (const include of INCLUDES) {
    const step = ensureInclude(result, include);
    result = step.source;
    if (step.inserted) inserted.push(include.marker);
    else already.push(include.marker);
  }

  return { source: result, inserted, already };
}

function printHelp() {
  console.log(`Usage:
  node scripts/patch-hud-xml.mjs [hud.xml] [--in-place] [--out path]

Examples:
  # Self-contained bridge addon (writes into twitch_minimap_fx)
  node scripts/patch-hud-xml.mjs

  # Patch QoLLock HUD in place, then rebuild QoLLock VPK
  node scripts/patch-hud-xml.mjs "path/to/QoLLock/panorama/layout/hud.xml" --in-place

  # Write patched copy elsewhere
  node scripts/patch-hud-xml.mjs "path/to/hud.xml" --out "path/to/patched-hud.xml"

Coexistence tip:
  - Bridge/scripts VPK: panorama/scripts/*.js only (NO hud.xml)
  - QoLLock VPK: hud.xml WITH the twitch_bridge_events.js <include>
  - Do NOT ship two different hud.xml overrides at once
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = resolveInputPath(args.input);
  let outputPath = defaultOutputPath;

  if (args.inPlace) {
    outputPath = inputPath;
  } else if (args.out) {
    outputPath = resolve(args.out);
  } else if (args.input) {
    // Explicit input without --out/--in-place still defaults to addon path
    // (self-contained rebuild from a given vanilla/QoLLock source).
    outputPath = defaultOutputPath;
  }

  const source = readFileSync(inputPath, "utf8");
  const patched = patchHudXml(source);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, patched.source, "utf8");

  console.log(`Source:  ${inputPath}`);
  console.log(`Output:  ${outputPath}`);
  if (args.inPlace) {
    console.log("Mode:    in-place (rebuild the HUD mod VPK that owns this hud.xml)");
  } else if (outputPath === defaultOutputPath) {
    console.log("Mode:    self-contained addon (do not use with another HUD override)");
  }
  if (patched.inserted.length) {
    console.log(`Inserted: ${patched.inserted.join(", ")}`);
  }
  if (patched.already.length) {
    console.log(`Already present: ${patched.already.join(", ")}`);
  }
  console.log("");
  console.log("Next: pack VPK(s). For QoLLock coexistence, bridge VPK must NOT contain panorama/layout/hud.xml.");
}

main();
