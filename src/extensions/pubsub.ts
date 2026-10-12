import { signExtensionJwt } from "./jwt.js";

export interface ExtPubSubConfig {
  extensionClientId: string;
  extensionSecret: string;
  ownerUserId: string;
  broadcasterId: string;
}

const PUBSUB_URL = "https://api.twitch.tv/helix/extensions/pubsub";

/**
 * Broadcast a message to all Extension instances on a channel.
 * Rate limit: 1 msg/sec/channel, 5 KB. Caller must throttle.
 */
export async function sendExtensionPubSub(
  config: ExtPubSubConfig,
  message: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!config.extensionClientId || !config.extensionSecret || !config.broadcasterId) {
    return { ok: false, error: "extension pubsub not configured" };
  }
  if (Buffer.byteLength(message, "utf8") > 5 * 1024) {
    return { ok: false, error: "message exceeds 5KB PubSub limit" };
  }
  const token = signExtensionJwt(config.extensionSecret, {
    user_id: config.ownerUserId || config.broadcasterId,
    role: "external",
    channel_id: config.broadcasterId,
    expSec: 30,
  });
  try {
    const res = await fetch(PUBSUB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": config.extensionClientId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        target: ["broadcast"],
        broadcaster_id: config.broadcasterId,
        is_global_broadcast: false,
        message,
      }),
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 200) || `http_${res.status}`,
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return { ok: false, error: messageText };
  }
}

/** Throttle broadcasts to ≤1/sec per channel. */
export class ExtPubSubThrottle {
  private lastSentAt = 0;
  private pending: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastErrorAt = 0;

  constructor(
    private readonly getConfig: () => ExtPubSubConfig | null,
    private readonly minIntervalMs = 1000,
  ) {}

  /** Queue latest message; flush at most once per second. */
  publish(message: string): void {
    this.pending = message;
    const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastSentAt));
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    const message = this.pending;
    this.pending = null;
    if (!message) return;
    const config = this.getConfig();
    if (!config) return;
    this.lastSentAt = Date.now();
    const result = await sendExtensionPubSub(config, message);
    if (!result.ok && Date.now() - this.lastErrorAt > 30_000) {
      this.lastErrorAt = Date.now();
      console.warn(`[ext] PubSub failed: ${result.error ?? "unknown"}`);
    }
    if (this.pending) {
      const wait = this.minIntervalMs;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, wait);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }
}
