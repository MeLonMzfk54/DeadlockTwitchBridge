# Deadlock Shop — одно Twitch Extension (Panel + Overlay)

Одно расширение с двумя view:

| View | Файл | Назначение |
|------|------|------------|
| **Panel** | `panel.html` | Компактное голосование под видео (категория/тир/предмет → bridge) |
| **Video Overlay** | `overlay.html` | Витрина Fairfax / MPS / Curiosities; browse вне голосования; в `voting_items` — голос за предмет |

Общий `config.js` (`BRIDGE_EBS_BASE`). Карточки всегда из Assets API. Вне голосования оверлей только для просмотра. Во время item-vote клик шлёт `class:<ClassName>` на bridge. Купленные у стримера предметы (`ownedClasses` из события `shop_owned`) серые и некликабельные.

**Язык оверлея:** кнопка `RU` / `EN` на рейке. Переводятся подписи UI (категории, тиры, баннеры, бейджи, статусы); названия предметов остаются как в Assets API. Выбор сохраняется в `localStorage` (`shop-ext-lang`).

Файлы пакета (zip содержимого папки):

```text
panel.html  panel.css  panel.js
overlay.html  overlay.css  overlay.js
config.js
```

Нужно **своё** расширение в [Twitch Developer Console](https://dev.twitch.tv/console/extensions). Чужие Client ID / Secret не подойдут.

Старые папки `extensions/shop-panel/` и `extensions/shop-overlay/` — устаревшие копии; канон — эта папка.

---

## Что нужно

| Компонент | Зачем |
|-----------|--------|
| Своё расширение (Panel **+** Video Overlay) | Client ID + Secret + Local/Hosted Test |
| Bridge (`npm run dev`) на `127.0.0.1:3920` | Голоса, каталог, apply в игру |
| Публичный HTTPS на bridge | Cloudflare Tunnel (или аналог) |
| VPK `twitch_minimap_fx` с `bridge_shop_cls` | Покупка победителя по class_name |
| Deadlock с `-condebug` | События магазина в `console.log` |

Зрителям ничего ставить не нужно — панель и/или overlay на канале.

---

## 1. Создать своё расширение

1. [dev.twitch.tv/console/extensions](https://dev.twitch.tv/console/extensions) → **Create Extension**.
2. Имя любое (например `Deadlock Shop`).
3. Capabilities: **Panel** и **Video Overlay** (оба).
4. **Create Extension Version**.

Client ID расширения — это `TWITCH_EXTENSION_CLIENT_ID`.

### Capabilities / Type

- **Panel** + **Video Overlay**
- Panel Height: **480** (или 400–500)

### Asset Hosting

| Поле | Значение |
|------|----------|
| Panel Viewer Path | `panel.html` |
| Video Overlay Viewer Path | `overlay.html` |
| Base URI (Local Test) | `https://localhost:8080/` (или ваш локальный HTTPS) |

### Allowlist for URL Fetching Domains

Добавьте **все** хосты, с которых view делает `fetch` / грузит иконки:

```text
https://xxxx.trycloudflare.com
https://api.deadlock-api.com
https://assets-bucket.deadlock-api.com
```

| Домен | Зачем |
|-------|--------|
| Хост туннеля (без пути) | Panel → bridge `/api/ext/shop` |
| `api.deadlock-api.com` | Overlay → каталог предметов |
| `assets-bucket.deadlock-api.com` | Иконки предметов в overlay |

Без туннеля в allowlist `fetch` панели на bridge заблокирует CSP. Без API/bucket overlay не загрузит карточки.

### Secret Keys

1. Settings → **Secret Keys** → Create New Secret (если ещё нет).
2. Скопируйте **Key** (base64) — `TWITCH_EXTENSION_SECRET`.

---

## 2. Bridge `.env`

В корне репозитория (`twitch-deadlock-bridge/.env`):

```env
HTTP_HOST=127.0.0.1
HTTP_PORT=3920

TWITCH_EXTENSION_CLIENT_ID=ваш_extension_client_id
TWITCH_EXTENSION_SECRET=ваш_base64_секрет

# Обычно совпадает с broadcaster id (числовой Twitch user id)
TWITCH_BROADCASTER_ID=ваш_id
# TWITCH_EXTENSION_OWNER_ID=  # если owner ≠ broadcaster
```

Если `TWITCH_EXTENSION_CLIENT_ID` не задан, берётся `TWITCH_CLIENT_ID`.

```bash
npm run dev
```

В логе: `[http] Extension API: http://127.0.0.1:3920/api/ext/shop`.

---

## 3. Cloudflare Tunnel (`cloudflared`)

Туннель даёт публичный HTTPS на локальный bridge (`127.0.0.1:3920`). Нужны **два** терминала: bridge + `cloudflared`.

### 3.1. Установка (Windows)

```powershell
winget install --id Cloudflare.cloudflared
```

```powershell
cloudflared --version
```

### 3.2. Bridge

```powershell
cd F:\DeadlockForMods\twitch-deadlock-bridge
npm run test
```

Должен слушать `http://127.0.0.1:3920` (проверьте `/control`).

### 3.3. Quick tunnel

В **другом** окне:

```powershell
cloudflared tunnel --url http://127.0.0.1:3920 2>&1 | Tee-Object -FilePath "$env:TEMP\cf-tunnel.log"
```

Дождитесь `Registered tunnel connection`. URL вида:

```text
https://random-words-xxxx.trycloudflare.com
```

Если не видно в окне:

```powershell
Select-String -Path "$env:TEMP\cf-tunnel.log" -Pattern "trycloudflare.com"
```

Каждый новый quick tunnel = новый URL → снова `config.js` и Allowlist.

### 3.4. Проверка туннеля

```text
https://ВАШ-URL.trycloudflare.com/api/ext/shop
```

| Ответ | Значение |
|-------|----------|
| JSON со `"stage":"…"` | Туннель → bridge ок |
| Сайт недоступен / timeout | Bridge не запущен или туннель упал |

С туннеля доступны только `/api/ext/*`. Управление — локально: `http://127.0.0.1:3920/control`.

### 3.5. Безопасность

При `cf-connecting-ip` / `x-forwarded-for` bridge отдаёт только `/api/ext/*`. Старт голосования и `/control` с туннеля недоступны.

---

## 4. `config.js`

Откройте [`config.js`](config.js) — origin туннеля **без** слэша в конце:

```js
window.BRIDGE_EBS_BASE = "https://xxxx.trycloudflare.com";
```

Local Test без правки файла:

```text
panel.html?ebs=https://xxxx.trycloudflare.com
```

Только на своём PC, без туннеля:

```text
panel.html?local=1
```

→ `http://127.0.0.1:3920`.

Внизу панели: `Preview (no Extension secret)` или `Connected`.

---

## 5. Загрузка фронта

### Вариант A — Local Test

1. Раздайте статику из `extensions/shop-ext`, порт как в Base URI (часто `8080`).
2. Консоль расширения: **Move to Local Test**.
3. На канале: Extensions → установить тестовую версию → Activate → слоты **Panel** и/или **Video Overlay**.

```bash
cd extensions/shop-ext
npx --yes serve -p 8080
```

(для строгого HTTPS см. [документацию Twitch](https://dev.twitch.tv/docs/extensions/) / mkcert.)

### Вариант B — Hosted Test

1. Zip **содержимого** `shop-ext` (не самой папки): `panel.html`, `overlay.html`, `panel.js`, `panel.css`, `overlay.js`, `overlay.css`, `config.js`.
2. Files → Upload Version → Upload.
3. **Move to Hosted Test**.
4. Activate Panel и/или Overlay на канале.

Перед сменой туннеля обновляйте `config.js` и перезаливайте zip (или `?ebs=` в Local Test).

---

## 6. Игра и мод

1. Актуальный VPK из `Deadlock/content/citadel_addons/twitch_minimap_fx/` (после правок JS — перепаковка, `PACKAGING.md`).
2. Launch options: `-condebug` (и `-exec autoexec` для cfg-bind).
3. Bridge видит события магазина (в `/control` — живой пайплайн).

---

## 7. Проверка на стриме

1. Канал → панель расширения под плеером; overlay — поверх видео (наведите / откройте окно магазина).
2. [http://127.0.0.1:3920/control](http://127.0.0.1:3920/control).
3. **Категория / тир:** «Полный цикл» → в панели кнопки Weapon/Vitality/Spirit и T1–T4.
4. **Предмет:** «Голосование за предмет» → скан магазина → карточки в панели / overlay → клик = голос. Победитель — **случайный среди предметов с ≥1 голосом** (`itemWinnerMode: random_among_voted`).
5. **Overlay:** browse API; в item-vote — карточки с % / «In roll», клик голосует.
6. Чат: `!w 1` или `item:0` / `item:1`.

Статус панели:

- `Connected` / `Vote sent` — мост доступен  
- `Bridge unreachable` — туннель, allowlist или `BRIDGE_EBS_BASE`  
- `Invalid extension JWT` — неверный `TWITCH_EXTENSION_SECRET`

---

## Чеклист

- [ ] Создано **своё** расширение (Panel + Video Overlay)
- [ ] Panel Viewer Path = `panel.html`, Overlay Path = `overlay.html`, высота ~480
- [ ] Allowlist: туннель + `api.deadlock-api.com` + `assets-bucket.deadlock-api.com`
- [ ] Secret → `TWITCH_EXTENSION_SECRET`, Client ID → `TWITCH_EXTENSION_CLIENT_ID`
- [ ] Tunnel → `127.0.0.1:3920`
- [ ] `BRIDGE_EBS_BASE` или `?ebs=`
- [ ] Local / Hosted Test, Activated Panel (+ Overlay)
- [ ] Bridge, VPK, `-condebug`
- [ ] Голос с `/control` + клик в панели/overlay; item-vote берёт случайного среди проголосованных

---

## Ссылки

- [Twitch Extensions — Get started](https://dev.twitch.tv/docs/extensions/)
- [Building Extensions (EBS, JWT, PubSub)](https://dev.twitch.tv/docs/extensions/building/)
- Голосование в игре: [`RANDOM_SHOP.md`](../../RANDOM_SHOP.md)
