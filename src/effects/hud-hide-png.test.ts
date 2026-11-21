import assert from "node:assert/strict";
import test from "node:test";
import {
  beginHudHide,
  endHudHide,
  getHudHidePng,
  getHudHideState,
  HUD_HIDE_LEVEL_MAX,
  hudHideLevels,
} from "./hud-hide-png.js";
import { decodeLevel, encodeLevel, PNG_BASE, PNG_STEP } from "../shop/shop-vote-png.js";

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("hud hide png encodes seq as width only", () => {
  endHudHide();
  assert.deepEqual(hudHideLevels(), { w: 0, h: 0 });

  const first = beginHudHide();
  assert.equal(first.seq, 1);
  assert.deepEqual(hudHideLevels(first), { w: 1, h: 0 });

  const second = beginHudHide();
  assert.equal(second.seq, 2);
  assert.deepEqual(hudHideLevels(second), { w: 2, h: 0 });

  const size = pngSize(getHudHidePng(second));
  assert.equal(size.w, second.seq * PNG_STEP + PNG_BASE);
  assert.equal(size.h, PNG_BASE);
  assert.equal(decodeLevel(size.w, 1, HUD_HIDE_LEVEL_MAX), second.seq);
  assert.equal(decodeLevel(size.h, 1, HUD_HIDE_LEVEL_MAX), 0);
  assert.equal(size.w, encodeLevel(second.seq, HUD_HIDE_LEVEL_MAX));
  assert.equal(size.h, encodeLevel(0, HUD_HIDE_LEVEL_MAX));

  assert.deepEqual(hudHideLevels({ seq: 0 }), { w: 0, h: 0 });
  assert.deepEqual(hudHideLevels({ seq: 50 }), { w: 50, h: 0 });

  endHudHide();
  for (let i = 0; i < HUD_HIDE_LEVEL_MAX; i++) beginHudHide();
  assert.equal(getHudHideState().seq, HUD_HIDE_LEVEL_MAX);
  assert.equal(beginHudHide().seq, 1);

  const off = endHudHide();
  assert.equal(off.seq, 0);
  assert.deepEqual(hudHideLevels(off), { w: 0, h: 0 });
  const offSize = pngSize(getHudHidePng());
  assert.equal(decodeLevel(offSize.w, 1, HUD_HIDE_LEVEL_MAX), 0);
  assert.equal(decodeLevel(offSize.h, 1, HUD_HIDE_LEVEL_MAX), 0);
});
