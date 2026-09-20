/**
 * Pure chat → shop-vote option parsing.
 * Accepts optional `!` prefix by default; set requireBangPrefix to require it.
 */

export type ShopChatVoteStage = "voting_category" | "voting_tier";

export interface ParseShopChatOptions {
  /** When true, message must start with `!` or it is not a vote. */
  requireBangPrefix?: boolean;
}

const CATEGORY_ALIASES: Record<string, "weapon" | "vitality" | "spirit"> = {
  weapon: "weapon",
  w: "weapon",
  vitality: "vitality",
  armor: "vitality",
  v: "vitality",
  spirit: "spirit",
  tech: "spirit",
  s: "spirit",
};

const TIER_ALIASES: Record<string, "1" | "2" | "3" | "4"> = {
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  t1: "1",
  t2: "2",
  t3: "3",
  t4: "4",
};

/**
 * Strip optional/required `!` and return the first token, lowercased.
 * Returns null when empty or when bang is required but missing.
 */
export function normalizeShopChatToken(
  text: string,
  options: ParseShopChatOptions = {},
): string | null {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (!s) return null;
  const hasBang = s.startsWith("!");
  if (options.requireBangPrefix && !hasBang) return null;
  if (hasBang) s = s.slice(1).trim();
  if (!s) return null;
  const token = s.split(/\s+/)[0]?.toLowerCase() ?? "";
  return token || null;
}

export function parseCategoryChatVote(
  text: string,
  options: ParseShopChatOptions = {},
): "weapon" | "vitality" | "spirit" | null {
  const token = normalizeShopChatToken(text, options);
  if (!token) return null;
  return CATEGORY_ALIASES[token] ?? null;
}

export function parseTierChatVote(
  text: string,
  options: ParseShopChatOptions = {},
): "1" | "2" | "3" | "4" | null {
  const token = normalizeShopChatToken(text, options);
  if (!token) return null;
  return TIER_ALIASES[token] ?? null;
}

/**
 * Parse a chat message for the current vote stage.
 * Returns the option string for `ShopVoteController.cast`, or null if not a vote.
 */
export function parseShopChatVote(
  text: string,
  stage: string,
  options: ParseShopChatOptions = {},
): string | null {
  if (stage === "voting_category") return parseCategoryChatVote(text, options);
  if (stage === "voting_tier") return parseTierChatVote(text, options);
  return null;
}
