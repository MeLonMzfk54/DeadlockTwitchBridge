import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { AppConfig, RewardsFile, TwitchChatMessage, TwitchRedemption } from "../types.js";
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
    event?: TwitchRedemption | RawTwitchChatMessage;
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

interface RawTwitchChatMessage {
  broadcaster_user_id?: string;
  broadcaster_user_login?: string;
  chatter_user_id?: string;
  chatter_user_login?: string;
  chatter_user_name?: string;
  message_id?: string;
  message?: {
    text?: string;
  };
}

export class TwitchEventSubClient extends EventEmitter<{
  connected: [];
  disconnected: [];
  redemption: [TwitchRedemption];
  chat: [TwitchChatMessage];
  error: [Error];
}> {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private broadcasterId: string | null = null;
  /** User ID of the OAuth token (must match chat subscription condition.user_id). */
  private tokenUserId: string | null = null;
  private chatSubscribed = false;

  constructor(
    private config: AppConfig,
    private rewards: RewardsFile,
  ) {
    super();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** True after a successful `channel.chat.message` EventSub subscription. */
  get chatConnected(): boolean {
    return this.connected && this.chatSubscribed;
  }

  async start(): Promise<void> {
    this.shouldRun = true;
    const token = await refreshAccessTokenIfNeeded(this.config);
    this.config.twitchAccessToken = token;
    this.broadcasterId = await resolveBroadcasterId(this.config);
    this.tokenUserId = await this.resolveTokenUserId();
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
    this.chatSubscribed = false;
  }

  private async resolveTokenUserId(): Promise<string> {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.config.twitchAccessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to validate Twitch token for chat: ${response.status}`);
    }
    const data = (await response.json()) as { user_id?: string };
    if (!data.user_id) {
      throw new Error("Twitch token validation missing user_id");
    }
    return data.user_id;
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
      this.chatSubscribed = false;
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
      await this.createSubscriptions();
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

    if (type === "notification") {
      const subType = message.metadata.subscription_type;
      if (subType === "channel.channel_points_custom_reward_redemption.add") {
        const event = this.normalizeRedemption(message.payload.event as RawTwitchRedemption | undefined);
        if (!event) return;
        this.emit("redemption", event);
        return;
      }
      if (subType === "channel.chat.message") {
        const event = this.normalizeChat(message.payload.event as RawTwitchChatMessage | undefined);
        if (!event) return;
        this.emit("chat", event);
        return;
      }
    }

    if (type === "revocation") {
      const revoked = message.payload.subscription?.type;
      console.warn("[twitch] Subscription revoked:", message.payload.subscription?.status, revoked);
      if (revoked === "channel.chat.message") {
        this.chatSubscribed = false;
      }
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

  private normalizeChat(event: RawTwitchChatMessage | undefined): TwitchChatMessage | null {
    const text = event?.message?.text;
    if (typeof text !== "string") return null;
    const chatterUserId = event?.chatter_user_id ?? "";
    const chatterUserLogin = event?.chatter_user_login ?? event?.chatter_user_name ?? "";
    if (!chatterUserId && !chatterUserLogin) return null;
    return {
      messageId: event?.message_id ?? "",
      broadcasterUserId: event?.broadcaster_user_id ?? "",
      broadcasterUserLogin: event?.broadcaster_user_login ?? "",
      chatterUserId,
      chatterUserLogin,
      text,
    };
  }

  private async createSubscriptions(): Promise<void> {
    if (!this.sessionId || !this.broadcasterId) {
      throw new Error("Missing EventSub session or broadcaster ID");
    }

    const userToken = await refreshAccessTokenIfNeeded(this.config);
    this.config.twitchAccessToken = userToken;

    await this.createSubscription({
      type: "channel.channel_points_custom_reward_redemption.add",
      version: "1",
      condition: {
        broadcaster_user_id: this.broadcasterId,
      },
    });
    console.log("[twitch] Subscribed to channel point redemptions");

    const chatUserId = this.tokenUserId ?? this.broadcasterId;
    try {
      await this.createSubscription({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: this.broadcasterId,
          user_id: chatUserId,
        },
      });
      this.chatSubscribed = true;
      console.log("[twitch] Subscribed to channel chat messages");
    } catch (error) {
      this.chatSubscribed = false;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        "[twitch] Chat subscription failed (need user:read:chat on token):",
        message,
      );
      this.emit("error", error instanceof Error ? error : new Error(message));
    }
  }

  private async createSubscription(body: {
    type: string;
    version: string;
    condition: Record<string, string>;
  }): Promise<void> {
    if (!this.sessionId) {
      throw new Error("Missing EventSub session");
    }

    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.twitchAccessToken}`,
        "Client-Id": this.config.twitchClientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        transport: {
          method: "websocket",
          session_id: this.sessionId,
        },
      }),
    });

    if (!response.ok) {
      const respBody = await response.text();
      throw new Error(`Failed to create EventSub subscription (${body.type}): ${response.status} ${respBody}`);
    }
  }
}
