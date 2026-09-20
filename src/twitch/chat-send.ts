import type { AppConfig } from "../types.js";
import { refreshAccessTokenIfNeeded, resolveBroadcasterId } from "./auth.js";
import { TWITCH_CHAT_MESSAGE_MAX_LEN } from "../shop/shop-vote-settings.js";

export interface SendTwitchChatResult {
  ok: boolean;
  status?: number;
  messageId?: string;
  error?: string;
}

async function resolveSenderUserId(accessToken: string): Promise<string> {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to validate Twitch token: ${response.status}`);
  }
  const data = (await response.json()) as { user_id?: string; scopes?: string[] };
  if (!data.user_id) {
    throw new Error("Twitch token validation missing user_id");
  }
  return data.user_id;
}

/**
 * Send a chat message as the user who owns TWITCH_ACCESS_TOKEN (Helix Send Chat Message).
 * Requires scope `user:write:chat` on that token.
 */
export async function sendTwitchChatMessage(
  config: AppConfig,
  message: string,
): Promise<SendTwitchChatResult> {
  const text = String(message ?? "").trim().slice(0, TWITCH_CHAT_MESSAGE_MAX_LEN);
  if (!text) {
    return { ok: false, error: "empty message" };
  }

  try {
    const token = await refreshAccessTokenIfNeeded(config);
    config.twitchAccessToken = token;
    const broadcasterId = await resolveBroadcasterId(config);
    const senderId = await resolveSenderUserId(token);

    const response = await fetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": config.twitchClientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message: text,
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { message?: string; error?: string };
        detail = body.message || body.error || "";
      } catch {
        detail = await response.text().catch(() => "");
      }
      const error =
        detail ||
        (response.status === 403
          ? "forbidden (need user:write:chat scope?)"
          : `HTTP ${response.status}`);
      return { ok: false, status: response.status, error };
    }

    const body = (await response.json()) as {
      data?: Array<{ message_id?: string }>;
    };
    return {
      ok: true,
      status: response.status,
      messageId: body.data?.[0]?.message_id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
