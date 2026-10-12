import { createHmac, timingSafeEqual } from "node:crypto";

export interface ExtensionJwtPayload {
  exp: number;
  opaque_user_id?: string;
  user_id?: string;
  channel_id?: string;
  role?: string;
  is_unlinked?: boolean;
  pubsub_perms?: {
    listen?: string[];
    send?: string[];
  };
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Verify a Twitch Extension Helper JWT (HS256, secret is base64). */
export function verifyExtensionJwt(
  token: string,
  secretBase64: string,
): ExtensionJwtPayload | null {
  if (!token || !secretBase64) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let secret: Buffer;
  try {
    secret = Buffer.from(secretBase64, "base64");
  } catch {
    return null;
  }
  if (!secret.length) return null;

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  let payload: ExtensionJwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as ExtensionJwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return null;
  }
  return payload;
}

/** Sign an EBS JWT for Helix Extension endpoints (role: external). */
export function signExtensionJwt(
  secretBase64: string,
  payload: { user_id: string; role?: string; channel_id?: string; expSec?: number },
): string {
  const secret = Buffer.from(secretBase64, "base64");
  const header = b64urlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8"));
  const body = {
    exp: Math.floor(Date.now() / 1000) + (payload.expSec ?? 60),
    user_id: payload.user_id,
    role: payload.role ?? "external",
    ...(payload.channel_id ? { channel_id: payload.channel_id } : {}),
    pubsub_perms: { send: ["broadcast"] },
  };
  const payloadEnc = b64urlEncode(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64urlEncode(
    createHmac("sha256", secret).update(`${header}.${payloadEnc}`).digest(),
  );
  return `${header}.${payloadEnc}.${sig}`;
}

/** Stable viewer id for last-vote-wins: opaque U-… preferred, else user_id, else anonymous. */
export function extensionVoterId(payload: ExtensionJwtPayload): string {
  if (payload.opaque_user_id && String(payload.opaque_user_id).trim()) {
    return String(payload.opaque_user_id).trim();
  }
  if (payload.user_id && String(payload.user_id).trim()) {
    return `twitch:${String(payload.user_id).trim()}`;
  }
  return `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}
