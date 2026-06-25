import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../config.js";
import { assertWindowsPlatform } from "./win-key-sender.js";

const HOOK_SCRIPT = join(projectRoot, "scripts", "wasd-invert-hook.ps1");
const HOOK_START_TIMEOUT_MS = 500;

export interface WasdInvertKeys {
  forward: string;
  back: string;
  left: string;
  right: string;
}

export interface WasdInvertHookOptions {
  processName?: string;
  windowTitleContains?: string;
  keys: WasdInvertKeys;
}

let hookProcess: ChildProcess | null = null;

export function isWasdInvertHookActive(): boolean {
  return hookProcess !== null && hookProcess.exitCode === null;
}

function waitForHookProcess(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      reject(new Error(`WASD invert hook exited immediately (code ${child.exitCode})`));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      if (child.exitCode !== null) {
        reject(new Error(`WASD invert hook exited during startup (code ${child.exitCode})`));
        return;
      }
      resolve();
    }, timeoutMs);

    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`WASD invert hook exited during startup (code ${code ?? "unknown"})`));
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };

    child.once("exit", onExit);
  });
}

export async function startWasdInvertHook(options: WasdInvertHookOptions): Promise<void> {
  assertWindowsPlatform();
  stopWasdInvertHook();

  if (!existsSync(HOOK_SCRIPT)) {
    throw new Error(`Missing WASD invert hook script: ${HOOK_SCRIPT}`);
  }

  const processName = options.processName ?? "deadlock";
  const titleContains = options.windowTitleContains?.trim() ?? "";

  hookProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      HOOK_SCRIPT,
      "-ProcessName",
      processName,
      "-TitleContains",
      titleContains,
      "-ForwardKey",
      options.keys.forward,
      "-BackKey",
      options.keys.back,
      "-LeftKey",
      options.keys.left,
      "-RightKey",
      options.keys.right,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  const child = hookProcess;
  let stderr = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  child.on("exit", (code) => {
    if (hookProcess === child) {
      hookProcess = null;
      if (code !== 0 && code !== null) {
        const detail = stderr.trim();
        console.warn(
          `[game] wasd-invert hook exited (code ${code})${detail ? `: ${detail}` : ""}`,
        );
      }
    }
  });

  child.on("error", (error) => {
    if (hookProcess === child) {
      hookProcess = null;
    }
    console.warn("[game] wasd-invert hook process error:", error.message);
  });

  await waitForHookProcess(child, HOOK_START_TIMEOUT_MS);
}

export function stopWasdInvertHook(): void {
  if (!hookProcess) return;
  hookProcess.kill();
  hookProcess = null;
}
