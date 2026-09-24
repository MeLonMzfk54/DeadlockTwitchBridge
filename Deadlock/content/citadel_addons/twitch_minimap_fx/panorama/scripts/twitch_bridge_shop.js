// twitch_bridge_shop.js — shop vote HUD via PNG image side-channel + cfg apply
(function () {
    "use strict";

    var MOD_VERSION = "1.9.0";
    var LOG_PREFIX = "[twitch_bridge] EVENT ";
    var POLL_SEC = 0.2;
    var BUSY_WATCHDOG_SEC = 10.0;
    var DIAG_EMIT_SEC = 5.0;
    var VOTE_BTN_DEBOUNCE_MS = 1500;
    var DEFAULT_URL = "http://127.0.0.1:3920/api/game-event";
    var DEFAULT_CMD_URL = "http://127.0.0.1:3920/api/shop-cmd";
    var DEFAULT_VOTE_URL = "http://127.0.0.1:3920/api/shop-vote";
    var DEFAULT_BRIDGE_BASE = "http://127.0.0.1:3920";
    // Default off; enable with convar `bridge_shop_debug 1`.
    var UI_DEBUG = false;

    // PNG side-channel (Minigames-compatible). AsyncWebRequest is dead in Deadlock Panorama.
    var PNG_STEP = 9;
    var PNG_BASE = 15;
    var PROBE_W = 600;
    var PROBE_H = 1000;
    var IMG_POLL_SEC = 1.2;
    var IMG_POLL_VOTE_SEC = 0.5;
    var IMG_DIM_POLL = 0.05;
    var IMG_TIMEOUT_MS = 8000;
    var IMG_PROBE_ATTEMPTS = 3;
    // cmd after meta: PNG apply/skip (cfg-poll remains backup).
    var HUD_SLOTS = ["cats", "t12", "t34", "meta", "cmd", "banner"];
    var CMD_SEQ_MAX = 200;

    var CV_URL = "bridge_evt_url";
    var CV_SEQ = "bridge_shop_seq";
    var CV_CAT = "bridge_shop_cat";
    var CV_TIER = "bridge_shop_tier";
    var CV_DEBUG = "bridge_shop_debug";

    var CAT_TO_LIST = {
        1: "ShopModsListWeapon",
        2: "ShopModsListArmor",
        3: "ShopModsListTech"
    };
    var LIST_TO_FILTER = {
        ShopModsListWeapon: "RSFilterWeapon",
        ShopModsListArmor: "RSFilterArmor",
        ShopModsListTech: "RSFilterTech"
    };
    var ALL_LISTS = ["ShopModsListWeapon", "ShopModsListArmor", "ShopModsListTech"];

    var bootTs = Date.now ? Date.now() : (new Date()).getTime();
    var bootGen = 0;

    // Allow re-boot when shop HUD panel is recreated (globalThis flag alone blocked polls forever).
    try {
        var bootRoot = null;
        try {
            if (typeof $ !== "undefined" && typeof $.GetContextPanel === "function") {
                bootRoot = $.GetContextPanel();
            }
        } catch (eRoot) {}
        if (typeof globalThis !== "undefined") {
            var prev = globalThis.__twitch_bridge_shop_boot;
            if (prev && prev.root === bootRoot && prev.active) {
                return;
            }
            bootGen = (prev && prev.gen ? prev.gen : 0) + 1;
            globalThis.__twitch_bridge_shop_boot = {
                root: bootRoot,
                gen: bootGen,
                active: true,
                ts: bootTs
            };
            // Keep legacy flag for older diagnostics; do not early-return on it alone.
            globalThis.__twitch_bridge_shop_booted = true;
        }
    } catch (eBoot) {}

    var state = {
        seq: 0,
        lastAppliedSeq: 0,
        busy: false,
        busySinceMs: 0,
        httpOk: null,
        httpPollInFlight: false,
        votePollInFlight: false,
        shopOpen: null,
        pendingCmd: null,
        awaitingRollSeq: 0,
        lastDomNotReadyEmit: 0,
        lastDiagEmit: 0,
        lastVoteHudEmit: 0,
        votePaintTick: 0,
        lastVoteStage: "",
        lastDebugLine: "",
        voteNet: "img_wait",
        cmdNet: "cfg",
        lastVoteMirror: null,
        lastVoteParseHint: "",
        _pendingApplyMeta: null,
        voteBtnLastClickMs: 0,
        bootGen: bootGen,
        imgReqCounter: 0,
        imgBusy: false,
        imgQueue: [],
        imgCalibrated: false,
        imgCalibrating: false,
        imgScaleX: 1,
        imgScaleY: 1,
        imgSwap: false,
        imgRoundScheduled: false,
        imgSlotCache: { cats: null, t12: null, t34: null, meta: null, cmd: null }
    };

    function nowMs() {
        return Date.now ? Date.now() : (new Date()).getTime();
    }

    function nextId() {
        state.seq += 1;
        return "shop" + bootTs + "-e" + state.seq;
    }

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return "{\"type\":\"raw\",\"payload\":{\"error\":\"stringify_failed\"}}";
        }
    }

    function readConvarString(name, fallback) {
        var api = typeof GameInterfaceAPI !== "undefined" ? GameInterfaceAPI : null;
        var game = typeof Game !== "undefined" ? Game : null;
        var readers = [];
        if (api && typeof api.GetConvarString === "function") {
            readers.push(function () { return api.GetConvarString(name, ""); });
        }
        if (api && typeof api.GetConVarString === "function") {
            readers.push(function () { return api.GetConVarString(name, ""); });
        }
        if (game && typeof game.GetConvarString === "function") {
            readers.push(function () { return game.GetConvarString(name, ""); });
        }
        if (game && typeof game.ConvarGetString === "function") {
            readers.push(function () { return game.ConvarGetString(name, ""); });
        }
        for (var i = 0; i < readers.length; i++) {
            try {
                var v = readers[i]();
                if (v !== undefined && v !== null && String(v) !== "") return String(v);
            } catch (e) {}
        }
        return fallback;
    }

    function readConvarInt(name, fallback) {
        var raw = readConvarString(name, "");
        if (raw === "") return fallback;
        var n = Number.parseInt(raw, 10);
        return Number.isFinite(n) ? n : fallback;
    }

    function tryRegisterConvars() {
        var names = [CV_SEQ, CV_CAT, CV_TIER, CV_DEBUG];
        var registered = [];
        var candidates = [];
        if (typeof Convars !== "undefined" && Convars) candidates.push(Convars);
        if (typeof GameInterfaceAPI !== "undefined" && GameInterfaceAPI) candidates.push(GameInterfaceAPI);
        if (typeof Game !== "undefined" && Game) candidates.push(Game);

        for (var c = 0; c < candidates.length; c++) {
            var api = candidates[c];
            var fn =
                (typeof api.RegisterConVar === "function" && api.RegisterConVar) ||
                (typeof api.RegisterConvar === "function" && api.RegisterConvar) ||
                (typeof api.CreateConVar === "function" && api.CreateConVar) ||
                null;
            if (!fn) continue;
            for (var i = 0; i < names.length; i++) {
                try {
                    fn.call(api, names[i], "0", 0, "twitch bridge shop");
                    registered.push(names[i]);
                } catch (e) {}
            }
            if (registered.length) break;
        }
        return registered;
    }

    function refreshUiDebug() {
        var on = readConvarInt(CV_DEBUG, 0) === 1;
        if (on === UI_DEBUG) return UI_DEBUG;
        UI_DEBUG = on;
        applyVoteMirrorVisibility();
        return UI_DEBUG;
    }

    function applyVoteMirrorVisibility() {
        var root = getRoot();
        if (!root) return;
        try {
            var mirror = root.FindChildTraverse("RSVoteMirror");
            if (!mirror) return;
            if (UI_DEBUG) {
                mirror.RemoveClass("rs-debug-hidden");
                try { mirror.style.visibility = "visible"; } catch (eV) {}
            } else {
                mirror.AddClass("rs-debug-hidden");
                try { mirror.style.visibility = "collapse"; } catch (eC) {}
            }
        } catch (e) {}
    }

    function currentImgPollSec() {
        var stage = state.lastVoteStage || "";
        if (stage === "voting_category" || stage === "voting_tier" || stage === "voting_combined") {
            return IMG_POLL_VOTE_SEC;
        }
        return IMG_POLL_SEC;
    }

    function getPostUrl() {
        var url = readConvarString(CV_URL, "");
        return url || DEFAULT_URL;
    }

    function getShopCmdUrl() {
        var post = getPostUrl();
        if (post && post.indexOf("/api/game-event") !== -1) {
            return post.replace("/api/game-event", "/api/shop-cmd");
        }
        return DEFAULT_CMD_URL;
    }

    function getShopVoteUrl() {
        var post = getPostUrl();
        if (post && post.indexOf("/api/game-event") !== -1) {
            return post.replace("/api/game-event", "/api/shop-vote");
        }
        return DEFAULT_VOTE_URL;
    }

    function getBridgeBase() {
        var post = getPostUrl();
        if (post && post.indexOf("/api/") !== -1) {
            return post.replace(/\/api\/.*$/, "");
        }
        return DEFAULT_BRIDGE_BASE;
    }

    function getProbeUrl() {
        state.imgReqCounter += 1;
        return getBridgeBase() + "/api/shop-probe.png?rnd=" + Math.random() + "x" + state.imgReqCounter;
    }

    function getHudSlotUrl(slot) {
        state.imgReqCounter += 1;
        return getBridgeBase() + "/api/shop-vote-hud.png?slot=" + slot +
            "&rnd=" + Math.random() + "x" + state.imgReqCounter;
    }

    function emit(type, payload, opts) {
        opts = opts || {};
        var evt = {
            v: 1,
            id: nextId(),
            tsMs: nowMs(),
            type: type,
            payload: payload || {}
        };
        var json = safeStringify(evt);
        if (!opts.skipLog) {
            try {
                $.Msg(LOG_PREFIX + json + "\n");
            } catch (e) {}
        }
        if (typeof $ !== "undefined" && typeof $.AsyncWebRequest === "function") {
            try {
                $.AsyncWebRequest(getPostUrl(), {
                    type: "POST",
                    data: json,
                    timeout: 3000,
                    headers: { "Content-Type": "application/json" },
                    complete: function (response) {
                        var status = 0;
                        try {
                            status = response && (response.status || response.statusCode || 0);
                        } catch (e2) {}
                        state.httpOk = status >= 200 && status < 300;
                    }
                });
            } catch (ePost) {
                state.httpOk = false;
            }
        }
        return evt;
    }

    /** Map PNG stage → HUD button action/label. */
    function voteButtonModeForStage(stage) {
        var s = stage || "";
        if (s === "applying" || s === "rolled" || s === "waiting_shop") {
            return { action: "skip", label: "SKIP", css: "rs-vote-btn-skip" };
        }
        if (s === "voting_category" || s === "voting_tier" || s === "voting_combined") {
            return { action: "restart", label: "RESTART", css: "rs-vote-btn-restart" };
        }
        return { action: "start", label: "START VOTE", css: "" };
    }

    function updateVoteStartBtn(stage) {
        var root = getRoot();
        if (!root) return;
        var mode = voteButtonModeForStage(stage || state.lastVoteStage || "idle");
        setLabelText(root, "RSVoteStartLabel", mode.label);
        setPanelClass(root, "RSVoteStartBtn", "rs-vote-btn-skip", mode.css === "rs-vote-btn-skip");
        setPanelClass(root, "RSVoteStartBtn", "rs-vote-btn-restart", mode.css === "rs-vote-btn-restart");
    }

    function TwitchBridgeVoteButton() {
        var now = nowMs();
        if (state.voteBtnLastClickMs && now - state.voteBtnLastClickMs < VOTE_BTN_DEBOUNCE_MS) {
            return;
        }
        state.voteBtnLastClickMs = now;
        var mode = voteButtonModeForStage(state.lastVoteStage || "idle");
        if (mode.action === "skip") {
            emit("shop_vote_skip", attachHero({ source: "hud" }));
            try { $.Msg("[twitch_bridge] HUD vote button: skip"); } catch (eSkip) {}
            return;
        }
        emit("shop_vote_start", attachHero({ source: "hud", mode: mode.action }));
        try { $.Msg("[twitch_bridge] HUD vote button: " + mode.action); } catch (eStart) {}
    }

    function getRoot() {
        try {
            return $.GetContextPanel();
        } catch (e) {
            return null;
        }
    }

    function isPlaceholderHero(name) {
        if (name === undefined || name === null) return true;
        var s = String(name).trim();
        if (!s) return true;
        if (s.indexOf("{") !== -1) return true;
        return false;
    }

    function readShopHeroName() {
        var root = getRoot();
        if (!root) return "";
        try {
            if (typeof root.GetDialogVariable === "function") {
                var d = root.GetDialogVariable("hero_name") || root.GetDialogVariable("heroname");
                if (!isPlaceholderHero(d)) return String(d);
            }
        } catch (e) {}
        try {
            if (typeof root.FindChildrenWithClassTraverse === "function") {
                var labels = root.FindChildrenWithClassTraverse("HeroFavoritesHeaderLabel");
                if (labels && labels.length) {
                    var lab = labels[0];
                    if (lab && typeof lab.GetDialogVariable === "function") {
                        var d2 = lab.GetDialogVariable("hero_name") || lab.GetDialogVariable("heroname");
                        if (!isPlaceholderHero(d2)) return String(d2);
                    }
                }
            }
        } catch (e2) {}
        return "";
    }

    function attachHero(info) {
        var out = info || {};
        if (!out.hero) {
            var hero = readShopHeroName();
            if (hero) out.hero = hero;
        }
        return out;
    }

    function isShopOpen(root) {
        if (!root) return false;
        try {
            if (typeof root.RandomShopIsShopOpen === "function") {
                return !!root.RandomShopIsShopOpen();
            }
        } catch (eApi) {}
        try {
            if (typeof root.BHasClass === "function" && root.BHasClass("gShopOpen")) return true;
        } catch (e) {}
        return false;
    }

    function hasRandomShopApi(root) {
        return !!(root &&
            typeof root.ActivateRandomTab === "function" &&
            typeof root.RandomShopToggleCategory === "function" &&
            (typeof root.RandomShopForceRoll === "function" || typeof root.RandomShopRollTier === "function"));
    }

    function shopDomReady(root) {
        if (!hasRandomShopApi(root)) return false;
        try {
            var list = root.FindChildTraverse("ShopModsListWeapon");
            return !!(list && list.IsValid());
        } catch (e) {
            return false;
        }
    }

    function emitShopOpenState(open) {
        if (state.shopOpen === open) return;
        state.shopOpen = open;
        try {
            if (typeof globalThis !== "undefined") {
                globalThis.__twitch_bridge_shop_open = !!open;
            }
        } catch (eFlag) {}
        emit(open ? "shop_open" : "shop_closed", attachHero({ open: open }));
        if (open) {
            activateRandomTabForPipeline("shop_open");
        }
    }

    function stageNeedsRandomTab(stage) {
        return stage === "voting_category" ||
            stage === "voting_tier" ||
            stage === "voting_combined" ||
            stage === "applying" ||
            stage === "rolled" ||
            stage === "waiting_shop";
    }

    function setLastVoteStage(stage) {
        if (!stage) return;
        state.lastVoteStage = String(stage);
        try {
            if (typeof globalThis !== "undefined") {
                globalThis.__twitch_bridge_last_vote_stage = state.lastVoteStage;
            }
        } catch (eSt) {}
    }

    /** Switch to Random Shop tab when vote/roll/purchase needs it. */
    function activateRandomTabForPipeline(reason) {
        try {
            var root = getRoot();
            if (!root || typeof root.ActivateRandomTab !== "function") return;
            var stage = state.lastVoteStage || "";
            var pending = readLocalPendingRoll();
            var rolled = false;
            try { rolled = root.BHasClass("rs-mode-rolled"); } catch (eR) {}
            if (!stageNeedsRandomTab(stage) && !pending && !rolled) return;
            root.ActivateRandomTab();
            if (typeof root.RandomShopTryRestorePending === "function") {
                root.RandomShopTryRestorePending();
            }
        } catch (eAct) {}
    }

    function clearBusy(reason) {
        if (!state.busy && !state.awaitingRollSeq) return;
        state.busy = false;
        state.busySinceMs = 0;
        state.awaitingRollSeq = 0;
        if (reason) {
            try {
                $.Msg("[twitch_bridge] shop busy cleared: " + reason);
            } catch (e) {}
        }
    }

    function maybeBusyWatchdog() {
        if (!state.busy) return;
        var root = getRoot();
        if (!root) {
            clearBusy("root_invalid");
            return;
        }
        try {
            if (typeof root.IsValid === "function" && !root.IsValid()) {
                clearBusy("root_not_valid");
                return;
            }
        } catch (e) {
            clearBusy("root_check_failed");
            return;
        }
        if (state.busySinceMs && nowMs() - state.busySinceMs > BUSY_WATCHDOG_SEC * 1000) {
            var stuckSeq = state.awaitingRollSeq;
            clearBusy("watchdog");
            if (stuckSeq) {
                emit("shop_error", attachHero({ reason: "roll_timeout", seq: stuckSeq, via: "watchdog" }));
            }
            // Keep pending so watchShopOpenBridge / next poll can retry.
            if (!state.pendingCmd && state._pendingApplyMeta) {
                state.pendingCmd = {
                    seq: state._pendingApplyMeta.seq,
                    cat: state._pendingApplyMeta.cat,
                    tier: state._pendingApplyMeta.tier,
                    source: state._pendingApplyMeta.source || "http"
                };
            }
        }
    }

    function emitDiagIfDue() {
        var now = nowMs();
        if (now - state.lastDiagEmit < DIAG_EMIT_SEC * 1000) return;
        if (!state.pendingCmd && !state.busy && !state.awaitingRollSeq) return;
        state.lastDiagEmit = now;
        emit("shop_cmd_poll", attachHero({
            pendingSeq: state.pendingCmd ? state.pendingCmd.seq : 0,
            lastAppliedSeq: state.lastAppliedSeq,
            busy: state.busy,
            awaitingRollSeq: state.awaitingRollSeq,
            httpOk: state.httpOk,
            shopOpen: state.shopOpen,
            hasApi: hasRandomShopApi(getRoot()),
            domReady: shopDomReady(getRoot())
        }), { skipLog: true });
    }

    function watchShopOpenBridge() {
        // Stop if a newer shop HUD boot replaced us.
        try {
            if (typeof globalThis !== "undefined" &&
                globalThis.__twitch_bridge_shop_boot &&
                globalThis.__twitch_bridge_shop_boot.gen !== state.bootGen) {
                return;
            }
        } catch (eGen) {}

        maybeBusyWatchdog();
        var root = getRoot();
        emitShopOpenState(isShopOpen(root));
        if (state.pendingCmd && !state.busy) {
            if (shopDomReady(root)) {
                var p = state.pendingCmd;
                considerApply(p.seq, p.cat, p.tier, p.source || "pending");
            } else {
                var now = nowMs();
                if (now - state.lastDomNotReadyEmit > 5000) {
                    state.lastDomNotReadyEmit = now;
                    emit("shop_error", attachHero({
                        reason: "dom_not_ready",
                        seq: state.pendingCmd.seq
                    }));
                }
            }
        }
        emitDiagIfDue();
        $.Schedule(0.5, watchShopOpenBridge);
    }

    function isFilterOn(root, listId) {
        var filterId = LIST_TO_FILTER[listId];
        if (!filterId) return false;
        try {
            var btn = root.FindChildTraverse(filterId);
            if (!btn || !btn.IsValid()) return false;
            return btn.BHasClass("rs-filter-on");
        } catch (e) {
            return false;
        }
    }

    function ensureOnlyCategory(root, targetListId) {
        var maxPasses = 8;
        for (var pass = 0; pass < maxPasses; pass++) {
            var targetOn = isFilterOn(root, targetListId);
            if (!targetOn) {
                try {
                    root.RandomShopToggleCategory(targetListId);
                } catch (eOn) {
                    emit("shop_error", { reason: "toggle_failed", listId: targetListId });
                    return false;
                }
                continue;
            }
            var othersOff = true;
            for (var i = 0; i < ALL_LISTS.length; i++) {
                var lid = ALL_LISTS[i];
                if (lid === targetListId) continue;
                if (isFilterOn(root, lid)) {
                    othersOff = false;
                    try {
                        root.RandomShopToggleCategory(lid);
                    } catch (eOff) {
                        emit("shop_error", { reason: "toggle_failed", listId: lid });
                        return false;
                    }
                }
            }
            if (othersOff && isFilterOn(root, targetListId)) return true;
        }
        emit("shop_error", {
            reason: "category_sync_failed",
            target: targetListId,
            weapon: isFilterOn(root, "ShopModsListWeapon"),
            vitality: isFilterOn(root, "ShopModsListArmor"),
            spirit: isFilterOn(root, "ShopModsListTech")
        });
        return false;
    }

    function extractResponseBody(response) {
        if (response == null) return "";
        if (typeof response === "string") return response;
        if (typeof response === "object" && typeof response.seq !== "undefined") {
            return safeStringify(response);
        }
        var keys = ["responseText", "text", "body", "response", "data"];
        for (var i = 0; i < keys.length; i++) {
            try {
                var v = response[keys[i]];
                if (typeof v === "string" && v) return v;
                if (v && typeof v === "object" && typeof v.seq !== "undefined") return safeStringify(v);
            } catch (e) {}
        }
        return "";
    }

    function parseShopCmd(raw) {
        var obj = raw;
        if (typeof raw === "string") {
            try {
                obj = JSON.parse(raw);
            } catch (e) {
                var m = raw.match(/\{[\s\S]*\}/);
                if (!m) return null;
                try {
                    obj = JSON.parse(m[0]);
                } catch (e2) {
                    return null;
                }
            }
        }
        if (!obj || typeof obj !== "object") return null;
        var seq = Number.parseInt(obj.seq, 10);
        var cat = Number.parseInt(obj.cat, 10);
        var tier = Number.parseInt(obj.tier, 10);
        if (!Number.isFinite(seq)) return null;
        return {
            seq: seq,
            cat: Number.isFinite(cat) ? cat : 0,
            tier: Number.isFinite(tier) ? tier : 0,
            pending: !!obj.pending,
            stage: typeof obj.stage === "string" ? obj.stage : "",
            categoryPct: obj.categoryPct && typeof obj.categoryPct === "object" ? obj.categoryPct : null,
            tierPct: obj.tierPct && typeof obj.tierPct === "object" ? obj.tierPct : null,
            winnerCategory: typeof obj.winnerCategory === "string" ? obj.winnerCategory : null,
            winnerTier: obj.winnerTier != null ? Number(obj.winnerTier) : null
        };
    }

    function coerceShopCmd(data) {
        if (data == null) return null;
        if (typeof data === "object" && typeof data.seq !== "undefined") {
            return parseShopCmd(data);
        }
        return parseShopCmd(extractResponseBody(data));
    }

    var DEFAULT_SUBTITLE = "Choose a tier to get a random item";
    var CAT_PCT_IDS = {
        weapon: "RSFilterWeaponPct",
        vitality: "RSFilterArmorPct",
        spirit: "RSFilterTechPct"
    };
    var CAT_BTN_IDS = {
        weapon: "RSFilterWeapon",
        vitality: "RSFilterArmor",
        spirit: "RSFilterTech"
    };
    var CAT_BASE_LABEL = {
        weapon: "WEAPON",
        vitality: "VITALITY",
        spirit: "SPIRIT"
    };
    var CAT_KEYS = ["weapon", "vitality", "spirit"];
    var TIER_KEYS = ["1", "2", "3", "4"];

    function setLabelText(root, id, text) {
        if (!root) return false;
        try {
            var el = root.FindChildTraverse(id);
            if (!el) return false;
            el.text = text;
            // Some Panorama builds only refresh via SetDialogVariable.
            try {
                if (typeof el.SetDialogVariable === "function") el.SetDialogVariable("text", text);
            } catch (eDV) {}
            return true;
        } catch (e) {}
        return false;
    }

    /** Always visible on the random tab. Not gated by UI_DEBUG. */
    function hostLayoutText() {
        var host = null;
        try { host = ensureVoteNetHost(); } catch (eHost) {}
        var w = 0;
        var h = 0;
        try {
            if (host) {
                w = Number(host.actuallayoutwidth) || 0;
                h = Number(host.actuallayoutheight) || 0;
            }
        } catch (eDim) {}
        return "host " + w + "x" + h;
    }

    function notePngStatus(text) {
        try { $.Msg("[twitch_bridge] " + text); } catch (eMsg) {}
        var root = getRoot();
        if (!root) return;
        setLabelText(root, "RSBridgeDebug", text);
    }

    /** Always-on HUD probe — mutates labels that already exist in packed XML. */
    function paintBridgeDebug(info) {
        refreshUiDebug();
        if (!UI_DEBUG) return;
        state.votePaintTick += 1;
        var root = getRoot();
        var stage = (info && info.stage) ? String(info.stage) : (state.lastVoteStage || "?");
        setLastVoteStage(stage);
        var line =
            "bridge " + MOD_VERSION +
            " #" + state.votePaintTick +
            " · " + stage;
        if (info && info.extra) line += " · " + info.extra;
        if (!root) {
            line += " · no_root";
            state.lastDebugLine = line;
            return;
        }
        state.lastDebugLine = line;

        // Title always exists in current Random Shop XML — strongest smoke test.
        setLabelText(root, "RSTitle", "RANDOM SHOP [" + MOD_VERSION + "]");
        // Dedicated debug row (needs XML rebuild); also mirror into subtitle if missing.
        var wroteDbg = setLabelText(root, "RSBridgeDebug", line);
        if (!wroteDbg) {
            setLabelText(root, "RSSubtitle", line);
        }

        var now = nowMs();
        if (!state.lastVoteHudEmit || now - state.lastVoteHudEmit > 2000) {
            state.lastVoteHudEmit = now;
            var hasTitle = false;
            var hasSubtitle = false;
            var hasDebug = false;
            var hasTier1 = false;
            var hasMirror = false;
            try { hasTitle = !!root.FindChildTraverse("RSTitle"); } catch (e1) {}
            try { hasSubtitle = !!root.FindChildTraverse("RSSubtitle"); } catch (e2) {}
            try { hasDebug = !!root.FindChildTraverse("RSBridgeDebug"); } catch (e3) {}
            try { hasTier1 = !!root.FindChildTraverse("RSTier1"); } catch (e4) {}
            try { hasMirror = !!root.FindChildTraverse("RSVoteMirror"); } catch (e5) {}
            emit("vote_hud_debug", {
                version: MOD_VERSION,
                tick: state.votePaintTick,
                stage: stage,
                wroteDebugLabel: wroteDbg,
                line: line,
                hasTitle: hasTitle,
                hasSubtitle: hasSubtitle,
                hasDebug: hasDebug,
                hasTier1: hasTier1,
                hasMirror: hasMirror,
                voteNet: state.voteNet,
                cmdNet: state.cmdNet
            }, { skipLog: true });
        }
    }

    function findChildLabelByClass(panel, className) {
        if (!panel) return null;
        try {
            if (typeof panel.FindChildrenWithClassTraverse === "function") {
                var list = panel.FindChildrenWithClassTraverse(className);
                if (list && list.length) return list[0];
            }
        } catch (e) {}
        try {
            var n = panel.GetChildCount ? panel.GetChildCount() : 0;
            for (var i = 0; i < n; i++) {
                var ch = panel.GetChild(i);
                if (!ch) continue;
                if (typeof ch.BHasClass === "function" && ch.BHasClass(className)) return ch;
                var nested = findChildLabelByClass(ch, className);
                if (nested) return nested;
            }
        } catch (e2) {}
        return null;
    }

    function setPanelClass(root, id, className, on) {
        if (!root) return;
        try {
            var el = root.FindChildTraverse(id);
            if (!el) return;
            if (on) el.AddClass(className);
            else el.RemoveClass(className);
        } catch (e) {}
    }

    function pctNum(map, key) {
        if (!map) return 0;
        var n = Number(map[key]);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }

    function findLeadKey(map, keys) {
        var best = -1;
        var lead = null;
        for (var i = 0; i < keys.length; i++) {
            var n = pctNum(map, keys[i]);
            if (n > best) {
                best = n;
                lead = keys[i];
            }
        }
        return best > 0 ? lead : null;
    }

    var TIER_BASE_COST = { "1": "800", "2": "1600", "3": "3200", "4": "6400" };

    function setCategoryPct(root, catKey, pct, show) {
        // Percent only in dedicated label (right side of bar) — not in RSFilterLabel.
        var wrote = setLabelText(root, CAT_PCT_IDS[catKey], show ? pct + "%" : "");
        var btn = null;
        try {
            btn = root.FindChildTraverse(CAT_BTN_IDS[catKey]);
        } catch (e) {}
        var label = findChildLabelByClass(btn, "RSFilterLabel");
        if (label) {
            label.text = CAT_BASE_LABEL[catKey] || catKey.toUpperCase();
            wrote = true;
        }
        return wrote;
    }

    function setTierPct(root, tierKey, pct, show) {
        // Percent only next to tier name; cost stays price-only.
        var wrote = setLabelText(root, "RSTier" + tierKey + "Pct", show ? pct + "%" : "");
        var btn = null;
        try {
            btn = root.FindChildTraverse("RSTier" + tierKey);
        } catch (e) {}
        var label = findChildLabelByClass(btn, "RSTierLabel");
        if (label) {
            label.text = "TIER " + tierKey;
            wrote = true;
        }
        var cost = findChildLabelByClass(btn, "RSTierCost");
        if (cost) {
            cost.text = TIER_BASE_COST[tierKey] || "";
            wrote = true;
        }
        return wrote;
    }

    function clearVoteHud(root) {
        if (!root) return;
        var i;
        for (i = 0; i < CAT_KEYS.length; i++) {
            var ck = CAT_KEYS[i];
            setCategoryPct(root, ck, 0, false);
            setPanelClass(root, CAT_BTN_IDS[ck], "rs-vote-on", false);
            setPanelClass(root, CAT_BTN_IDS[ck], "rs-vote-lead", false);
            setPanelClass(root, CAT_BTN_IDS[ck], "rs-vote-winner", false);
            setPanelClass(root, CAT_BTN_IDS[ck], "rs-vote-lost", false);
        }
        for (i = 0; i < TIER_KEYS.length; i++) {
            var tk = TIER_KEYS[i];
            setTierPct(root, tk, 0, false);
            setPanelClass(root, "RSTier" + tk, "rs-vote-on", false);
            setPanelClass(root, "RSTier" + tk, "rs-vote-lead", false);
            setPanelClass(root, "RSTier" + tk, "rs-vote-winner", false);
            setPanelClass(root, "RSTier" + tk, "rs-vote-lost", false);
        }
        setLabelText(root, "RSSubtitle", DEFAULT_SUBTITLE);
    }

    function formatTierSubtitle(tierPct) {
        var parts = [];
        for (var i = 0; i < TIER_KEYS.length; i++) {
            var tk = TIER_KEYS[i];
            parts.push("T" + tk + " " + pctNum(tierPct, tk) + "%");
        }
        return parts.join(" · ");
    }

    function formatCatSubtitle(catPct) {
        return (
            "W " + pctNum(catPct, "weapon") + "% · " +
            "V " + pctNum(catPct, "vitality") + "% · " +
            "S " + pctNum(catPct, "spirit") + "%"
        );
    }

    function httpStatusToken() {
        if (state.httpOk === true) return "http_ok";
        if (state.httpOk === false) return "http_fail";
        return "http_?";
    }

    function tallyPctLine(keys, labels, tally, pct) {
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var t = tally && tally[k] != null ? Number(tally[k]) : 0;
            if (!Number.isFinite(t)) t = 0;
            parts.push(labels[i] + " " + t + " (" + pctNum(pct, k) + "%)");
        }
        return parts.join(" · ");
    }

    function formatMirrorTimer(cmd) {
        if (!cmd) return "—";
        var stage = cmd.stage || "";
        if (cmd.stageEndsAt && (stage === "voting_category" || stage === "voting_tier" || stage === "voting_combined")) {
            var left = Math.max(0, Math.ceil((Number(cmd.stageEndsAt) - nowMs()) / 1000));
            return left + "s";
        }
        if (stage === "applying") {
            if (cmd.cmdReceived) return "shop_cmd received";
            if (cmd.lastWaiting && cmd.lastWaiting.reason) return String(cmd.lastWaiting.reason);
            return "HTTP pending…";
        }
        if (stage === "rolled") return "rolled — purchasing…";
        if (stage === "waiting_shop") {
            return (cmd.lastWaiting && cmd.lastWaiting.reason) ? String(cmd.lastWaiting.reason) : "подойди к магазину";
        }
        if (stage === "purchased") return "куплено";
        if (stage === "failed") return "ошибка";
        return "—";
    }

    function formatMirrorSeq(cmd) {
        if (!cmd) return "—";
        if (cmd.lastCfg && typeof cmd.lastCfg === "object") {
            var seq = cmd.lastCfg.seq != null ? cmd.lastCfg.seq : "?";
            var tag = cmd.cmdReceived ? "rolled" : "waiting";
            return "seq " + seq + " · " + tag;
        }
        if (cmd.lastSeq != null) return "seq " + cmd.lastSeq;
        return "—";
    }

    function formatMirrorResult(cmd) {
        if (!cmd) return "Нет ролла / покупки";
        var parts = [];
        if (cmd.hero) parts.push("Герой: " + String(cmd.hero));
        if (cmd.lastCfg && typeof cmd.lastCfg === "object") {
            var catNames = { 1: "Weapon", 2: "Vitality", 3: "Spirit" };
            var catLabel = catNames[cmd.lastCfg.cat] || cmd.lastCfg.cat;
            var cmdState = cmd.cmdReceived
                ? "rolled"
                : (cmd.stage === "applying" ? "waiting shop_rolled" : "HTTP pending");
            parts.push(cmdState + ": seq=" + cmd.lastCfg.seq + " " + catLabel + " T" + cmd.lastCfg.tier);
        }
        var rolled = cmd.lastRolled;
        if ((!rolled || typeof rolled !== "object") && cmd._pendingRoll) {
            rolled = cmd._pendingRoll;
        }
        if (rolled && typeof rolled === "object") {
            parts.push("Rolled: " + String(rolled.name || rolled.cls || "?") + " T" + String(rolled.tier || "?"));
        }
        if (cmd.lastWaiting && typeof cmd.lastWaiting === "object" && cmd.lastWaiting.reason) {
            parts.push("Waiting: " + String(cmd.lastWaiting.reason));
        }
        if (cmd.lastPurchase && typeof cmd.lastPurchase === "object") {
            parts.push(cmd.lastPurchase.ok ? "Purchase: OK" : "Purchase: fail/timeout");
        }
        if (cmd.lastError && typeof cmd.lastError === "object") {
            parts.push("Error: " + String(cmd.lastError.reason || "unknown"));
        }
        return parts.length ? parts.join(" · ") : "Нет ролла / покупки";
    }

    function readLocalPendingRoll() {
        try {
            var root = getRoot();
            if (root && typeof root.RandomShopGetPendingRoll === "function") {
                var fromApi = root.RandomShopGetPendingRoll();
                if (fromApi && fromApi.cls) return fromApi;
            }
        } catch (eApi) {}
        try {
            if (typeof globalThis !== "undefined" && globalThis.__rs_pending_roll && globalThis.__rs_pending_roll.cls) {
                return globalThis.__rs_pending_roll;
            }
        } catch (eG) {}
        return null;
    }

    function ensureRolledItemVisible(stage) {
        if (!stageNeedsRandomTab(stage)) return;
        try {
            var root = getRoot();
            if (!root) return;
            if (typeof root.RandomShopTryRestorePending === "function") {
                root.RandomShopTryRestorePending();
            }
            if (typeof root.ActivateRandomTab === "function") {
                // Always show Random tab during vote/apply/roll/wait — roll+buy need gShowingRandom.
                root.ActivateRandomTab();
            }
        } catch (eEns) {}
    }

    function paintVoteMirror(cmd, net) {
        refreshUiDebug();
        var root = getRoot();
        if (!root) return;
        applyVoteMirrorVisibility();
        if (!UI_DEBUG) return;

        if (cmd) {
            var prev = state.lastVoteMirror || {};
            state.lastVoteMirror = {
                stage: cmd.stage != null ? cmd.stage : prev.stage,
                categoryPct: cmd.categoryPct != null ? cmd.categoryPct : prev.categoryPct,
                tierPct: cmd.tierPct != null ? cmd.tierPct : prev.tierPct,
                categoryTally: cmd.categoryTally != null ? cmd.categoryTally : prev.categoryTally,
                tierTally: cmd.tierTally != null ? cmd.tierTally : prev.tierTally,
                winnerCategory: cmd.winnerCategory !== undefined ? cmd.winnerCategory : prev.winnerCategory,
                winnerTier: cmd.winnerTier !== undefined ? cmd.winnerTier : prev.winnerTier,
                shopOpen: cmd.shopOpen !== undefined && cmd.shopOpen !== null ? cmd.shopOpen : prev.shopOpen,
                stageEndsAt: cmd.stageEndsAt !== undefined ? cmd.stageEndsAt : prev.stageEndsAt,
                lastSeq: cmd.lastSeq != null ? cmd.lastSeq : prev.lastSeq,
                lastCfg: cmd.lastCfg !== undefined ? cmd.lastCfg : prev.lastCfg,
                cmdReceived: cmd.cmdReceived !== undefined ? cmd.cmdReceived : prev.cmdReceived,
                hero: cmd.hero != null && cmd.hero !== "" ? cmd.hero : prev.hero,
                lastRolled: cmd.lastRolled !== undefined ? cmd.lastRolled : prev.lastRolled,
                lastPurchase: cmd.lastPurchase !== undefined ? cmd.lastPurchase : prev.lastPurchase,
                lastWaiting: cmd.lastWaiting !== undefined ? cmd.lastWaiting : prev.lastWaiting,
                lastError: cmd.lastError !== undefined ? cmd.lastError : prev.lastError
            };
        }
        var snap = state.lastVoteMirror;

        var voteNet = (net && net.vote != null) ? net.vote : state.voteNet;
        var cmdNet = (net && net.cmd != null) ? net.cmd : state.cmdNet;
        if (net && net.vote != null) state.voteNet = net.vote;
        if (net && net.cmd != null) state.cmdNet = net.cmd;

        // PNG channel has no item name — fill from local pending roll.
        var pendingRoll = readLocalPendingRoll();
        if (snap && pendingRoll && !snap.lastRolled) {
            snap.lastRolled = {
                name: pendingRoll.name || pendingRoll.cls,
                cls: pendingRoll.cls,
                tier: pendingRoll.tier
            };
        }
        if (snap) snap._pendingRoll = pendingRoll;

        var httpLine =
            "v" + MOD_VERSION +
            " · " + httpStatusToken() +
            " · vote=" + voteNet +
            " · cmd=" + cmdNet;
        if (state.lastVoteParseHint) {
            httpLine += " · " + state.lastVoteParseHint;
        }
        setLabelText(root, "RSVoteMirrorHttp", httpLine);

        if (!snap) {
            setLabelText(root, "RSVoteMirrorStage", "stage=— · shop=— · timer=— · seq —");
            setLabelText(root, "RSVoteMirrorCats", "W 0 (0%) · V 0 (0%) · S 0 (0%)");
            setLabelText(root, "RSVoteMirrorTiers", "T1 0 (0%) · T2 0 (0%) · T3 0 (0%) · T4 0 (0%)");
            setLabelText(root, "RSVoteMirrorResult", pendingRoll
                ? ("Rolled: " + String(pendingRoll.name || pendingRoll.cls) + " T" + String(pendingRoll.tier || "?"))
                : "Нет ролла / покупки");
            return;
        }

        ensureRolledItemVisible(snap.stage);

        var shopLabel = snap.shopOpen === true ? "открыт" : (snap.shopOpen === false ? "закрыт" : "—");
        setLabelText(
            root,
            "RSVoteMirrorStage",
            "stage=" + (snap.stage || "—") +
                " · shop=" + shopLabel +
                " · timer=" + formatMirrorTimer(snap) +
                " · " + formatMirrorSeq(snap)
        );
        setLabelText(
            root,
            "RSVoteMirrorCats",
            tallyPctLine(
                CAT_KEYS,
                ["W", "V", "S"],
                snap.categoryTally || {},
                snap.categoryPct || {}
            )
        );
        setLabelText(
            root,
            "RSVoteMirrorTiers",
            tallyPctLine(
                TIER_KEYS,
                ["T1", "T2", "T3", "T4"],
                snap.tierTally || {},
                snap.tierPct || {}
            )
        );
        setLabelText(root, "RSVoteMirrorResult", formatMirrorResult(snap));
    }

    function paintVoteHud(cmd) {
        var root = getRoot();
        if (!root) {
            paintBridgeDebug({ stage: "no_root" });
            paintVoteMirror(null, null);
            return;
        }
        var prevStage = state.lastVoteStage || "";
        var stage = cmd && cmd.stage ? String(cmd.stage) : "";
        if (stage) setLastVoteStage(stage);
        // First paint into a vote/apply stage: force Random tab even if shop
        // was already open on Weapon/Vitality/Spirit.
        if (stage && stage !== prevStage && stageNeedsRandomTab(stage)) {
            activateRandomTabForPipeline("vote_stage");
        }
        var catPct = (cmd && cmd.categoryPct) || {};
        var tierPct = (cmd && cmd.tierPct) || {};
        var postVote =
            stage === "applying" ||
            stage === "waiting_shop" ||
            stage === "rolled";
        // Split flags: tier leftovers must not light up category chrome (and vice versa).
        var hasCatResults = false;
        var hasTierResults = false;
        var hi;
        for (hi = 0; hi < CAT_KEYS.length; hi++) {
            if (pctNum(catPct, CAT_KEYS[hi]) > 0) { hasCatResults = true; break; }
        }
        for (hi = 0; hi < TIER_KEYS.length; hi++) {
            if (pctNum(tierPct, TIER_KEYS[hi]) > 0) { hasTierResults = true; break; }
        }
        // purchased/failed/idle or direct-apply (all 0%) → wipe vote chrome.
        if (stage === "purchased" || stage === "failed" || stage === "idle" ||
            (postVote && !hasCatResults && !hasTierResults)) {
            if (stage) setLastVoteStage(stage);
            clearVoteHud(root);
            updateVoteStartBtn(stage || "idle");
            paintBridgeDebug({ stage: stage || "idle" });
            paintVoteMirror(cmd, null);
            return;
        }

        paintBridgeDebug({
            stage: stage || "idle",
            extra: (stage === "voting_combined")
                ? (formatCatSubtitle(catPct) + " · " + formatTierSubtitle(tierPct))
                : (stage === "voting_tier" || (postVote && hasTierResults))
                    ? formatTierSubtitle(tierPct)
                    : (stage === "voting_category" ? formatCatSubtitle(catPct) : "")
        });
        paintVoteMirror(cmd, null);
        updateVoteStartBtn(stage);

        ensureRolledItemVisible(stage);

        // Category chrome: lead during voting_category / voting_combined;
        // winner during voting_tier + post-vote.
        var showCatPct =
            stage === "voting_category" ||
            stage === "voting_tier" ||
            stage === "voting_combined" ||
            (postVote && hasCatResults);
        var showTiers =
            stage === "voting_tier" ||
            stage === "voting_combined" ||
            (postVote && hasTierResults);
        var catLead =
            stage === "voting_category" || stage === "voting_combined"
                ? findLeadKey(catPct, CAT_KEYS)
                : null;
        var catWinner = null;
        if (stage === "voting_tier" || (postVote && hasCatResults)) {
            if (cmd.winnerCategory && typeof cmd.winnerCategory === "string") {
                catWinner = cmd.winnerCategory;
            } else {
                catWinner = findLeadKey(catPct, CAT_KEYS);
            }
        }
        var i;
        for (i = 0; i < CAT_KEYS.length; i++) {
            var ck = CAT_KEYS[i];
            setCategoryPct(root, ck, pctNum(catPct, ck), showCatPct);
            setPanelClass(root, CAT_BTN_IDS[ck], "rs-vote-on", showCatPct);
            setPanelClass(
                root,
                CAT_BTN_IDS[ck],
                "rs-vote-lead",
                (stage === "voting_category" || stage === "voting_combined") && catLead === ck
            );
            setPanelClass(
                root,
                CAT_BTN_IDS[ck],
                "rs-vote-winner",
                (stage === "voting_tier" || postVote) && catWinner === ck
            );
            setPanelClass(
                root,
                CAT_BTN_IDS[ck],
                "rs-vote-lost",
                postVote && catWinner != null && catWinner !== ck
            );
        }

        if (!showTiers) {
            for (i = 0; i < TIER_KEYS.length; i++) {
                setTierPct(root, TIER_KEYS[i], 0, false);
                setPanelClass(root, "RSTier" + TIER_KEYS[i], "rs-vote-on", false);
                setPanelClass(root, "RSTier" + TIER_KEYS[i], "rs-vote-lead", false);
                setPanelClass(root, "RSTier" + TIER_KEYS[i], "rs-vote-winner", false);
                setPanelClass(root, "RSTier" + TIER_KEYS[i], "rs-vote-lost", false);
            }
        } else {
            var tierLead =
                stage === "voting_tier" || stage === "voting_combined"
                    ? findLeadKey(tierPct, TIER_KEYS)
                    : null;
            var tierWinner = null;
            if (postVote && hasTierResults) {
                if (cmd.winnerTier != null && Number.isFinite(Number(cmd.winnerTier))) {
                    tierWinner = String(cmd.winnerTier);
                } else {
                    tierWinner = findLeadKey(tierPct, TIER_KEYS);
                }
            }
            for (i = 0; i < TIER_KEYS.length; i++) {
                var tk = TIER_KEYS[i];
                setTierPct(root, tk, pctNum(tierPct, tk), true);
                setPanelClass(root, "RSTier" + tk, "rs-vote-on", true);
                setPanelClass(root, "RSTier" + tk, "rs-vote-lead", !postVote && tierLead === tk);
                setPanelClass(root, "RSTier" + tk, "rs-vote-winner", postVote && tierWinner === tk);
                setPanelClass(root, "RSTier" + tk, "rs-vote-lost", postVote && tierWinner != null && tierWinner !== tk);
            }
        }

        var subText = DEFAULT_SUBTITLE;
        if (stage === "voting_combined") {
            subText = formatCatSubtitle(catPct) + " · " + formatTierSubtitle(tierPct);
        } else if (stage === "voting_category") subText = formatCatSubtitle(catPct);
        else if (stage === "voting_tier") subText = formatTierSubtitle(tierPct);
        else if (postVote && hasTierResults) subText = "Voted · " + formatTierSubtitle(tierPct);
        setLabelText(root, "RSSubtitle", subText);
    }

    function snapshotToVoteCmd(snap) {
        if (!snap || typeof snap !== "object") return null;
        return {
            seq: 0,
            cat: 0,
            tier: 0,
            pending: false,
            stage: typeof snap.stage === "string" ? snap.stage : "",
            categoryPct: snap.categoryPct && typeof snap.categoryPct === "object" ? snap.categoryPct : null,
            tierPct: snap.tierPct && typeof snap.tierPct === "object" ? snap.tierPct : null,
            categoryTally: snap.categoryTally && typeof snap.categoryTally === "object" ? snap.categoryTally : null,
            tierTally: snap.tierTally && typeof snap.tierTally === "object" ? snap.tierTally : null,
            winnerCategory: typeof snap.winnerCategory === "string" ? snap.winnerCategory : null,
            winnerTier: snap.winnerTier != null ? Number(snap.winnerTier) : null,
            shopOpen: typeof snap.shopOpen === "boolean" ? snap.shopOpen : null,
            stageEndsAt: snap.stageEndsAt != null ? Number(snap.stageEndsAt) : null,
            lastSeq: snap.lastSeq != null ? Number(snap.lastSeq) : 0,
            lastCfg: snap.lastCfg && typeof snap.lastCfg === "object" ? snap.lastCfg : null,
            cmdReceived: !!snap.cmdReceived,
            hero: typeof snap.hero === "string" ? snap.hero : "",
            lastRolled: snap.lastRolled && typeof snap.lastRolled === "object" ? snap.lastRolled : null,
            lastPurchase: snap.lastPurchase && typeof snap.lastPurchase === "object" ? snap.lastPurchase : null,
            lastWaiting: snap.lastWaiting && typeof snap.lastWaiting === "object" ? snap.lastWaiting : null,
            lastError: snap.lastError && typeof snap.lastError === "object" ? snap.lastError : null
        };
    }

    function coerceShopVoteSnapshot(data) {
        if (data == null) return null;
        if (typeof data === "object" && typeof data.stage === "string" && data.categoryPct) {
            return snapshotToVoteCmd(data);
        }
        var raw = extractResponseBody(data);
        if (!raw) return null;
        var obj = raw;
        if (typeof raw === "string") {
            try {
                obj = JSON.parse(raw);
            } catch (e) {
                var m = raw.match(/\{[\s\S]*\}/);
                if (!m) return null;
                try {
                    obj = JSON.parse(m[0]);
                } catch (e2) {
                    return null;
                }
            }
        }
        if (!obj || typeof obj !== "object" || typeof obj.stage !== "string") return null;
        return snapshotToVoteCmd(obj);
    }

    function truncateHint(raw, maxLen) {
        var s = "";
        try {
            s = typeof raw === "string" ? raw : extractResponseBody(raw);
        } catch (e) {
            s = "";
        }
        if (!s) return "";
        s = String(s).replace(/\s+/g, " ");
        if (s.length > (maxLen || 80)) s = s.slice(0, maxLen || 80) + "…";
        return s;
    }

    // ── PNG image side-channel (Minigames-style) ─────────────────────────

    function clampLevel(level, max) {
        var n = Number(level);
        if (!Number.isFinite(n)) return 0;
        if (n < 0) return 0;
        if (n > max) return max;
        return Math.round(n);
    }

    function decodeLevel(dim, scale, max) {
        if (!Number.isFinite(dim) || !Number.isFinite(scale) || scale <= 0) return 0;
        return clampLevel((dim / scale - PNG_BASE) / PNG_STEP, max);
    }

    function decodeDims(rawW, rawH, slotName) {
        var w = Number(rawW);
        var h = Number(rawH);
        if (state.imgSwap) {
            var t = w;
            w = h;
            h = t;
        }
        if (slotName === "meta") {
            return {
                w: decodeLevel(w, state.imgScaleX, 8),
                h: decodeLevel(h, state.imgScaleY, 60)
            };
        }
        if (slotName === "cmd") {
            return {
                w: decodeLevel(w, state.imgScaleX, CMD_SEQ_MAX),
                h: decodeLevel(h, state.imgScaleY, 60)
            };
        }
        if (slotName === "banner") {
            return {
                w: decodeLevel(w, state.imgScaleX, CMD_SEQ_MAX),
                h: decodeLevel(h, state.imgScaleY, 200)
            };
        }
        return {
            w: decodeLevel(w, state.imgScaleX, 100),
            h: decodeLevel(h, state.imgScaleY, 100)
        };
    }

    /** Decode cmd.h: cat*10+tier (11–34) or 0 = skip / no apply. */
    function decodeCmdHeight(h) {
        var n = clampLevel(h, 60);
        if (n < 11) return { cat: 0, tier: 0 };
        var cat = Math.floor(n / 10);
        var tier = n % 10;
        if (cat < 1 || cat > 3 || tier < 1 || tier > 4) return { cat: 0, tier: 0 };
        return { cat: cat, tier: tier };
    }

    /**
     * Seq is newer in the 1..CMD_SEQ_MAX circle (half-range forward).
     * Handles wrap after 200 → 1 without ignoring the next apply/skip.
     */
    function isNewerShopSeq(seq) {
        if (!seq || seq < 1) return false;
        var last = state.lastAppliedSeq || 0;
        if (last === 0) return true;
        if (seq === last) return false;
        var d = (seq - last + CMD_SEQ_MAX) % CMD_SEQ_MAX;
        return d > 0 && d < CMD_SEQ_MAX / 2;
    }

    function stageFromLevel(level) {
        var stages = [
            "idle",
            "voting_category",
            "voting_tier",
            "applying",
            "rolled",
            "waiting_shop",
            "purchased",
            "failed",
            "voting_combined"
        ];
        var i = clampLevel(level, 8);
        return stages[i] || "idle";
    }

    function categoryPctFromCats(weapon, vitality) {
        var w = clampLevel(weapon, 100);
        var v = clampLevel(vitality, 100);
        if (w + v <= 0) return { weapon: 0, vitality: 0, spirit: 0 };
        return { weapon: w, vitality: v, spirit: clampLevel(100 - w - v, 100) };
    }

    function findHudCore() {
        var panel = getRoot();
        var root = panel;
        var hops = 0;
        while (panel && hops < 16) {
            try {
                if (typeof panel.BHasClass === "function" && panel.BHasClass("HudCore")) return panel;
            } catch (eClass) {}
            var parent = null;
            try { parent = panel.GetParent ? panel.GetParent() : null; } catch (eParent) {}
            if (!parent) break;
            root = parent;
            panel = parent;
            hops += 1;
        }
        if (!root || typeof root.FindChildrenWithClassTraverse !== "function") return null;
        try {
            var found = root.FindChildrenWithClassTraverse("HudCore");
            if (found && found.length) return found[0];
        } catch (eFind) {}
        return null;
    }

    function ensureVoteNetHost() {
        var root = getRoot();
        if (!root || typeof root.FindChildTraverse !== "function") return null;
        var host = null;
        try { host = root.FindChildTraverse("RSVoteNetHost"); } catch (eFind) {}
        return host || null;
    }

    function imgFailFast(img, onFail) {
        try {
            if (img && typeof img.SetPanelEvent === "function") {
                img.SetPanelEvent("ImageFailedLoad", function () {
                    try {
                        onFail();
                    } catch (e) {}
                });
            }
        } catch (e2) {}
    }

    function drainImgQueue() {
        if (state.imgBusy) return;
        if (!state.imgQueue.length) return;
        state.imgBusy = true;
        var job = state.imgQueue.shift();
        try {
            job(function () {
                state.imgBusy = false;
                drainImgQueue();
            });
        } catch (e) {
            state.imgBusy = false;
            drainImgQueue();
        }
    }

    function enqueueImg(job) {
        state.imgQueue.push(job);
        drainImgQueue();
    }

    /** Load URL into a temporary Image; onDone(w,h) with raw layout dims. */
    function rawImgRequest(url, onDone, onError) {
        enqueueImg(function (release) {
            var host = ensureVoteNetHost();
            if (!host || typeof $.CreatePanel !== "function") {
                notePngStatus("png no_host");
                try {
                    onError("no_host");
                } catch (e) {}
                release();
                return;
            }
            var img = null;
            var finished = false;
            var elapsed = 0;
            function cleanup() {
                try {
                    if (img) img.SetImage("");
                } catch (e1) {}
                try {
                    if (img && typeof img.DeleteAsync === "function") img.DeleteAsync(0);
                } catch (e2) {}
            }
            function finishOk(w, h) {
                if (finished) return;
                finished = true;
                cleanup();
                try {
                    onDone(w, h);
                } catch (e3) {}
                release();
            }
            function finishErr(why) {
                if (finished) return;
                finished = true;
                cleanup();
                try {
                    onError(why || "fail");
                } catch (e4) {}
                release();
            }
            try {
                state.imgReqCounter += 1;
                img = $.CreatePanel("Image", host, "rsvote_img_" + state.imgReqCounter);
                // Do NOT set width/height — intrinsic PNG size is the payload.
                img.style.position = "0px 0px 0px";
                img.SetImage(url);
            } catch (eCreate) {
                finishErr("exception");
                return;
            }
            imgFailFast(img, function () {
                finishErr("failed");
            });
            function check() {
                if (finished) return;
                var w = 0;
                var hh = 0;
                try {
                    w = Number(img.actuallayoutwidth);
                    hh = Number(img.actuallayoutheight);
                } catch (eDim) {}
                if (w > 0 && hh > 0) {
                    finishOk(w, hh);
                    return;
                }
                elapsed += IMG_DIM_POLL * 1000;
                if (elapsed >= IMG_TIMEOUT_MS) {
                    finishErr("timeout");
                    return;
                }
                $.Schedule(IMG_DIM_POLL, check);
            }
            $.Schedule(IMG_DIM_POLL, check);
        });
    }

    function calibrateImg(onOk, onFail) {
        if (state.imgCalibrated) {
            try {
                onOk();
            } catch (e) {}
            return;
        }
        if (state.imgCalibrating) return;
        state.imgCalibrating = true;
        paintVoteMirror(null, { vote: "img_wait" });

        function attempt(n) {
            rawImgRequest(
                getProbeUrl(),
                function (w, hh) {
                    var sw = false;
                    var rw = w;
                    var rh = hh;
                    if (rw > rh) {
                        sw = true;
                        var tmp = rw;
                        rw = rh;
                        rh = tmp;
                    }
                    var sx = rw / PROBE_W;
                    var sy = rh / PROBE_H;
                    if (!(sx > 0) || !(sy > 0)) {
                        retryOrFail(n, "bad_scale");
                        return;
                    }
                    // Uniform UI scale → sx ≈ sy; diverge means host clamped the probe.
                    var ratio = Math.abs(sx - sy) / Math.max(sx, sy);
                    if (ratio > 0.2) {
                        retryOrFail(n, "clamped");
                        return;
                    }
                    state.imgSwap = sw;
                    state.imgScaleX = sx;
                    state.imgScaleY = sy;
                    state.imgCalibrated = true;
                    state.imgCalibrating = false;
                    try {
                        onOk();
                    } catch (eOk) {}
                },
                function () {
                    retryOrFail(n, "probe_fail");
                }
            );
        }

        function retryOrFail(n, why) {
            if (n < IMG_PROBE_ATTEMPTS) {
                attempt(n + 1);
                return;
            }
            state.imgCalibrating = false;
            paintVoteMirror(null, { vote: "calib_fail" });
            try {
                onFail(why || "calib_fail");
            } catch (eFail) {}
        }

        attempt(1);
    }

    function decodeWinnerCode(code) {
        var n = clampLevel(code, 60);
        if (n < 11) return { category: null, tier: null };
        var catIdx = Math.floor(n / 10);
        var tier = n % 10;
        var cats = { 1: "weapon", 2: "vitality", 3: "spirit" };
        var category = cats[catIdx] || null;
        if (!category || tier < 1 || tier > 4) return { category: null, tier: null };
        return { category: category, tier: tier };
    }

    function voteCmdFromImgSlots(slots) {
        var cats = slots.cats || { w: 0, h: 0 };
        var t12 = slots.t12 || { w: 0, h: 0 };
        var t34 = slots.t34 || { w: 0, h: 0 };
        var meta = slots.meta || { w: 0, h: 0 };
        var categoryPct = categoryPctFromCats(cats.w, cats.h);
        var tierPct = {
            "1": clampLevel(t12.w, 100),
            "2": clampLevel(t12.h, 100),
            "3": clampLevel(t34.w, 100),
            "4": clampLevel(t34.h, 100)
        };
        var stage = stageFromLevel(meta.w);
        var metaH = clampLevel(meta.h, 60);
        var postVote =
            stage === "applying" ||
            stage === "rolled" ||
            stage === "waiting_shop" ||
            stage === "purchased" ||
            stage === "failed";
        var winnerCategory = null;
        var winnerTier = null;
        var stageEndsAt = null;
        if (postVote) {
            var win = decodeWinnerCode(metaH);
            winnerCategory = win.category;
            winnerTier = win.tier;
        } else if (metaH > 0) {
            stageEndsAt = nowMs() + metaH * 1000;
        }
        return {
            seq: 0,
            cat: 0,
            tier: 0,
            pending: false,
            stage: stage,
            categoryPct: categoryPct,
            tierPct: tierPct,
            // Counts unknown over image channel — mirror shows pct in both slots.
            categoryTally: {
                weapon: categoryPct.weapon,
                vitality: categoryPct.vitality,
                spirit: categoryPct.spirit
            },
            tierTally: {
                "1": tierPct["1"],
                "2": tierPct["2"],
                "3": tierPct["3"],
                "4": tierPct["4"]
            },
            winnerCategory: winnerCategory,
            winnerTier: winnerTier,
            shopOpen: state.shopOpen,
            stageEndsAt: stageEndsAt,
            lastSeq: 0,
            lastCfg: null,
            cmdReceived: false,
            hero: "",
            lastRolled: null,
            lastPurchase: null,
            lastWaiting: null,
            lastError: null
        };
    }

    function publishVoteSnap(vote) {
        if (!vote) return;
        var hud = findHudCore();
        var gen = 1;
        try {
            if (hud && typeof hud.GetAttributeInt === "function") {
                gen = (hud.GetAttributeInt("bridge_vote_gen", 0) || 0) + 1;
            }
        } catch (eGen) {}
        try {
            if (hud && typeof hud.SetAttributeInt === "function") {
                hud.SetAttributeInt("bridge_vote_gen", gen);
                hud.SetAttributeString("bridge_vote_stage", String(vote.stage || ""));
                hud.SetAttributeString("bridge_vote_ends", String(vote.stageEndsAt || 0));
                hud.SetAttributeString("bridge_vote_winner_cat", String(vote.winnerCategory || ""));
                hud.SetAttributeString("bridge_vote_winner_tier", String(vote.winnerTier || 0));
            }
        } catch (eAttr) {}
        try {
            if (typeof globalThis !== "undefined") {
                globalThis.__twitch_bridge_vote_snap = {
                    gen: gen,
                    stage: vote.stage || "",
                    endsAt: vote.stageEndsAt || 0,
                    winnerCategory: vote.winnerCategory || "",
                    winnerTier: vote.winnerTier || 0
                };
            }
        } catch (eSnap) {}
    }

    function publishBannerCmd(slot) {
        if (!slot || !(slot.w > 0)) return;
        var kind = Math.floor(slot.h / 40);
        var win = slot.h % 40;
        var hud = findHudCore();
        try {
            if (hud && typeof hud.SetAttributeInt === "function") {
                hud.SetAttributeInt("bridge_banner_gen", slot.w);
                hud.SetAttributeString("bridge_banner_kind", String(kind));
                hud.SetAttributeString("bridge_banner_win", String(win));
            }
        } catch (eBanner) {}
        try {
            $.Msg("[twitch_bridge] vote banner png seq=" + slot.w + " kind=" + kind + " win=" + win);
        } catch (eMsg) {}
    }

    function applyImgSlots(slots) {
        state.imgSlotCache = slots;
        var vote = voteCmdFromImgSlots(slots);
        var meta = slots.meta || { w: 0, h: 0 };
        notePngStatus(
            "png " + (meta.rawW || 0) + "x" + (meta.rawH || 0) +
            " stage=" + (vote.stage || "") +
            " " + hostLayoutText()
        );
        publishVoteSnap(vote);
        publishBannerCmd(slots.banner);
        paintVoteHud(vote);
        paintVoteMirror(vote, { vote: "img" });
        // Phase 3: PNG cmd slot → considerApply (cfg-poll remains backup).
        try {
            if (slots.cmd && slots.cmd.w > 0) {
                var packed = decodeCmdHeight(slots.cmd.h);
                paintVoteMirror(null, { cmd: "png" });
                considerApply(slots.cmd.w, packed.cat, packed.tier, "png");
            }
        } catch (eCmd) {}
    }

    function fetchHudSlotsRound(onDone, onFail) {
        var slots = { cats: null, t12: null, t34: null, meta: null, cmd: null };
        var i = 0;
        function next() {
            if (i >= HUD_SLOTS.length) {
                try {
                    onDone(slots);
                } catch (e) {}
                return;
            }
            var name = HUD_SLOTS[i];
            i += 1;
            rawImgRequest(
                getHudSlotUrl(name),
                function (w, h) {
                    slots[name] = decodeDims(w, h, name);
                    slots[name].rawW = w;
                    slots[name].rawH = h;
                    next();
                },
                function (why) {
                    if (name === "meta") notePngStatus("png " + (why || "fail") + " " + hostLayoutText());
                    try {
                        onFail("slot_" + name);
                    } catch (e2) {}
                }
            );
        }
        next();
    }

    function scheduleImgRound(delaySec) {
        if (state.imgRoundScheduled) return;
        state.imgRoundScheduled = true;
        $.Schedule(delaySec == null ? IMG_POLL_SEC : delaySec, function () {
            state.imgRoundScheduled = false;
            runImgHudRound();
        });
    }

    function runImgHudRound() {
        var stale = false;
        try {
            if (typeof globalThis !== "undefined" &&
                globalThis.__twitch_bridge_shop_boot &&
                globalThis.__twitch_bridge_shop_boot.gen !== state.bootGen) {
                stale = true;
            }
        } catch (eGen) {}
        if (stale) return;

        if (!state.imgCalibrated) {
            calibrateImg(
                function () {
                    scheduleImgRound(0.05);
                },
                function () {
                    scheduleImgRound(IMG_POLL_SEC * 2);
                }
            );
            return;
        }

        paintVoteMirror(null, { vote: "img_wait" });
        fetchHudSlotsRound(
            function (slots) {
                applyImgSlots(slots);
                scheduleImgRound(currentImgPollSec());
            },
            function () {
                paintVoteMirror(null, { vote: "img_fail" });
                scheduleImgRound(currentImgPollSec());
            }
        );
    }

    // Legacy AsyncWebRequest polls kept as no-ops — Panorama JSON HTTP is dead.
    function pollShopVoteHttp() {}
    function pollHttp() {}

    function getCurrentRollSeq(root) {
        try {
            if (root && typeof root.RandomShopGetRollSeq === "function") {
                var n = Number(root.RandomShopGetRollSeq());
                return Number.isFinite(n) ? n : 0;
            }
        } catch (e) {}
        return 0;
    }

    function considerApply(seq, cat, tier, source) {
        if (!isNewerShopSeq(seq)) return;

        // Always keep the newest pending cmd — even while busy — so a stuck busy
        // does not permanently drop seq N+1.
        var incoming = { seq: seq, cat: cat, tier: tier, source: source || "http" };
        if (!state.pendingCmd) {
            state.pendingCmd = incoming;
        } else {
            var pend = state.pendingCmd.seq;
            if (seq === pend) {
                state.pendingCmd = incoming;
            } else {
                var dPend = (seq - pend + CMD_SEQ_MAX) % CMD_SEQ_MAX;
                if (dPend > 0 && dPend < CMD_SEQ_MAX / 2) {
                    state.pendingCmd = incoming;
                }
            }
        }

        // Skip / clear: cat=0 (PNG h=0 or cfg cat=0). Newer seq → CancelRoll, no ForceRoll.
        if (!cat || cat < 1) {
            var rootSkip = getRoot();
            try {
                if (rootSkip && typeof rootSkip.RandomShopCancelRoll === "function") {
                    var rollSeqSkip = getCurrentRollSeq(rootSkip);
                    var alreadyRolledSkip = false;
                    try {
                        alreadyRolledSkip = rootSkip.BHasClass("rs-mode-rolled");
                    } catch (eModeSkip) {}
                    if (alreadyRolledSkip || state.busy || state.awaitingRollSeq || rollSeqSkip > 0) {
                        rootSkip.RandomShopCancelRoll(source === "png" ? "png_skip" : "skip");
                    }
                }
            } catch (eCancelSkip) {}
            state.lastAppliedSeq = seq;
            state.pendingCmd = null;
            state._pendingApplyMeta = null;
            clearBusy("skip");
            return;
        }

        if (state.busy) {
            // If busy on an older seq, let watchdog / roll finish; pending is saved.
            return;
        }

        var root = getRoot();
        if (!root || !hasRandomShopApi(root)) {
            return;
        }
        if (!shopDomReady(root)) {
            return;
        }

        // Same seq already rolled — ack without CancelRoll / ForceRoll (cfg retry safe).
        var rollSeq = getCurrentRollSeq(root);
        var alreadyRolled = false;
        try {
            alreadyRolled = root.BHasClass("rs-mode-rolled");
        } catch (eMode) {}
        if (alreadyRolled && rollSeq > 0 && seq === rollSeq) {
            state.lastAppliedSeq = seq;
            state.pendingCmd = null;
            clearBusy("already_rolled_same_seq");
            return;
        }

        // Only cancel a previous roll when a newer vote seq arrives.
        try {
            if (alreadyRolled && seq !== rollSeq && typeof root.RandomShopCancelRoll === "function") {
                root.RandomShopCancelRoll("new_vote_seq");
            }
        } catch (eCancel) {}
        state.pendingCmd = null;
        applyCommand(cat, tier, seq, source || "http");
    }

    function applyCommand(cat, tier, seq, source) {
        var root = getRoot();
        if (!root) {
            state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
            emit("shop_error", { reason: "dom_not_ready", seq: seq, detail: "no_root" });
            return;
        }
        if (!hasRandomShopApi(root)) {
            state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
            emit("shop_error", { reason: "random_shop_api_missing", seq: seq });
            return;
        }

        var listId = CAT_TO_LIST[cat];
        if (!listId) {
            state.lastAppliedSeq = seq;
            emit("shop_error", { reason: "bad_category", cat: cat, seq: seq });
            return;
        }
        if (tier < 1 || tier > 4) {
            state.lastAppliedSeq = seq;
            emit("shop_error", { reason: "bad_tier", tier: tier, seq: seq });
            return;
        }

        state.busy = true;
        state.busySinceMs = nowMs();
        state.awaitingRollSeq = seq;
        var shopWasOpen = isShopOpen(root);

        try {
            root.ActivateRandomTab();
        } catch (eAct) {
            clearBusy("activate_failed");
            state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
            emit("shop_error", { reason: "activate_failed", seq: seq, message: String(eAct) });
            return;
        }

        $.Schedule(0.08, function () {
            if (state.awaitingRollSeq !== seq) return;
            var ok = ensureOnlyCategory(root, listId);
            if (!ok) {
                clearBusy("category_sync_failed");
                state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
                return;
            }
            $.Schedule(0.06, function () {
                if (state.awaitingRollSeq !== seq) return;
                try {
                    var started = false;
                    if (typeof root.RandomShopForceRoll === "function") {
                        started = root.RandomShopForceRoll(tier, { seq: seq, force: true });
                    } else {
                        started = root.RandomShopRollTier(tier);
                    }
                    if (started === false) {
                        clearBusy("roll_busy");
                        state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
                        emit("shop_error", { reason: "roll_busy", seq: seq });
                        return;
                    }
                    // shop_cmd emitted only after shop_rolled (onRollSucceeded).
                    state._pendingApplyMeta = {
                        seq: seq,
                        cat: cat,
                        tier: tier,
                        listId: listId,
                        source: source || "http",
                        shopOpen: shopWasOpen
                    };
                } catch (eRoll) {
                    emit("shop_error", { reason: "roll_failed", seq: seq, message: String(eRoll) });
                    clearBusy("roll_failed");
                    state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
                    return;
                }
                $.Schedule(8.0, function () {
                    if (state.awaitingRollSeq === seq) {
                        clearBusy("roll_timeout");
                        state.pendingCmd = { seq: seq, cat: cat, tier: tier, source: source || "http" };
                        emit("shop_error", { reason: "roll_timeout", seq: seq });
                    }
                });
            });
        });
    }

    function onRollSucceeded(info) {
        var meta = state._pendingApplyMeta || {};
        // Prefer meta.seq so cfg re-poll does not re-apply after a successful roll.
        var seq = meta.seq || (info && info.seq) || state.awaitingRollSeq;
        if (seq) state.lastAppliedSeq = seq;
        clearBusy("rolled");
        state.pendingCmd = null;
        state._pendingApplyMeta = null;
        var rolledPayload = info || {};
        if (seq && !rolledPayload.seq) {
            rolledPayload = Object.assign({}, rolledPayload, { seq: seq });
        }
        emit("shop_cmd", attachHero({
            seq: seq,
            cat: meta.cat,
            tier: meta.tier || (info && info.tier),
            listId: meta.listId || (info && info.listId),
            source: meta.source || "http",
            shopOpen: meta.shopOpen
        }));
        emit("shop_rolled", attachHero(rolledPayload));
        try {
            var root = getRoot();
            if (root && typeof root.ActivateRandomTab === "function") root.ActivateRandomTab();
            if (root && typeof root.RandomShopTryRestorePending === "function") {
                root.RandomShopTryRestorePending();
            }
        } catch (eAct) {}
    }

    function onRollFailed(info) {
        var reason = info && info.reason ? String(info.reason) : "unknown";
        var seq = (info && info.seq) || state.awaitingRollSeq;
        // If we are not awaiting a roll, this is a post-roll error — just forward it.
        if (!state.awaitingRollSeq) {
            emit("shop_error", attachHero(info || {}));
            clearBusy("post_roll_error");
            return;
        }
        clearBusy("roll_failed:" + reason);
        if (reason === "no_items" || reason === "dom_not_ready" || reason === "roll_busy" || reason === "roll_timeout") {
            if (state._pendingApplyMeta) {
                state.pendingCmd = {
                    seq: state._pendingApplyMeta.seq,
                    cat: state._pendingApplyMeta.cat,
                    tier: state._pendingApplyMeta.tier,
                    source: state._pendingApplyMeta.source || "http"
                };
            }
        } else if (seq) {
            state.lastAppliedSeq = seq;
            state.pendingCmd = null;
            state._pendingApplyMeta = null;
        }
        emit("shop_error", attachHero(info || {}));
    }

    function pollCfgBackup() {
        try {
            var seq = readConvarInt(CV_SEQ, 0);
            if (seq > 0) {
                var cat = readConvarInt(CV_CAT, 0);
                var tier = readConvarInt(CV_TIER, 0);
                paintVoteMirror(null, { cmd: "cfg" });
                considerApply(seq, cat, tier, "cfg");
            }
        } catch (ePoll) {}
    }

    function pollPendingFromEvents() {
        try {
            if (typeof globalThis === "undefined") return;
            var cmd = globalThis.__twitch_bridge_pending_shop_cmd;
            if (cmd && cmd.seq > 0) {
                paintVoteMirror(null, { cmd: "cfg" });
                considerApply(cmd.seq, cmd.cat, cmd.tier, "events_pending");
            }
        } catch (ePend) {}
    }

    function poll() {
        var stale = false;
        try {
            if (typeof globalThis !== "undefined" &&
                globalThis.__twitch_bridge_shop_boot &&
                globalThis.__twitch_bridge_shop_boot.gen !== state.bootGen) {
                stale = true;
            }
        } catch (eGen) {}
        // Always reschedule — a gen mismatch used to kill the loop forever.
        $.Schedule(POLL_SEC, poll);
        if (stale) {
            paintBridgeDebug({ stage: "stale_boot" });
            return;
        }
        // Heartbeat even when image channel is slow — #N must climb while HUD lives.
        paintBridgeDebug({
            stage: state.lastVoteStage || "poll",
            extra: state.voteNet || "img_wait"
        });
        paintVoteMirror(null, null);
        pollPendingFromEvents();
        pollCfgBackup();
        // Vote HUD: PNG image side-channel (runImgHudRound), not AsyncWebRequest.
    }

    try {
        if (typeof globalThis !== "undefined") {
            globalThis.__twitch_bridge_consider_shop_cmd = function (seq, cat, tier, source) {
                considerApply(seq, cat, tier, source || "events");
            };
            globalThis.__twitch_bridge_on_shop_rolled = function (info) {
                onRollSucceeded(info || {});
            };
            globalThis.__twitch_bridge_on_shop_purchase = function (info) {
                clearBusy("purchase");
                emit("shop_purchase", attachHero(info || {}));
            };
            globalThis.__twitch_bridge_on_shop_purchase_waiting = function (info) {
                emit("shop_purchase_waiting", attachHero(info || {}));
            };
            globalThis.__twitch_bridge_on_shop_error = function (info) {
                onRollFailed(info || {});
            };
            globalThis.__twitch_bridge_on_shop_open_change = function (open) {
                emitShopOpenState(!!open);
            };
        }
    } catch (eHooks) {}

    try {
        var voteBtnRoot = getRoot();
        if (voteBtnRoot) {
            voteBtnRoot.TwitchBridgeVoteButton = TwitchBridgeVoteButton;
        }
    } catch (eBtn) {}

    var registered = tryRegisterConvars();
    emitShopOpenState(isShopOpen(getRoot()));
    emit("shop_bridge_ready", {
        version: MOD_VERSION,
        registeredConvars: registered,
        cmdUrl: getShopCmdUrl(),
        voteUrl: getShopVoteUrl(),
        probeUrl: getBridgeBase() + "/api/shop-probe.png",
        hudPngUrl: getBridgeBase() + "/api/shop-vote-hud.png",
        hasRandomApi: hasRandomShopApi(getRoot()),
        hasForceRoll: !!(getRoot() && typeof getRoot().RandomShopForceRoll === "function"),
        shopOpen: isShopOpen(getRoot()),
        bootGen: state.bootGen,
        uiDebug: UI_DEBUG,
        voteTransport: "image_png"
    });

    paintBridgeDebug({ stage: "boot" });
    updateVoteStartBtn("idle");
    applyVoteMirrorVisibility();
    paintVoteMirror(null, { vote: "img_wait", cmd: "cfg" });

    // Drain any cmd that events.js already polled before shop HUD loaded.
    pollPendingFromEvents();

    $.Schedule(POLL_SEC, poll);
    $.Schedule(0.2, runImgHudRound);
    $.Schedule(0.15, watchShopOpenBridge);
})();
