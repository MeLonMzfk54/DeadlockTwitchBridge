# Twitch Deadlock Bridge

Внешний мост между **Twitch Channel Points** и игрой **Deadlock** (retail). Зритель тратит баллы канала — bridge отправляет команды в игру через **VConsole**.

Документация по моддингу Deadlock: [Modding Guides](https://deadlockmodding.pages.dev/modding-guides/)

## Архитектура

```
Twitch (Channel Points) → EventSub WebSocket → Bridge App → VConsole (:29000) → Deadlock
```

Компоненты в репозитории:

| Путь | Назначение |
|------|------------|
| `twitch-deadlock-bridge/` | Node.js приложение (Twitch + VConsole + UI) |
| `Deadlock/content/citadel_addons/twitch_integration/` | Справочные alias-команды |
| `Deadlock/game/citadel_addons/twitch_integration/` | Манифест addon для упаковки |

## Быстрый старт

### 1. Запуск Deadlock

Steam → Deadlock → Свойства → Параметры запуска:

```
-vconsole
```

Консоль в игре: **F7**. Команда скрытия HUD: `citadel_hud_visible 0`.

### 2. Установка bridge

```bash
cd twitch-deadlock-bridge
npm install
cp .env.example .env
```

### 3. Тест без Twitch

```bash
npm run test
```

Откройте панель управления: [http://127.0.0.1:3920/control](http://127.0.0.1:3920/control)

В поле **«Текст награды (userInput)»** можно ввести текст, который зритель вводит при активации награды (например, `инфернус` для ростера).

### 4. Настройка Twitch

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

| ID | Описание | ConVar / command | Retail |
|----|----------|------------------|--------|
| `hud_hide` | Скрыть HUD | `citadel_hud_visible 0/1` | Да |
| `crosshair_chaos` | Случайный прицел | `citadel_crosshair_*` | Да |
| `skill1_cast` … `skill4_cast` | Каст скиллов 1–4 | `+in_abilityN / -in_abilityN` | Да |
| `roster_high_priority_set` | High priority roster | `citadel_hero_roster_high_priority <id>` | Да |
| `minimap_customize` | Миникарта: размер/центр/прозрачность | convar mapping в `config/minimap-convars.json` | Да |
| `minimap_spin` | Миникарта крутится | rotation convar (после F7 discovery) | Да |
| `melee_parry_press` | Парирование | `+in_helditem / -in_helditem` (настраивается) | Да |
| `disconnect` | Выход из матча | `disconnect` | Да (destructive) |

Добавление нового эффекта:

1. Создайте файл в `src/effects/`
2. Зарегистрируйте в `src/effects/registry.ts`
3. Добавьте запись в `config/effects.json`
4. Привяжите reward в `config/rewards.json`

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
| `GET /api/status` | Статус подключений и активных эффектов |

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
| `config/input-binds.json` | Input bind парирования (`meleeParry.press/release`) |

## Ограничения

- Требуется `-vconsole` в launch options
- Cheat-эффекты (`ALLOW_CHEAT_EFFECTS=true`) могут не работать в матчмейкинге
- **`disconnect`** — необратимый эффект. Может вызвать abandon-штраф. По умолчанию заблокирован для Twitch (`ALLOW_DESTRUCTIVE_EFFECTS=false`); в `/control` требует подтверждение
- `roster_high_priority_set` парсит `userInput` через `heroes.tsv` + `hero_aliases.json`
- `minimap_spin` требует настроенный `rotation` convar в `minimap-convars.json` (проверьте в F7: `find minimap`)
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
    ├── game/vconsole.ts
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

**Игра не реагирует на команды**

- Проверьте `-vconsole` в launch options
- Убедитесь, что Deadlock запущен
- В панели `/control` статус «Игра» должен быть зелёным
- Порт VConsole по умолчанию `29000` (`VCONSOLE_PORT` в `.env`)

**Twitch не подключается**

- Проверьте токен и scope `channel:read:redemptions`
- Используйте `TEST_MODE=true` для отладки без Twitch

**Зритель активировал награду, но ничего не произошло**

- Проверьте `reward_id` в `config/rewards.json`
- Для roster-наград включите `usesUserInput: true` и создайте reward с полем ввода на Twitch
- Смотрите журнал в `/control`
