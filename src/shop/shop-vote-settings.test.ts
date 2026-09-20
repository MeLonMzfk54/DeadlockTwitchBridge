import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_CHAT_ANNOUNCE_CATEGORY,
  defaultShopVoteSettings,
  enabledTiersFromSettings,
  formatShopChatAnnounce,
  loadShopVoteSettings,
  mergeShopVoteSettings,
  saveShopVoteSettings,
  TWITCH_CHAT_MESSAGE_MAX_LEN,
} from "./shop-vote-settings.js";

describe("mergeShopVoteSettings", () => {
  it("merges durations and clamps tier range", () => {
    const base = defaultShopVoteSettings();
    const next = mergeShopVoteSettings(base, {
      categoryDurationMs: 30_000,
      minTier: 3,
      maxTier: 2,
      enabledCategories: ["spirit", "weapon", "bogus"],
      requireBangPrefix: true,
      applyDelayMs: 0,
      overlayHoldMs: 12_000,
      allowHudStart: false,
      hudCanRestart: false,
      chatAnnounceEnabled: false,
      chatAnnounceCategory: "Custom cat {options}",
      chatAnnounceTier: "",
    });
    assert.equal(next.categoryDurationMs, 30_000);
    assert.equal(next.minTier, 2);
    assert.equal(next.maxTier, 3);
    assert.deepEqual(next.enabledCategories, ["spirit", "weapon"]);
    assert.equal(next.requireBangPrefix, true);
    assert.equal(next.applyDelayMs, 0);
    assert.equal(next.overlayHoldMs, 12_000);
    assert.equal(next.allowHudStart, false);
    assert.equal(next.hudCanRestart, false);
    assert.equal(next.chatAnnounceEnabled, false);
    assert.equal(next.chatAnnounceCategory, "Custom cat {options}");
    assert.equal(next.chatAnnounceTier, "");
  });

  it("keeps at least one category when array empty", () => {
    const base = defaultShopVoteSettings();
    const next = mergeShopVoteSettings(base, { enabledCategories: [] });
    assert.deepEqual(next.enabledCategories, ["weapon", "vitality", "spirit"]);
  });

  it("defaults include chat announce templates", () => {
    const d = defaultShopVoteSettings();
    assert.equal(d.chatAnnounceEnabled, true);
    assert.equal(d.chatAnnounceCategory, DEFAULT_CHAT_ANNOUNCE_CATEGORY);
    assert.ok(d.chatAnnounceTier.includes("{category}"));
  });
});

describe("enabledTiersFromSettings", () => {
  it("returns inclusive range", () => {
    assert.deepEqual(enabledTiersFromSettings({ minTier: 2, maxTier: 4 }), [2, 3, 4]);
    assert.deepEqual(enabledTiersFromSettings({ minTier: 1, maxTier: 1 }), [1]);
  });
});

describe("formatShopChatAnnounce", () => {
  it("formats category announce with long names when bang not required", () => {
    const settings = defaultShopVoteSettings({ categoryDurationMs: 25_000 });
    const msg = formatShopChatAnnounce({ stage: "voting_category", settings });
    assert.ok(msg);
    assert.match(msg!, /weapon \/ vitality \/ spirit/);
    assert.match(msg!, /25 сек/);
  });

  it("formats category with short bang aliases", () => {
    const settings = defaultShopVoteSettings();
    settings.requireBangPrefix = true;
    settings.enabledCategories = ["weapon", "spirit"];
    const msg = formatShopChatAnnounce({ stage: "voting_category", settings });
    assert.equal(msg, "Голосование началось! Категория магазина — пишите в чат: !w / !s. 25 сек.");
  });

  it("formats tier announce with category and tier options", () => {
    const settings = defaultShopVoteSettings({ tierDurationMs: 30_000 });
    settings.minTier = 2;
    settings.maxTier = 3;
    const msg = formatShopChatAnnounce({
      stage: "voting_tier",
      settings,
      category: "vitality",
    });
    assert.ok(msg);
    assert.match(msg!, /Vitality/);
    assert.match(msg!, /2 \/ 3/);
    assert.match(msg!, /30 сек/);
  });

  it("returns null when disabled or empty template", () => {
    const settings = defaultShopVoteSettings();
    settings.chatAnnounceEnabled = false;
    assert.equal(
      formatShopChatAnnounce({ stage: "voting_category", settings }),
      null,
    );
    settings.chatAnnounceEnabled = true;
    settings.chatAnnounceCategory = "   ";
    assert.equal(
      formatShopChatAnnounce({ stage: "voting_category", settings }),
      null,
    );
  });

  it("truncates to Twitch max length", () => {
    const settings = defaultShopVoteSettings();
    settings.chatAnnounceCategory = "x".repeat(600) + " {options}";
    const msg = formatShopChatAnnounce({ stage: "voting_category", settings });
    assert.ok(msg);
    assert.equal(msg!.length, TWITCH_CHAT_MESSAGE_MAX_LEN);
  });
});

describe("load/save shop-vote settings", () => {
  it("round-trips through a temp JSON file", () => {
    const dir = mkdtempSync(join(tmpdir(), "shop-vote-settings-"));
    const path = join(dir, "shop-vote.json");
    try {
      const settings = defaultShopVoteSettings({ categoryDurationMs: 11_000 });
      settings.autoStart = true;
      settings.defaultStartMode = "tier";
      settings.minTier = 2;
      settings.chatAnnounceCategory = "Hello {options}";
      saveShopVoteSettings(settings, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(raw.autoStart, true);
      assert.equal(raw.defaultStartMode, "tier");
      assert.equal(raw.chatAnnounceCategory, "Hello {options}");

      const loaded = loadShopVoteSettings({ categoryDurationMs: 99_000 }, { path });
      assert.equal(loaded.autoStart, true);
      assert.equal(loaded.defaultStartMode, "tier");
      assert.equal(loaded.categoryDurationMs, 11_000);
      assert.equal(loaded.minTier, 2);
      assert.equal(loaded.chatAnnounceCategory, "Hello {options}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createIfMissing writes defaults when file absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "shop-vote-settings-"));
    const path = join(dir, "missing.json");
    try {
      const loaded = loadShopVoteSettings(
        { categoryDurationMs: 15_000 },
        { createIfMissing: true, path },
      );
      assert.equal(loaded.categoryDurationMs, 15_000);
      const again = loadShopVoteSettings({}, { path });
      assert.equal(again.categoryDurationMs, 15_000);
      assert.equal(again.chatAnnounceEnabled, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
