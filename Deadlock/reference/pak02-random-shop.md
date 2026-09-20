# Deadlock Panorama VPK — разбор pak02 (Random Shop)

Разобрано 2026-09-18 по живым аддонам в

`E:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\`

Документ — шпаргалка, как устроены чужие Panorama-моды и как не конфликтовать с ними при упаковке нашего VPK. Связан с [PACKAGING.md](../content/citadel_addons/twitch_minimap_fx/PACKAGING.md).

## Что лежит в addons

| Файл | Что это |
|------|---------|
| `pak01_dir.vpk` | **наш** Twitch Bridge (хук на top bar) |
| `pak02_dir.vpk` | **Random Shop** (хук на hero shop) |
| `Source2Viewer.exe` | GUI для просмотра/декомпиляции VPK |

В `game/citadel/gameinfo.gi` путь поиска начинается с `Game citadel/addons` (Deadlock Mod Manager). Аддон-VPK перекрывают стоковый `citadel`.

## Что такое pak02

Это не bridge. Это UI-мод магазина: вкладка Random, которая кидает случайный непрокупленный предмет выбранного тира и сама его покупает.

Состав VPK (исходник + скомпилированная пара):

| Путь | Роль |
|------|------|
| `panorama/layout/citadel_hud_hero_shop.xml` + `.vxml_c` | Стоковый shop + вкладка Random |
| `panorama/scripts/random_shop.js` + `.vjs_c` | Логика |
| `panorama/styles/random_shop.css` + `.vcss_c` | Оверлей при активной вкладке |
| `panorama/styles/custom_icons.css` + `.vcss_c` | Карта иконок предметов |

Нет `addoninfo.txt`, нет `hud.xml`, нет top bar — поэтому живёт рядом с pak01.

## Главный паттерн хука

Panorama-скрипт **сам не стартует**. Его должен `<include>` какой-то layout XML, и этот layout игра должна реально создать.

Random Shop делает тот же трюк, что наш bridge, но на **другой** панели:

| Мод | Override | Зачем этот файл |
|-----|----------|-----------------|
| pak01 twitch_bridge | `citadel_hud_top_bar.xml` | Есть весь матч; не воюет с QoLLock (`hud.xml`) |
| pak02 random shop | `citadel_hud_hero_shop.xml` | UI магазина; вкладка живёт здесь |
| QoLLock (типично) | полный `hud.xml` | Весь HUD |

**Два мода конфликтуют только если шлют один и тот же путь layout.** Меньший `pakNN` побеждает. Разные пути — складываются.

`hud.xml` в наш VPK не класть, если не хотим единолично владеть HUD.

Если понадобится телеметрия магазина при установленном Random Shop: вшить include в **их** `citadel_hud_hero_shop.xml` или смотреть shop с top bar через `FindChildTraverse("CitadelHudHeroShop")`. Второй VPK с тем же `hero_shop` не класть.

## Как работает Random Shop

1. XML — стоковый `CitadelHudHeroShop` плюс:
   - кнопка `#RandomNav`
   - оверлей `#RandomShopContent` (фильтры, T1–T4, выпавший предмет)
   - стили `custom_icons.css`, `random_shop.css`
   - скрипт `s2r://panorama/scripts/random_shop.js`
2. XML вызывает **методы на context panel**, не глобалы:
   - `onmouseactivate="$.GetContextPanel().ActivateRandomTab();"`
   - `$.GetContextPanel().RandomShopRollTier(1)`
   - `$.GetContextPanel().RandomShopToggleCategory('ShopModsListWeapon')`
   В JS: `ctx.RandomShopRollTier = ...`
3. Состояние UI — **CSS-классы на корне магазина**:
   - `gShowingRandom` — вкладка Random видна (нативные списки прячет CSS)
   - `rs-mode-rolled` — идёт ролл
   - `rs-cant-afford` / `rs-no-items` / `rs-filter-on|off`
   Нативный магазин уже использует `showingWeapon|Armor|Tech|Favorites|Search`, `gShopOpen`, `gEditingBuilds`. В XML: `<GlobalClassListener classes="gEditingBuilds gScoreboardOpen gShopOpen" />`.
4. Каталога предметов в публичном API нет. Скрипт:
   - `$.DispatchEvent('CitadelShopModsActivate', 'EItemSlotType_WeaponMod'|Armor|Tech)` — заставляет C++ заполнить списки
   - обходит `ShopModsListWeapon|Armor|Tech` через `FindChildrenWithClassTraverse(cssClass)`
   - хардкодит ~150 CSS-классов предметов (`closeRange`, `berserker`, …)
   - пропускает `owned`, `usedAsComponent`, `itemDisabled`
   - тир берёт из `id` предка, где есть `tier` и цифры
   - id покупки — `GetAttributeInt` по полям `ItemType`, `item_type`, `upgrade_type`, `item_id`, `shopmod_type`, `component_type`, `upgradeid`
5. Покупка — имитация, не документированное API. После ролла:
   - ищет родителя `paneltype === 'CitadelShopMod'`
   - `SetFocus` / `SetInputFocus`
   - пачка `$.DispatchEvent`: `Activated`, `PanelActivated`, `MouseButtonActivate`, `UIEvent.MouseActivate`
   - плюс попытки `CitadelShopPurchaseMod` / `CitadelPurchaseItem` / `CitadelModPurchase` с int-типом
   - подтверждение: поллинг, пока иконка не получит класс `owned` (таймаут 30 с)
   - если во время ролла появился `gEditingBuilds` — слоты полные, отмена
6. Имена: CSS-класс → внутренний ключ (`ITEM_LOCKEYS`) → `$.Localize('#upgrade_' + key)`. Иконки: на `#RSBigIconWrapper` вешаются `{class}-style` и id списка; `custom_icons.css` ставит `background-image: url("s2r://panorama/images/items/{weapon|vitality|spirit}/..._psd.vtex")`.
7. Души: числа с лейблов `#GoldAPContainer` (индекс 2 — текущие души). Запасной вариант `#SoulAmount` (всего собрано, хуже).
8. Вотчеры через `$.Schedule`: нативная вкладка 50 мс, доступность 2 с, диалог замены 0/100 мс.

## Panorama API, которые этот мод подтверждает

Надёжнее, чем гадать про `GameEvents`.

- `$.GetContextPanel()`, `$.Schedule(sec, fn)`, `$.Msg()`, `$.DispatchEvent(name, ...)`
- `$.Localize('#token')`
- Панель: `IsValid()`, `id`, `paneltype`, `text`, `GetParent()`, `GetChild(i)`, `GetChildCount()`
- `FindChildTraverse(id)`, `FindChildrenWithClassTraverse(className)`
- `BHasClass`, `AddClass`, `RemoveClass`, `SetHasClass`
- `GetAttributeInt(name, default)` (у нас ещё `GetAttributeString` / `SetAttributeInt`)
- Нативные события магазина: `CitadelShopModsActivate`, `CitadelExitUpgradeShop`, скорее всего `CitadelShopPurchaseMod`
- `GlobalClassListener` — зеркалит engine-классы на дерево панелей
- XML-хендлеры `onmouseactivate` / `onactivate` / `oncancel`
- Promises работают; если нет `Async`, полифилят `Delay/NextFrame/Condition` через `$.Schedule`

URI скриптов (оба варианта живые):

- Random Shop: `s2r://panorama/scripts/random_shop.js`
- наш bridge: `file://{resources}/scripts/twitch_bridge_events.js`

CSDK-VPK обычно кладёт **и исходник** (`.xml/.js/.css`), **и** `_c`. Движок предпочитает `_c`. XML в pak02 с шапкой Source 2 Viewer — сток декомпилировали, правили, снова собрали.

Скрипты Random Shop стоят **после** дерева панелей, внутри `<root>`. У нас `<scripts>` ближе к верху. Оба варианта валидны.

## VPK и установка

- Имя `pakNN_dir.vpk` в `game/citadel/addons/`. Номер = порядок. **Меньший N побеждает** на одном пути.
- VPK v2, сигнатура `0x55AA1234`. Самодостаточный (`archiveIndex = 0x7FFF`), без `pakNN_000.vpk`.
- Один VPK — одна забота и **один** override layout. Скрипты/CSS с уникальными путями не конфликтуют.
- `addoninfo.txt` необязателен (у pak02 его нет). У bridge он есть.

### Как вскрыть VPK в следующий раз

1. GUI: `Source2Viewer.exe` в папке addons (или VRF).
2. Без CLI: дерево VPK v2 — plaintext-пути после 28-байтного заголовка. Хватает короткого Node-парсера.
3. Если есть исходники `.xml/.js/.css` — читать их. `_c` без исходника декомпилировать Viewer’ом.
4. Первый вопрос после списка файлов: **какой layout перекрыт?** Это и есть множество конфликтов.

## Для twitch-deadlock-bridge

- pak01 (мы) + pak02 (Random Shop) — правильный стек: top_bar vs hero_shop.
- `twitch_bridge_events.js` уже считает shop фазой (`CitadelHudHeroShop` / `gShopOpen`). Random Shop это не ломает, меняет только внутренности вкладки Random.
- Покупки через их shotgun-события не повторять, пока нет эффекта «купить предмет». Для телеметрии — поллинг классов (`owned`, `gShopOpen`) и лейблов.
- Если эффекту нужен DOM магазина: активировать каждую категорию, подождать 60–150 мс, `FindChildrenWithClassTraverse`, читать `CitadelShopMod` + `GetAttributeInt`.
- Список CSS-классов и `#upgrade_*` в `random_shop.js` / `custom_icons.css` — живой каталог предметов. Гниёт после патчей: классов в Panorama нет, всё захардкожено.
- Как в PACKAGING.md: не воевать с QoLLock за `hud.xml`; брать маленький всегда загружаемый layout.

## Конфликты

| Чужой мод перекрывает | Наш top_bar VPK | Заметка |
|-----------------------|-----------------|---------|
| только `hud.xml` (QoLLock) | OK | разные файлы |
| `citadel_hud_hero_shop.xml` (этот pak02) | OK | разные файлы |
| `citadel_hud_top_bar.xml` (pak21 и т.п.) | КОНФЛИКТ | вшить include в их XML или выключить один |
| тот же `hud.xml`, что и мы | КОНФЛИКТ | не класть hud.xml |

## Рецепт новой Panorama-фичи

1. Найти **самый маленький** стоковый layout, который существует в нужный момент (top bar, shop, pause, …). Вытащить из game pak или Viewer.
2. Патч: `<scripts><include …></scripts>` и только свои панели/стили. Нативные id/классы не ломать — на них сидит C++.
3. Своё UI — CSS-классы на context panel + XML `onmouseactivate` → `$.GetContextPanel().YourFn()`.
4. С игрой говорить через **существующие** события / клик по `Citadel*`-панелям, не выдумывать concommand, если канала ещё нет.
5. В VPK: уникальные script/style + один layout. Compiled + source. `pakNN_dir.vpk` с номером, который не отбирает чужой тот же layout.
6. Проверка: F7 / `-condebug` и префиксы `$.Msg`.
