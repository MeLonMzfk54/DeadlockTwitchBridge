(function () {
  "use strict";

  // Assets live under the main Deadlock API (assets.deadlock-api.com no longer resolves).
  var API_URL = "https://api.deadlock-api.com/v1/assets/items";

  var BRANDS = {
    weapon: { title: "Fairfax", sub: "Artillery Bought and Sold", theme: "theme-weapon" },
    vitality: { title: "MPS", sub: "Mystic Pharmaceutical Stores", theme: "theme-vitality" },
    spirit: { title: "Curiosities", sub: "Curios for the Discerning", theme: "theme-spirit" },
  };

  var FALLBACK_COST = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };

  var catalog = { weapon: { 1: [], 2: [], 3: [], 4: [] }, vitality: { 1: [], 2: [], 3: [], 4: [] }, spirit: { 1: [], 2: [], 3: [], 4: [] } };
  var activeCat = "weapon";
  var shopOpen = true;
  var searchOpen = false;
  var filterText = "";

  var stage = document.getElementById("stage");
  var shop = document.getElementById("shop");
  var shopStatus = document.getElementById("shopStatus");
  var tiersEl = document.getElementById("tiers");
  var brandTitle = document.getElementById("brandTitle");
  var brandSub = document.getElementById("brandSub");
  var searchBox = document.getElementById("searchBox");
  var searchInput = document.getElementById("searchInput");
  var closeBtn = document.getElementById("closeBtn");

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

  function mapItem(item) {
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
      // Shop images already bake in ACTIVE / IMBUE chrome.
      shopChrome: !!(item.shop_image_webp || item.shop_image),
      active: !!item.is_active_item,
      imbue: !!item.imbue,
    };
  }

  function setStatus(text, isErr) {
    shopStatus.hidden = !text;
    shopStatus.textContent = text || "";
    shopStatus.className = "shop-status" + (isErr ? " err" : "");
  }

  function applyBrand(cat) {
    var brand = BRANDS[cat] || BRANDS.weapon;
    brandTitle.textContent = brand.title;
    brandSub.textContent = brand.sub;
    shop.className = "shop " + brand.theme;
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

  function tierCost(cat, tier) {
    var list = catalog[cat][tier];
    if (list && list.length && typeof list[0].cost === "number") return list[0].cost;
    return FALLBACK_COST[tier];
  }

  function matchesFilter(item) {
    if (!filterText) return true;
    return item.name.toLowerCase().indexOf(filterText) >= 0;
  }

  function renderCards() {
    applyBrand(activeCat);
    setRailActive(activeCat, searchOpen);

    if (!shopOpen) {
      shop.hidden = true;
      return;
    }

    shop.hidden = false;
    searchBox.hidden = !searchOpen;

    var anyVisible = false;
    document.querySelectorAll(".tier-panel").forEach(function (panel) {
      var tier = Number(panel.getAttribute("data-tier"));
      var priceEl = $("[data-price]", panel);
      var cardsEl = $("[data-cards]", panel);
      var items = (catalog[activeCat] && catalog[activeCat][tier]) || [];
      priceEl.textContent = "$" + tierCost(activeCat, tier);
      cardsEl.innerHTML = "";

      items.forEach(function (item) {
        var visible = matchesFilter(item);
        if (visible) anyVisible = true;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "card";
        btn.hidden = !visible;
        btn.title = item.name;
        var badge =
          item.shopChrome
            ? ""
            : item.active
              ? '<span class="card-badge">Active</span>'
              : item.imbue
                ? '<span class="card-badge">Imbue</span>'
                : "";
        var img = item.image
          ? '<img src="' +
            escapeHtml(item.image) +
            '" alt="" loading="lazy" decoding="async" />'
          : "";
        btn.innerHTML =
          '<div class="card-icon">' +
          badge +
          img +
          '</div><div class="card-name">' +
          escapeHtml(item.name) +
          "</div>";
        cardsEl.appendChild(btn);
      });
    });

    if (filterText && !anyVisible) {
      setStatus("No items match \"" + filterText + "\"", false);
      tiersEl.hidden = false;
    } else if (!catalog[activeCat][1].length && !catalog[activeCat][2].length && !catalog[activeCat][3].length && !catalog[activeCat][4].length) {
      setStatus("No shop items for this category", true);
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

  async function loadItems() {
    setStatus("Loading items…", false);
    tiersEl.hidden = true;
    shop.hidden = false;
    applyBrand(activeCat);

    try {
      var res = await fetch(API_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (!Array.isArray(data)) throw new Error("Unexpected response");

      var next = {
        weapon: { 1: [], 2: [], 3: [], 4: [] },
        vitality: { 1: [], 2: [], 3: [], 4: [] },
        spirit: { 1: [], 2: [], 3: [], 4: [] },
      };

      data.forEach(function (raw) {
        if (!isShopable(raw)) return;
        var item = mapItem(raw);
        if (!item) return;
        next[item.cat][item.tier].push(item);
      });

      ["weapon", "vitality", "spirit"].forEach(function (cat) {
        for (var t = 1; t <= 4; t++) {
          next[cat][t].sort(function (a, b) {
            return a.name.localeCompare(b.name);
          });
        }
      });

      catalog = next;
      setStatus("", false);
      renderCards();
    } catch (err) {
      setStatus("Failed to load items from Deadlock Assets API", true);
      tiersEl.hidden = true;
      shop.hidden = false;
    }
  }

  document.querySelectorAll(".rail-btn[data-cat]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cat = btn.getAttribute("data-cat");
      if (shopOpen && activeCat === cat && !searchOpen) {
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
    closeShop();
  });

  searchInput.addEventListener("input", function () {
    filterText = String(searchInput.value || "").trim().toLowerCase();
    renderCards();
  });

  // Local preview keeps the weapon shop open; Twitch overlay uses hover via CSS.
  if (window.location.search.indexOf("hover=1") >= 0) {
    stage.classList.remove("preview-open");
  }

  loadItems();
})();
