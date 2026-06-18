import { EventEmitter } from "node:events";
import net from "node:net";
import type { ConnectableGameCommandClient } from "./game-command-client.js";

/** Source 2 VConsole2 wire version (byte 0xD4 = 212). Deadlock rejects legacy 210. */
const VCONSOLE_PROTOCOL_VERSION = 0x00d40000;

export interface VConsoleClientOptions {
  host: string;
  port: number;
  reconnectMs: number;
}

/**
 * Source 2 VConsole2 client (CMND packets).
 * Protocol reference: Penguinwizzard/VConsoleLib
 */
export class VConsoleClient
  extends EventEmitter<{
  connected: [];
  disconnected: [];
  error: [Error];
  message: [string];
}>
  implements ConnectableGameCommandClient
{
  private socket: net.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connecting = false;
  private shouldRun = false;
  private commandQueue: string[] = [];
  private flushChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: VConsoleClientOptions) {
    super();
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed && this.socket.writable;
  }

  start(): void {
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
  }

  async sendCommand(command: string): Promise<void> {
    if (!command.trim()) return;
    await this.sendCommands([command]);
  }

  async sendCommands(commands: string[]): Promise<void> {
    const filtered = commands.map((c) => c.trim()).filter(Boolean);
    if (filtered.length === 0) return;

    for (const command of filtered) {
      this.commandQueue.push(command);
    }
    this.flushChain = this.flushChain.then(() => this.drainQueue());
    await this.flushChain;
  }

  private connect(): void {
    if (!this.shouldRun || this.connecting || this.connected) return;
    this.connecting = true;

    const socket = new net.Socket();
    socket.setKeepAlive(true);

    socket.once("connect", () => {
      this.connecting = false;
      this.socket = socket;
      this.emit("connected");
      this.flushChain = this.flushChain.then(() => this.drainQueue());
    });

    socket.on("data", (chunk) => {
      this.emit("message", chunk.toString("utf8", 0, Math.min(chunk.length, 200)));
    });

    socket.on("error", (error) => {
      this.emit("error", error);
    });

    socket.on("close", () => {
      this.socket = null;
      this.connecting = false;
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    socket.connect(this.options.port, this.options.host);
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectMs);
  }

  private async drainQueue(): Promise<void> {
    while (this.commandQueue.length > 0) {
      if (!this.connected) {
        this.connect();
        await sleep(250);
        if (!this.connected) break;
      }

      const command = this.commandQueue.shift();
      if (!command || !this.socket) continue;

      const packet = buildCmndPacket(command);
      await new Promise<void>((resolve, reject) => {
        this.socket!.write(packet, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await sleep(50);
    }
  }
}

function buildCmndPacket(command: string): Buffer {
  const commandBytes = Buffer.from(`${command}\0`, "utf8");
  const header = Buffer.alloc(12);
  header.write("CMND", 0, 4, "ascii");
  header.writeUInt32BE(VCONSOLE_PROTOCOL_VERSION, 4);
  header.writeUInt16BE(commandBytes.length + 12, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, commandBytes]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
