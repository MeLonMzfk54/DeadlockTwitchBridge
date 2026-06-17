import { createToggleEffect } from "./types.js";

export const hudHideEffect = createToggleEffect(
  "hud_hide",
  "Скрыть HUD",
  true,
  45,
  { name: "citadel_hud_visible", onValue: false, offValue: true },
);
