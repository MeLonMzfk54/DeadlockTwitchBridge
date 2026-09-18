import { existsSync, openSync, readSync, closeSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join, normalize } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingGameEvent } from "../types.js";
import { parseIncomingGameEvent } from "./game-event-bus.js";

export const BRIDGE_EVENT_LOG_PREFIX = "[twitch_bridge] EVENT ";

export class ConsoleLogTail extends EventEmitter<{
  event: [IncomingGameEvent];
  error: [Error];
  started: [string];
  stopped: [];
}> {
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private offset = 0;
  private running = false;
  private path: string | null = null;
  private leftover = "";

  start(filePath: string): boolean {
    this.stop();
    if (!filePath || !existsSync(filePath)) {
      return false;
    }

    this.path = filePath;
    this.running = true;

    try {
      const stat = statSync(filePath);
      this.offset = stat.size;
    } catch {
      this.offset = 0;
    }

    try {
      this.watcher = watch(filePath, () => {
        this.readNew();
      });
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }

    this.pollTimer = setInterval(() => this.readNew(), 1000);
    this.emit("started", filePath);
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.path = null;
    this.leftover = "";
    this.emit("stopped");
  }

  get activePath(): string | null {
    return this.path;
  }

  private readNew(): void {
    if (!this.running || !this.path) return;
    let fd: number | null = null;
    try {
      const stat = statSync(this.path);
      if (stat.size < this.offset) {
        // log rotated / truncated
        this.offset = 0;
        this.leftover = "";
      }
      if (stat.size === this.offset) return;

      fd = openSync(this.path, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      this.consume(buf.toString("utf8"));
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private consume(chunk: string): void {
    const text = this.leftover + chunk;
    const lines = text.split(/\r?\n/);
    this.leftover = lines.pop() ?? "";

    for (const line of lines) {
      const evt = parseBridgeEventLine(line);
      if (evt) this.emit("event", evt);
    }
  }
}

export function parseBridgeEventLine(line: string): IncomingGameEvent | null {
  const idx = line.indexOf(BRIDGE_EVENT_LOG_PREFIX);
  if (idx === -1) return null;
  const jsonPart = line.slice(idx + BRIDGE_EVENT_LOG_PREFIX.length).trim();
  if (!jsonPart) return null;
  try {
    const parsed: unknown = JSON.parse(jsonPart);
    return parseIncomingGameEvent(parsed);
  } catch {
    return null;
  }
}

export function resolveConsoleLogPath(
  explicitPath: string,
  deadlockCfgDir: string,
  deadlockGameDir: string,
): string | null {
  const candidates: string[] = [];
  if (explicitPath.trim()) candidates.push(normalize(explicitPath.trim()));

  if (deadlockCfgDir.trim()) {
    const cfg = normalize(deadlockCfgDir.trim());
    candidates.push(normalize(join(cfg, "..", "console.log")));
    candidates.push(normalize(join(cfg, "console.log")));
  }

  if (deadlockGameDir.trim()) {
    const root = normalize(deadlockGameDir.trim());
    candidates.push(normalize(join(root, "game", "citadel", "console.log")));
  }

  candidates.push(
    "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/console.log",
    "D:/Steam/steamapps/common/Deadlock/game/citadel/console.log",
    "F:/Steam/steamapps/common/Deadlock/game/citadel/console.log",
    "E:/SteamLibrary/steamapps/common/Deadlock/game/citadel/console.log",
  );

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}
