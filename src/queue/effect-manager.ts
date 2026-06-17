import { EventEmitter } from "node:events";
import type { VConsoleClient } from "../game/vconsole.js";
import type { GameEffect } from "../effects/types.js";
import { mergeEffectParams } from "../effects/types.js";
import type {
  ActiveEffectState,
  BridgeEvent,
  EffectActivationSource,
  RewardConfig,
} from "../types.js";

interface QueuedActivation {
  effectId: string;
  durationSec: number;
  viewer?: string;
  rewardName?: string;
  params?: Record<string, unknown>;
  source: EffectActivationSource;
}

export class EffectManager extends EventEmitter<{
  event: [BridgeEvent];
  status: [];
}> {
  private readonly activeByEffect = new Map<string, ActiveEffectState>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly queue: QueuedActivation[] = [];
  private processing = false;
  private recentEvents: BridgeEvent[] = [];

  constructor(
    private readonly vconsole: VConsoleClient,
    private readonly effects: Map<string, GameEffect>,
    private readonly allowCheatEffects: boolean,
    private readonly allowDestructiveEffects: boolean,
    private readonly maxQueueSize: number,
  ) {
    super();
  }

  getActiveEffects(): ActiveEffectState[] {
    return [...this.activeByEffect.values()].map((state) => ({
      effectId: state.effectId,
      viewer: state.viewer,
      rewardName: state.rewardName,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt,
    }));
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRecentEvents(): BridgeEvent[] {
    return [...this.recentEvents];
  }

  async activateReward(
    reward: RewardConfig,
    viewer: string,
    rewardKey?: string,
    userInput?: string,
  ): Promise<void> {
    if (rewardKey) {
      const cooldown = this.cooldownUntil.get(rewardKey);
      if (cooldown && Date.now() < cooldown) {
        this.pushEvent("error", `Cooldown active for reward "${reward.name}"`, {
          reward: reward.name,
          viewer,
        });
        return;
      }
    }

    for (const effectReq of reward.effects) {
      if (this.queue.length >= this.maxQueueSize) {
        this.pushEvent("error", "Effect queue is full", { viewer, reward: reward.name });
        return;
      }

      const effect = this.effects.get(effectReq.id);
      if (effect?.destructive && !this.allowDestructiveEffects) {
        this.pushEvent(
          "error",
          `Destructive effect "${effect.name}" blocked (ALLOW_DESTRUCTIVE_EFFECTS=false)`,
          { effectId: effect.id, viewer, reward: reward.name },
        );
        return;
      }

      const durationSec = effectReq.durationSec ?? effect?.defaultDurationSec ?? 30;
      const mergedParams = mergeEffectParams(
        effect ?? ({ defaultParams: undefined } as GameEffect),
        effectReq.params,
        reward.usesUserInput ? userInput : undefined,
      );

      this.queue.push({
        effectId: effectReq.id,
        durationSec,
        viewer,
        rewardName: reward.name,
        params: mergedParams,
        source: "twitch",
      });
    }

    if (rewardKey && reward.cooldownSec) {
      this.cooldownUntil.set(rewardKey, Date.now() + reward.cooldownSec * 1000);
    }

    this.pushEvent("reward_received", `Reward "${reward.name}" from ${viewer}`, {
      viewer,
      reward: reward.name,
      userInput: userInput ?? "",
      effects: reward.effects,
    });

    await this.processQueue();
  }

  async activateEffect(
    effectId: string,
    durationSec?: number,
    viewer = "test",
    rewardName = "Manual test",
    params?: Record<string, unknown>,
    userInput?: string,
    source: EffectActivationSource = "test-ui",
  ): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      this.pushEvent("error", "Effect queue is full", { effectId });
      return;
    }

    const effect = this.effects.get(effectId);
    const duration = durationSec ?? effect?.defaultDurationSec ?? 30;
    const mergedParams = mergeEffectParams(
      effect ?? ({ defaultParams: undefined } as GameEffect),
      params,
      userInput,
    );

    this.queue.push({
      effectId,
      durationSec: duration,
      viewer,
      rewardName,
      params: mergedParams,
      source,
    });
    await this.processQueue();
  }

  async revertEffect(effectId: string): Promise<void> {
    const active = this.activeByEffect.get(effectId);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    const effect = this.effects.get(effectId);
    if (effect) {
      await effect.revert(this.vconsole);
      this.pushEvent("effect_reverted", `Reverted ${effect.name}`, { effectId });
    }
    this.activeByEffect.delete(effectId);
    this.emit("status");
  }

  async revertAll(): Promise<void> {
    const ids = [...this.activeByEffect.keys()];
    for (const id of ids) {
      await this.revertEffect(id);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      await this.applyQueued(item);
    }

    this.processing = false;
    this.emit("status");
  }

  private async applyQueued(item: QueuedActivation): Promise<void> {
    const effect = this.effects.get(item.effectId);
    if (!effect) {
      this.pushEvent("error", `Unknown effect: ${item.effectId}`);
      return;
    }

    if (!effect.retailSafe && !this.allowCheatEffects) {
      this.pushEvent("error", `Effect "${effect.name}" is not retail-safe`, {
        effectId: item.effectId,
      });
      return;
    }

    if (effect.destructive && item.source === "twitch" && !this.allowDestructiveEffects) {
      this.pushEvent("error", `Destructive effect "${effect.name}" blocked`, {
        effectId: item.effectId,
      });
      return;
    }

    if (effect.destructive && item.source === "twitch") {
      this.pushEvent(
        "status",
        `WARNING: "${effect.name}" will disconnect from match — possible abandon penalty`,
        { effectId: item.effectId, viewer: item.viewer },
      );
    }

    const existing = this.activeByEffect.get(item.effectId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
      await effect.revert(this.vconsole);
    }

    try {
      await effect.apply(this.vconsole, item.params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent("error", message, { effectId: item.effectId, viewer: item.viewer });
      return;
    }

    if (effect.oneShot) {
      this.pushEvent("effect_applied", `${effect.name} activated`, {
        effectId: item.effectId,
        viewer: item.viewer,
        reward: item.rewardName,
        durationSec: item.durationSec,
        params: item.params,
      });
      this.emit("status");
      return;
    }

    const startedAt = Date.now();
    const expiresAt = startedAt + item.durationSec * 1000;
    const timer = setTimeout(() => {
      void this.revertEffect(item.effectId);
    }, item.durationSec * 1000);

    this.activeByEffect.set(item.effectId, {
      effectId: item.effectId,
      viewer: item.viewer,
      rewardName: item.rewardName,
      startedAt,
      expiresAt,
      timer,
    });

    this.pushEvent("effect_applied", `${effect.name} activated for ${item.durationSec}s`, {
      effectId: item.effectId,
      viewer: item.viewer,
      reward: item.rewardName,
      durationSec: item.durationSec,
      params: item.params,
    });
    this.emit("status");
  }

  private pushEvent(
    type: BridgeEvent["type"],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const event: BridgeEvent = {
      type,
      timestamp: Date.now(),
      message,
      data,
    };
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > 50) {
      this.recentEvents = this.recentEvents.slice(0, 50);
    }
    this.emit("event", event);
    console.log(`[${type}] ${message}`);
  }
}
