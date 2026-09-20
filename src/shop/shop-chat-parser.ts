/**
 * Pure chat → shop-vote option parsing.
 * Accepts optional `!` prefix by default; set requireBangPrefix to require it.
 */

export type ShopChatVoteStage = "voting_category" | "voting_tier" | "voting_combined";

export type ShopChatCategory = "weapon" | "vitality" | "spirit";
export type ShopChatTier = "1" | "2" | "3" | "4";

export interface ParseShopChatOptions {
  /** When true, message must start with `!` or it is not a vote. */
  requireBangPrefix?: boolean;
}

export interface ParsedShopChatVotes {
  category?: ShopChatCategory;
  tier?: ShopChatTier;
}

const CATEGORY_ALIASES: Record<string, ShopChatCategory> = {
  weapon: "weapon",
  w: "weapon",
  vitality: "vitality",
  armor: "vitality",
  v: "vitality",
  spirit: "spirit",
  tech: "spirit",
  s: "spirit",
};

const TIER_ALIASES: Record<string, ShopChatTier> = {
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

/** Strip a leading `!` from a single whitespace token and lowercase. */
function stripTokenBang(raw: string): string {
  let t = raw.trim().toLowerCase();
  if (t.startsWith("!")) t = t.slice(1);
  return t;
}

/**
 * Parse all whitespace-separated tokens for category and/or tier.
 * First valid category and first valid tier win; order of words does not matter.
 * When requireBangPrefix is set, the message itself must start with `!`.
 */
export function parseShopChatVotes(
  text: string,
  options: ParseShopChatOptions = {},
): ParsedShopChatVotes | null {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (!s) return null;
  const hasBang = s.startsWith("!");
  if (options.requireBangPrefix && !hasBang) return null;

  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  let category: ShopChatCategory | undefined;
  let tier: ShopChatTier | undefined;

  for (const part of parts) {
    const token = stripTokenBang(part);
    if (!token) continue;
    if (!category && CATEGORY_ALIASES[token]) {
      category = CATEGORY_ALIASES[token];
      continue;
    }
    if (!tier && TIER_ALIASES[token]) {
      tier = TIER_ALIASES[token];
    }
  }

  if (!category && !tier) return null;
  const out: ParsedShopChatVotes = {};
  if (category) out.category = category;
  if (tier) out.tier = tier;
  return out;
}

export function parseCategoryChatVote(
  text: string,
  options: ParseShopChatOptions = {},
): ShopChatCategory | null {
  const multi = parseShopChatVotes(text, options);
  return multi?.category ?? null;
}

export function parseTierChatVote(
  text: string,
  options: ParseShopChatOptions = {},
): ShopChatTier | null {
  const multi = parseShopChatVotes(text, options);
  return multi?.tier ?? null;
}

/**
 * Parse a chat message for the current vote stage.
 * Returns the option string for `ShopVoteController.cast`, or null if not a vote.
 * For `voting_combined`, prefer `parseShopChatVotes` (may return both axes).
 */
export function parseShopChatVote(
  text: string,
  stage: string,
  options: ParseShopChatOptions = {},
): string | null {
  if (stage === "voting_category") return parseCategoryChatVote(text, options);
  if (stage === "voting_tier") return parseTierChatVote(text, options);
  if (stage === "voting_combined") {
    const multi = parseShopChatVotes(text, options);
    // Prefer category if only one string is needed; callers should use parseShopChatVotes.
    return multi?.category ?? multi?.tier ?? null;
  }
  return null;
}
