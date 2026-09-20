import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeShopChatToken,
  parseCategoryChatVote,
  parseShopChatVote,
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
});

describe("parseTierChatVote", () => {
  it("accepts 1-4 and t1-t4", () => {
    assert.equal(parseTierChatVote("1"), "1");
    assert.equal(parseTierChatVote("!4"), "4");
    assert.equal(parseTierChatVote("t1"), "1");
    assert.equal(parseTierChatVote("T3"), "3");
    assert.equal(parseTierChatVote("!t4 now"), "4");
  });

  it("ignores category words and other chat", () => {
    assert.equal(parseTierChatVote("weapon"), null);
    assert.equal(parseTierChatVote("w"), null);
    assert.equal(parseTierChatVote("5"), null);
    assert.equal(parseTierChatVote("t5"), null);
    assert.equal(parseTierChatVote("hello"), null);
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

  it("honors requireBangPrefix", () => {
    assert.equal(parseShopChatVote("w", "voting_category", { requireBangPrefix: true }), null);
    assert.equal(parseShopChatVote("!w", "voting_category", { requireBangPrefix: true }), "weapon");
    assert.equal(parseShopChatVote("1", "voting_tier", { requireBangPrefix: true }), null);
    assert.equal(parseShopChatVote("!1", "voting_tier", { requireBangPrefix: true }), "1");
  });
});
