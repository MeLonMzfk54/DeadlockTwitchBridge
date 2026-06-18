import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConnectableGameCommandClient } from "./game-command-client.js";
import { parseVirtualKeyCode, pressVirtualKey } from "./win-key-sender.js";

export interface CfgBindClientOptions {
  cfgDir: string;
  filename: string;
  triggerKey: string;
  commandDelayMs: number;
  windowTitleContains: string;
  processName: string;
}

export class CfgBindClient
  extends EventEmitter<{
    connected: [];
    disconnected: [];
    error: [Error];
  }>
  implements ConnectableGameCommandClient
{
  private readonly cfgPath: string;
  private readonly vkCode: number;
  private commandQueue: string[] = [];
  private sending = false;
  private shouldRun = false;
  private isConnected = false;

  constructor(private readonly options: CfgBindClientOptions) {
    super();
    this.cfgPath = join(options.cfgDir, options.filename);
    this.vkCode = parseVirtualKeyCode(options.triggerKey);
  }

  get connected(): boolean {
    return this.isConnected;
  }

  start(): void {
    this.shouldRun = true;
    this.refreshConnection();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.isConnected) {
      this.isConnected = false;
      this.emit("disconnected");
    }
  }

  async sendCommand(command: string): Promise<void> {
    if (!command.trim()) return;
    this.commandQueue.push(command);
    await this.flushQueue();
  }

  private refreshConnection(): void {
    try {
      if (!existsSync(this.options.cfgDir)) {
        throw new Error(`DEADLOCK_CFG_DIR does not exist: ${this.options.cfgDir}`);
      }

      writeFileSync(this.cfgPath, "", "utf8");

      if (!this.isConnected) {
        this.isConnected = true;
        this.emit("connected");
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.isConnected) {
        this.isConnected = false;
        this.emit("disconnected");
      }
      this.emit("error", err);
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.sending) return;
    this.sending = true;

    while (this.commandQueue.length > 0) {
      if (!this.shouldRun) break;

      if (!this.isConnected) {
        this.refreshConnection();
        await sleep(100);
        if (!this.isConnected) break;
      }

      const command = this.commandQueue.shift();
      if (!command) continue;

      try {
        writeFileSync(this.cfgPath, `${command}\n`, "utf8");
        const keyResult = await pressVirtualKey(this.vkCode, {
          processName: this.options.processName,
          windowTitleContains: this.options.windowTitleContains,
        });
        if (!keyResult.windowFound) {
          const message =
            `Deadlock process "${this.options.processName}" not found. ` +
            `Start the game or set DEADLOCK_PROCESS_NAME in .env.`;
          console.warn(`[game] cfg-bind: ${message}`);
          this.emit("error", new Error(message));
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.isConnected = false;
        this.emit("disconnected");
        this.emit("error", err);
        break;
      }

      await sleep(this.options.commandDelayMs);
    }

    this.sending = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
