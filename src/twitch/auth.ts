import type { AppConfig } from "../types.js";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface ValidateResponse {
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[];
}

export async function resolveBroadcasterId(config: AppConfig): Promise<string> {
  if (config.twitchBroadcasterId) {
    return config.twitchBroadcasterId;
  }

  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${config.twitchAccessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to validate Twitch token: ${response.status}`);
  }

  const data = (await response.json()) as ValidateResponse;
  return data.user_id;
}

export async function refreshAccessTokenIfNeeded(config: AppConfig): Promise<string> {
  const validate = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${config.twitchAccessToken}` },
  });

  if (validate.ok) {
    return config.twitchAccessToken;
  }

  if (!config.twitchRefreshToken || !config.twitchClientId || !config.twitchClientSecret) {
    throw new Error("Twitch access token expired and refresh credentials are missing");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.twitchRefreshToken,
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
  });

  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Twitch token: ${response.status}`);
  }

  const data = (await response.json()) as TokenResponse;
  config.twitchAccessToken = data.access_token;
  if (data.refresh_token) {
    config.twitchRefreshToken = data.refresh_token;
  }
  return data.access_token;
}

export async function getAppAccessToken(config: AppConfig): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    grant_type: "client_credentials",
  });

  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to get app access token: ${response.status}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}
