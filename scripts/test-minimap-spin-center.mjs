#!/usr/bin/env node
/**
 * Smoke test for minimap_spin_center bridge effect (HTTP API).
 * Requires bridge running: npm run dev
 *
 * Usage: node scripts/test-minimap-spin-center.mjs [baseUrl]
 */

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3920";

async function request(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return body;
}

async function main() {
  console.log(`Bridge: ${baseUrl}`);

  const status = await request("/api/status");
  console.log("Status:", {
    gameCommandMode: status.gameCommandMode,
    gameReady: status.gameReady,
  });

  const result = await request("/api/test-effect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      effectId: "minimap_spin_center",
      durationSec: 10,
      params: { size: 900, spinDegPerSec: 45, opacity: 0.85 },
    }),
  });
  console.log("Test effect:", result);

  console.log("\nIn-game checklist:");
  console.log("  1. F7: [twitch_minimap_fx] loaded");
  console.log("  2. F7: [twitch_minimap_fx] effect active ...");
  console.log("  3. Minimap enlarged, centered, spinning");
  console.log("  4. After ~10s: [twitch_minimap_fx] effect reverted");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
