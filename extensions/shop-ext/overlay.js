(function () {
  "use strict";

  // Assets live under the main Deadlock API (assets.deadlock-api.com no longer resolves).
  var API_URL = "https://api.deadlock-api.com/v1/assets/items";
  var LANG_KEY = "shop-ext-lang";

  var I18N = {
    en: {
      shopCategories: "Shop categories",
      weapon: "Weapon",
      vitality: "Vitality",
      spirit: "Spirit",
      search: "Search",
      language: "Language",
      closeShop: "Close shop",
      filterItems: "Filter items",
      filterPlaceholder: "Filter items…",
      brandWeaponTitle: "Fairfax",
      brandWeaponSub: "Artillery Bought and Sold",
      brandVitalityTitle: "MPS",
      brandVitalitySub: "Mystic Pharmaceutical Stores",
      brandSpiritTitle: "Curiosities",
      brandSpiritSub: "Curios for the Discerning",
      tier1: "Tier 1",
      tier2: "Tier 2",
      tier3: "Tier 3",
      tier4: "Tier 4 Experts Only",
      itemVoteBanner: "Item vote · click a card · random among voted",
      inRollCount: "{n} in roll",
      secondsLeft: "{n}s",
      badgeActive: "Active",
      badgeImbue: "Imbue",
      badgeOwned: "Owned",
      badgeInRoll: "In roll",
      ownedSuffix: "(owned)",
      loadingItems: "Loading items…",
      noFilterMatch: 'No items match "{q}"',
      noCategoryItems: "No shop items for this category",
      setEbsVote: "Set BRIDGE_EBS_BASE in config.js to vote",
      noClassName: "Item has no class_name",
      alreadyOwned: "Item already owned",
      voteSent: "Vote sent",
      voteFailed: "Vote failed",
      voteFailedNetwork: "Vote failed — check tunnel / allowlist",
      loadFailed: "Failed to load items from Deadlock Assets API",
    },
    ru: {
      shopCategories: "Категории магазина",
      weapon: "Оружие",
      vitality: "Живучесть",
      spirit: "Дух",
      search: "Поиск",
      language: "Язык",
      closeShop: "Закрыть магазин",
      filterItems: "Фильтр предметов",
      filterPlaceholder: "Фильтр предметов…",
      brandWeaponTitle: "Fairfax",
      brandWeaponSub: "Артиллерия: купля и продажа",
      brandVitalityTitle: "MPS",
      brandVitalitySub: "Мистические аптеки",
      brandSpiritTitle: "Диковины",
      brandSpiritSub: "Диковины для ценителей",
      tier1: "Тир 1",
      tier2: "Тир 2",
      tier3: "Тир 3",
      tier4: "Тир 4 · только эксперты",
      itemVoteBanner: "Голос за предмет · клик по карточке · случайный среди проголосовавших",
      inRollCount: "{n} в ролле",
      secondsLeft: "{n}с",
      badgeActive: "Активный",
      badgeImbue: "Imbue",
      badgeOwned: "Куплено",
      badgeInRoll: "В ролле",
      ownedSuffix: "(куплено)",
      loadingItems: "Загрузка предметов…",
      noFilterMatch: 'Нет предметов по запросу «{q}»',
      noCategoryItems: "Нет предметов в этой категории",
      setEbsVote: "Укажите BRIDGE_EBS_BASE в config.js для голосования",
      noClassName: "У предмета нет class_name",
      alreadyOwned: "Предмет уже куплен",
      voteSent: "Голос отправлен",
      voteFailed: "Не удалось проголосовать",
      voteFailedNetwork: "Голос не отправлен — проверьте туннель / allowlist",
      loadFailed: "Не удалось загрузить предметы из Deadlock Assets API",
    },
  };

  var BRIDGE_ERROR_KEYS = {
    "item already owned": "alreadyOwned",
    "vote failed": "voteFailed",
  };

  var FALLBACK_COST = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };

  var emptyBuckets = function () {
    return {
      weapon: { 1: [], 2: [], 3: [], 4: [] },
      vitality: { 1: [], 2: [], 3: [], 4: [] },
      spirit: { 1: [], 2: [], 3: [], 4: [] },
    };
  };

  /** Full shop from public Assets API (browse + item vote cards). */
  var apiCatalog = emptyBuckets();
  var apiLoaded = false;

  var activeCat = "weapon";
  var shopOpen = true;
  var searchOpen = false;
  var filterText = "";
  /** Last class_name this viewer voted for during item vote. */
  var myItemVoteClass = "";

  var ebsBase = resolveEbsBase();
  var token = "";
  var previewUserId = "preview-" + Math.random().toString(36).slice(2, 10);
  var bridgeState = null;
  var lang = detectLang();

  var stage = document.getElementById("stage");
  var shop = document.getElementById("shop");
  var shopStatus = document.getElementById("shopStatus");
  var tiersEl = document.getElementById("tiers");
  var brandTitle = document.getElementById("brandTitle");
  var brandSub = document.getElementById("brandSub");
  var searchBox = document.getElementById("searchBox");
  var searchInput = document.getElementById("searchInput");
  var closeBtn = document.getElementById("closeBtn");
  var voteBanner = document.getElementById("voteBanner");
  var langBtn = document.getElementById("langBtn");
  var langCode = document.getElementById("langCode");
  var rail = document.getElementById("rail");

  function detectLang() {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored === "ru" || stored === "en") return stored;
    } catch (e) {}
    var raw = "";
    try {
      if (window.Twitch && window.Twitch.ext && window.Twitch.ext.viewer) {
        raw = String(window.Twitch.ext.viewer.language || "");
      }
    } catch (e2) {}
    if (!raw) {
      try {
        raw = String(navigator.language || navigator.userLanguage || "");
      } catch (e3) {}
    }
    return /^ru/i.test(raw) ? "ru" : "en";
  }

  function t(key, vars) {
    var pack = I18N[lang] || I18N.en;
    var s = pack[key] != null ? pack[key] : I18N.en[key] != null ? I18N.en[key] : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function localizeBridgeError(err) {
    if (!err) return "";
    var key = BRIDGE_ERROR_KEYS[String(err).toLowerCase()];
    return key ? t(key) : String(err);
  }

  function brandFor(cat) {
    if (cat === "vitality") {
      return {
        title: t("brandVitalityTitle"),
        sub: t("brandVitalitySub"),
        theme: "theme-vitality",
      };
    }
    if (cat === "spirit") {
      return {
        title: t("brandSpiritTitle"),
        sub: t("brandSpiritSub"),
        theme: "theme-spirit",
      };
    }
    return {
      title: t("brandWeaponTitle"),
      sub: t("brandWeaponSub"),
      theme: "theme-weapon",
    };
  }

  function applyStaticI18n() {
    document.documentElement.lang = lang;
    if (rail) rail.setAttribute("aria-label", t("shopCategories"));
    document.querySelectorAll(".rail-btn[data-cat]").forEach(function (btn) {
      var cat = btn.getAttribute("data-cat");
      var label = t(cat);
      btn.title = label;
      btn.setAttribute("aria-label", label);
    });
    var searchBtn = document.querySelector(".rail-btn.search");
    if (searchBtn) {
      searchBtn.title = t("search");
      searchBtn.setAttribute("aria-label", t("search"));
    }
    if (langBtn) {
      langBtn.title = t("language");
      langBtn.setAttribute("aria-label", t("language"));
    }
    if (langCode) langCode.textContent = lang === "ru" ? "RU" : "EN";
    if (closeBtn) closeBtn.setAttribute("aria-label", t("closeShop"));
    if (searchInput) searchInput.placeholder = t("filterPlaceholder");
    var filterLabel = searchBox && searchBox.querySelector(".sr-only");
    if (filterLabel) filterLabel.textContent = t("filterItems");
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
  }

  function setLang(next) {
    lang = next === "ru" ? "ru" : "en";
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {}
    applyStaticI18n();
    renderCards();
  }

  function toggleLang() {
    setLang(lang === "ru" ? "en" : "ru");
  }

  function resolveEbsBase() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var q = params.get("ebs");
      if (q) return String(q).replace(/\/+$/, "");
      if (params.get("local") === "1" || params.get("preview") === "1") {
        return "http://127.0.0.1:3920";
      }
    } catch (e) {}
    var fromConfig =
      typeof window.BRIDGE_EBS_BASE === "string" ? window.BRIDGE_EBS_BASE.trim() : "";
    return fromConfig.replace(/\/+$/, "");
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function authHeaders() {
    var h = { "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function isItemsVoting() {
    return bridgeState && bridgeState.stage === "voting_items";
  }

  function isTypeTierVoting(stage) {
    return (
      stage === "voting_category" ||
      stage === "voting_tier" ||
      stage === "voting_combined"
    );
  }

  function voteStatsForClass(cls) {
    var items = (bridgeState && bridgeState.items) || [];
    var pcts = (bridgeState && bridgeState.itemPct) || [];
    var tallies = (bridgeState && bridgeState.itemTally) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].cls === cls) {
        return {
          pct: pcts[i] || 0,
          tally: tallies[i] || 0,
          index: typeof items[i].index === "number" ? items[i].index : i,
        };
      }
    }
    return { pct: 0, tally: 0, index: -1 };
  }

  function normalizeSlot(raw) {
    var s = String(raw || "").toLowerCase();
    if (s.indexOf("weapon") >= 0 || s === "weaponmod" || s === "weapon_mod") return "weapon";
    if (s.indexOf("armor") >= 0 || s.indexOf("vital") >= 0) return "vitality";
    if (s.indexOf("tech") >= 0 || s.indexOf("spirit") >= 0) return "spirit";
    return "";
  }

  function normalizeTier(raw) {
    if (typeof raw === "number" && raw >= 1 && raw <= 4) return raw;
    var s = String(raw || "");
    var m = s.match(/([1-4])/);
    if (m) return Number(m[1]);
    return 0;
  }

  function isShopable(item) {
    if (!item || item.type !== "upgrade") return false;
    if (item.shopable === true) return true;
    if (item.shopable === false) return false;
    if (item.disabled) return false;
    var slot = normalizeSlot(item.item_slot_type);
    return !!slot && !!(item.image_webp || item.image);
  }

  function mapApiItem(item) {
    var cat = normalizeSlot(item.item_slot_type);
    var tier = normalizeTier(item.item_tier);
    if (!cat || tier < 1 || tier > 4) return null;
    return {
      name: item.name || item.class_name || "Item",
      className: item.class_name || "",
      cat: cat,
      tier: tier,
      cost: typeof item.cost === "number" ? item.cost : FALLBACK_COST[tier],
      image:
        item.shop_image_webp ||
        item.shop_image ||
        item.image_webp ||
        item.image ||
        "",
      shopChrome: !!(item.shop_image_webp || item.shop_image),
      active: !!item.is_active_item,
      imbue: !!item.imbue,
      catalogIndex: -1,
      votePct: 0,
      voteCount: 0,
    };
  }

  function displayCatalog() {
    return apiCatalog;
  }

  function setStatus(text, isErr) {
    shopStatus.hidden = !text;
    shopStatus.textContent = text || "";
    shopStatus.className = "shop-status" + (isErr ? " err" : "");
  }

  function updateVoteBanner() {
    if (!voteBanner) return;
    if (isItemsVoting()) {
      var ends = bridgeState.stageEndsAt;
      var left =
        ends && Number.isFinite(ends)
          ? Math.max(0, Math.ceil((ends - Date.now()) / 1000))
          : null;
      var voted = ((bridgeState && bridgeState.itemTally) || []).filter(function (n) {
        return n > 0;
      }).length;
      voteBanner.hidden = false;
      voteBanner.textContent =
        t("itemVoteBanner") +
        (voted ? " · " + t("inRollCount", { n: voted }) : "") +
        (left != null ? " · " + t("secondsLeft", { n: left }) : "");
      return;
    }
    voteBanner.hidden = true;
    voteBanner.textContent = "";
  }

  function applyBrand(cat) {
    var brand = brandFor(cat);
    brandTitle.textContent = brand.title;
    brandSub.textContent = brand.sub;
    shop.className =
      "shop " + brand.theme + (isItemsVoting() ? " vote-live" : "");
  }

  function setRailActive(cat, searching) {
    document.querySelectorAll(".rail-btn[data-cat]").forEach(function (btn) {
      var on = !searching && btn.getAttribute("data-cat") === cat && shopOpen;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var searchBtn = $(".rail-btn.search");
    if (searchBtn) {
      searchBtn.classList.toggle("active", !!searching);
      searchBtn.setAttribute("aria-pressed", searching ? "true" : "false");
    }
  }

  function tierCost(cat, tier, list) {
    if (list && list.length && typeof list[0].cost === "number") return list[0].cost;
    return FALLBACK_COST[tier];
  }

  function matchesFilter(item) {
    if (!filterText) return true;
    return item.name.toLowerCase().indexOf(filterText) >= 0;
  }

  /**
   * Bridge sends Assets API class_names in ownedClasses (mapped explicitly).
   * Exact match only — blind camelCase↔upgrade_ aliases caused false «КУПЛЕНО».
   */
  function ownedClassSet() {
    var list = (bridgeState && bridgeState.ownedClasses) || [];
    var set = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var cls = String(list[i] || "").trim();
      if (cls) set[cls] = true;
    }
    return set;
  }

  function isItemOwned(item, owned) {
    if (!item || !item.className || !owned) return false;
    return !!owned[item.className];
  }

  function renderCards() {
    applyBrand(activeCat);
    setRailActive(activeCat, searchOpen);
    updateVoteBanner();

    if (!shopOpen) {
      shop.hidden = true;
      return;
    }

    shop.hidden = false;
    searchBox.hidden = !searchOpen;

    var catalog = displayCatalog();
    var voting = isItemsVoting();
    var owned = ownedClassSet();
    var anyVisible = false;
    var anyInCat = false;

    document.querySelectorAll(".tier-panel").forEach(function (panel) {
      var tier = Number(panel.getAttribute("data-tier"));
      var priceEl = $("[data-price]", panel);
      var cardsEl = $("[data-cards]", panel);
      var items = (catalog[activeCat] && catalog[activeCat][tier]) || [];
      if (items.length) anyInCat = true;
      priceEl.textContent = "$" + tierCost(activeCat, tier, items);
      cardsEl.innerHTML = "";

      items.forEach(function (item) {
        var visible = matchesFilter(item);
        if (visible) anyVisible = true;
        var btn = document.createElement("button");
        btn.type = "button";
        var ownedItem = isItemOwned(item, owned);
        var stats =
          voting && !ownedItem && item.className
            ? voteStatsForClass(item.className)
            : null;
        var votePct = stats ? stats.pct : 0;
        var voteCount = stats ? stats.tally : 0;
        var inPool = voting && !ownedItem && voteCount > 0;
        var selected =
          voting &&
          !ownedItem &&
          item.className &&
          item.className === myItemVoteClass;
        btn.className =
          "card" +
          (ownedItem ? " owned" : "") +
          (!ownedItem && voting ? " voteable" : "") +
          (selected ? " selected" : "") +
          (inPool ? " in-pool" : "");
        btn.hidden = !visible;
        btn.disabled = ownedItem || !voting;
        btn.title = ownedItem ? item.name + " " + t("ownedSuffix") : item.name;
        if (ownedItem || !voting) btn.setAttribute("aria-disabled", "true");

        var badge =
          item.shopChrome
            ? ""
            : item.active
              ? '<span class="card-badge">' + escapeHtml(t("badgeActive")) + "</span>"
              : item.imbue
                ? '<span class="card-badge">' + escapeHtml(t("badgeImbue")) + "</span>"
                : "";
        var voteBadge = "";
        if (ownedItem) {
          voteBadge +=
            '<span class="card-owned-badge">' + escapeHtml(t("badgeOwned")) + "</span>";
        } else if (voting) {
          if (inPool) {
            voteBadge +=
              '<span class="card-vote-pool">' + escapeHtml(t("badgeInRoll")) + "</span>";
          }
          voteBadge +=
            '<span class="card-vote-pct">' + Math.max(0, votePct) + "%</span>";
        }
        var img = item.image
          ? '<img src="' +
            escapeHtml(item.image) +
            '" alt="" loading="lazy" decoding="async" />'
          : "";
        btn.innerHTML =
          '<div class="card-icon">' +
          badge +
          voteBadge +
          img +
          '</div><div class="card-name">' +
          escapeHtml(item.name) +
          "</div>";

        if (!ownedItem && voting && item.className) {
          btn.addEventListener("click", function () {
            myItemVoteClass = item.className;
            void castItemVote(item);
            renderCards();
          });
        }
        cardsEl.appendChild(btn);
      });
    });

    if (filterText && !anyVisible) {
      setStatus(t("noFilterMatch", { q: filterText }), false);
      tiersEl.hidden = false;
    } else if (!anyInCat) {
      setStatus(t("noCategoryItems"), true);
      tiersEl.hidden = true;
    } else {
      setStatus("", false);
      tiersEl.hidden = false;
    }
  }

  function openCategory(cat) {
    activeCat = cat;
    shopOpen = true;
    searchOpen = false;
    stage.classList.add("force-open");
    renderCards();
  }

  function closeShop() {
    shopOpen = false;
    searchOpen = false;
    searchBox.hidden = true;
    shop.hidden = true;
    setRailActive(activeCat, false);
  }

  function toggleSearch() {
    if (!shopOpen) shopOpen = true;
    searchOpen = !searchOpen;
    if (searchOpen) {
      searchBox.hidden = false;
      searchInput.focus();
    } else {
      searchBox.hidden = true;
      filterText = "";
      searchInput.value = "";
    }
    stage.classList.add("force-open");
    renderCards();
  }

  function applyBridgeState(next) {
    if (!next || typeof next !== "object") return;
    var prevStage = bridgeState && bridgeState.stage;
    bridgeState = next;
    var nextStage = next.stage || "idle";
    // Close the shop window once when entering type/tier vote so only the rail stays.
    // Do not re-close on every poll — viewer may reopen a category to browse.
    if (isTypeTierVoting(nextStage) && prevStage !== nextStage) {
      closeShop();
    }
    if (isItemsVoting()) {
      shopOpen = true;
      stage.classList.add("force-open");
    }
    renderCards();
  }

  async function fetchBridgeState() {
    if (!ebsBase) return;
    try {
      var res = await fetch(ebsBase + "/api/ext/shop", {
        method: "GET",
        headers: authHeaders(),
      });
      if (!res.ok) return;
      var data = await res.json();
      applyBridgeState(data);
    } catch (e) {
      /* bridge optional for browse-only */
    }
  }

  async function castItemVote(item) {
    if (!ebsBase) {
      setStatus(t("setEbsVote"), true);
      return;
    }
    if (!item || !item.className) {
      setStatus(t("noClassName"), true);
      return;
    }
    if (isItemOwned(item, ownedClassSet())) {
      setStatus(t("alreadyOwned"), true);
      return;
    }
    try {
      var payload = {
        option: "class:" + item.className,
        category: item.cat,
        tier: item.tier,
        name: item.name,
      };
      if (!token) payload.userId = previewUserId;
      var res = await fetch(ebsBase + "/api/ext/shop/vote", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        setStatus(localizeBridgeError(body.error) || t("voteFailed"), true);
        return;
      }
      applyBridgeState(body);
      setStatus(t("voteSent"), false);
    } catch (e) {
      setStatus(t("voteFailedNetwork"), true);
    }
  }

  async function loadApiItems() {
    setStatus(t("loadingItems"), false);
    tiersEl.hidden = true;
    shop.hidden = false;
    applyBrand(activeCat);

    try {
      var res = await fetch(API_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (!Array.isArray(data)) throw new Error("Unexpected response");

      var next = emptyBuckets();

      data.forEach(function (raw) {
        if (!isShopable(raw)) return;
        var item = mapApiItem(raw);
        if (!item) return;
        next[item.cat][item.tier].push(item);
      });

      ["weapon", "vitality", "spirit"].forEach(function (cat) {
        for (var tier = 1; tier <= 4; tier++) {
          next[cat][tier].sort(function (a, b) {
            return a.name.localeCompare(b.name);
          });
        }
      });

      apiCatalog = next;
      apiLoaded = true;
      setStatus("", false);
      renderCards();
    } catch (err) {
      setStatus(t("loadFailed"), true);
      tiersEl.hidden = true;
      shop.hidden = false;
    }
  }

  function onPubSub(_target, _contentType, message) {
    try {
      var data = typeof message === "string" ? JSON.parse(message) : message;
      if (!data || data.t !== "shop") return;
      applyBridgeState(data);
    } catch (e) {}
  }

  document.querySelectorAll(".rail-btn[data-cat]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cat = btn.getAttribute("data-cat");
      if (shopOpen && activeCat === cat && !searchOpen && !isItemsVoting()) {
        closeShop();
        return;
      }
      openCategory(cat);
    });
  });

  $(".rail-btn.search").addEventListener("click", function () {
    toggleSearch();
  });

  closeBtn.addEventListener("click", function () {
    if (isItemsVoting()) return;
    closeShop();
  });

  if (langBtn) {
    langBtn.addEventListener("click", function () {
      toggleLang();
    });
  }

  searchInput.addEventListener("input", function () {
    filterText = String(searchInput.value || "").trim().toLowerCase();
    renderCards();
  });

  if (window.location.search.indexOf("hover=1") >= 0) {
    stage.classList.remove("preview-open");
  }

  applyStaticI18n();

  if (window.Twitch && window.Twitch.ext) {
    window.Twitch.ext.onAuthorized(function (auth) {
      token = auth.token;
      void fetchBridgeState();
    });
    try {
      window.Twitch.ext.listen("broadcast", onPubSub);
    } catch (eListen) {}
  }

  void loadApiItems();
  void fetchBridgeState();
  setInterval(function () {
    void fetchBridgeState();
  }, 1500);
  setInterval(function () {
    if (isItemsVoting()) updateVoteBanner();
  }, 500);
})();
