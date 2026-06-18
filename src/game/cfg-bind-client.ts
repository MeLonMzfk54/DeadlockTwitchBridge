import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConnectableGameCommandClient } from "./game-command-client.js";
import { isGameProcessRunning, parseVirtualKeyCode, pressVirtualKey } from "./win-key-sender.js";

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
  private readonly triggerKey: string;
  private commandQueue: string[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private shouldRun = false;
  private isConnected = false;
  private processRunning = false;

  constructor(private readonly options: CfgBindClientOptions) {
    super();
    this.cfgPath = join(options.cfgDir, options.filename);
    this.vkCode = parseVirtualKeyCode(options.triggerKey);
    this.triggerKey = options.triggerKey;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get gameProcessRunning(): boolean {
    return this.processRunning;
  }

  start(): void {
    this.shouldRun = true;
    void this.refreshConnection();
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
    await this.sendCommands([command]);
  }

  async sendCommands(commands: string[]): Promise<void> {
    const filtered = commands.map((c) => c.trim()).filter(Boolean);
    if (filtered.length === 0) return;

    this.commandQueue.push(filtered.join("\n"));
    this.flushChain = this.flushChain.then(() => this.drainQueue());
    await this.flushChain;
  }

  private async refreshConnection(): Promise<void> {
    try {
      if (!existsSync(this.options.cfgDir)) {
        throw new Error(`DEADLOCK_CFG_DIR does not exist: ${this.options.cfgDir}`);
      }

      writeFileSync(this.cfgPath, "", "utf8");

      const gameState = await isGameProcessRunning(
        this.options.processName,
        this.options.windowTitleContains,
      );
      this.processRunning = gameState.processRunning;

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

  private async drainQueue(): Promise<void> {
    while (this.commandQueue.length > 0) {
      if (!this.shouldRun) break;

      if (!this.isConnected) {
        await this.refreshConnection();
        await sleep(100);
        if (!this.isConnected) break;
      }

      const batch = this.commandQueue.shift();
      if (!batch) continue;

      try {
        writeFileSync(this.cfgPath, `${batch}\n`, "utf8");
        console.log(`[game] cfg-bind: wrote ${batch.split("\n").length} command(s) to ${this.cfgPath}`);

        const gameState = await isGameProcessRunning(
          this.options.processName,
          this.options.windowTitleContains,
        );
        this.processRunning = gameState.processRunning;

        if (!gameState.processRunning) {
          const message =
            `Deadlock process "${this.options.processName}" not found. ` +
            `Start the game or set DEADLOCK_PROCESS_NAME in .env.`;
          console.warn(`[game] cfg-bind: ${message}`);
          this.emit("error", new Error(message));
          continue;
        }

        const keyResult = await pressVirtualKey(this.vkCode, {
          processName: this.options.processName,
          windowTitleContains: this.options.windowTitleContains,
        });

        if (!keyResult.windowFound) {
          const message =
            `Deadlock window not found for process "${this.options.processName}".`;
          console.warn(`[game] cfg-bind: ${message}`);
          this.emit("error", new Error(message));
        } else if (!keyResult.keySent) {
          const message = `${this.triggerKey} key press failed (SendInput=0).`;
          console.warn(`[game] cfg-bind: ${message}`);
          this.emit("error", new Error(message));
        } else {
          const focusNote = keyResult.focused ? "focused=ok" : "focused=no";
          console.log(
            `[game] cfg-bind: ${this.triggerKey} pressed (${focusNote}, sendInput=${keyResult.sendInputCount})`,
          );
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
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
