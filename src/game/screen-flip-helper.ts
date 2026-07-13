import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../config.js";
import { assertWindowsPlatform } from "./win-key-sender.js";

const HELPER_SCRIPT = join(projectRoot, "scripts", "screen-flip-overlay.ps1");
const HELPER_START_TIMEOUT_MS = 1500;

export interface ScreenFlipHelperOptions {
  processName?: string;
  windowTitleContains?: string;
  fps?: number;
  axis?: string;
  syncAd?: boolean;
  leftKey?: string;
  rightKey?: string;
  monitorIndex?: string;
}

let helperProcess: ChildProcess | null = null;

export function isScreenFlipHelperActive(): boolean {
  return helperProcess !== null && helperProcess.exitCode === null;
}

function waitForHelperProcess(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      reject(new Error(`screen_flip helper exited immediately (code ${child.exitCode})`));
      return;
    }

    let settled = false;
    let stdout = "";

    const settleOk = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const settleErr = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const timer = setTimeout(() => {
      if (child.exitCode !== null) {
        settleErr(`screen_flip helper exited during startup (code ${child.exitCode})`);
        return;
      }
      // Process still alive — treat as started even without ready line.
      settleOk();
    }, timeoutMs);

    const onExit = (code: number | null): void => {
      settleErr(`screen_flip helper exited during startup (code ${code ?? "unknown"})`);
    };

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("screen-flip: ready")) {
        settleOk();
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.stdout?.off("data", onStdout);
    };

    child.once("exit", onExit);
    child.stdout?.on("data", onStdout);
  });
}

export async function startScreenFlipHelper(options: ScreenFlipHelperOptions): Promise<void> {
  assertWindowsPlatform();
  stopScreenFlipHelper();

  if (!existsSync(HELPER_SCRIPT)) {
    throw new Error(`Missing screen_flip helper script: ${HELPER_SCRIPT}`);
  }

  const processName = options.processName ?? "deadlock";
  const titleContains = options.windowTitleContains?.trim() ?? "";
  const fps = Math.max(5, Math.min(60, options.fps ?? 45));
  const axis = options.axis === "vertical" ? "vertical" : "horizontal";
  const leftKey = options.leftKey ?? "a";
  const rightKey = options.rightKey ?? "d";
  const monitorIndex = options.monitorIndex?.trim() ?? "";

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    // Hidden console, but do NOT use Node windowsHide/CREATE_NO_WINDOW —
    // that prevents WinForms overlay windows from painting on the desktop.
    "-WindowStyle",
    "Hidden",
    "-File",
    HELPER_SCRIPT,
    "-ProcessName",
    processName,
    "-TitleContains",
    titleContains,
    "-Fps",
    String(fps),
    "-Axis",
    axis,
    "-LeftKey",
    leftKey,
    "-RightKey",
    rightKey,
    "-MonitorIndex",
    monitorIndex,
  ];

  if (options.syncAd) {
    args.push("-SyncAd");
  }

  helperProcess = spawn("powershell.exe", args, {
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const child = helperProcess;
  let stderr = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) console.log(`[game] screen_flip: ${text}`);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    const text = chunk.toString("utf8").trim();
    if (text) console.warn(`[game] screen_flip stderr: ${text}`);
  });

  child.on("exit", (code) => {
    if (helperProcess === child) {
      helperProcess = null;
      if (code !== 0 && code !== null) {
        const detail = stderr.trim();
        console.warn(
          `[game] screen_flip helper exited (code ${code})${detail ? `: ${detail}` : ""}`,
        );
      }
    }
  });

  child.on("error", (error) => {
    if (helperProcess === child) {
      helperProcess = null;
    }
    console.warn("[game] screen_flip helper process error:", error.message);
  });

  try {
    await waitForHelperProcess(child, HELPER_START_TIMEOUT_MS);
  } catch (error) {
    stopScreenFlipHelper();
    const detail = stderr.trim();
    const base = error instanceof Error ? error.message : String(error);
    throw new Error(detail ? `${base}: ${detail}` : base);
  }
}

export function stopScreenFlipHelper(): void {
  if (!helperProcess) return;
  helperProcess.kill();
  helperProcess = null;
}
