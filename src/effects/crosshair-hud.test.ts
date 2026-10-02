import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCrosshairChaos,
  CROSSHAIR_COLOR_COUNT,
  CROSSHAIR_LEVEL_MAX,
  CROSSHAIR_SHAPE_COUNT,
  crosshairHudLevels,
  endCrosshairChaos,
  getCrosshairHudPng,
  getCrosshairHudState,
  packCrosshairHeight,
} from "./crosshair-hud.js";
import { decodeLevel, encodeLevel, PNG_BASE, PNG_STEP } from "../shop/shop-vote-png.js";

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("crosshair hud png encodes seq and packed shape plus color", () => {
  endCrosshairChaos();
  assert.deepEqual(crosshairHudLevels(), { w: 0, h: 0 });

  const first = beginCrosshairChaos();
  assert.equal(first.seq, 1);
  assert.ok(first.shapeIndex >= 0 && first.shapeIndex < CROSSHAIR_SHAPE_COUNT);
  assert.ok(first.colorIndex >= 0 && first.colorIndex < CROSSHAIR_COLOR_COUNT);
  assert.equal(
    crosshairHudLevels(first).h,
    first.shapeIndex * CROSSHAIR_COLOR_COUNT + first.colorIndex,
  );

  const second = beginCrosshairChaos();
  assert.equal(second.seq, 2);
  const packed = packCrosshairHeight(second.shapeIndex, second.colorIndex);
  assert.deepEqual(crosshairHudLevels(second), { w: 2, h: packed });
  assert.ok(packed <= CROSSHAIR_SHAPE_COUNT * CROSSHAIR_COLOR_COUNT - 1);

  const size = pngSize(getCrosshairHudPng(second));
  assert.equal(size.w, second.seq * PNG_STEP + PNG_BASE);
  assert.equal(size.h, packed * PNG_STEP + PNG_BASE);
  assert.equal(decodeLevel(size.w, 1, CROSSHAIR_LEVEL_MAX), second.seq);
  assert.equal(decodeLevel(size.h, 1, CROSSHAIR_LEVEL_MAX), packed);
  assert.equal(size.w, encodeLevel(second.seq, CROSSHAIR_LEVEL_MAX));
  assert.equal(size.h, encodeLevel(packed, CROSSHAIR_LEVEL_MAX));

  const stick = crosshairHudLevels({ seq: 3, shapeIndex: 1, colorIndex: 7 });
  assert.deepEqual(stick, { w: 3, h: 27 });
  const cross = crosshairHudLevels({ seq: 4, shapeIndex: 2, colorIndex: 19 });
  assert.deepEqual(cross, { w: 4, h: 59 });
  assert.deepEqual(
    crosshairHudLevels({ seq: 0, shapeIndex: 2, colorIndex: 19 }),
    { w: 0, h: 0 },
  );

  endCrosshairChaos();
  for (let i = 0; i < CROSSHAIR_LEVEL_MAX; i++) beginCrosshairChaos();
  assert.equal(getCrosshairHudState().seq, CROSSHAIR_LEVEL_MAX);
  assert.equal(beginCrosshairChaos().seq, 1);

  const off = endCrosshairChaos();
  assert.equal(off.seq, 0);
  assert.deepEqual(crosshairHudLevels(off), { w: 0, h: 0 });
  const offSize = pngSize(getCrosshairHudPng());
  assert.equal(decodeLevel(offSize.w, 1, CROSSHAIR_LEVEL_MAX), 0);
  assert.equal(decodeLevel(offSize.h, 1, CROSSHAIR_LEVEL_MAX), 0);
});
