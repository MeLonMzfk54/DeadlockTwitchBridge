# twitch_minimap_fx — упаковка addon

Panorama-мод для эффекта `minimap_spin_center` в [twitch-deadlock-bridge](../../../README.md).

## Что делает мод

- Читает client convar'ы `bridge_mm_fx_*`, которые bridge пишет в `twitch_bridge_effect.cfg`
- Увеличивает миникарту и центрирует на экране (логика из ModMinimap / QoLLock)
- Крутит миникарту (`preTransformRotate2d`) пока `bridge_mm_fx_active 1`
- При `bridge_mm_fx_active 0` восстанавливает стили и parent панелей

## Подготовка hud.xml (обязательно)

Deadlock загружает **`panorama/layout/hud.xml`**, не `base_hud.xml`. После обновления игры перегенерируйте override:

```bash
npm run patch-hud-xml
```

Или укажите путь к ванильному `hud.xml` вручную:

```bash
node scripts/patch-hud-xml.mjs "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir/panorama/layout/hud.xml"
```

Переменная окружения `DEADLOCK_GAME_DIR` (корень установки Deadlock) тоже поддерживается.

## Установка (разработка, без VPK)

1. В `game/citadel/gameinfo.gi` в `SearchPaths` добавьте **выше** `Game citadel`:
   ```
   Game    citadel/addons
   ```
   (см. [Installing Mods](https://deadlockmodding.pages.dev/installing-mods))
2. Скопируйте папку `twitch_minimap_fx` в:
   ```
   Deadlock/game/citadel_addons/twitch_minimap_fx/
   ```
   **или** соберите VPK и положите в `game/citadel/addons/` (см. ниже).
3. Запустите Deadlock, зайдите в матч/песочницу.
4. В F7 проверьте, что в логе есть:
   ```
   [twitch_minimap_fx] loaded
   [twitch_minimap_fx] convar probe: ...
   ```

## Упаковка VPK (CSDK 12)

1. Выполните `npm run patch-hud-xml` (актуальный `hud.xml`).
2. Откройте [CSDK 12](https://deadlockmodding.pages.dev/modding-guides/csdk12-packing).
3. CS2 Workshop Manager → New → Submit (может упасть — VPK всё равно создастся).
4. Добавьте файлы из `Deadlock/content/citadel_addons/twitch_minimap_fx/`.
5. Переименуйте в `pak##_dir.vpk` и положите в `game/citadel/addons/`.

Структура внутри VPK:

```
panorama/layout/hud.xml
panorama/scripts/twitch_minimap_fx.js
cfg/bridge_mm_fx.cfg
addoninfo.txt
```

## Конфликт с QoLLock / другими HUD-модами

Только один `hud.xml` побеждает по приоритету VPK. **Не используйте одновременно** с QoLLock или другими модами, которые override `hud.xml`.

Если нужен QoLLock + twitch_minimap_fx — добавьте в QoLLock `hud.xml` в блок `<scripts>`:

```xml
<include src="file://{resources}/scripts/twitch_minimap_fx.js" />
```

## Convar'ы (bridge → mod)

| Convar | Значение |
|--------|----------|
| `bridge_mm_fx_active` | `1` вкл / `0` выкл |
| `bridge_mm_fx_size` | размер в px (по умолчанию 900) |
| `bridge_mm_fx_spin` | градусов/сек (по умолчанию 45) |
| `bridge_mm_fx_opacity` | 0–1 (по умолчанию 0.85) |

Проверка в F7 (после `[twitch_minimap_fx] loaded`):

```
bridge_mm_fx_active 1
bridge_mm_fx_size 900
bridge_mm_fx_spin 45
bridge_mm_fx_opacity 0.85
```

В F7 должно появиться `[twitch_minimap_fx] effect active ...`. Через `bridge_mm_fx_active 0` — `effect reverted`.

Если convar probe в логе показывает `active=0` после установки `bridge_mm_fx_active 1`, см. раздел диагностики в README bridge.

## Связка с bridge

- `GAME_COMMAND_MODE=cfg-bind`
- Установлен bind `F10 "exec twitch_bridge_effect.cfg"`
- Эффект `minimap_spin_center` в `/control` или Twitch reward

Без установленного addon эффект только выставит convar'ы — визуально ничего не изменится.
