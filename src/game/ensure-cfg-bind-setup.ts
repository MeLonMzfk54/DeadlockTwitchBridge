import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETUP_MARKER = "// twitch-deadlock-bridge cfg-bind";

export interface CfgBindSetupOptions {
  cfgDir: string;
  filename: string;
  triggerKey: string;
}

export interface CfgBindSetupResult {
  autoexecUpdated: boolean;
  bindKeySynced: boolean;
  bindPresent: boolean;
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

  if (existingBind) {
    const currentKey = existingBind[1].toUpperCase();
    const desiredKey = triggerKey.toUpperCase();
    if (currentKey === desiredKey) {
      return { autoexecUpdated: false, bindKeySynced: false, bindPresent: true };
    }

    writeFileSync(autoexecPath, content.replace(bindPattern, bindLine), "utf8");
    return { autoexecUpdated: true, bindKeySynced: true, bindPresent: true };
  }

  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  writeFileSync(autoexecPath, `${content}${prefix}\n${SETUP_MARKER}\n${bindLine}\n`, "utf8");
  return { autoexecUpdated: true, bindKeySynced: false, bindPresent: true };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
