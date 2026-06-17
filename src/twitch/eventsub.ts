import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { AppConfig, RewardsFile, TwitchRedemption } from "../types.js";
import { refreshAccessTokenIfNeeded, resolveBroadcasterId } from "./auth.js";

interface EventSubMessage {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
    subscription_type?: string;
  };
  payload: {
    session?: { id: string; status: string; keepalive_timeout_seconds?: number };
    subscription?: { id: string; status: string; type: string };
    event?: TwitchRedemption;
  };
}

interface RawTwitchRedemption {
  id?: string;
  broadcaster_user_id?: string;
  broadcaster_user_login?: string;
  user_id?: string;
  user_login?: string;
  user_name?: string;
  user_input?: string;
  status?: string;
  redeemed_at?: string;
  reward?: {
    id?: string;
    title?: string;
    cost?: number;
  };
}

export class TwitchEventSubClient extends EventEmitter<{
  connected: [];
  disconnected: [];
  redemption: [TwitchRedemption];
  error: [Error];
}> {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private broadcasterId: string | null = null;

  constructor(
    private config: AppConfig,
    private rewards: RewardsFile,
  ) {
    super();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.shouldRun = true;
    const token = await refreshAccessTokenIfNeeded(this.config);
    this.config.twitchAccessToken = token;
    this.broadcasterId = await resolveBroadcasterId(this.config);
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
  }

  private connect(): void {
    if (!this.shouldRun) return;

    this.ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");

    this.ws.on("open", () => {
      console.log("[twitch] EventSub WebSocket connecting...");
    });

    this.ws.on("message", (data) => {
      void this.handleMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.emit("disconnected");
      this.sessionId = null;
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      this.emit("error", error);
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private async handleMessage(raw: string): Promise<void> {
    const message = JSON.parse(raw) as EventSubMessage;
    const type = message.metadata.message_type;

    if (type === "session_welcome") {
      this.sessionId = message.payload.session?.id ?? null;
      console.log("[twitch] EventSub session welcome");
      await this.createSubscription();
      this.emit("connected");
      return;
    }

    if (type === "session_keepalive") {
      return;
    }

    if (type === "session_reconnect") {
      this.ws?.close();
      return;
    }

    if (type === "notification" && message.metadata.subscription_type === "channel.channel_points_custom_reward_redemption.add") {
      const event = this.normalizeRedemption(message.payload.event as RawTwitchRedemption | undefined);
      if (!event) return;
      this.emit("redemption", event);
      return;
    }

    if (type === "revocation") {
      console.warn("[twitch] Subscription revoked:", message.payload.subscription?.status);
    }
  }

  private normalizeRedemption(event: RawTwitchRedemption | undefined): TwitchRedemption | null {
    if (!event?.id || !event.reward?.id) {
      return null;
    }

    const userLogin = event.user_login ?? event.user_name ?? "";
    const rewardTitle = event.reward.title ?? "";

    return {
      id: event.id,
      broadcasterUserId: event.broadcaster_user_id ?? "",
      broadcasterUserLogin: event.broadcaster_user_login ?? "",
      userId: event.user_id ?? "",
      userLogin,
      userInput: event.user_input ?? "",
      status: event.status ?? "",
      reward: {
        id: event.reward.id,
        title: rewardTitle,
        cost: event.reward.cost ?? 0,
      },
      redeemedAt: event.redeemed_at ?? "",
    };
  }

  private async createSubscription(): Promise<void> {
    if (!this.sessionId || !this.broadcasterId) {
      throw new Error("Missing EventSub session or broadcaster ID");
    }

    const userToken = await refreshAccessTokenIfNeeded(this.config);
    this.config.twitchAccessToken = userToken;
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Client-Id": this.config.twitchClientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.channel_points_custom_reward_redemption.add",
        version: "1",
        condition: {
          broadcaster_user_id: this.broadcasterId,
        },
        transport: {
          method: "websocket",
          session_id: this.sessionId,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create EventSub subscription: ${response.status} ${body}`);
    }

    console.log("[twitch] Subscribed to channel point redemptions");
  }
}
