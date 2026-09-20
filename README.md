# Twitch Deadlock Bridge

Внешний мост между **Twitch Channel Points** и игрой **Deadlock** (retail). Зритель тратит баллы канала — bridge отправляет команды в игру.

Документация по моддингу Deadlock: [Modding Guides](https://deadlockmodding.pages.dev/modding-guides/)

## Архитектура

```
Twitch (Channel Points) → EventSub WebSocket → Bridge App → GameCommandClient → Deadlock
Deadlock (Panorama mod) → HTTP / console.log → Bridge App → /control «События игры»
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
| `Deadlock/content/citadel_addons/twitch_minimap_fx/` | Panorama addon: телеметрия + Random Shop vote (`twitch_bridge_shop.js`, mod **1.9.0**) |
| `Deadlock/content/citadel_addons/RandomShop/` | Устаревший снимок — **не** источник истины (см. `DEPRECATED.md`) |
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
- `minimap_spin` (VConsole setInterval), `disconnect` и другие input/destructive эффекты также недоступны в cfg-bind

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
2. Получите OAuth-токен со scopes:
   - `channel:read:redemptions` — Channel Points → эффекты
   - `user:read:chat` — Random Shop vote через EventSub `channel.chat.message`
   - `user:write:chat` — объявление старта голосования в чат (Helix Send Chat Message)
   - опционально `user:bot` / `channel:bot`, если Twitch потребует bot-style chat auth
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
| `mouse_invert` | Инверсия мыши (X + Y) | Да | Да |
| `wasd_invert` | Инверсия WASD (Windows hook) | Да | Да |
| `screen_flip` | Зеркало экрана (Windows overlay) | Да* | Да* |
| `roster_high_priority_set` | High priority roster | Да | Да |
| `minimap_customize` | Миникарта: размер/центр/прозрачность | Да | Да |
| `minimap_spin` | Миникарта крутится (VConsole setInterval) | Да | Нет |
| `skill1_cast` … `skill4_cast` | Каст скиллов 1–4 | Да | Нет |
| `melee_parry_press` | Парирование (симуляция клавиши F) | Да | Да |
| `disconnect` | Выход из матча | Да* | Нет |

\* `disconnect` через Twitch только при `ALLOW_DESTRUCTIVE_EFFECTS=true`.

\* `screen_flip` — Windows-side overlay (не inject). Работает в vconsole и cfg-bind; `syncInput` шлёт convar `m_yaw` через текущий transport. Только Windows + Borderless Windowed.

### `screen_flip` — зеркало экрана

Горизонтальное зеркало картинки поверх окна Deadlock (видят **и стример, и зрители** при правильном OBS).

1. Deadlock в **Borderless Windowed** (не Exclusive Fullscreen).
2. Награда с `screen_flip` (рекомендуется `durationSec` 20–30, `cooldownSec` ≥ 60–90).
3. OBS: **Display Capture** монитора с игрой **или** Window Capture оверлея `screen_flip`.
4. **Не** используйте Game Capture процесса Deadlock — зрители не увидят overlay (он отдельное topmost-окно поверх игры).
5. Params: `syncInput` (default `true`) — на время flip инвертирует mouse X (`m_yaw`) и меняет A/D; `axis`: `"horizontal"` (MVP). Не стекуйте с `mouse_invert` / `wasd_invert`.
6. Env: `SCREEN_FLIP_FPS` (default 45), `SCREEN_FLIP_PROCESS_NAME` / `SCREEN_FLIP_WINDOW_TITLE` (fallback на `DEADLOCK_*`).

**Производительность (MVP):** GDI `PrintWindow` / BitBlt только client area + FPS cap. При лагах снизьте `SCREEN_FLIP_FPS` до 30. Оценить: Task Manager (CPU у `powershell`/`Deadlock`) + визуальный lag оверлея vs игра.

**TODO:** DXGI Desktop Duplication → ниже CPU на 1440p/4K.

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
| `/control` | Панель стримера (статусы, тест с userInput, журнал эффектов, **события игры**, Random Shop vote) |
| `/overlay` | OBS Browser Source (тосты Channel Points) |
| `/overlay/shop` | OBS Browser Source (панель shop vote) |
| `POST /api/test-effect` | API теста с `userInput` |
| `GET /api/status` | Статус подключений (`chatConnected`), `gameTelemetry`, `shopVote`, активные эффекты |
| `GET /api/effects` | Каталог эффектов с `cfgBindSafe` |
| `POST /api/game-event` | Приём события от Panorama-мода (только localhost) |
| `GET /api/game-events` | Журнал телеметрии (`?afterSeq=&limit=`), плюс `match` / `lastHeartbeat` |
| `POST /api/game-events/clear` | Очистить журнал телеметрии (и `seenIds`) |

## Random Shop / shop vote

> **Полный гайд по запуску:** [RANDOM_SHOP.md](RANDOM_SHOP.md) (VPK, launch options, Twitch, настройки, чеклист).

Голосование чата за категорию и тир предмета в магазине. Живой мод — только `twitch_minimap_fx` (VPK с `citadel_hud_hero_shop.xml` + `twitch_bridge_shop.js` / `random_shop.js`). Папка `RandomShop/` — устаревший снимок.

### Как голосует чат

Режим **`full`** (по умолчанию) — одна стадия `voting_combined`: тип и тир голосуются **параллельно**. Bridge слушает EventSub `channel.chat.message` и парсит **все слова** сообщения (опциональный префикс `!`; в настройках можно требовать, чтобы сообщение начиналось с `!`):

| Что писать | Результат |
|------------|-----------|
| `!w 1`, `!w !1`, `w 1`, `!1 !w` | weapon **и** T1 |
| `!w` / `weapon` | только тип (тир можно дописать позже) |
| `!1` / `t2` | только тир |
| `weapon` / `w`, `vitality` / `armor` / `v`, `spirit` / `tech` / `s` | тип |
| `1`–`4` или `t1`–`t4` | тир |

Режимы `category` / `tier` — по-прежнему отдельные стадии; там тоже можно писать комбо, засчитывается только нужная ось.

Один голос на Twitch `userId` **на каждую ось** (last-vote-wins независимо для типа и тира). Кнопки в `/control` без `userId` — каждый клик считается отдельно. Mock-бот по умолчанию **выкл** (`POST /api/shop-vote/mock`).

При старте стадии `voting_combined` / `voting_category` / `voting_tier` bridge пишет в чат редактируемый текст (настройки `chatAnnounce*` в `/control` → `config/shop-vote.json`). Нужен scope `user:write:chat`. Плейсхолдеры: `{options}`, `{tierOptions}`, `{seconds}`, `{prefix}`, `{category}`. Пустой шаблон или выключенный чекбокс — сообщение не шлётся.

Длительность полного цикла берётся из **«Категория / полный цикл (сек)»** (`categoryDurationMs`).

### Каналы Bridge → HUD / apply

Panorama **не** читает JSON HTTP надёжно. Используются:

| Назначение | Канал |
|------------|--------|
| % голосов, stage, таймер | PNG side-channel `GET /api/shop-vote-hud.png?slot=cats\|t12\|t34\|meta` (+ калибровка `/api/shop-probe.png`) |
| Apply / skip ролла | PNG слот `slot=cmd`: `w=seq` (1–200), `h=cat*10+tier` (11–34) или `h=0` = skip |
| Backup apply | cfg-bind: `bridge_shop_seq` / `cat` / `tier` + F10 `exec` |
| События мода → bridge | `$.Msg("[twitch_bridge] EVENT …")` → хвост `console.log` (`-condebug`) |

Debug-зеркало HUD: в консоли F7 `bridge_shop_debug 1` (по умолчанию выкл).

### OBS overlay

Два Browser Source:

| URL | Что показывает |
|-----|----------------|
| `/overlay` | Тосты Channel Points |
| `/overlay/shop` | Панель shop vote на стадиях `voting_*` / `applying` / `waiting_shop` и коротко после ролла/покупки (`overlayHoldMs`) |

Рекомендуемый размер shop-источника ≈ 380×480 (панель вверху слева, прозрачный фон).

### Control panel

Карточка **Random Shop**: стадии, таймеры, категории/тиры, apply delay, автостарт (режим цикла), mock-бот, `!` prefix, тексты объявления в чат, cast/skip/apply, лента голосов. Настройки сохраняются в `config/shop-vote.json`. Точка **«Чат (голоса)»** зелёная при успешной подписке EventSub chat.

### Env / persistence

```env
SHOP_VOTE_CATEGORY_MS=25000   # seed, если ещё нет config/shop-vote.json
SHOP_VOTE_TIER_MS=25000
SHOP_VOTE_RESTART_MS=25000
```

Живые префы: `config/shop-vote.json` (образец `config/shop-vote.example.json`) или `POST /api/shop-vote/settings` / `/control`.

### API (shop vote)

```bash
curl http://127.0.0.1:3920/api/shop-vote
curl http://127.0.0.1:3920/api/shop-vote/settings
curl -X POST http://127.0.0.1:3920/api/shop-vote/start -H "Content-Type: application/json" -d "{\"stage\":\"full\"}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/cast -H "Content-Type: application/json" -d "{\"option\":\"weapon\",\"userId\":\"alice\"}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/mock -H "Content-Type: application/json" -d "{\"enabled\":true}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/skip
curl -X POST http://127.0.0.1:3920/api/shop-vote/durations -H "Content-Type: application/json" -d "{\"categorySec\":30,\"tierSec\":25,\"restartSec\":25}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/settings -H "Content-Type: application/json" -d "{\"autoStart\":true,\"minTier\":1,\"maxTier\":3}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/apply -H "Content-Type: application/json" -d "{\"category\":\"weapon\",\"tier\":1}"
```

### Стрим: чеклист

См. полный список в [RANDOM_SHOP.md](RANDOM_SHOP.md). Кратко:

1. VPK из `twitch_minimap_fx` ([PACKAGING.md](Deadlock/content/citadel_addons/twitch_minimap_fx/PACKAGING.md)). **Выключите** отдельный `pak02` Random Shop.
2. Launch options: `-condebug` (+ `-exec autoexec` для cfg-bind).
3. Токен со scopes `channel:read:redemptions` + `user:read:chat` (+ `user:write:chat` для объявлений в чат).
4. `npm run dev` → `/control`: «Чат» зелёный, при открытии магазина — Auto-start или «Полный цикл».
5. OBS: Browser Source → `http://127.0.0.1:3920/overlay` (тосты) и `http://127.0.0.1:3920/overlay/shop` (голосование).
6. Зрители пишут в чат `w` / `v` / `s`, затем `1`–`4`.

## Телеметрия матча (мод → bridge)

Обратный канал: addon `twitch_bridge_events.js` шлёт HUD/матчевые события в bridge. Twitch Predictions пока **не** подключены — только журнал и снимок матча в `/control`.

Heartbeat обновляет онлайн-статус мода, но **не** попадает в кольцевой журнал (фильтр `heartbeat` показывает последний payload).

**Установка**

1. Собери VPK (см. `PACKAGING.md`):
   - **один мод:** self-contained с `hud.xml` (`npm run patch-hud-xml`);
   - **с QoLLock:** bridge VPK только со скриптами + include вшит в HUD QoLLock (`node scripts/patch-hud-xml.mjs path/to/QoLLock/hud.xml --in-place`).
2. Установи VPK в `game/citadel/addons/`, в `gameinfo.gi` должна быть строка `Game citadel/addons`.
3. Launch options: `-condebug` (+ `-exec autoexec` для наград cfg-bind).
4. Опционально в `.env`:
   ```env
   DEADLOCK_CONSOLE_LOG=C:\...\Deadlock\game\citadel\console.log
   DEADLOCK_GAME_DIR=C:\...\Deadlock
   ```
5. `npm run test` → откройте [http://127.0.0.1:3920/control](http://127.0.0.1:3920/control) → карточка **«События игры»**.

**Sandbox-check**

1. Зайдите в sandbox / матч.
2. В F7 или в `/control` должны появиться `mod_loaded`, `api_probe`; точка «Мод» зелёная пока heartbeat свежий (~5 с). Снимок матча сверху карточки.
3. Умрите / зареспауньтесь → `local_death` / `local_respawn` (с `respawnSec` если таймер читается).
4. Killfeed (если DataFeed отдаёт детей) → `killfeed`; score / announcements — при диффе панелей.
5. Смена фазы (hideout / pregame / in_match / match_end / shop / …) → `phase`.
6. Dump панелей: в F7 `bridge_evt_dump 1` → `hud_dump` по HTTP (в лог — stub).
7. Если HTTP пустой, а в логе есть `[twitch_bridge] EVENT` — смотрите `transport` = `log` и `httpOk` в heartbeat / снимке.

Convar'ы: `bridge_evt_url` (URL POST), `bridge_evt_dump` (`1` = dump).

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

# Симуляция события мода
curl -X POST http://127.0.0.1:3920/api/game-event \
  -H "Content-Type: application/json" \
  -d "{\"v\":1,\"id\":\"manual-1\",\"tsMs\":0,\"type\":\"heartbeat\",\"payload\":{\"phase\":\"sandbox\"}}"

# Журнал телеметрии
curl http://127.0.0.1:3920/api/game-events
```

## Конфигурация convar mapping

| Файл | Назначение |
|------|------------|
| `config/minimap-convars.json` | Convar'ы миникарты (scale, center, opacity, rotation). Поля `null` — заполнить после `find minimap` в F7 |
| `config/input-binds.json` | Клавиша парирования для `melee_parry_press` и клавиши движения для `wasd_invert` / `screen_flip` syncInput (A/D) |
| `config/input-convars.json` | Convar'ы инверсии мыши для `mouse_invert` и mouse X для `screen_flip` syncInput (`m_yaw`) |

## Ограничения

- **vconsole**: требует `-vconsole -insecure`, не для official servers
- **cfg-bind**: client-side convar эффекты и `melee_parry_press` (симуляция клавиши); skill cast/disconnect/minimap_spin недоступны
- Cheat-эффекты (`ALLOW_CHEAT_EFFECTS=true`) могут не работать в матчмейкинге
- **`disconnect`** — необратимый эффект. Может вызвать abandon-штраф. По умолчанию заблокирован для Twitch (`ALLOW_DESTRUCTIVE_EFFECTS=false`); в `/control` требует подтверждение
- `roster_high_priority_set` парсит `userInput` через `heroes.tsv` + `hero_aliases.json`
- `minimap_spin` требует настроенный `rotation` convar в `minimap-convars.json` (проверьте в F7: `find minimap`)
- Телеметрия матча требует include `twitch_bridge_events.js` в рабочем HUD; для хвоста лога — launch option `-condebug`
- `melee_parry_press` симулирует нажатие клавиши из `input-binds.json` (по умолчанию **F**); Deadlock должен быть запущен
- `screen_flip` требует Windows, запущенный Deadlock в Borderless Windowed, OBS Display Capture; см. секцию выше

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
│   ├── overlay.html
│   └── overlay-shop.html
└── src/
    ├── game/
    │   ├── game-command-client.ts
    │   ├── game-event-bus.ts
    │   ├── console-log-tail.ts
    │   ├── vconsole.ts
    │   ├── cfg-bind-client.ts
    │   └── create-game-client.ts
    ├── heroes/hero-resolver.ts
    ├── shop/
    │   ├── shop-vote-controller.ts
    │   ├── shop-vote-png.ts
    │   ├── shop-vote-settings.ts
    │   └── shop-chat-parser.ts
    ├── effects/
    ├── queue/effect-manager.ts
    ├── twitch/
    │   ├── eventsub.ts
    │   └── chat-send.ts
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
- Для shop vote в чате нужен ещё `user:read:chat` (точка «Чат» в `/control`)
- Для объявления старта голосования в чат — `user:write:chat`
- Используйте `TEST_MODE=true` для отладки без Twitch (голоса — кнопками панели)

**Shop vote / Random Shop не голосует в HUD**

- В VPK должны быть `citadel_hud_hero_shop.xml` + `twitch_bridge_shop.js` (версия **1.9.0+**)
- Выключите чужой `pak02` Random Shop (конфликт override)
- Launch option `-condebug`; в `/control` смотрите `shop_*` события
- Debug: F7 `bridge_shop_debug 1`

**Зритель активировал награду, но ничего не произошло**

- Проверьте `reward_id` в `config/rewards.json`
- В cfg-bind режиме skill cast награды отклоняются — смотрите журнал в `/control`
- Для roster-наград включите `usesUserInput: true` и создайте reward с полем ввода на Twitch
- Смотрите журнал в `/control`

**`screen_flip`: стример видит зеркало, зрители — нет**

- Переключите OBS на **Display Capture** (или Window Capture оверлея), не Game Capture Deadlock
- Убедитесь, что игра в Borderless Windowed
