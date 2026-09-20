import {
  loadAppConfig,
  loadEffectsCatalog,
  loadRewardsConfig,
} from "./config.js";
import { createGameCommandClient } from "./game/create-game-client.js";
import { ensureCfgBindSetup, ensureShopConvarDefaults } from "./game/ensure-cfg-bind-setup.js";
import { stopScreenFlipHelper } from "./game/screen-flip-helper.js";
import { stopWasdInvertHook } from "./game/wasd-invert-hook.js";
import { GameEventBus } from "./game/game-event-bus.js";
import {
  ConsoleLogTail,
  resolveConsoleLogPath,
} from "./game/console-log-tail.js";
import { createEffectRegistry } from "./effects/registry.js";
import { createHeroResolver } from "./heroes/hero-resolver.js";
import { EffectManager } from "./queue/effect-manager.js";
import { TwitchEventSubClient } from "./twitch/eventsub.js";
import { startHttpServer } from "./server/http-server.js";
import { printTestModeHelp } from "./test/test-mode.js";
import type { BridgeStatus } from "./types.js";
import { join } from "node:path";
import { ShopVoteController, isShopVotingStage } from "./shop/shop-vote-controller.js";
import { parseShopChatVote, parseShopChatVotes } from "./shop/shop-chat-parser.js";
import { loadShopVoteSettings, saveShopVoteSettings, formatShopChatAnnounce } from "./shop/shop-vote-settings.js";
import { sendTwitchChatMessage } from "./twitch/chat-send.js";

const MOD_ONLINE_MS = 8_000;

async function main(): Promise<void> {
  const config = loadAppConfig();
  const rewards = loadRewardsConfig();
  const catalog = loadEffectsCatalog();
  const heroResolver = createHeroResolver();
  const effects = createEffectRegistry(catalog, heroResolver);
  const gameEventBus = new GameEventBus();
  const consoleTail = new ConsoleLogTail();

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
      if (setup.shopConvarsUpdated) {
        console.log("[game] autoexec.cfg: added bridge_shop_* convar defaults");
      }
      console.warn(
        "[game] Restart Deadlock with launch option -exec autoexec so the bind loads.",
      );
    }
  } else if (config.deadlockCfgDir.trim()) {
    // Still seed shop convars when using vconsole if cfg dir is known
    if (ensureShopConvarDefaults(config.deadlockCfgDir)) {
      console.log("[game] autoexec.cfg: added bridge_shop_* convar defaults");
    }
  }

  const gameClient = createGameCommandClient(config);
  const shopSettings = loadShopVoteSettings(
    {
      categoryDurationMs: config.shopVoteCategoryMs,
      tierDurationMs: config.shopVoteTierMs,
      restartDelayMs: config.shopVoteRestartMs,
    },
    { createIfMissing: true },
  );
  const shopVote = new ShopVoteController(gameClient, gameEventBus, {
    settings: shopSettings,
  });
  const persistShopSettings = (): void => {
    try {
      saveShopVoteSettings(shopVote.getSettings());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[shop] Failed to save settings: ${message}`);
    }
  };

  shopVote.on("vote_stage_start", ({ stage, snapshot }) => {
    if (config.testMode) return;
    const message = formatShopChatAnnounce({
      stage,
      settings: snapshot.settings,
      category: snapshot.winnerCategory,
    });
    if (!message) return;
    void (async () => {
      const result = await sendTwitchChatMessage(config, message);
      if (result.ok) {
        shopVote.note(`chat announce (${stage}) ok`);
        console.log(`[shop] Chat announce (${stage}): sent`);
      } else {
        shopVote.note(`chat announce (${stage}) fail: ${result.error ?? "unknown"}`);
        console.warn(
          `[shop] Chat announce failed (${stage}): ${result.error ?? "unknown"}` +
            (result.status === 403 ? " — regenerate token with user:write:chat" : ""),
        );
      }
    })();
  });

  let twitchConnected = false;
  let chatConnected = false;
  let gameConnected = false;
  let twitchClient: TwitchEventSubClient | null = null;

  const effectManager = new EffectManager(
    gameClient,
    effects,
    config.gameCommandMode,
    config.allowCheatEffects,
    config.allowDestructiveEffects,
    config.maxQueueSize,
  );

  const consoleLogPath = resolveConsoleLogPath(
    config.deadlockConsoleLog,
    config.deadlockCfgDir,
    config.deadlockGameDir,
  );

  const getStatus = (): BridgeStatus => {
    const mod = gameEventBus.getModStatus();
    const modOnline = mod.modLastSeenAt > 0 && Date.now() - mod.modLastSeenAt < MOD_ONLINE_MS;
    if (mod.match.phase || typeof mod.match.shopOpen === "boolean") {
      shopVote.syncFromMatchPhase(mod.match.phase || "", mod.match.shopOpen);
    }
    return {
      twitchConnected,
      chatConnected: Boolean(twitchClient?.chatConnected ?? chatConnected),
      gameConnected,
      gameProcessRunning: gameClient.gameProcessRunning ?? false,
      gameCommandMode: config.gameCommandMode,
      testMode: config.testMode,
      activeEffects: effectManager.getActiveEffects(),
      queueLength: effectManager.getQueueLength(),
      recentEvents: effectManager.getRecentEvents(),
      gameTelemetry: {
        modOnline,
        modLastSeenAt: mod.modLastSeenAt,
        lastTransport: mod.lastTransport,
        lastEventType: mod.lastEventType,
        eventCount: mod.eventCount,
        consoleLogPath: consoleTail.activePath,
        consoleLogTailing: Boolean(consoleTail.activePath),
        lastHeartbeat: mod.lastHeartbeat,
        match: mod.match,
      },
      shopVote: shopVote.getSnapshot(),
    };
  };

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

  consoleTail.on("event", (evt) => {
    gameEventBus.ingest(evt, "log");
  });
  consoleTail.on("started", (path) => {
    console.log(`[game-events] Tailing console.log: ${path}`);
  });
  consoleTail.on("error", (error) => {
    console.warn("[game-events] console.log tail error:", error.message);
  });

  function tryStartConsoleTail(): boolean {
    if (consoleTail.activePath) return true;
    const path = resolveConsoleLogPath(
      config.deadlockConsoleLog,
      config.deadlockCfgDir,
      config.deadlockGameDir,
    );
    if (!path) return false;
    return consoleTail.start(path);
  }

  if (consoleLogPath) {
    consoleTail.start(consoleLogPath);
  } else {
    console.log(
      "[game-events] console.log not found yet. HTTP ingest still works. Will retry. Set DEADLOCK_CONSOLE_LOG or launch Deadlock with -condebug.",
    );
    const retry = setInterval(() => {
      if (tryStartConsoleTail()) clearInterval(retry);
    }, 15_000);
  }

  startHttpServer(config.httpHost, config.httpPort, {
    effectManager,
    effects,
    getStatus,
    gameEventBus,
    shopVote,
    onShopSettingsChange: persistShopSettings,
  });

  if (config.testMode) {
    printTestModeHelp();
  } else {
    if (!config.twitchClientId || !config.twitchAccessToken) {
      console.error("Missing TWITCH_CLIENT_ID or TWITCH_ACCESS_TOKEN. Use TEST_MODE=true or --test-mode.");
      process.exit(1);
    }

    const twitch = new TwitchEventSubClient(config, rewards);
    twitchClient = twitch;

    twitch.on("connected", () => {
      twitchConnected = true;
      chatConnected = twitch.chatConnected;
      console.log("[twitch] Connected to EventSub");
      if (chatConnected) {
        console.log("[twitch] Chat vote listening (channel.chat.message)");
      }
    });

    twitch.on("disconnected", () => {
      twitchConnected = false;
      chatConnected = false;
      console.log("[twitch] Disconnected from EventSub");
    });

    twitch.on("error", (error) => {
      console.error("[twitch] Error:", error.message);
      chatConnected = twitch.chatConnected;
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

    twitch.on("chat", (msg) => {
      const snap = shopVote.getSnapshot();
      const stage = snap.stage;
      if (!isShopVotingStage(stage)) return;
      const bangOpts = { requireBangPrefix: snap.settings.requireBangPrefix };
      // Login for /control nick feed; falls back to id. Last-vote-wins per chatter per axis.
      const voterId = msg.chatterUserLogin || msg.chatterUserId;

      if (stage === "voting_combined") {
        const multi = parseShopChatVotes(msg.text, bangOpts);
        if (!multi) return;
        try {
          if (multi.category) shopVote.cast(multi.category, voterId);
          if (multi.tier) shopVote.cast(multi.tier, voterId);
        } catch {
          // Wrong option — ignore
        }
        return;
      }

      const option = parseShopChatVote(msg.text, stage, bangOpts);
      if (!option) return;
      try {
        shopVote.cast(option, voterId);
      } catch {
        // Wrong option for stage — ignore (parser already filters most of these).
      }
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

  const shutdown = (): void => {
    consoleTail.stop();
    stopWasdInvertHook();
    stopScreenFlipHelper();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
