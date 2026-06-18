import type { AppConfig } from "../types.js";
import type { ConnectableGameCommandClient } from "./game-command-client.js";
import { CfgBindClient } from "./cfg-bind-client.js";
import { VConsoleClient } from "./vconsole.js";
import { assertWindowsPlatform } from "./win-key-sender.js";

export function createGameCommandClient(config: AppConfig): ConnectableGameCommandClient {
  if (config.gameCommandMode === "cfg-bind") {
    assertWindowsPlatform();
    return new CfgBindClient({
      cfgDir: config.deadlockCfgDir,
      filename: config.cfgBindFilename,
      triggerKey: config.cfgTriggerKey,
      commandDelayMs: config.cfgBindCommandDelayMs,
      windowTitleContains: config.deadlockWindowTitle,
      processName: config.deadlockProcessName,
    });
  }

  return new VConsoleClient({
    host: config.vconsoleHost,
    port: config.vconsolePort,
    reconnectMs: config.vconsoleReconnectMs,
  });
}
