#!/usr/bin/env node
/**
 * Patches stock citadel_hud_top_bar.xml to load bridge scripts.
 * This is the DeadlockShock-style hook: no full hud.xml override → better QoLLock coexistence.
 *
 * Usage:
 *   node scripts/patch-top-bar-xml.mjs [path/to/vanilla/citadel_hud_top_bar.xml]
 *   node scripts/patch-top-bar-xml.mjs path/to/other/citadel_hud_top_bar.xml --in-place
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const defaultOutput = join(
  projectRoot,
  "Deadlock/content/citadel_addons/twitch_minimap_fx/panorama/layout/citadel_hud_top_bar.xml",
);

const INCLUDES = [
  {
    marker: "twitch_bridge_events.js",
    line: '\t\t<include src="file://{resources}/scripts/twitch_bridge_events.js" />',
  },
  {
    marker: "twitch_bridge_vote_announce.js",
    line: '\t\t<include src="file://{resources}/scripts/twitch_bridge_vote_announce.js" />',
  },
];

const DEFAULT_SOURCES = [
  process.env.DEADLOCK_GAME_DIR
    ? join(
        process.env.DEADLOCK_GAME_DIR,
        "game/citadel/pak01_dir/panorama/layout/citadel_hud_top_bar.xml",
      )
    : null,
  join(projectRoot, "Deadlock/reference/vanilla_citadel_hud_top_bar.xml"),
].filter(Boolean);

function parseArgs(argv) {
  const args = { input: null, inPlace: false, help: false };
  for (const a of argv) {
    if (a === "--in-place" || a === "-i") args.inPlace = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  return args;
}

function resolveInput(cli) {
  if (cli) {
    const p = resolve(cli);
    if (!existsSync(p)) throw new Error(`Not found: ${p}`);
    return p;
  }
  for (const c of DEFAULT_SOURCES) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "citadel_hud_top_bar.xml not found. Extract from pak01 or pass path.\n" +
      "Reference: Deadlock/reference/vanilla_citadel_hud_top_bar.xml",
  );
}

function ensureIncludes(source) {
  let result = source;
  const inserted = [];
  const already = [];

  for (const inc of INCLUDES) {
    if (result.includes(inc.marker)) {
      already.push(inc.marker);
      continue;
    }
    inserted.push(inc.marker);

    const scriptsClose = "</scripts>";
    const idx = result.indexOf(scriptsClose);
    if (idx !== -1) {
      const before = result.slice(0, idx);
      const nl = before.endsWith("\n") ? "" : "\n";
      result = `${before}${nl}${inc.line}\n${result.slice(idx)}`;
      continue;
    }

    const stylesClose = "</styles>";
    const sIdx = result.indexOf(stylesClose);
    if (sIdx === -1) throw new Error("No </styles> in citadel_hud_top_bar.xml");
    const insertAt = sIdx + stylesClose.length;
    // First include creates the whole scripts block; subsequent use </scripts>
    if (!result.includes("<scripts>")) {
      const block = `\n\t<scripts>\n${inc.line}\n\t</scripts>`;
      result = result.slice(0, insertAt) + block + result.slice(insertAt);
    }
  }

  return { source: result, inserted, already };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/patch-top-bar-xml.mjs [citadel_hud_top_bar.xml] [--in-place]

Preferred packaging (coexists with QoLLock full hud.xml):
  - Ship citadel_hud_top_bar.xml + scripts (NO full hud.xml)
  - Conflict only with mods that also override citadel_hud_top_bar.xml (e.g. some top-bar packs)
`);
    return;
  }

  const input = resolveInput(args.input);
  const output = args.inPlace ? input : defaultOutput;
  const patched = ensureIncludes(readFileSync(input, "utf8"));

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, patched.source, "utf8");

  console.log(`Source: ${input}`);
  console.log(`Output: ${output}`);
  if (patched.inserted.length) console.log(`Inserted: ${patched.inserted.join(", ")}`);
  if (patched.already.length) console.log(`Already: ${patched.already.join(", ")}`);
  console.log("Pack VPK WITHOUT panorama/layout/hud.xml when using this mode.");
}

main();
