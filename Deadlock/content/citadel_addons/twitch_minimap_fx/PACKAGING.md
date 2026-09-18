# twitch_bridge_events — упаковка VPK

## Рекомендуемый способ (совместим с QoLLock)

Как [DeadlockShock](https://github.com/VolcanoCookies/DeadlockShock): **не** подменять весь `hud.xml`, а повесить скрипт на маленький layout, который всегда грузится в матче — `citadel_hud_top_bar.xml`.

```bash
npm run patch-top-bar-xml
```

VPK:

```
panorama/layout/citadel_hud_top_bar.xml   ← stock + <scripts> include
panorama/scripts/twitch_bridge_events.js
addoninfo.txt
```

**Не клади** в этот VPK `panorama/layout/hud.xml`.

Тогда:

| Мод | Что override | Результат |
|-----|----------------|-----------|
| QoLLock | полный `hud.xml` | QoL UI жив |
| наш bridge | только `citadel_hud_top_bar.xml` | скрипт стартует, события идут |
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

Проверка в F7: `[twitch_bridge] EVENT {"type":"mod_loaded"...`

## Почему так

Скрипт сам не стартует — его должен подключить **какой‑то** XML через `<scripts><include …>`.  
Не обязательно корневой `hud.xml`: достаточно панели, которую игра создаёт в матче (`TopBar`). Это и есть обходной путь без войны с QoLLock.
