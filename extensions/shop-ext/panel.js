(function () {
  "use strict";

  var CAT_LABELS = { weapon: "Weapon", vitality: "Vitality", spirit: "Spirit" };
  var STAGE_LABELS = {
    idle: "",
    awaiting_catalog: "Starting…",
    voting_category: "Vote · Category",
    voting_tier: "Vote · Tier",
    voting_combined: "Vote · Type + Tier",
    voting_items: "Vote · Item",
    applying: "Applying",
    rolled: "Rolled",
    waiting_shop: "Walk to shop",
    purchased: "Purchased",
    failed: "Failed",
  };

  var token = "";
  var channelId = "";
  var previewUserId =
    "preview-" + Math.random().toString(36).slice(2, 10);
  var ebsBase = resolveEbsBase();
  var state = null;
  var myVotes = { category: "", tier: "", item: -1 };
  var catalogCache = [];
  var catalogSeq = -1;

  function resolveEbsBase() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var q = params.get("ebs");
      if (q) return String(q).replace(/\/+$/, "");
      // ?local=1 → talk to bridge on this PC (no tunnel / no Twitch JWT needed).
      if (params.get("local") === "1" || params.get("preview") === "1") {
        return "http://127.0.0.1:3920";
      }
    } catch (e) {}
    var fromConfig = typeof window.BRIDGE_EBS_BASE === "string" ? window.BRIDGE_EBS_BASE.trim() : "";
    return fromConfig.replace(/\/+$/, "");
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, cls) {
    var el = $("status");
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  function authHeaders() {
    var h = { "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  async function fetchState() {
    if (!ebsBase) return;
    try {
      var res = await fetch(ebsBase + "/api/ext/shop", {
        method: "GET",
        headers: authHeaders(),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () {
          return {};
        });
        setStatus(err.error || "HTTP " + res.status, "err");
        return;
      }
      var data = await res.json();
      applyState(data, true);
      setStatus(data.preview ? "Preview (no Extension secret)" : "Connected", "ok");
    } catch (e) {
      setStatus("Bridge unreachable — check tunnel / config.js", "err");
    }
  }

  async function castVote(option, meta) {
    if (!ebsBase) return;
    try {
      var payload = { option: option };
      if (meta) {
        if (meta.category) payload.category = meta.category;
        if (meta.tier != null) payload.tier = meta.tier;
        if (meta.name) payload.name = meta.name;
      }
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
        setStatus(body.error || "Vote failed", "err");
        return;
      }
      applyState(body, true);
      setStatus("Vote sent", "ok");
    } catch (e) {
      setStatus("Vote failed — network", "err");
    }
  }

  function applyState(next, fromGet) {
    if (!next || typeof next !== "object") return;
    state = next;
    if (Array.isArray(next.items)) {
      catalogCache = next.items;
      catalogSeq = next.catalogSeq || 0;
    } else if (
      typeof next.catalogSeq === "number" &&
      next.catalogSeq !== catalogSeq &&
      Array.isArray(next.itemNames)
    ) {
      catalogCache = next.itemNames.map(function (name, i) {
        return {
          index: i,
          name: name,
          category: "weapon",
          tier: 1,
          cls: "",
        };
      });
      catalogSeq = next.catalogSeq;
    }
    render();
  }

  function timerText(snap) {
    var stage = snap.stage || "idle";
    if (stage === "idle") return "";
    if (
      snap.stageEndsAt &&
      (stage === "voting_category" ||
        stage === "voting_tier" ||
        stage === "voting_combined" ||
        stage === "voting_items" ||
        stage === "awaiting_catalog")
    ) {
      return Math.max(0, Math.ceil((snap.stageEndsAt - Date.now()) / 1000)) + "s";
    }
    if (stage === "applying") return "…";
    if (stage === "waiting_shop") return "⏳";
    if (stage === "purchased" || stage === "rolled") return "✓";
    return "—";
  }

  function hintText(snap) {
    var stage = snap.stage || "idle";
    if (stage === "idle") return "";
    if (stage === "voting_combined") return "Pick a type and a tier";
    if (stage === "voting_category") return "Pick a category";
    if (stage === "voting_tier") {
      var cat = snap.winnerCategory ? CAT_LABELS[snap.winnerCategory] || snap.winnerCategory : "—";
      return "Category: " + cat + " · pick a tier";
    }
    if (stage === "voting_items") {
      return "Pick an item in Overlay · winner is random among voted";
    }
    if (stage === "awaiting_catalog") return "Starting item vote…";
    if (stage === "waiting_shop") return "Streamer must walk to the shop";
    if (stage === "purchased") return "Item purchased";
    if (stage === "failed") return "Vote failed";
    return "";
  }

  function renderBarButton(label, option, pct, selected, enabled) {
    var wrap = document.createElement("div");
    wrap.className = "row";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn" + (selected ? " selected" : "");
    btn.disabled = !enabled;
    btn.innerHTML =
      '<span>' +
      escapeHtml(label) +
      '</span><div class="bar"><i style="width:' +
      Math.max(0, Math.min(100, pct || 0)) +
      '%"></i></div>';
    if (enabled) {
      btn.addEventListener("click", function () {
        if (option === "weapon" || option === "vitality" || option === "spirit") {
          myVotes.category = option;
        } else {
          myVotes.tier = option;
        }
        void castVote(option);
        render();
      });
    }
    var pctEl = document.createElement("div");
    pctEl.className = "pct";
    pctEl.textContent = (pct || 0) + "%";
    wrap.appendChild(btn);
    wrap.appendChild(pctEl);
    return wrap;
  }

  function render() {
    var snap = state || { stage: "idle" };
    var stage = snap.stage || "idle";
    var head = $("head");
    if (head) head.hidden = stage === "idle";
    $("stage").textContent = stage === "idle" ? "" : STAGE_LABELS[stage] || stage;
    $("timer").textContent = timerText(snap);
    $("hint").textContent = hintText(snap);

    var rows = $("rows");
    var itemsEl = $("items");
    rows.innerHTML = "";
    itemsEl.innerHTML = "";

    if (stage === "idle") {
      itemsEl.hidden = true;
      rows.hidden = false;
      return;
    }

    var live =
      stage === "voting_category" ||
      stage === "voting_tier" ||
      stage === "voting_combined" ||
      stage === "voting_items";
    var showCats =
      stage === "voting_category" ||
      stage === "voting_combined" ||
      stage === "voting_tier" ||
      stage === "applying" ||
      stage === "waiting_shop" ||
      stage === "rolled" ||
      stage === "purchased";
    var showTiers =
      stage === "voting_tier" ||
      stage === "voting_combined" ||
      stage === "applying" ||
      stage === "waiting_shop" ||
      stage === "rolled" ||
      stage === "purchased";

    if (stage === "voting_items") {
      itemsEl.hidden = false;
      rows.hidden = true;
      var list = catalogCache.length ? catalogCache : snap.items || [];
      var pcts = snap.itemPct || [];
      list.forEach(function (it, i) {
        var idx = typeof it.index === "number" ? it.index : i;
        var btn = document.createElement("button");
        btn.type = "button";
        var tally = (snap.itemTally && snap.itemTally[idx]) || 0;
        var inPool = tally > 0;
        btn.className =
          "item " +
          (it.category || "") +
          (myVotes.item === idx ? " selected" : "") +
          (inPool ? " in-pool" : "");
        btn.disabled = !live;
        btn.innerHTML =
          '<div class="name">' +
          escapeHtml(it.name || "Item " + idx) +
          '</div><div class="meta"><span>' +
          escapeHtml(CAT_LABELS[it.category] || it.category || "") +
          " · T" +
          (it.tier || "?") +
          (inPool ? " · in roll" : "") +
          "</span><span>" +
          (pcts[idx] || 0) +
          "%</span></div>";
        if (live) {
          btn.addEventListener("click", function () {
            myVotes.item = idx;
            if (it.cls) {
              void castVote("class:" + it.cls, {
                category: it.category,
                tier: it.tier,
                name: it.name,
              });
            } else {
              void castVote("item:" + idx);
            }
            render();
          });
        }
        itemsEl.appendChild(btn);
      });
      if (!list.length) {
        $("hint").textContent = "Open Overlay and click items to vote";
      }
      return;
    }

    itemsEl.hidden = true;
    rows.hidden = false;

    var enabledCats =
      (snap.settings && snap.settings.enabledCategories) ||
      ["weapon", "vitality", "spirit"];
    var minTier = (snap.settings && snap.settings.minTier) || 1;
    var maxTier = (snap.settings && snap.settings.maxTier) || 4;

    if (showCats) {
      var catTitle = document.createElement("div");
      catTitle.className = "section";
      catTitle.textContent = "Category";
      rows.appendChild(catTitle);
      ["weapon", "vitality", "spirit"].forEach(function (c) {
        if (enabledCats.indexOf(c) < 0) return;
        var pct = (snap.categoryPct && snap.categoryPct[c]) || 0;
        var canVote = live && (stage === "voting_category" || stage === "voting_combined");
        rows.appendChild(
          renderBarButton(
            CAT_LABELS[c],
            c,
            pct,
            myVotes.category === c || snap.winnerCategory === c,
            canVote,
          ),
        );
      });
    }

    if (showTiers) {
      var tierTitle = document.createElement("div");
      tierTitle.className = "section";
      tierTitle.textContent = "Tier";
      rows.appendChild(tierTitle);
      for (var t = 1; t <= 4; t++) {
        if (t < minTier || t > maxTier) continue;
        var key = String(t);
        var tp = (snap.tierPct && snap.tierPct[key]) || 0;
        var canTier = live && (stage === "voting_tier" || stage === "voting_combined");
        rows.appendChild(
          renderBarButton(
            "Tier " + t,
            key,
            tp,
            myVotes.tier === key || snap.winnerTier === t,
            canTier,
          ),
        );
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function onPubSub(_target, _contentType, message) {
    try {
      var data = typeof message === "string" ? JSON.parse(message) : message;
      if (!data || data.t !== "shop") return;
      applyState(data, false);
    } catch (e) {}
  }

  if (!ebsBase) {
    setStatus("Set BRIDGE_EBS_BASE in config.js (tunnel URL)", "err");
  }

  if (window.Twitch && window.Twitch.ext) {
    window.Twitch.ext.onAuthorized(function (auth) {
      token = auth.token;
      channelId = auth.channelId;
      void fetchState();
    });
    try {
      window.Twitch.ext.listen("broadcast", onPubSub);
    } catch (eListen) {}
  } else {
    setStatus("Local preview (no Twitch Helper)", "ok");
  }

  // Poll even without JWT (preview when Extension secret not set).
  void fetchState();
  setInterval(function () {
    void fetchState();
  }, 1500);

  setInterval(function () {
    if (state && state.stage !== "idle") {
      $("timer").textContent = timerText(state);
    }
  }, 500);

  render();
})();
