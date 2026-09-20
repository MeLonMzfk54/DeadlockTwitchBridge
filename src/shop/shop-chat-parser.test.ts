import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeShopChatToken,
  parseCategoryChatVote,
  parseShopChatVote,
  parseShopChatVotes,
  parseTierChatVote,
} from "./shop-chat-parser.js";

describe("normalizeShopChatToken", () => {
  it("strips ! and returns first token lowercased", () => {
    assert.equal(normalizeShopChatToken("  !Weapon  "), "weapon");
    assert.equal(normalizeShopChatToken("!t2 please"), "t2");
    assert.equal(normalizeShopChatToken("vitality"), "vitality");
  });

  it("returns null for empty / whitespace", () => {
    assert.equal(normalizeShopChatToken(""), null);
    assert.equal(normalizeShopChatToken("   "), null);
    assert.equal(normalizeShopChatToken("!"), null);
    assert.equal(normalizeShopChatToken("!  "), null);
  });

  it("requireBangPrefix rejects messages without !", () => {
    assert.equal(normalizeShopChatToken("w", { requireBangPrefix: true }), null);
    assert.equal(normalizeShopChatToken("!w", { requireBangPrefix: true }), "w");
    assert.equal(normalizeShopChatToken("weapon", { requireBangPrefix: true }), null);
  });
});

describe("parseCategoryChatVote", () => {
  it("accepts full names and short aliases", () => {
    assert.equal(parseCategoryChatVote("weapon"), "weapon");
    assert.equal(parseCategoryChatVote("!W"), "weapon");
    assert.equal(parseCategoryChatVote("vitality"), "vitality");
    assert.equal(parseCategoryChatVote("armor"), "vitality");
    assert.equal(parseCategoryChatVote("v"), "vitality");
    assert.equal(parseCategoryChatVote("spirit"), "spirit");
    assert.equal(parseCategoryChatVote("tech"), "spirit");
    assert.equal(parseCategoryChatVote("!s"), "spirit");
  });

  it("ignores unrelated chat", () => {
    assert.equal(parseCategoryChatVote("hello"), null);
    assert.equal(parseCategoryChatVote("1"), null);
    assert.equal(parseCategoryChatVote("t2"), null);
    assert.equal(parseCategoryChatVote("!pog"), null);
  });

  it("picks category from multi-token messages", () => {
    assert.equal(parseCategoryChatVote("!w 1"), "weapon");
    assert.equal(parseCategoryChatVote("1 w"), "weapon");
  });
});

describe("parseTierChatVote", () => {
  it("accepts 1-4 and t1-t4", () => {
    assert.equal(parseTierChatVote("1"), "1");
    assert.equal(parseTierChatVote("!4"), "4");
    assert.equal(parseTierChatVote("t1"), "1");
    assert.equal(parseTierChatVote("T3"), "3");
    assert.equal(parseTierChatVote("!t4 now"), "4");
  });

  it("ignores category-only and other chat", () => {
    assert.equal(parseTierChatVote("weapon"), null);
    assert.equal(parseTierChatVote("w"), null);
    assert.equal(parseTierChatVote("5"), null);
    assert.equal(parseTierChatVote("t5"), null);
    assert.equal(parseTierChatVote("hello"), null);
  });

  it("picks tier from multi-token messages", () => {
    assert.equal(parseTierChatVote("!w 1"), "1");
    assert.equal(parseTierChatVote("w !t2"), "2");
  });
});

describe("parseShopChatVotes", () => {
  it("parses combined !w 1 and !w !1", () => {
    assert.deepEqual(parseShopChatVotes("!w 1"), { category: "weapon", tier: "1" });
    assert.deepEqual(parseShopChatVotes("!w !1"), { category: "weapon", tier: "1" });
    assert.deepEqual(parseShopChatVotes("w 1"), { category: "weapon", tier: "1" });
  });

  it("accepts either order", () => {
    assert.deepEqual(parseShopChatVotes("!1 !w"), { category: "weapon", tier: "1" });
    assert.deepEqual(parseShopChatVotes("t2 vitality"), { category: "vitality", tier: "2" });
  });

  it("accepts category-only or tier-only", () => {
    assert.deepEqual(parseShopChatVotes("!w"), { category: "weapon" });
    assert.deepEqual(parseShopChatVotes("weapon"), { category: "weapon" });
    assert.deepEqual(parseShopChatVotes("!1"), { tier: "1" });
    assert.deepEqual(parseShopChatVotes("t3"), { tier: "3" });
  });

  it("takes first valid category and first valid tier", () => {
    assert.deepEqual(parseShopChatVotes("!w !v 2 3"), { category: "weapon", tier: "2" });
  });

  it("returns null for unrelated chat", () => {
    assert.equal(parseShopChatVotes("hello"), null);
    assert.equal(parseShopChatVotes("!pog"), null);
    assert.equal(parseShopChatVotes(""), null);
  });

  it("honors requireBangPrefix on the message", () => {
    assert.equal(parseShopChatVotes("w 1", { requireBangPrefix: true }), null);
    assert.deepEqual(parseShopChatVotes("!w 1", { requireBangPrefix: true }), {
      category: "weapon",
      tier: "1",
    });
    assert.deepEqual(parseShopChatVotes("!w !1", { requireBangPrefix: true }), {
      category: "weapon",
      tier: "1",
    });
  });
});

describe("parseShopChatVote", () => {
  it("routes by stage", () => {
    assert.equal(parseShopChatVote("w", "voting_category"), "weapon");
    assert.equal(parseShopChatVote("w", "voting_tier"), null);
    assert.equal(parseShopChatVote("2", "voting_tier"), "2");
    assert.equal(parseShopChatVote("2", "voting_category"), null);
    assert.equal(parseShopChatVote("weapon", "idle"), null);
    assert.equal(parseShopChatVote("weapon", "applying"), null);
  });

  it("on voting_combined returns category preferentially", () => {
    assert.equal(parseShopChatVote("!w 1", "voting_combined"), "weapon");
    assert.equal(parseShopChatVote("!2", "voting_combined"), "2");
  });

  it("honors requireBangPrefix", () => {
    assert.equal(parseShopChatVote("w", "voting_category", { requireBangPrefix: true }), null);
    assert.equal(parseShopChatVote("!w", "voting_category", { requireBangPrefix: true }), "weapon");
    assert.equal(parseShopChatVote("1", "voting_tier", { requireBangPrefix: true }), null);
    assert.equal(parseShopChatVote("!1", "voting_tier", { requireBangPrefix: true }), "1");
  });
});
