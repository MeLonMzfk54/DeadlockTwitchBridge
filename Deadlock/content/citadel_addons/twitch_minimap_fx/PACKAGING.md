# twitch_minimap_fx — упаковка VPK

## Рекомендуемый способ (совместим с QoLLock)

Как [DeadlockShock](https://github.com/VolcanoCookies/DeadlockShock): **не** подменять весь `hud.xml`, а повесить скрипты на маленькие layout'ы.

```bash
npm run patch-top-bar-xml
```

VPK (один аддон, два layout — разные пути, конфликта нет):

```
panorama/layout/citadel_hud_top_bar.xml      ← stock + twitch_bridge_events.js
panorama/layout/citadel_hud_hero_shop.xml    ← Random Shop + twitch_bridge_shop.js
panorama/scripts/twitch_bridge_events.js
panorama/scripts/twitch_bridge_shop.js
panorama/scripts/random_shop.js
panorama/styles/random_shop.css
panorama/styles/custom_icons.css
addoninfo.txt
```

**Не клади** в этот VPK `panorama/layout/hud.xml`.

Тогда:

| Мод | Что override | Результат |
|-----|----------------|-----------|
| QoLLock | полный `hud.xml` | QoL UI жив |
| наш bridge | `citadel_hud_top_bar.xml` + `citadel_hud_hero_shop.xml` | телеметрия + Random Shop vote |
| оба | разные файлы | **работают вместе** |

### Конфликт с pak21 / top-bar модами

Твой `pak21_dir.vpk` уже трогает:

- `citadel_hud_top_bar`
- `citadel_hud_top_bar_player`
- `hud_paused`
- …

Два мода с одним и тем же `citadel_hud_top_bar.xml` → победит один (меньший `pak##`).

Варианты:

1. Выключить pak21 / top-bar пак, оставить QoLLock + наш VPK.
2. Вшить наши include **в** top_bar из pak21:
   ```bash
   node scripts/patch-top-bar-xml.mjs "path/to/extracted/citadel_hud_top_bar.xml" --in-place
   ```
   и пересобрать pak21; наш VPK тогда только со скриптами (без layout).

### Конфликт с отдельным Random Shop (pak02)

Если в `addons/` лежит чужой `pak02_dir.vpk` с `citadel_hud_hero_shop.xml` — **выключи его**.  
Наш VPK уже содержит Random Shop + `twitch_bridge_shop.js`. Два override одного layout → победит меньший `pakNN`, и голосование/безопасная покупка не заработают.

**Обязательно один VPK** `twitch_minimap_fx` с обоими layout:

| Файл | Назначение |
|------|------------|
| `citadel_hud_top_bar.xml` | телеметрия (`twitch_bridge_events.js`) |
| `citadel_hud_hero_shop.xml` | Random Shop + `twitch_bridge_shop.js` (без `id` на root — компилятор запрещает) |
| `random_shop.js` | ролл + безопасная покупка (background → UI fallback) |
| `twitch_bridge_shop.js` | PNG HUD + PNG cmd apply, cfg-poll backup, HUD Start/Skip, `shop_open`/`shop_closed` (mod **1.9.0**) |

После голосования покупка может пройти без открытия UI (семантический `CitadelShopPurchaseMod`), когда игрок в зоне магазина. Повторные клики по owned-панели отключены — иначе buy/sell цикл.

## Запасной способ — полный hud.xml

Только если top_bar не подходит:

```bash
npm run patch-hud-xml
```

VPK с `panorama/layout/hud.xml`. **Несовместим** с QoLLock (один hud на всех).

## Установка

1. `gameinfo.gi` → `Game citadel/addons`
2. VPK в `game/citadel/addons/` (например `pak50_dir.vpk`)
3. Launch: `-condebug -exec autoexec`
4. Bridge: `npm run test` → `/control`
5. Выключи отдельный Random Shop VPK (если был)

Проверка в F7:

- `[twitch_bridge] EVENT {"type":"mod_loaded"...`
- `[twitch_bridge] EVENT {"type":"shop_bridge_ready"...` (при открытии магазина)

## Convars (shop apply)

Bridge пишет в `twitch_bridge_effect.cfg` (F10 exec):

| Convar | Значение |
|--------|----------|
| `bridge_shop_seq` | монотонный id (менять = применить) |
| `bridge_shop_cat` | `1` Weapon / `2` Vitality / `3` Spirit |
| `bridge_shop_tier` | `1..4` |
| `bridge_shop_debug` | `1` = show `#RSVoteMirror` + debug labels (default `0`) |

Дефолты `0` добавляются в `autoexec.cfg` при старте bridge.

**Apply (покупка):** primary — PNG `slot=cmd` (`w=seq` 1–200, `h=cat*10+tier` или `h=0` skip); backup — cfg + F10 (`bridge_shop_*`).  
**HUD (проценты / stage):** PNG image side-channel — `Image.SetImage` → `GET /api/shop-probe.png` (калибровка 600×1000) и `GET /api/shop-vote-hud.png?slot=cats|t12|t34|meta|cmd` (ответ в intrinsic width/height). `AsyncWebRequest` JSON в Deadlock Panorama не работает; JSON `/api/shop-vote` остаётся для `/control` / overlay.

## Почему так

Скрипт сам не стартует — его должен подключить **какой‑то** XML через `<scripts><include …>`.  
Не обязательно корневой `hud.xml`: достаточно панели, которую игра создаёт в матче (`TopBar`, `CitadelHudHeroShop`). Это и есть обходной путь без войны с QoLLock.
