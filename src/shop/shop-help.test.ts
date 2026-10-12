import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeHelpClassName } from "./shop-help.js";

test("sanitizeHelpClassName accepts mod ids only", () => {
  assert.equal(sanitizeHelpClassName("reinforcingCasings"), "reinforcingCasings");
  assert.equal(sanitizeHelpClassName("upgrade_stamina"), "upgrade_stamina");
  assert.equal(sanitizeHelpClassName("0"), null);
  assert.equal(sanitizeHelpClassName("../evil"), null);
  assert.equal(sanitizeHelpClassName("item name"), null);
});
