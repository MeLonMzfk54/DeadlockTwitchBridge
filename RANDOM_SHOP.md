# Random Shop — голосование чата

Гайд по запуску голосования за категорию и тир предмета в магазине Deadlock.  
Живой мод — только `twitch_minimap_fx`. Папка `Deadlock/content/citadel_addons/RandomShop/` **устарела** — не редактируйте и не пакуйте её.

Архитектура каналов (PNG HUD, cfg backup, лог-события) описана в [`.cursor/rules/mod-data-transfer.mdc`](.cursor/rules/mod-data-transfer.mdc) и кратко ниже.

---

## 1. Что нужно

| Компонент | Зачем |
|-----------|--------|
| Bridge (этот репозиторий) | Голоса, таймеры, PNG HUD, apply |
| VPK из `twitch_minimap_fx` | Random Shop UI + `twitch_bridge_shop.js` |
| Deadlock с `-condebug` | События магазина → bridge |
| Twitch EventSub + `user:read:chat` | Голоса из чата (не обязательно для теста с `/control`) |

**Не ставьте** отдельный `pak02` Random Shop с тем же `citadel_hud_hero_shop.xml` — конфликт layout, голосование сломается.

---

## 2. Мод (VPK)

Источник: [`Deadlock/content/citadel_addons/twitch_minimap_fx/`](Deadlock/content/citadel_addons/twitch_minimap_fx/).  
Упаковка: [`PACKAGING.md`](Deadlock/content/citadel_addons/twitch_minimap_fx/PACKAGING.md).

Рекомендуемый стек (совместим с QoLLock):

```bash
npm run patch-top-bar-xml
```

В VPK должны быть (mod **1.9.0+**):

- `panorama/layout/citadel_hud_top_bar.xml` + `twitch_bridge_events.js`
- `panorama/layout/citadel_hud_hero_shop.xml` + `random_shop.js` + `twitch_bridge_shop.js`
- `panorama/styles/random_shop.css`, `custom_icons.css`
- `addoninfo.txt`

Установка:

1. В `gameinfo.gi` есть `Game citadel/addons`.
2. Положите VPK в `game/citadel/addons/` (например `pak50_dir.vpk`).
3. Выключите чужие VPK с тем же `citadel_hud_hero_shop.xml` / конфликтующим `citadel_hud_top_bar.xml`.

Мод ходит на bridge по адресу **`http://127.0.0.1:3920`** (хардкод). Порт в `.env` должен совпадать.

---

## 3. Launch options Deadlock

| Опция | Зачем |
|-------|--------|
| `-condebug` | **Обязательно** — `console.log` с `[twitch_bridge] EVENT …` |
| `-exec autoexec` | cfg-bind backup (`bridge_shop_*` + F10) |
| `-vconsole -insecure` | Только sandbox + `GAME_COMMAND_MODE=vconsole` |

---

## 4. Bridge

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

Минимум в `.env`:

```env
HTTP_HOST=127.0.0.1
HTTP_PORT=3920
DEADLOCK_CFG_DIR=C:\Path\To\Deadlock\game\citadel\cfg
GAME_COMMAND_MODE=cfg-bind
```

Опционально seed таймеров (если ещё нет `config/shop-vote.json`):

```env
SHOP_VOTE_CATEGORY_MS=25000
SHOP_VOTE_TIER_MS=25000
SHOP_VOTE_RESTART_MS=25000
```

### Без Twitch (тест)

```bash
npm run test
```

Откройте [http://127.0.0.1:3920/control](http://127.0.0.1:3920/control) → карточка **Random Shop** → «Полный цикл» / cast / mock-бот.

### С чатом Twitch

1. Приложение на [dev.twitch.tv](https://dev.twitch.tv/console/apps).
2. Токен со scope **`user:read:chat`** (чат идёт через EventSub `channel.chat.message`, **не IRC**).
   Для объявления старта голосования — ещё **`user:write:chat`**.
3. Заполните `TWITCH_*` в `.env`, `TEST_MODE=false`.
4. `npm run dev` → в `/control` точка **«Чат (голоса)»** зелёная.

---

## 5. Команды чата

На стадиях `voting_category` / `voting_tier` парсится **первое слово** сообщения:

| Стадия | Команды |
|--------|---------|
| Категория | `weapon` / `w`, `vitality` / `armor` / `v`, `spirit` / `tech` / `s` |
| Тир | `1`–`4` или `t1`–`t4` |

Префикс `!` обычно опционален (`!w`, `!2`). Если в настройках включено **«Требовать !»** — без `!` голос не считается.

Один голос на Twitch-пользователя (last-vote-wins внутри стадии). Кнопки в `/control` без `userId` — каждый клик отдельно.

---

## 6. Настройки (сохраняются)

Живые префы пишутся в **`config/shop-vote.json`** (в git не коммитится; образец — `config/shop-vote.example.json`).  
Меняются в `/control` или через `POST /api/shop-vote/settings` и **переживают рестарт** bridge.

| Настройка | Смысл |
|-----------|--------|
| После покупки — новый цикл | После `purchased` ждёт паузу и стартует снова (**магазин может быть закрыт**) |
| Кнопка Start/Skip в HUD | Random Shop: START / RESTART / SKIP → события `shop_vote_start` / `shop_vote_skip` |
| HUD Restart во время голосования | START во время vote рестартует цикл; иначе клик игнорируется |
| Цикл автостарта | `full` / `category` / `tier` (также для HUD Start) |
| Категория / Тир / Пауза после покупки | Длительности в секундах |
| Категории (чекбоксы) | Какие варианты в голосовании (минимум одна) |
| Мин/макс тир | Диапазон `1–4`; вне диапазона голоса игнорируются |
| Требовать `!` | Только `!w` / `!1` и т.п. |
| Писать в чат при старте | Объявление + инструкция (шаблоны с `{options}` / `{seconds}` / `{category}`) |
| Пауза перед apply | Показать победителя, затем PNG cmd + cfg |
| Mock-бот + интервал | Случайные голоса для теста HUD |
| Оверлей после ролла | Сколько секунд `/overlay/shop` держит панель после ролла/покупки |

Открытие магазина **само по себе не стартует** голосование — только кнопка в HUD, `/control`, или auto-start после покупки.

Если включена только одна категория или один тир — соответствующая стадия **пропускается**.

Env `SHOP_VOTE_*_MS` используется только как seed, когда JSON ещё нет.

---

## 7. Поток на стриме

1. Bridge запущен, VPK установлен, Deadlock с `-condebug`.
2. Зайдите в матч, откройте магазин → вкладка **Random**.
3. Нажмите **START VOTE** в HUD (или `/control` → **Полный цикл**).
4. Чат голосует `w`/`v`/`s`, затем `1`–`4`.
5. После тира bridge шлёт apply (PNG `slot=cmd`; cfg+F10 — backup).
6. Мод роллит предмет; покупка проходит в зоне магазина (`waiting_shop` → `purchased`).
7. Если включено «После покупки — новый цикл» — после паузы стартует следующий vote (даже с закрытым магазином).

Во время ролла/ожидания покупки кнопка в HUD становится **SKIP**. Во время голосования — **RESTART** (если разрешено в настройках).

OBS (опционально): два Browser Source —
[http://127.0.0.1:3920/overlay](http://127.0.0.1:3920/overlay) (тосты) и
[http://127.0.0.1:3920/overlay/shop](http://127.0.0.1:3920/overlay/shop) (голосование, ≈380×480).

Debug-зеркало в HUD: в консоли F7 `bridge_shop_debug 1`.

---

## 8. Каналы данных (кратко)

| Направление | Канал |
|-------------|--------|
| Bridge → % / stage / timer | `GET /api/shop-vote-hud.png?slot=cats\|t12\|t34\|meta` (+ `/api/shop-probe.png`) |
| Bridge → apply / skip | PNG `slot=cmd` (`w=seq`, `h=cat*10+tier` или `h=0`) |
| Bridge → backup | cfg `bridge_shop_cat/tier/seq` + F10 |
| Мод → bridge | `$.Msg` → хвост `console.log` (`-condebug`); HUD Start/Skip → `shop_vote_start` / `shop_vote_skip` |
| Чат → bridge | EventSub `channel.chat.message` |
| Панель / OBS | JSON `/api/shop-vote`, `/control`, `/overlay`, `/overlay/shop` |

Panorama **не** должна читать JSON HTTP для HUD — только PNG.

---

## 9. Чеклист

- [ ] Один VPK `twitch_minimap_fx` (hero_shop + top_bar + scripts **1.9.0+**)
- [ ] Чужой Random Shop / конфликтующий top_bar выключен
- [ ] `-condebug` (+ `-exec autoexec` для cfg backup)
- [ ] Bridge на `127.0.0.1:3920`
- [ ] `/control` открывается; для чата — зелёная точка «Чат»
- [ ] В матче: Random → **START VOTE** → голоса → apply в зоне

---

## 10. Типичные поломки

| Симптом | Что проверить |
|---------|----------------|
| Нет % в HUD | VPK, порт 3920, не JSON-poll; чужой pak02 Random Shop |
| Нет apply | PNG `slot=cmd`; `-exec autoexec` + F10 для backup |
| Нет событий shop_* | `-condebug`, путь к `console.log` |
| Чат не голосует | Scope `user:read:chat`, точка «Чат»; опция «Требовать !» |
| Настройки сбросились | Должен быть `config/shop-vote.json` после первого запуска / сохранения из `/control` |
| Покупка зависла | Подойти к магазину (`waiting_shop`) |

---

## API (шпаргалка)

```bash
curl http://127.0.0.1:3920/api/shop-vote
curl http://127.0.0.1:3920/api/shop-vote/settings
curl -X POST http://127.0.0.1:3920/api/shop-vote/start -H "Content-Type: application/json" -d "{\"stage\":\"full\"}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/cast -H "Content-Type: application/json" -d "{\"option\":\"weapon\",\"userId\":\"alice\"}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/settings -H "Content-Type: application/json" -d "{\"autoStart\":true,\"minTier\":1,\"maxTier\":3}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/mock -H "Content-Type: application/json" -d "{\"enabled\":true}"
curl -X POST http://127.0.0.1:3920/api/shop-vote/skip
```

Юнит-тесты: `npm run test:unit`.
