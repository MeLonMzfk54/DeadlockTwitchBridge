import {
  loadAppConfig,
  loadEffectsCatalog,
  loadRewardsConfig,
} from "./config.js";
import { createGameCommandClient } from "./game/create-game-client.js";
import { ensureCfgBindSetup } from "./game/ensure-cfg-bind-setup.js";
import { createEffectRegistry } from "./effects/registry.js";
import { createHeroResolver } from "./heroes/hero-resolver.js";
import { EffectManager } from "./queue/effect-manager.js";
import { TwitchEventSubClient } from "./twitch/eventsub.js";
import { startHttpServer } from "./server/http-server.js";
import { printTestModeHelp } from "./test/test-mode.js";
import type { BridgeStatus } from "./types.js";
import { join } from "node:path";

async function main(): Promise<void> {
  const config = loadAppConfig();
  const rewards = loadRewardsConfig();
  const catalog = loadEffectsCatalog();
  const heroResolver = createHeroResolver();
  const effects = createEffectRegistry(catalog, heroResolver);

  if (config.gameCommandMode === "cfg-bind") {
    const setup = ensureCfgBindSetup({
      cfgDir: config.deadlockCfgDir,
      filename: config.cfgBindFilename,
      triggerKey: config.cfgTriggerKey,
    });
    if (setup.autoexecUpdated) {
      const action = setup.bindKeySynced ? "synced bind key in" : "updated";
      console.log(
        `[game] autoexec.cfg ${action}: bind ${config.cfgTriggerKey} "exec ${config.cfgBindFilename}"`,
      );
      console.warn(
        "[game] Restart Deadlock with launch option -exec autoexec so the bind loads.",
      );
    }
  }

  const gameClient = createGameCommandClient(config);

  let twitchConnected = false;
  let gameConnected = false;

  const effectManager = new EffectManager(
    gameClient,
    effects,
    config.gameCommandMode,
    config.allowCheatEffects,
    config.allowDestructiveEffects,
    config.maxQueueSize,
  );

  const getStatus = (): BridgeStatus => ({
    twitchConnected,
    gameConnected,
    gameProcessRunning: gameClient.gameProcessRunning ?? false,
    gameCommandMode: config.gameCommandMode,
    testMode: config.testMode,
    activeEffects: effectManager.getActiveEffects(),
    queueLength: effectManager.getQueueLength(),
    recentEvents: effectManager.getRecentEvents(),
  });

  gameClient.on("connected", () => {
    gameConnected = true;
    if (config.gameCommandMode === "vconsole") {
      console.log("[game] VConsole connected");
    } else {
      console.log(
        `[game] cfg-bind ready: ${join(config.deadlockCfgDir, config.cfgBindFilename)} (trigger ${config.cfgTriggerKey})`,
      );
    }
  });

  gameClient.on("disconnected", () => {
    gameConnected = false;
    if (config.gameCommandMode === "vconsole") {
      console.log("[game] VConsole disconnected, retrying...");
    } else {
      console.log("[game] cfg-bind unavailable (check DEADLOCK_CFG_DIR)");
    }
  });

  gameClient.on("error", (error) => {
    console.warn("[game] error:", error.message);
  });

  gameClient.start();

  startHttpServer(config.httpHost, config.httpPort, {
    effectManager,
    effects,
    getStatus,
  });

  if (config.testMode) {
    printTestModeHelp();
  } else {
    if (!config.twitchClientId || !config.twitchAccessToken) {
      console.error("Missing TWITCH_CLIENT_ID or TWITCH_ACCESS_TOKEN. Use TEST_MODE=true or --test-mode.");
      process.exit(1);
    }

    const twitch = new TwitchEventSubClient(config, rewards);

    twitch.on("connected", () => {
      twitchConnected = true;
      console.log("[twitch] Connected to EventSub");
    });

    twitch.on("disconnected", () => {
      twitchConnected = false;
      console.log("[twitch] Disconnected from EventSub");
    });

    twitch.on("error", (error) => {
      console.error("[twitch] Error:", error.message);
    });

    twitch.on("redemption", (event) => {
      const rewardConfig = rewards.rewards[event.reward.id];
      if (!rewardConfig) {
        console.log(
          `[twitch] Unmapped reward "${event.reward.title}" (${event.reward.id}) from ${event.userLogin}`,
        );
        return;
      }

      void effectManager.activateReward(
        rewardConfig,
        event.userLogin,
        event.reward.id,
        event.userInput,
      );
    });

    try {
      await twitch.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[twitch] Failed to start:", message);
      console.error("Tip: run with TEST_MODE=true to test without Twitch credentials.");
      process.exit(1);
    }
  }

  console.log("");
  console.log("Deadlock Twitch Bridge is running.");
  if (config.gameCommandMode === "vconsole") {
    console.log("Launch Deadlock with -vconsole -insecure in Steam launch options.");
  } else {
    console.log(
      `cfg-bind mode: bind ${config.cfgTriggerKey} to exec ${config.cfgBindFilename} (auto-setup on start). Use -exec autoexec.`,
    );
  }
  console.log(`Open control panel: http://${config.httpHost}:${config.httpPort}/control`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
