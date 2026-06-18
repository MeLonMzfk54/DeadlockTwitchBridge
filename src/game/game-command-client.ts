export interface GameCommandClient {
  sendCommand(command: string): Promise<void>;
  sendCommands(commands: string[]): Promise<void>;
}

export type GameCommandMode = "vconsole" | "cfg-bind";

export interface ConnectableGameCommandClient extends GameCommandClient {
  readonly connected: boolean;
  readonly gameProcessRunning?: boolean;
  start(): void;
  stop(): void;
  on(event: "connected", listener: () => void): void;
  on(event: "disconnected", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export async function sendCommandsSequential(
  client: GameCommandClient,
  commands: string[],
): Promise<void> {
  const filtered = commands.map((c) => c.trim()).filter(Boolean);
  if (filtered.length === 0) return;
  for (const command of filtered) {
    await client.sendCommand(command);
  }
}
