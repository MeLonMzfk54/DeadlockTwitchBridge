import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "../config.js";

const execFileAsync = promisify(execFile);

const F_KEY_VK: Record<number, number> = Object.fromEntries(
  Array.from({ length: 24 }, (_, index) => [index + 1, 0x70 + index]),
);

const PRESS_KEY_SCRIPT = join(projectRoot, "scripts", "press-game-key.ps1");

export interface PressVirtualKeyOptions {
  processName?: string;
  windowTitleContains?: string;
}

export interface PressVirtualKeyResult {
  windowFound: boolean;
  focused: boolean;
  keySent: boolean;
  sendInputCount: number;
}

interface PowerShellKeyResult {
  windowFound?: boolean;
  focused?: boolean;
  keySent?: boolean;
  sendInputCount?: number;
  status?: string;
  processRunning?: boolean;
}

export function parseVirtualKeyCode(keyName: string): number {
  const normalized = keyName.trim().toUpperCase();
  const functionKeyMatch = /^F(\d{1,2})$/.exec(normalized);
  if (functionKeyMatch) {
    const fn = Number.parseInt(functionKeyMatch[1], 10);
    const vk = F_KEY_VK[fn];
    if (vk !== undefined) return vk;
  }

  throw new Error(`Unsupported CFG_TRIGGER_KEY "${keyName}". Use F1 through F24.`);
}

export function assertWindowsPlatform(): void {
  if (process.platform !== "win32") {
    throw new Error("cfg-bind mode requires Windows for key simulation.");
  }
}

function assertPressKeyScript(): void {
  if (!existsSync(PRESS_KEY_SCRIPT)) {
    throw new Error(`Missing key press script: ${PRESS_KEY_SCRIPT}`);
  }
}

async function runPressKeyScript(args: string[]): Promise<PowerShellKeyResult> {
  assertWindowsPlatform();
  assertPressKeyScript();

  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PRESS_KEY_SCRIPT, ...args],
    { windowsHide: true },
  );

  if (stderr?.trim()) {
    console.warn(`[game] key-sender stderr: ${stderr.trim()}`);
  }

  try {
    return JSON.parse(stdout.trim()) as PowerShellKeyResult;
  } catch {
    const status = stdout.trim().toLowerCase();
    if (status === "notfound") {
      return { windowFound: false, focused: false, keySent: false, sendInputCount: 0 };
    }
    return {
      windowFound: true,
      focused: status === "ok",
      keySent: status === "ok" || status === "sent",
      sendInputCount: status === "ok" || status === "sent" ? 2 : 0,
    };
  }
}

export async function isGameProcessRunning(
  processName = "deadlock",
  windowTitleContains = "",
): Promise<{ processRunning: boolean; windowFound: boolean }> {
  if (process.platform !== "win32") {
    return { processRunning: false, windowFound: false };
  }

  try {
    const result = await runPressKeyScript([
      "-VkCode",
      "0",
      "-ProcessName",
      processName,
      "-TitleContains",
      windowTitleContains,
      "-CheckOnly",
    ]);
    return {
      processRunning: result.processRunning ?? false,
      windowFound: result.windowFound ?? false,
    };
  } catch {
    return { processRunning: false, windowFound: false };
  }
}

export async function pressVirtualKey(
  vkCode: number,
  options: PressVirtualKeyOptions = {},
): Promise<PressVirtualKeyResult> {
  const processName = options.processName ?? "deadlock";
  const titleFilter = options.windowTitleContains?.trim() ?? "";

  const result = await runPressKeyScript([
    "-VkCode",
    String(vkCode),
    "-ProcessName",
    processName,
    "-TitleContains",
    titleFilter,
  ]);

  return {
    windowFound: result.windowFound ?? false,
    focused: result.focused ?? false,
    keySent: result.keySent ?? false,
    sendInputCount: result.sendInputCount ?? 0,
  };
}
