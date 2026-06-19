# Twitch Deadlock Bridge

Внешний мост между **Twitch Channel Points** и игрой **Deadlock** (retail). Зритель тратит баллы канала — bridge отправляет команды в игру.

Документация по моддингу Deadlock: [Modding Guides](https://deadlockmodding.pages.dev/modding-guides/)

## Архитектура

```
Twitch (Channel Points) → EventSub WebSocket → Bridge App → GameCommandClient → Deadlock
```

Два транспорта:

| Режим | Транспорт | Когда использовать |
|-------|-----------|-------------------|
| `vconsole` | TCP VConsole `:29000` | sandbox / custom / dev |
| `cfg-bind` | запись cfg + keypress | official matchmaking (без `-insecure`) |

Компоненты в репозитории:

| Путь | Назначение |
|------|------------|
| `twitch-deadlock-bridge/` | Node.js приложение (Twitch + game transport + UI) |
| `Deadlock/content/citadel_addons/twitch_integration/` | Справочные alias-команды |
| `Deadlock/content/citadel_addons/twitch_minimap_fx/` | Panorama addon для `minimap_spin_center` |
| `Deadlock/game/citadel_addons/twitch_integration/` | Манифест addon для упаковки |

## Режимы отправки команд

### vconsole (sandbox / custom / dev)

Steam → Deadlock → Свойства → Параметры запуска:

```
-vconsole -insecure
```

- Bridge подключается к TCP `127.0.0.1:29000` (`VCONSOLE_HOST` / `VCONSOLE_PORT`)
- Доступны **все** эффекты (с учётом `ALLOW_CHEAT_EFFECTS` / `ALLOW_DESTRUCTIVE_EFFECTS`)
- Консоль в игре: **F7**
- **Не подходит для official matchmaking servers** — требует `-insecure`

`.env`:

```env
GAME_COMMAND_MODE=vconsole
VCONSOLE_HOST=127.0.0.1
VCONSOLE_PORT=29000
```

### cfg-bind (official-safe)

Client-side эффекты без `-insecure`: bridge пишет команду в cfg-файл и симулирует нажатие клавиши, забинженной на `exec`.

**Настройка игры:**

1. Укажите `DEADLOCK_CFG_DIR` в `.env` (путь к папке cfg Deadlock).
2. Добавьте launch option:
   ```
   -exec autoexec
   ```
3. При **первом запуске** bridge автоматически допишет в `autoexec.cfg` (если bind ещё нет):
   ```
   bind F10 "exec twitch_bridge_effect.cfg"
   ```
4. Настройте `.env`:
   ```env
   GAME_COMMAND_MODE=cfg-bind
   DEADLOCK_CFG_DIR=C:\Program Files (x86)\Steam\steamapps\common\Deadlock\game\citadel\cfg
   CFG_BIND_FILENAME=twitch_bridge_effect.cfg
   CFG_TRIGGER_KEY=F10
   ```

**Как применяется эффект:** при активации (Twitch, `/control` или API) bridge записывает команды эффекта в `twitch_bridge_effect.cfg` и симулирует нажатие **F10** — игра выполняет `exec` и применяет эффект на клиенте. Отдельный bind для каждого эффекта не нужен.

Ручная настройка bind (если не хотите auto-setup):

```
bind F10 "exec twitch_bridge_effect.cfg"
```

в `autoexec.cfg`.

**Ограничения official-safe режима:**

- Награды на **каст скиллов** (`skill1_cast`–`skill4_cast`) **отключены**
- Награды на **парирование** (`melee_parry_press`) **отключены**
- `minimap_spin` (VConsole setInterval), `disconnect` и другие input/destructive эффекты также недоступны в cfg-bind
- `minimap_spin_center` работает в cfg-bind при установленном addon `twitch_minimap_fx`

Статус «Игра» в `/control` означает, что bridge может записать cfg-файл в `DEADLOCK_CFG_DIR` (не TCP-подключение).

## Быстрый старт

### 1. Установка bridge

```bash
cd twitch-deadlock-bridge
npm install
cp .env.example .env
```

Выберите режим в `.env` (см. выше) и настройте Deadlock.

### 2. Тест без Twitch

```bash
npm run test
```

Откройте панель управления: [http://127.0.0.1:3920/control](http://127.0.0.1:3920/control)

В поле **«Текст награды (userInput)»** можно ввести текст, который зритель вводит при активации награды (например, `инфернус` для ростера).

### 3. Настройка Twitch

1. Создайте приложение на [dev.twitch.tv](https://dev.twitch.tv/console/apps)
2. Получите OAuth-токен со scope `channel:read:redemptions`
3. Заполните `.env`:

```env
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_ACCESS_TOKEN=...
TWITCH_REFRESH_TOKEN=...
TWITCH_BROADCASTER_ID=...   # опционально, иначе берётся из токена
TEST_MODE=false
ALLOW_DESTRUCTIVE_EFFECTS=false
```

4. В Twitch Creator Dashboard создайте Custom Rewards (с полем ввода текста для roster-наград)
5. Скопируйте `reward_id` в `config/rewards.json`

Пример `config/rewards.json` с userInput:

```json
{
  "rewards": {
    "abc123-roster-reward": {
      "name": "Выбрать героя в ростер",
      "usesUserInput": true,
      "effects": [{ "id": "roster_high_priority_set", "durationSec": 120 }],
      "cooldownSec": 180
    }
  }
}
```

6. Запустите bridge:

```bash
npm run dev
```

## Встроенные эффекты

| ID | Описание | vconsole | cfg-bind |
|----|----------|----------|----------|
| `hud_hide` | Скрыть HUD | Да | Да |
| `crosshair_chaos` | Случайный прицел | Да | Да |
| `random_sensitivity` | Рандомная чувствительность | Да | Да |
| `roster_high_priority_set` | High priority roster | Да | Да |
| `minimap_customize` | Миникарта: размер/центр/прозрачность | Да | Да |
| `minimap_spin` | Миникарта крутится (VConsole setInterval) | Да | Нет |
| `minimap_spin_center` | Миникарта крутится по центру (addon + convars) | Да | Да |
| `skill1_cast` … `skill4_cast` | Каст скиллов 1–4 | Да | Нет |
| `melee_parry_press` | Парирование | Да | Нет |
| `disconnect` | Выход из матча | Да* | Нет |

\* `disconnect` через Twitch только при `ALLOW_DESTRUCTIVE_EFFECTS=true`.

Добавление нового эффекта:

1. Создайте файл в `src/effects/`
2. Зарегистрируйте в `src/effects/registry.ts`
3. Добавьте запись в `config/effects.json` (укажите `cfgBindSafe`)
4. Привяжите reward в `config/rewards.json`
5. В режиме **cfg-bind** эффект с `cfgBindSafe: true` автоматически применяется на клиенте при активации: bridge пишет команды в cfg-файл и нажимает **F10** (bind настраивается при старте bridge). Для проверки используйте `/control` или `POST /api/test-effect`.

## Герои и алиасы

- Список героев: [`config/heroes.tsv`](config/heroes.tsv) — формат `id<TAB>name`
- Пользовательские алиасы: [`config/hero_aliases.json`](config/hero_aliases.json)

Пример: зритель вводит `инфернус` → bridge отправляет `citadel_hero_roster_high_priority 1`.

## UI и overlay

| URL | Назначение |
|-----|------------|
| `/control` | Панель стримера (статусы, тест с userInput, журнал) |
| `/overlay` | OBS Browser Source (тосты при активации) |
| `POST /api/test-effect` | API теста с `userInput` |
| `GET /api/status` | Статус подключений, `gameCommandMode`, активные эффекты |
| `GET /api/effects` | Каталог эффектов с `cfgBindSafe` |

## Ручной тест через консоль игры

Файл `Deadlock/content/citadel_addons/twitch_integration/cfg/twitch_effects.cfg`:

```
twitch_hud_hide                    → citadel_hud_visible 0
twitch_skill1_cast                 → +in_ability1; -in_ability1
twitch_roster_high_priority_infernus → citadel_hero_roster_high_priority 1
twitch_melee_parry_press           → +in_helditem; -in_helditem
twitch_disconnect                  → disconnect
```

## API

```bash
# Тест эффекта
curl -X POST http://127.0.0.1:3920/api/test-effect \
  -H "Content-Type: application/json" \
  -d "{\"effectId\":\"hud_hide\",\"durationSec\":30}"

# Тест roster с userInput (имя или ID героя)
curl -X POST http://127.0.0.1:3920/api/test-effect \
  -H "Content-Type: application/json" \
  -d "{\"effectId\":\"roster_high_priority_set\",\"durationSec\":120,\"userInput\":\"инфернус\"}"

# Сброс всех эффектов
curl -X POST http://127.0.0.1:3920/api/revert-all
```

## Конфигурация convar mapping

| Файл | Назначение |
|------|------------|
| `config/minimap-convars.json` | Convar'ы миникарты (scale, center, opacity, rotation). Поля `null` — заполнить после `find minimap` в F7 |
| `config/minimap-fx-convars.json` | Convar'ы для `minimap_spin_center` → addon `twitch_minimap_fx` |
| `config/input-binds.json` | Input bind парирования (`meleeParry.press/release`) |

## Ограничения

- **vconsole**: требует `-vconsole -insecure`, не для official servers
- **cfg-bind**: только client-side convar эффекты; skill/parry/disconnect/minimap_spin недоступны
- Cheat-эффекты (`ALLOW_CHEAT_EFFECTS=true`) могут не работать в матчмейкинге
- **`disconnect`** — необратимый эффект. Может вызвать abandon-штраф. По умолчанию заблокирован для Twitch (`ALLOW_DESTRUCTIVE_EFFECTS=false`); в `/control` требует подтверждение
- `roster_high_priority_set` парсит `userInput` через `heroes.tsv` + `hero_aliases.json`
- `minimap_spin` требует настроенный `rotation` convar в `minimap-convars.json` (проверьте в F7: `find minimap`)
- `minimap_spin_center` требует установленный addon `twitch_minimap_fx` (см. `Deadlock/content/citadel_addons/twitch_minimap_fx/PACKAGING.md`; после обновления игры: `npm run patch-hud-xml`)
- `melee_parry_press` использует bind из `input-binds.json` — проверьте в F7: `find in_held`

## Структура проекта

```
twitch-deadlock-bridge/
├── config/
│   ├── effects.json
│   ├── rewards.json
│   ├── heroes.tsv
│   ├── hero_aliases.json
│   ├── minimap-convars.json
│   └── input-binds.json
├── public/
│   ├── control.html
│   └── overlay.html
└── src/
    ├── game/
    │   ├── game-command-client.ts
    │   ├── vconsole.ts
    │   ├── cfg-bind-client.ts
    │   └── create-game-client.ts
    ├── heroes/hero-resolver.ts
    ├── effects/
    ├── queue/effect-manager.ts
    ├── twitch/eventsub.ts
    └── server/http-server.ts
```

## Сборка

```bash
npm run build
npm start
```

## FAQ

**Игра не реагирует на команды (vconsole)**

- Проверьте `-vconsole -insecure` в launch options
- Убедитесь, что Deadlock запущен
- В панели `/control` статус «Игра» должен быть зелёным
- Порт VConsole по умолчанию `29000` (`VCONSOLE_PORT` в `.env`)

**Игра не реагирует на команды (cfg-bind)**

- Проверьте `bind F10 "exec twitch_bridge_effect.cfg"` в `autoexec.cfg` (bridge добавляет строку при старте, если её ещё нет)
- Launch option `-exec autoexec` должен быть задан
- `DEADLOCK_CFG_DIR` должен указывать на папку cfg игры
- `CFG_TRIGGER_KEY` в `.env` должен совпадать с клавишей в bind (по умолчанию **F10**)
- Deadlock должен быть **запущен** — bridge ищет процесс `deadlock.exe` (`DEADLOCK_PROCESS_NAME`, по умолчанию `deadlock`), а не окно по заголовку (иначе может найти Cursor/браузер с «Deadlock» в названии)
- Если тестируете из браузера `/control`, bridge сам переведёт фокус в игру; вручную нажимать F10 не нужно
- Если фокус не переключается: запустите bridge и игру с одинаковыми правами (оба без админа или оба от админа)
- Статус «Игра» = возможность записи в cfg-dir

**Twitch не подключается**

- Проверьте токен и scope `channel:read:redemptions`
- Используйте `TEST_MODE=true` для отладки без Twitch

**Зритель активировал награду, но ничего не произошло**

- Проверьте `reward_id` в `config/rewards.json`
- В cfg-bind режиме skill/parry награды отклоняются — смотрите журнал в `/control`
- Для roster-наград включите `usesUserInput: true` и создайте reward с полем ввода на Twitch
- Смотрите журнал в `/control`
