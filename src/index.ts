import {
  loadAppConfig,
  loadEffectsCatalog,
  loadRewardsConfig,
} from "./config.js";
import { VConsoleClient } from "./game/vconsole.js";
import { createEffectRegistry } from "./effects/registry.js";
import { createHeroResolver } from "./heroes/hero-resolver.js";
import { EffectManager } from "./queue/effect-manager.js";
import { TwitchEventSubClient } from "./twitch/eventsub.js";
import { startHttpServer } from "./server/http-server.js";
import { printTestModeHelp } from "./test/test-mode.js";
import type { BridgeStatus } from "./types.js";

async function main(): Promise<void> {
  const config = loadAppConfig();
  const rewards = loadRewardsConfig();
  const catalog = loadEffectsCatalog();
  const heroResolver = createHeroResolver();
  const effects = createEffectRegistry(catalog, heroResolver);

  const vconsole = new VConsoleClient({
    host: config.vconsoleHost,
    port: config.vconsolePort,
    reconnectMs: config.vconsoleReconnectMs,
  });

  let twitchConnected = false;
  let gameConnected = false;

  const effectManager = new EffectManager(
    vconsole,
    effects,
    config.allowCheatEffects,
    config.allowDestructiveEffects,
    config.maxQueueSize,
  );

  const getStatus = (): BridgeStatus => ({
    twitchConnected,
    gameConnected,
    testMode: config.testMode,
    activeEffects: effectManager.getActiveEffects(),
    queueLength: effectManager.getQueueLength(),
    recentEvents: effectManager.getRecentEvents(),
  });

  vconsole.on("connected", () => {
    gameConnected = true;
    console.log("[game] VConsole connected");
  });

  vconsole.on("disconnected", () => {
    gameConnected = false;
    console.log("[game] VConsole disconnected, retrying...");
  });

  vconsole.on("error", (error) => {
    console.warn("[game] VConsole error:", error.message);
  });

  vconsole.start();

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
  console.log("Launch Deadlock with -vconsole in Steam launch options.");
  console.log(`Open control panel: http://${config.httpHost}:${config.httpPort}/control`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
