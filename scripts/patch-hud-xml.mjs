#!/usr/bin/env node
/**
 * Patches vanilla Deadlock hud.xml to include twitch_minimap_fx.js.
 *
 * Usage:
 *   node scripts/patch-hud-xml.mjs [path/to/vanilla/hud.xml]
 *
 * If no path is given, reads DEADLOCK_GAME_DIR from env or common Steam paths.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = join(
  projectRoot,
  "Deadlock/content/citadel_addons/twitch_minimap_fx/panorama/layout/hud.xml",
);

const INCLUDE_LINE =
  '\t\t<include src="file://{resources}/scripts/twitch_minimap_fx.js" />';
const INCLUDE_MARKER = "twitch_minimap_fx.js";

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

function resolveVanillaPath(cliArg) {
  if (cliArg) {
    const resolved = resolve(cliArg);
    if (!existsSync(resolved)) {
      throw new Error(`Vanilla hud.xml not found: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of DEFAULT_VANILLA_PATHS) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Vanilla hud.xml not found. Pass path as argument or set DEADLOCK_GAME_DIR.\n" +
      "Example: node scripts/patch-hud-xml.mjs \"C:/.../Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml\"",
  );
}

function patchHudXml(source) {
  if (source.includes(INCLUDE_MARKER)) {
    return source;
  }

  const scriptsClose = "</scripts>";
  const scriptsOpen = "<scripts>";
  const scriptsCloseIdx = source.indexOf(scriptsClose);

  if (scriptsCloseIdx !== -1) {
    const before = source.slice(0, scriptsCloseIdx);
    const after = source.slice(scriptsCloseIdx);
    const needsNewline = before.endsWith("\n") ? "" : "\n";
    return `${before}${needsNewline}${INCLUDE_LINE}\n${after}`;
  }

  const stylesClose = "</styles>";
  const stylesCloseIdx = source.indexOf(stylesClose);
  if (stylesCloseIdx === -1) {
    throw new Error("Could not find </styles> in hud.xml");
  }

  const insertAt = stylesCloseIdx + stylesClose.length;
  const block = `\n\t<scripts>\n${INCLUDE_LINE}\n\t</scripts>`;
  return source.slice(0, insertAt) + block + source.slice(insertAt);
}

function main() {
  const vanillaPath = resolveVanillaPath(process.argv[2]);
  const source = readFileSync(vanillaPath, "utf8");
  const patched = patchHudXml(source);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, patched, "utf8");

  const hadInclude = source.includes(INCLUDE_MARKER);
  console.log(`Source:  ${vanillaPath}`);
  console.log(`Output:  ${outputPath}`);
  console.log(hadInclude ? "Include already present — copied as-is." : "Include inserted.");
}

main();
