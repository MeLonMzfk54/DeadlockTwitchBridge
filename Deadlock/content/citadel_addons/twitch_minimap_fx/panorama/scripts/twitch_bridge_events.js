// twitch_bridge_events.js — HUD telemetry for Twitch Deadlock Bridge
(function () {
    "use strict";

    // Single boot across hud.xml + top_bar includes
    try {
        if (typeof $ !== "undefined" && typeof $.GetContextPanel === "function") {
            var bootCtx = $.GetContextPanel();
            if (bootCtx) {
                var already = false;
                try {
                    if (typeof bootCtx.GetAttributeInt === "function") {
                        already = bootCtx.GetAttributeInt("bridge_evt_booted", 0) === 1;
                    }
                } catch (eAttr) {}
                if (!already && typeof globalThis !== "undefined" && globalThis.__twitch_bridge_events_booted) {
                    already = true;
                }
                if (already) return;
                try {
                    if (typeof bootCtx.SetAttributeInt === "function") {
                        bootCtx.SetAttributeInt("bridge_evt_booted", 1);
                    }
                } catch (eSet) {}
            }
        }
        if (typeof globalThis !== "undefined") {
            if (globalThis.__twitch_bridge_events_booted) return;
            globalThis.__twitch_bridge_events_booted = true;
        }
    } catch (eBoot) {}

    var MOD_VERSION = "1.3.0";
    var LOG_PREFIX = "[twitch_bridge] EVENT ";
    var POLL_SEC = 0.25;
    var HEARTBEAT_SEC = 5.0;
    var DUMP_COOLDOWN_SEC = 10.0;
    var PROBE_RETRY_SEC = 3.0;
    /** Clock text must change within this window to count as "running". */
    var CLOCK_LIVE_MS = 3000;
    /** PausedInfo only wins if clock has been frozen at least this long. */
    var CLOCK_FROZEN_MS = 2000;

    var CV_URL = "bridge_evt_url";
    var CV_DUMP = "bridge_evt_dump";
    var CV_SHOP_SEQ = "bridge_shop_seq";
    var CV_SHOP_CAT = "bridge_shop_cat";
    var CV_SHOP_TIER = "bridge_shop_tier";
    var DEFAULT_URL = "http://127.0.0.1:3920/api/game-event";
    var DEFAULT_SHOP_CMD_URL = "http://127.0.0.1:3920/api/shop-cmd";
    var SHOP_CMD_POLL_SEC = 0.35;

    var PANEL_IDS = {
        hideout: "CitadelHudHideout",
        pregame: "Pregame",
        pregameCountdown: "PregameCountdown",
        matchStart: "MatchStart",
        matchEnd: "MatchEnd",
        reportCard: "hud_reportcard",
        paused: "PausedInfo",
        dataFeed: "DataFeed",
        deadHud: "gameplay_hud_dead",
        aliveHud: "gameplay_hud_alive",
        respawnTimer: "respawn_timer",
        topBar: "TopBar",
        gameplayHud: "gameplay_hud",
        heroShop: "CitadelHudHeroShop",
        announcements: "CitadelHudGameAnnouncements",
        eventIndicators: "HudEventIndicatorsPanel",
        gameTime: "GameTime",
        spectate: "spectate_container",
        hudReplay: "hud_replay",
        deathReplayLoading: "death_replay_loading"
    };

    var GAME_EVENT_CANDIDATES = [
        "entity_killed",
        "player_death",
        "citadel_player_death",
        "game_end",
        "match_end",
        "round_end"
    ];

    var bootTs = Date.now ? Date.now() : (new Date()).getTime();

    var state = {
        seq: 0,
        gen: 0,
        httpOk: null,
        lastHttpError: "",
        lastHeartbeatMs: 0,
        lastDumpMs: 0,
        lastProbeMs: 0,
        phase: "",
        dead: false,
        respawnSec: null,
        feedSignature: "",
        feedSeen: {},
        announceSeen: {},
        scoreSig: "",
        lastClockText: "",
        lastClockChangeMs: 0,
        clockLive: false,
        hero: "",
        heroSource: "",
        matchEndDumped: false,
        gameEventsSubscribed: false,
        probeComplete: false,
        panelsFound: {
            dataFeed: null,
            announcements: null,
            gameEvents: null
        },
        shopCmdPollInFlight: false,
        shopCmdLastSeenSeq: 0,
        shopConvarsRegistered: false
    };

    function nowMs() {
        return Date.now ? Date.now() : (new Date()).getTime();
    }

    function nextId() {
        state.seq += 1;
        return "s" + bootTs + "-e" + state.seq;
    }

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return "{\"type\":\"raw\",\"payload\":{\"error\":\"stringify_failed\"}}";
        }
    }

    function isPanelValid(panel) {
        if (!panel) return false;
        try {
            if (typeof panel.IsValid === "function" && !panel.IsValid()) return false;
        } catch (e) {
            return false;
        }
        return true;
    }

    function findRootPanel() {
        var panel = (typeof $ !== "undefined" && typeof $.GetContextPanel === "function")
            ? $.GetContextPanel()
            : null;
        while (panel && typeof panel.GetParent === "function") {
            var parent = panel.GetParent();
            if (!parent) break;
            panel = parent;
        }
        return panel;
    }

    function findPanelById(root, id) {
        if (!isPanelValid(root) || !id) return null;
        try {
            if (typeof root.FindChildTraverse === "function") {
                var found = root.FindChildTraverse(id);
                if (isPanelValid(found)) return found;
            }
        } catch (e) {}
        return null;
    }

    function findPanelByTypeOrClass(root, panelType, className, maxDepth) {
        if (!isPanelValid(root)) return null;
        var depthLimit = typeof maxDepth === "number" ? maxDepth : 14;
        var queue = [{ panel: root, depth: 0 }];
        while (queue.length) {
            var item = queue.shift();
            var panel = item.panel;
            var depth = item.depth;
            if (!isPanelValid(panel)) continue;
            try {
                if (panelType && panel.paneltype === panelType) return panel;
            } catch (eType) {}
            if (className && panelHasClass(panel, className)) return panel;
            if (depth >= depthLimit) continue;
            try {
                var n = typeof panel.GetChildCount === "function" ? panel.GetChildCount() : 0;
                for (var i = 0; i < n; i++) {
                    var child = panel.GetChild(i);
                    if (isPanelValid(child)) queue.push({ panel: child, depth: depth + 1 });
                }
            } catch (eChild) {}
        }
        return null;
    }

    function findHeroShopPanel(root) {
        var byId = findPanelById(root, PANEL_IDS.heroShop);
        if (isPanelValid(byId)) return byId;
        // Walk up to HUD root then search by type/class (override may omit id).
        var climb = root;
        var hops = 0;
        while (isPanelValid(climb) && hops < 10) {
            try {
                var parent = typeof climb.GetParent === "function" ? climb.GetParent() : null;
                if (!isPanelValid(parent)) break;
                climb = parent;
            } catch (e) {
                break;
            }
            hops += 1;
        }
        var searchRoot = isPanelValid(climb) ? climb : root;
        var byType = findPanelByTypeOrClass(searchRoot, "CitadelHudHeroShop", "CitadelHudHeroShop", 16);
        if (isPanelValid(byType)) return byType;
        return null;
    }

    function treeHasClass(root, className, maxDepth) {
        if (rootHasClass(root, className)) return true;
        // Descend a few levels (gShopOpen lives on hero shop, not top-bar ancestors).
        if (!isPanelValid(root)) return false;
        var depthLimit = typeof maxDepth === "number" ? maxDepth : 10;
        var queue = [{ panel: root, depth: 0 }];
        var visited = 0;
        while (queue.length && visited < 200) {
            var item = queue.shift();
            visited += 1;
            var panel = item.panel;
            var depth = item.depth;
            if (!isPanelValid(panel)) continue;
            if (panelHasClass(panel, className)) return true;
            if (depth >= depthLimit) continue;
            try {
                var n = typeof panel.GetChildCount === "function" ? panel.GetChildCount() : 0;
                for (var i = 0; i < n; i++) {
                    var child = panel.GetChild(i);
                    if (isPanelValid(child)) queue.push({ panel: child, depth: depth + 1 });
                }
            } catch (e) {}
        }
        return false;
    }

    function panelVisible(panel) {
        if (!isPanelValid(panel)) return false;
        try {
            if (typeof panel.BHasClass === "function") {
                if (panel.BHasClass("Hidden") || panel.BHasClass("hidden")) return false;
            }
            if (panel.visible === false) return false;
            if (typeof panel.style !== "undefined" && panel.style) {
                var vis = panel.style.visibility;
                if (vis === "collapse" || vis === "hidden") return false;
            }
        } catch (e) {}
        return true;
    }

    /** Stricter visibility: requires non-zero layout (avoids phantom PausedInfo etc.). */
    function panelReallyVisible(panel) {
        if (!panelVisible(panel)) return false;
        try {
            var w = Number(panel.actuallayoutwidth);
            var h = Number(panel.actuallayoutheight);
            if (Number.isFinite(w) && Number.isFinite(h)) {
                return w > 0 && h > 0;
            }
        } catch (e) {}
        // Layout not ready yet — fall back to soft visible check.
        return true;
    }

    function panelHasClass(panel, className) {
        if (!isPanelValid(panel)) return false;
        try {
            if (typeof panel.BHasClass === "function") return panel.BHasClass(className);
        } catch (e) {}
        return false;
    }

    function rootHasClass(root, className) {
        var p = root;
        var hops = 0;
        while (isPanelValid(p) && hops < 8) {
            if (panelHasClass(p, className)) return true;
            try {
                p = typeof p.GetParent === "function" ? p.GetParent() : null;
            } catch (e) {
                break;
            }
            hops += 1;
        }
        // Also check known listeners
        var minimap = findPanelById(root, "minimap_persp");
        if (panelHasClass(minimap, className)) return true;
        return false;
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

    function getPostUrl() {
        var url = readConvarString(CV_URL, "");
        return url || DEFAULT_URL;
    }

    function getShopCmdUrl() {
        var post = getPostUrl();
        if (post && post.indexOf("/api/game-event") !== -1) {
            return post.replace("/api/game-event", "/api/shop-cmd");
        }
        return DEFAULT_SHOP_CMD_URL;
    }

    function tryRegisterShopConvars() {
        if (state.shopConvarsRegistered) return;
        var names = [CV_SHOP_SEQ, CV_SHOP_CAT, CV_SHOP_TIER];
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
        if (registered.length) {
            state.shopConvarsRegistered = true;
            emit("shop_convars_ready", { registered: registered });
        }
    }

    function parseShopCmdBody(raw) {
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
        if (typeof obj.responseText === "string" && obj.responseText) {
            return parseShopCmdBody(obj.responseText);
        }
        if (typeof obj.body === "string" && obj.body) {
            return parseShopCmdBody(obj.body);
        }
        if (typeof obj.text === "string" && obj.text) {
            return parseShopCmdBody(obj.text);
        }
        var seq = Number.parseInt(obj.seq, 10);
        var cat = Number.parseInt(obj.cat, 10);
        var tier = Number.parseInt(obj.tier, 10);
        if (!Number.isFinite(seq)) return null;
        return {
            seq: seq,
            cat: Number.isFinite(cat) ? cat : 0,
            tier: Number.isFinite(tier) ? tier : 0,
            pending: !!obj.pending
        };
    }

    function deliverShopCmd(cmd, source) {
        if (!cmd || !cmd.seq) return;
        try {
            if (typeof globalThis !== "undefined") {
                globalThis.__twitch_bridge_pending_shop_cmd = cmd;
            }
        } catch (eStore) {}
        try {
            if (typeof globalThis !== "undefined" &&
                typeof globalThis.__twitch_bridge_consider_shop_cmd === "function") {
                globalThis.__twitch_bridge_consider_shop_cmd(cmd.seq, cmd.cat, cmd.tier, source || "events");
            }
        } catch (eCall) {}
        if (cmd.seq !== state.shopCmdLastSeenSeq) {
            state.shopCmdLastSeenSeq = cmd.seq;
            emit("shop_cmd_poll", {
                seq: cmd.seq,
                cat: cmd.cat,
                tier: cmd.tier,
                pending: cmd.pending,
                source: source || "events",
                shopOpen: readShopOpenHint()
            });
        }
    }

    function readShopOpenHint() {
        try {
            if (typeof globalThis !== "undefined" && typeof globalThis.__twitch_bridge_shop_open === "boolean") {
                return globalThis.__twitch_bridge_shop_open;
            }
        } catch (e) {}
        return null;
    }

    function pollShopCmdHttp() {
        if (state.shopCmdPollInFlight) return;
        if (typeof $ === "undefined" || typeof $.AsyncWebRequest !== "function") return;
        state.shopCmdPollInFlight = true;
        var handled = false;
        function onBody(raw) {
            if (handled) return;
            handled = true;
            state.shopCmdPollInFlight = false;
            try {
                var cmd = parseShopCmdBody(raw);
                if (cmd && cmd.seq > 0) {
                    deliverShopCmd(cmd, "http_post");
                }
            } catch (e) {}
        }
        try {
            // POST — same payload as GET; Panorama GET often silently fails.
            $.AsyncWebRequest(getShopCmdUrl(), {
                type: "POST",
                data: "{}",
                timeout: 2000,
                headers: { "Content-Type": "application/json" },
                success: function (data) {
                    onBody(data);
                },
                complete: function (response) {
                    if (handled) return;
                    onBody(response);
                }
            });
        } catch (eReq) {
            state.shopCmdPollInFlight = false;
            return;
        }
        $.Schedule(2.5, function () {
            if (!handled) {
                handled = true;
                state.shopCmdPollInFlight = false;
            }
        });
    }

    function pollShopCmdCfg() {
        try {
            var seq = readConvarInt(CV_SHOP_SEQ, 0);
            if (seq > 0) {
                var cat = readConvarInt(CV_SHOP_CAT, 0);
                var tier = readConvarInt(CV_SHOP_TIER, 0);
                deliverShopCmd({ seq: seq, cat: cat, tier: tier, pending: true }, "cfg");
            }
        } catch (ePoll) {}
    }

    function shopCmdPollLoop() {
        tryRegisterShopConvars();
        pollShopCmdCfg();
        pollShopCmdHttp();
        $.Schedule(SHOP_CMD_POLL_SEC, shopCmdPollLoop);
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
        var skipLog = opts.skipLog === true;
        var logOnly = opts.logOnly === true;
        if (!skipLog) {
            try {
                if (type === "hud_dump") {
                    $.Msg(LOG_PREFIX + safeStringify({
                        v: 1,
                        id: evt.id,
                        tsMs: evt.tsMs,
                        type: "hud_dump",
                        payload: { omitted: true, reason: "large_payload_http_only" }
                    }) + "\n");
                } else {
                    $.Msg(LOG_PREFIX + json + "\n");
                }
            } catch (e) {}
        }
        if (!logOnly) {
            postHttp(json, evt);
        }
        return evt;
    }

    function postHttp(json, evt) {
        if (typeof $ === "undefined" || typeof $.AsyncWebRequest !== "function") {
            state.httpOk = false;
            state.lastHttpError = "AsyncWebRequest_absent";
            return;
        }
        var url = getPostUrl();
        try {
            $.AsyncWebRequest(url, {
                type: "POST",
                data: json,
                timeout: 3000,
                headers: {
                    "Content-Type": "application/json"
                },
                complete: function (response) {
                    var status = 0;
                    try {
                        status = response && (response.status || response.statusCode || 0);
                    } catch (e) {}
                    if (status >= 200 && status < 300) {
                        state.httpOk = true;
                        state.lastHttpError = "";
                    } else {
                        state.httpOk = false;
                        state.lastHttpError = "http_" + status;
                        if (evt && evt.type !== "transport_error" && evt.type !== "heartbeat") {
                            try {
                                $.Msg(LOG_PREFIX + safeStringify({
                                    v: 1,
                                    id: nextId(),
                                    tsMs: nowMs(),
                                    type: "transport_error",
                                    payload: { status: status, forId: evt.id, url: url }
                                }) + "\n");
                            } catch (e2) {}
                        }
                    }
                }
            });
        } catch (e) {
            state.httpOk = false;
            state.lastHttpError = String(e && e.message ? e.message : e);
        }
    }

    function listKeys(obj, limit) {
        var out = [];
        if (!obj) return out;
        try {
            var keys = Object.keys(obj);
            for (var i = 0; i < keys.length && out.length < (limit || 40); i++) {
                out.push(keys[i]);
            }
        } catch (e) {
            try {
                for (var k in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, k)) {
                        out.push(k);
                        if (out.length >= (limit || 40)) break;
                    }
                }
            } catch (e2) {}
        }
        return out;
    }

    function probeApis() {
        var hasAsync = typeof $ !== "undefined" && typeof $.AsyncWebRequest === "function";
        var hasGE = typeof GameEvents !== "undefined";
        state.panelsFound.gameEvents = hasGE;
        return {
            version: MOD_VERSION,
            globals: {
                $: typeof $ !== "undefined",
                AsyncWebRequest: hasAsync,
                Game: typeof Game !== "undefined",
                GameInterfaceAPI: typeof GameInterfaceAPI !== "undefined",
                GameEvents: hasGE,
                Citizens: typeof Citizens !== "undefined"
            },
            gameKeys: listKeys(typeof Game !== "undefined" ? Game : null, 30),
            gameInterfaceKeys: listKeys(typeof GameInterfaceAPI !== "undefined" ? GameInterfaceAPI : null, 30),
            gameEventsKeys: listKeys(hasGE ? GameEvents : null, 40)
        };
    }

    function detectPhase(root) {
        if (panelVisible(findPanelById(root, PANEL_IDS.hideout))) return "hideout";
        // Real pause overlay — but advancing GameTime means custom/sandbox false pause.
        if (panelReallyVisible(findPanelById(root, PANEL_IDS.paused))) {
            if (state.clockLive) return "in_match";
            return "paused";
        }
        if (panelReallyVisible(findPanelById(root, PANEL_IDS.matchEnd))) return "match_end";
        if (panelVisible(findPanelById(root, PANEL_IDS.pregame))) return "pregame";
        if (panelVisible(findPanelById(root, PANEL_IDS.pregameCountdown))) return "pregame_countdown";
        if (panelVisible(findPanelById(root, PANEL_IDS.matchStart))) return "match_start";
        if (panelVisible(findHeroShopPanel(root)) || treeHasClass(root, "gShopOpen", 12) || rootHasClass(root, "gShopOpen")) {
            return "shop";
        }
        if (rootHasClass(root, "gScoreboardOpen")) return "scoreboard";
        var alive = findPanelById(root, PANEL_IDS.aliveHud);
        var gameplay = findPanelById(root, PANEL_IDS.gameplayHud);
        if (panelReallyVisible(alive) || panelReallyVisible(gameplay)) return "in_match";
        // Custom matches often lack normal HUD panels — running clock is enough.
        if (state.clockLive) return "in_match";
        return "unknown";
    }

    function readGameClockText(root) {
        var clockPanel = findPanelById(root, PANEL_IDS.gameTime);
        var direct = readPanelText(clockPanel);
        if (direct && isClockText(direct)) return String(direct).trim();
        // Bound game_clock often lives on a child Label, not panel.text.
        if (isPanelValid(clockPanel)) {
            var texts = [];
            collectLabelTexts(clockPanel, 0, texts);
            for (var i = 0; i < texts.length; i++) {
                var t = String(texts[i] || "").trim();
                if (isClockText(t)) return t;
                var m = t.match(/(\d{1,2}:\d{2}(?:\.\d+)?)/);
                if (m) return m[1];
            }
        }
        var byClass = readLabelByClass(root, "GameTime");
        if (byClass && isClockText(byClass)) return String(byClass).trim();
        if (byClass) {
            var m2 = String(byClass).trim().match(/(\d{1,2}:\d{2}(?:\.\d+)?)/);
            if (m2) return m2[1];
        }
        return direct ? String(direct).trim() : "";
    }

    /** True if text looks like a match clock (e.g. 0:12, 12:05). */
    function isClockText(text) {
        return /^\d{1,2}:\d{2}(?:\.\d+)?$/.test(String(text || "").trim());
    }

    /**
     * Update clock-live state from GameTime panel.
     * Clock "advancing" = text changed recently; frozen = same text for CLOCK_FROZEN_MS.
     */
    function updateClockLive(root) {
        var clock = String(readGameClockText(root) || "").trim();
        var t = nowMs();
        if (clock && isClockText(clock)) {
            if (clock !== state.lastClockText) {
                state.lastClockText = clock;
                state.lastClockChangeMs = t;
                state.clockLive = true;
            } else if (state.lastClockChangeMs > 0) {
                var age = t - state.lastClockChangeMs;
                state.clockLive = age < CLOCK_LIVE_MS;
                if (age >= CLOCK_FROZEN_MS) state.clockLive = false;
            }
        } else if (state.lastClockChangeMs > 0 && t - state.lastClockChangeMs >= CLOCK_LIVE_MS) {
            state.clockLive = false;
        }
        // Prefer last known good clock for telemetry when this frame's read is empty.
        return clock || state.lastClockText || "";
    }

    function readPanelText(panel) {
        if (!isPanelValid(panel)) return "";
        try {
            if (typeof panel.text === "string") return panel.text;
        } catch (e) {}
        return "";
    }

    function parseRespawnSec(root) {
        var timer = findPanelById(root, PANEL_IDS.respawnTimer);
        if (!isPanelValid(timer) || !panelVisible(timer)) return null;
        var texts = [];
        collectLabelTexts(timer, 0, texts);
        for (var i = 0; i < texts.length; i++) {
            var m = String(texts[i]).match(/(\d+(?:\.\d+)?)/);
            if (m) {
                var n = Number.parseFloat(m[1]);
                if (Number.isFinite(n)) return n;
            }
        }
        return null;
    }

    function detectDeath(root) {
        // Do not treat spectate / death replay as local death
        if (panelVisible(findPanelById(root, PANEL_IDS.deathReplayLoading))) return false;
        if (panelVisible(findPanelById(root, PANEL_IDS.hudReplay))) return false;

        var dead = findPanelById(root, PANEL_IDS.deadHud);
        var respawn = findPanelById(root, PANEL_IDS.respawnTimer);
        var deadVisible = panelVisible(dead) || panelVisible(respawn);
        if (!deadVisible) return false;

        // If only spectate is up without dead hud, ignore
        if (!panelVisible(dead) && !panelVisible(respawn) && panelVisible(findPanelById(root, PANEL_IDS.spectate))) {
            return false;
        }
        return true;
    }

    function collectLabelTexts(panel, depth, out) {
        if (!isPanelValid(panel) || depth > 5 || out.length >= 16) return;
        try {
            if (typeof panel.text === "string" && panel.text.length > 0) {
                out.push(panel.text);
            }
            if (typeof panel.GetChildCount === "function") {
                var n = panel.GetChildCount();
                for (var i = 0; i < n; i++) {
                    var child = panel.GetChild(i);
                    collectLabelTexts(child, depth + 1, out);
                }
            }
        } catch (e) {}
    }

    function readHeroAttr(panel) {
        if (!isPanelValid(panel)) return "";
        var keys = ["heroname", "heroName", "hero", "HeroName"];
        for (var i = 0; i < keys.length; i++) {
            try {
                if (typeof panel.GetAttributeString === "function") {
                    var v = panel.GetAttributeString(keys[i], "");
                    if (v) return String(v);
                }
            } catch (e) {}
            try {
                if (panel[keys[i]]) return String(panel[keys[i]]);
            } catch (e2) {}
        }
        try {
            if (typeof panel.GetDialogVariable === "function") {
                var d = panel.GetDialogVariable("heroname") || panel.GetDialogVariable("hero_name");
                if (d) return String(d);
            }
        } catch (e3) {}
        return "";
    }

    function isPlaceholderHero(name) {
        if (name === undefined || name === null) return true;
        var s = String(name).trim();
        if (!s) return true;
        if (s.indexOf("{") !== -1) return true;
        if (s === "?" || s === "-" || s === "undefined" || s === "null") return true;
        return false;
    }

    function findPanelByClass(root, className, maxDepth) {
        var found = null;
        var cap = maxDepth || 12;
        function walk(panel, depth) {
            if (!isPanelValid(panel) || depth > cap || found) return;
            if (panelHasClass(panel, className)) {
                found = panel;
                return;
            }
            try {
                if (typeof panel.GetChildCount === "function") {
                    var n = Math.min(panel.GetChildCount(), 30);
                    for (var i = 0; i < n; i++) walk(panel.GetChild(i), depth + 1);
                }
            } catch (e) {}
        }
        walk(root, 0);
        return found;
    }

    function panelOrAncestorIsLocal(panel, hops) {
        var p = panel;
        var n = hops || 5;
        for (var i = 0; i < n && isPanelValid(p); i++) {
            if (
                panelHasClass(p, "local") ||
                panelHasClass(p, "LocalPlayer") ||
                panelHasClass(p, "Local") ||
                panelHasClass(p, "localPlayer")
            ) {
                return true;
            }
            try {
                p = typeof p.GetParent === "function" ? p.GetParent() : null;
            } catch (e) {
                break;
            }
        }
        return false;
    }

    function readHeroFromShop(root) {
        var shop = findHeroShopPanel(root);
        var candidates = [];
        if (isPanelValid(shop)) candidates.push(shop);
        if (isPanelValid(root)) candidates.push(root);
        for (var i = 0; i < candidates.length; i++) {
            var p = candidates[i];
            try {
                if (typeof p.GetDialogVariable === "function") {
                    var d = p.GetDialogVariable("hero_name") || p.GetDialogVariable("heroname");
                    if (!isPlaceholderHero(d)) return String(d);
                }
            } catch (e) {}
        }
        var label = findPanelByClass(shop || root, "HeroFavoritesHeaderLabel", 12);
        if (isPanelValid(label)) {
            try {
                if (typeof label.GetDialogVariable === "function") {
                    var d2 = label.GetDialogVariable("hero_name") || label.GetDialogVariable("heroname");
                    if (!isPlaceholderHero(d2)) return String(d2);
                }
            } catch (e2) {}
            var text = readPanelText(label);
            var m = String(text).match(/^(.+?)(?:'s|’s)\s+Recommended Mods/i);
            if (m && !isPlaceholderHero(m[1])) return m[1].trim();
        }
        return "";
    }

    function readHeroFromTopBar(root) {
        var teams = findPanelById(root, "TeamsContainer") || findPanelById(root, PANEL_IDS.topBar) || root;
        var found = "";
        function walk(panel, depth) {
            if (!isPanelValid(panel) || depth > 10 || found) return;
            var type = "";
            try { type = String(panel.paneltype || panel.type || ""); } catch (e) {}
            var isHeroImg = type === "CitadelHeroImage";
            if (isHeroImg && panelOrAncestorIsLocal(panel, 5)) {
                var hero = readHeroAttr(panel);
                if (!isPlaceholderHero(hero)) {
                    found = hero;
                    return;
                }
            }
            try {
                if (typeof panel.GetChildCount === "function") {
                    var n = Math.min(panel.GetChildCount(), 24);
                    for (var i = 0; i < n; i++) walk(panel.GetChild(i), depth + 1);
                }
            } catch (e2) {}
        }
        walk(teams, 0);
        return found;
    }

    function detectLocalHero(root) {
        var fromShop = readHeroFromShop(root);
        if (fromShop) return { name: fromShop, source: "hero_name" };
        var fromBar = readHeroFromTopBar(root);
        if (fromBar) return { name: fromBar, source: "local_hero_image" };
        return { name: "", source: "" };
    }

    function pollHero(root) {
        var info = detectLocalHero(root);
        if (!info.name || info.name === state.hero) return;
        state.hero = info.name;
        state.heroSource = info.source;
        emit("hero", { name: info.name, source: info.source });
    }

    function findHeroImageInfo(parent, id) {
        var img = null;
        try {
            if (isPanelValid(parent) && typeof parent.FindChildTraverse === "function") {
                img = parent.FindChildTraverse(id);
            }
        } catch (e) {}
        if (!isPanelValid(img)) return { id: id, found: false, hero: "" };
        return { id: id, found: true, hero: readHeroAttr(img) };
    }

    function feedChildSignature(child) {
        var texts = [];
        collectLabelTexts(child, 0, texts);
        var id = "";
        try { id = child.id || ""; } catch (e) {}
        var killer = findHeroImageInfo(child, "KillerHeroImage");
        var victim = findHeroImageInfo(child, "VictimHeroImage");
        return id + "|" + texts.join("|") + "|" + killer.hero + ">" + victim.hero;
    }

    function pollFeedPanel(root, panelId, seenMap, eventType, pruneTo) {
        var feed = findPanelById(root, panelId);
        var found = isPanelValid(feed);
        if (panelId === PANEL_IDS.dataFeed) state.panelsFound.dataFeed = found;
        if (panelId === PANEL_IDS.announcements || panelId === PANEL_IDS.eventIndicators) {
            if (found) state.panelsFound.announcements = true;
            else if (state.panelsFound.announcements !== true) state.panelsFound.announcements = false;
        }
        if (!found) return;

        var children = [];
        try {
            if (typeof feed.GetChildCount === "function") {
                var n = feed.GetChildCount();
                for (var i = 0; i < n; i++) {
                    var c = feed.GetChild(i);
                    if (isPanelValid(c)) children.push(c);
                }
            }
        } catch (e) {
            return;
        }

        var sigParts = [];
        for (var j = 0; j < children.length; j++) {
            var sig = feedChildSignature(children[j]);
            sigParts.push(sig);
            if (!seenMap[sig]) {
                seenMap[sig] = true;
                var texts = [];
                collectLabelTexts(children[j], 0, texts);
                var killer = findHeroImageInfo(children[j], "KillerHeroImage");
                var victim = findHeroImageInfo(children[j], "VictimHeroImage");
                var payload = {
                    text: texts.join(" "),
                    texts: texts,
                    childId: (function () {
                        try { return children[j].id || ""; } catch (e2) { return ""; }
                    })(),
                    childIndex: j,
                    sourcePanel: panelId
                };
                if (eventType === "killfeed") {
                    payload.killer = killer.hero || "";
                    payload.victim = victim.hero || "";
                    payload.killerFound = killer.found;
                    payload.victimFound = victim.found;
                    payload.dataFeedFound = true;
                } else {
                    payload.announcementsFound = true;
                }
                emit(eventType, payload);
            }
        }

        var keys = Object.keys(seenMap);
        if (keys.length > (pruneTo || 80)) {
            var keep = {};
            for (var k = 0; k < sigParts.length; k++) keep[sigParts[k]] = true;
            for (var key in keep) {
                if (Object.prototype.hasOwnProperty.call(keep, key)) seenMap[key] = true;
            }
            // rebuild map
            var fresh = {};
            for (var s = 0; s < sigParts.length; s++) fresh[sigParts[s]] = true;
            if (eventType === "killfeed") state.feedSeen = fresh;
            else state.announceSeen = fresh;
        }
    }

    function pollKillfeed(root) {
        pollFeedPanel(root, PANEL_IDS.dataFeed, state.feedSeen, "killfeed", 80);
    }

    function pollAnnouncements(root) {
        pollFeedPanel(root, PANEL_IDS.announcements, state.announceSeen, "announcement", 60);
        pollFeedPanel(root, PANEL_IDS.eventIndicators, state.announceSeen, "announcement", 60);
    }

    function readLabelByClass(root, className) {
        // Best-effort: walk TopBar for labels with matching class / id
        var top = findPanelById(root, PANEL_IDS.topBar);
        if (!isPanelValid(top)) top = root;
        var found = "";
        function walk(panel, depth) {
            if (!isPanelValid(panel) || depth > 6 || found) return;
            try {
                if (typeof panel.BHasClass === "function" && panel.BHasClass(className)) {
                    var t = readPanelText(panel);
                    if (t) {
                        found = t;
                        return;
                    }
                }
                if (panel.id === className) {
                    var t2 = readPanelText(panel);
                    if (t2) {
                        found = t2;
                        return;
                    }
                }
                if (typeof panel.GetChildCount === "function") {
                    var n = Math.min(panel.GetChildCount(), 20);
                    for (var i = 0; i < n; i++) walk(panel.GetChild(i), depth + 1);
                }
            } catch (e) {}
        }
        walk(top, 0);
        return found;
    }

    function pollScore(root) {
        var clock = updateClockLive(root);
        var friendly = readLabelByClass(root, "FriendlyKills");
        var enemy = readLabelByClass(root, "EnemyKills");
        var fk = friendly !== "" ? Number.parseInt(friendly, 10) : null;
        var ek = enemy !== "" ? Number.parseInt(enemy, 10) : null;
        if (fk !== null && !Number.isFinite(fk)) fk = null;
        if (ek !== null && !Number.isFinite(ek)) ek = null;

        var sig = clock + "|" + (fk === null ? "" : fk) + "|" + (ek === null ? "" : ek);
        if (sig === "||") return;
        if (sig === state.scoreSig) return;
        var prevSig = state.scoreSig;
        state.scoreSig = sig;
        // Only log when kills change (not every clock tick).
        var prevParts = String(prevSig || "").split("|");
        var killsChanged =
            prevParts.length < 3 ||
            String(prevParts[1]) !== String(fk === null ? "" : fk) ||
            String(prevParts[2]) !== String(ek === null ? "" : ek);
        emit(
            "score",
            {
                clock: clock,
                friendlyKills: fk,
                enemyKills: ek
            },
            { skipLog: !killsChanged }
        );
    }

    function dumpPanelTree(panel, depth, maxDepth, maxNodes, maxChildren, acc) {
        if (!isPanelValid(panel) || depth > maxDepth || acc.length >= maxNodes) return;
        var entry = { depth: depth, id: "", type: "", visible: false, text: "", attrs: {} };
        try { entry.id = panel.id || ""; } catch (e) {}
        try { entry.type = panel.paneltype || panel.type || ""; } catch (e2) {}
        try { entry.visible = panelVisible(panel); } catch (e3) {}
        try {
            if (typeof panel.text === "string") entry.text = panel.text.slice(0, 80);
        } catch (e4) {}
        try {
            var hero = readHeroAttr(panel);
            if (hero) entry.attrs.hero = hero;
        } catch (e5) {}
        acc.push(entry);
        try {
            if (typeof panel.GetChildCount === "function") {
                var n = Math.min(panel.GetChildCount(), maxChildren || 16);
                for (var i = 0; i < n; i++) {
                    dumpPanelTree(panel.GetChild(i), depth + 1, maxDepth, maxNodes, maxChildren, acc);
                }
            }
        } catch (e6) {}
    }

    function maybeHudDump(root) {
        if (readConvarInt(CV_DUMP, 0) !== 1) return;
        var t = nowMs();
        if (t - state.lastDumpMs < DUMP_COOLDOWN_SEC * 1000) return;
        state.lastDumpMs = t;

        var targets = [
            PANEL_IDS.dataFeed,
            PANEL_IDS.announcements,
            PANEL_IDS.eventIndicators,
            PANEL_IDS.matchEnd,
            PANEL_IDS.reportCard,
            PANEL_IDS.topBar,
            PANEL_IDS.deadHud,
            PANEL_IDS.aliveHud,
            PANEL_IDS.hideout,
            PANEL_IDS.heroShop
        ];
        var dump = {};
        for (var i = 0; i < targets.length; i++) {
            var id = targets[i];
            var p = findPanelById(root, id);
            var nodes = [];
            if (isPanelValid(p)) dumpPanelTree(p, 0, 5, 80, 20, nodes);
            dump[id] = {
                found: isPanelValid(p),
                visible: panelVisible(p),
                nodes: nodes
            };
        }
        // Full dump over HTTP only; log gets stub via emit()
        emit("hud_dump", dump);
    }

    function maybeMatchEndDump(root, phase) {
        if (phase !== "match_end") {
            state.matchEndDumped = false;
            return;
        }
        if (state.matchEndDumped) return;
        state.matchEndDumped = true;

        var targets = [PANEL_IDS.matchEnd, PANEL_IDS.reportCard];
        var texts = [];
        var nodes = [];
        for (var i = 0; i < targets.length; i++) {
            var p = findPanelById(root, targets[i]);
            if (!isPanelValid(p)) continue;
            collectLabelTexts(p, 0, texts);
            dumpPanelTree(p, 0, 4, 50, 16, nodes);
        }
        emit("match_end", {
            texts: texts.slice(0, 24),
            text: texts.slice(0, 12).join(" | "),
            nodes: nodes
        });
    }

    function trySubscribeGameEvents(probe) {
        if (state.gameEventsSubscribed) return;
        if (typeof GameEvents === "undefined" || typeof GameEvents.Subscribe !== "function") {
            return;
        }
        state.gameEventsSubscribed = true;
        state.panelsFound.gameEvents = true;

        var foundKeys = (probe && probe.gameEventsKeys) ? probe.gameEventsKeys : listKeys(GameEvents, 40);
        var names = [];
        var seen = {};

        // Prefer real keys that look like event names
        for (var i = 0; i < foundKeys.length; i++) {
            var k = foundKeys[i];
            if (!k || k === "Subscribe" || k === "Unsubscribe") continue;
            if (typeof GameEvents[k] === "function") continue;
            if (!seen[k]) {
                seen[k] = true;
                names.push(k);
            }
            if (names.length >= 12) break;
        }

        // Always try short candidate list if not already included
        for (var c = 0; c < GAME_EVENT_CANDIDATES.length; c++) {
            var name = GAME_EVENT_CANDIDATES[c];
            if (!seen[name]) {
                seen[name] = true;
                names.push(name);
            }
        }

        var subscribed = [];
        for (var n = 0; n < names.length; n++) {
            (function (eventName) {
                try {
                    GameEvents.Subscribe(eventName, function (data) {
                        emit("raw", { source: "GameEvents", name: eventName, data: data || {} });
                    });
                    subscribed.push(eventName);
                } catch (e) {}
            })(names[n]);
        }
        emit("api_probe", {
            gameEventsSubscribe: true,
            attempted: names,
            subscribed: subscribed,
            foundKeys: foundKeys.slice(0, 40)
        });
    }

    function maybeProbeAndSubscribe() {
        var hasAsync = typeof $ !== "undefined" && typeof $.AsyncWebRequest === "function";
        var hasGE = typeof GameEvents !== "undefined";
        var t = nowMs();

        if (state.probeComplete) {
            if (!state.gameEventsSubscribed && hasGE) {
                trySubscribeGameEvents(probeApis());
            }
            return;
        }

        if (state.lastProbeMs && t - state.lastProbeMs < PROBE_RETRY_SEC * 1000) return;
        state.lastProbeMs = t;

        var probe = probeApis();
        emit("api_probe", probe);
        trySubscribeGameEvents(probe);

        // Keep retrying until AsyncWebRequest is up; wait for GameEvents up to ~20s
        if (hasAsync && (hasGE || state.gameEventsSubscribed || t - bootTs > 20000)) {
            state.probeComplete = true;
        }
    }

    function poll(gen) {
        if (gen !== state.gen) return;

        var root = findRootPanel();
        if (!isPanelValid(root)) {
            $.Schedule(POLL_SEC, function () { poll(gen); });
            return;
        }

        maybeProbeAndSubscribe();

        // Update clock before phase so PausedInfo can be demoted when time is running.
        updateClockLive(root);

        var phase = detectPhase(root);
        if (phase !== state.phase) {
            var prev = state.phase;
            state.phase = phase;
            emit("phase", { phase: phase, previous: prev, clock: state.lastClockText || "" });
            maybeMatchEndDump(root, phase);
        }

        var dead = detectDeath(root);
        var respawnSec = dead ? parseRespawnSec(root) : null;
        if (dead !== state.dead) {
            state.dead = dead;
            state.respawnSec = respawnSec;
            if (dead) {
                emit("local_death", {
                    respawnSec: respawnSec,
                    source: panelVisible(findPanelById(root, PANEL_IDS.respawnTimer))
                        ? "respawn_timer"
                        : "gameplay_hud_dead"
                });
            } else {
                emit("local_respawn", {});
            }
        } else if (dead && respawnSec !== state.respawnSec) {
            // Update snapshot via heartbeat path only — avoid spam; keep local state
            state.respawnSec = respawnSec;
        }

        pollKillfeed(root);
        pollAnnouncements(root);
        pollScore(root);
        pollHero(root);
        maybeHudDump(root);

        var t = nowMs();
        if (t - state.lastHeartbeatMs >= HEARTBEAT_SEC * 1000) {
            state.lastHeartbeatMs = t;
            var shopHint = readShopOpenHint();
            var shopOpenHb = typeof shopHint === "boolean"
                ? shopHint
                : (state.phase === "shop");
            emit(
                "heartbeat",
                {
                    phase: state.phase,
                    shopOpen: shopOpenHb,
                    clock: state.lastClockText || "",
                    clockLive: state.clockLive,
                    dead: state.dead,
                    respawnSec: state.respawnSec,
                    hero: state.hero,
                    heroSource: state.heroSource,
                    httpOk: state.httpOk,
                    lastHttpError: state.lastHttpError,
                    version: MOD_VERSION,
                    url: getPostUrl(),
                    panelsFound: {
                        dataFeed: state.panelsFound.dataFeed,
                        announcements: state.panelsFound.announcements,
                        gameEvents: state.panelsFound.gameEvents
                    }
                },
                { skipLog: true }
            );
        }

        $.Schedule(POLL_SEC, function () { poll(gen); });
    }

    function boot() {
        var ctx = (typeof $ !== "undefined" && typeof $.GetContextPanel === "function")
            ? $.GetContextPanel()
            : null;
        if (!ctx || !isPanelValid(ctx)) {
            $.Schedule(0.5, boot);
            return;
        }
        state.gen += 1;
        emit("mod_loaded", {
            version: MOD_VERSION,
            sessionId: "s" + bootTs,
            defaults: { url: DEFAULT_URL, pollSec: POLL_SEC, heartbeatSec: HEARTBEAT_SEC }
        });
        tryRegisterShopConvars();
        $.Schedule(SHOP_CMD_POLL_SEC, shopCmdPollLoop);
        poll(state.gen);
    }

    boot();
})();
