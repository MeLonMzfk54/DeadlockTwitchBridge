import { createToggleEffect } from "./types.js";

function getRandomArbitrary(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export const randomSensitivityEffect = createToggleEffect(
  "random_sensitivity",
  "Рандомная чувствительность",
  true,
  true,
  30,
  { name: "sensitivity", onValue: getRandomArbitrary(0.5, 10), offValue: 1.55 },
);
