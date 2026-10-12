import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETUP_MARKER = "// twitch-deadlock-bridge cfg-bind";
const SHOP_CVAR_MARKER = "// twitch-deadlock-bridge shop convars";
const SHOP_CVAR_LINES = [
  "bridge_shop_seq 0",
  "bridge_shop_cat 0",
  "bridge_shop_tier 0",
  "bridge_shop_pick 0",
  "bridge_shop_cls 0",
  "bridge_shop_scan 0",
  "bridge_vote_banner_seq 0",
  "bridge_vote_banner_kind 0",
  "bridge_vote_banner_win 0",
];

export interface CfgBindSetupOptions {
  cfgDir: string;
  filename: string;
  triggerKey: string;
}

export interface CfgBindSetupResult {
  autoexecUpdated: boolean;
  bindKeySynced: boolean;
  bindPresent: boolean;
  shopConvarsUpdated: boolean;
}

export function hasCfgBindInAutoexec(options: CfgBindSetupOptions): boolean {
  const { cfgDir, filename } = options;
  const autoexecPath = join(cfgDir, "autoexec.cfg");
  if (!existsSync(autoexecPath)) return false;

  const content = readFileSync(autoexecPath, "utf8");
  const bindPattern = new RegExp(
    `bind\\s+\\S+\\s+"exec\\s+${escapeRegex(filename)}"`,
    "i",
  );
  return bindPattern.test(content);
}

export function ensureCfgBindSetup(options: CfgBindSetupOptions): CfgBindSetupResult {
  const { cfgDir, filename, triggerKey } = options;
  const bindLine = `bind ${triggerKey} "exec ${filename}"`;
  const effectCfgPath = join(cfgDir, filename);
  const autoexecPath = join(cfgDir, "autoexec.cfg");

  if (!existsSync(effectCfgPath)) {
    writeFileSync(effectCfgPath, "", "utf8");
  }

  const content = existsSync(autoexecPath) ? readFileSync(autoexecPath, "utf8") : "";
  const bindPattern = new RegExp(
    `bind\\s+(\\S+)\\s+"exec\\s+${escapeRegex(filename)}"`,
    "i",
  );
  const existingBind = bindPattern.exec(content);

  let autoexecUpdated = false;
  let bindKeySynced = false;

  if (existingBind) {
    const currentKey = existingBind[1].toUpperCase();
    const desiredKey = triggerKey.toUpperCase();
    if (currentKey !== desiredKey) {
      writeFileSync(autoexecPath, content.replace(bindPattern, bindLine), "utf8");
      autoexecUpdated = true;
      bindKeySynced = true;
    }
  } else {
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    writeFileSync(autoexecPath, `${content}${prefix}\n${SETUP_MARKER}\n${bindLine}\n`, "utf8");
    autoexecUpdated = true;
  }

  const shopConvarsUpdated = ensureShopConvarDefaults(cfgDir);
  if (shopConvarsUpdated) autoexecUpdated = true;

  return {
    autoexecUpdated,
    bindKeySynced,
    bindPresent: true,
    shopConvarsUpdated,
  };
}

/** Ensure shop vote convars exist in autoexec so exec doesn't warn Unknown command. */
export function ensureShopConvarDefaults(cfgDir: string): boolean {
  const autoexecPath = join(cfgDir, "autoexec.cfg");
  let content = existsSync(autoexecPath) ? readFileSync(autoexecPath, "utf8") : "";
  let updated = false;

  if (!content.includes(SHOP_CVAR_MARKER)) {
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    const block = `${SHOP_CVAR_MARKER}\n${SHOP_CVAR_LINES.join("\n")}\n`;
    content = `${content}${prefix}\n${block}`;
    updated = true;
  } else {
    const missing = SHOP_CVAR_LINES.filter((line) => {
      const name = line.split(/\s+/)[0];
      return !new RegExp(`^\\s*${escapeRegex(name)}\\b`, "m").test(content);
    });
    if (missing.length > 0) {
      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      content = `${content}${prefix}${missing.join("\n")}\n`;
      updated = true;
    }
  }

  if (updated) {
    writeFileSync(autoexecPath, content, "utf8");
  }
  return updated;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
