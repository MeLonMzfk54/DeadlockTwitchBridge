export interface GameCommandClient {
  sendCommand(command: string): Promise<void>;
}

export type GameCommandMode = "vconsole" | "cfg-bind";

export interface ConnectableGameCommandClient extends GameCommandClient {
  readonly connected: boolean;
  start(): void;
  stop(): void;
  on(event: "connected", listener: () => void): void;
  on(event: "disconnected", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}
