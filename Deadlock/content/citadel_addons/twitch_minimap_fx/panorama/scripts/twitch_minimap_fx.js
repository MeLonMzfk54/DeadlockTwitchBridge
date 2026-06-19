// twitch_minimap_fx.js — center enlarged spinning minimap (Twitch bridge hybrid)
(function () {
    "use strict";

    var TICK_SEC = 0.05;
    var CONVAR_PROBE_INTERVAL_SEC = 5.0;
    var DRAW_OVER_UI_REASSERT_MS = 250;
    var PANEL_ID_MINIMAP = "hud_minimap";
    var PANEL_ID_GAMEPLAY_HUD = "gameplay_hud";
    var MINIMAP_CAST_RANGE_BASE_SIZE = 400.0;

    var CV_ACTIVE = "bridge_mm_fx_active";
    var CV_SIZE = "bridge_mm_fx_size";
    var CV_SPIN = "bridge_mm_fx_spin";
    var CV_OPACITY = "bridge_mm_fx_opacity";

    var STYLE_KEYS = [
        "width", "height", "opacity", "align", "margin", "transformOrigin",
        "preTransformScale2d", "preTransformRotate2d", "transform", "zIndex"
    ];

    var state = {
        cachedPanels: {},
        drawOverUiActive: false,
        drawOverUiOriginalParent: null,
        drawOverUiOriginalIndex: -1,
        drawOverUiNextReassertMs: 0,
        savedStyles: null,
        spinAngle: 0,
        lastTickMs: 0,
        fxWasActive: false,
        convarProbeLogged: false,
        nextConvarProbeMs: 0,
        gen: 0
    };

    function perfNowMs() {
        return Date.now ? Date.now() : (new Date()).getTime();
    }

    function isPanelValid(panel) {
        if (!panel) return false;
        try {
            if (typeof panel.IsValid === "function" && !panel.IsValid()) return false;
        } catch (e) {}
        return true;
    }

    function isPanelListValid(list) {
        if (!list || list.length === 0) return false;
        for (var i = 0; i < list.length; i++) {
            if (!isPanelValid(list[i])) return false;
        }
        return true;
    }

    function getCachedPanel(key) {
        var panel = state.cachedPanels[key];
        if (isPanelValid(panel)) return panel;
        state.cachedPanels[key] = null;
        return null;
    }

    function setCachedPanel(key, panel) {
        state.cachedPanels[key] = isPanelValid(panel) ? panel : null;
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

    function tryReadConvarVia(label, reader) {
        try {
            var value = reader();
            if (value === undefined || value === null) return null;
            return { label: label, raw: String(value) };
        } catch (e) {
            return null;
        }
    }

    function probeConvarReaders(name) {
        var hits = [];
        var api = typeof GameInterfaceAPI !== "undefined" ? GameInterfaceAPI : null;
        var game = typeof Game !== "undefined" ? Game : null;

        if (api && typeof api.GetConvarString === "function") {
            var hit = tryReadConvarVia("GameInterfaceAPI.GetConvarString", function () {
                return api.GetConvarString(name, "");
            });
            if (hit) hits.push(hit);
        }
        if (api && typeof api.GetConVarString === "function") {
            var hitCv = tryReadConvarVia("GameInterfaceAPI.GetConVarString", function () {
                return api.GetConVarString(name, "");
            });
            if (hitCv) hits.push(hitCv);
        }
        if (game && typeof game.GetConvarString === "function") {
            var hitGame = tryReadConvarVia("Game.GetConvarString", function () {
                return game.GetConvarString(name, "");
            });
            if (hitGame) hits.push(hitGame);
        }
        if (game && typeof game.ConvarGetString === "function") {
            var hitConvarGet = tryReadConvarVia("Game.ConvarGetString", function () {
                return game.ConvarGetString(name, "");
            });
            if (hitConvarGet) hits.push(hitConvarGet);
        }
        if (game && typeof game.GetConvarInt === "function") {
            var hitInt = tryReadConvarVia("Game.GetConvarInt", function () {
                return game.GetConvarInt(name, -9999);
            });
            if (hitInt) hits.push(hitInt);
        }

        return hits;
    }

    function readConvarString(name) {
        var hits = probeConvarReaders(name);
        for (var i = 0; i < hits.length; i++) {
            if (hits[i].raw !== "") return hits[i].raw;
        }
        return "";
    }

    function readConvarFloat(name, fallback) {
        var raw = readConvarString(name);
        if (raw === "") return fallback;
        var value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    function readConvarInt(name, fallback) {
        var raw = readConvarString(name);
        if (raw === "") return fallback;
        var value = Number.parseInt(raw, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function readFxConfig() {
        return {
            active: readConvarInt(CV_ACTIVE, 0) === 1,
            size: readConvarFloat(CV_SIZE, 900),
            spinDegPerSec: readConvarFloat(CV_SPIN, 45),
            opacity: readConvarFloat(CV_OPACITY, 0.85)
        };
    }

    function logConvarProbe(force) {
        var nowMs = perfNowMs();
        if (!force && state.convarProbeLogged && nowMs < state.nextConvarProbeMs) return;

        var hits = probeConvarReaders(CV_ACTIVE);
        var cfg = readFxConfig();
        var apiSummary = hits.length > 0
            ? hits.map(function (h) { return h.label + "=\"" + h.raw + "\""; }).join("; ")
            : "no readable API (GameInterfaceAPI absent?)";

        $.Msg(
            "[twitch_minimap_fx] convar probe: " + apiSummary +
            " | parsed active=" + (cfg.active ? "1" : "0") +
            " size=" + cfg.size +
            " spin=" + cfg.spinDegPerSec +
            " opacity=" + cfg.opacity + "\n"
        );

        state.convarProbeLogged = true;
        state.nextConvarProbeMs = nowMs + (CONVAR_PROBE_INTERVAL_SEC * 1000);
    }

    function dispatchConvarBootstrap() {
        try {
            $.DispatchEvent("CitadelConCommand", "exec bridge_mm_fx");
        } catch (e0) {}
    }

    function clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    function findMinimapRotateTarget(root) {
        var cached = getCachedPanel("minimapRotateTarget");
        if (isPanelValid(cached)) return cached;

        var target = null;
        if (root && root.FindChildTraverse) {
            target = root.FindChildTraverse(PANEL_ID_MINIMAP);
            if (!target) target = root.FindChildTraverse("minimap_container");
            if (!target) target = root.FindChildTraverse("minimap_persp");
        }
        setCachedPanel("minimapRotateTarget", target);
        return target;
    }

    function ensureMinimapPanelCache(root) {
        if (state.cachedPanels.minimap && isPanelListValid(state.cachedPanels.minimap)) {
            return state.cachedPanels.minimap;
        }
        var panels = [];
        if (root && root.FindChildTraverse) {
            var ids = ["minimap_persp", "minimap_container", "minimap_frame", "HudMinimapContainer", PANEL_ID_MINIMAP];
            for (var i = 0; i < ids.length; i++) {
                var panel = root.FindChildTraverse(ids[i]);
                if (panel) panels.push(panel);
            }
        }
        state.cachedPanels.minimap = panels;
        return panels;
    }

    function resolveHudRootForMinimapDraw(root) {
        var cached = getCachedPanel("minimapDrawHudRoot");
        if (isPanelValid(cached)) return cached;

        var gameplayHud = root && root.FindChildTraverse ? root.FindChildTraverse(PANEL_ID_GAMEPLAY_HUD) : null;
        var hudCore = gameplayHud && gameplayHud.GetParent ? gameplayHud.GetParent() : null;
        var hudRoot = hudCore && hudCore.GetParent ? hudCore.GetParent() : null;
        var fallback = $.GetContextPanel ? $.GetContextPanel() : null;
        var target = hudRoot || hudCore || fallback || root || null;
        setCachedPanel("minimapDrawHudRoot", target);
        return target;
    }

    function captureMinimapOriginalParent(minimapPersp) {
        if (!minimapPersp || state.drawOverUiOriginalParent) return;

        var parent = minimapPersp.GetParent ? minimapPersp.GetParent() : null;
        state.drawOverUiOriginalParent = parent || null;
        state.drawOverUiOriginalIndex = -1;
        if (!parent || !parent.GetChildCount || !parent.GetChild) return;

        var count = parent.GetChildCount();
        for (var i = 0; i < count; i++) {
            if (parent.GetChild(i) === minimapPersp) {
                state.drawOverUiOriginalIndex = i;
                break;
            }
        }
    }

    function restoreMinimapOriginalOrder(minimapPersp) {
        var parent = state.drawOverUiOriginalParent;
        if (!minimapPersp || !parent || !isPanelValid(parent)) return;

        if (minimapPersp.GetParent && minimapPersp.GetParent() !== parent && minimapPersp.SetParent) {
            minimapPersp.SetParent(parent);
        }

        if (!parent.GetChildCount || !parent.GetChild || !parent.MoveChildBefore) return;

        var targetIndex = state.drawOverUiOriginalIndex;
        if (!Number.isFinite(targetIndex) || targetIndex < 0) return;

        var count = parent.GetChildCount();
        if (count <= 1 || targetIndex >= count) return;

        var anchor = parent.GetChild(targetIndex);
        if (anchor && anchor !== minimapPersp) {
            parent.MoveChildBefore(minimapPersp, anchor);
        }
    }

    function updateZoomDrawOverUi(root, minimapPersp) {
        var nowMs = perfNowMs();
        minimapPersp = isPanelValid(minimapPersp)
            ? minimapPersp
            : (root && root.FindChildTraverse ? root.FindChildTraverse("minimap_persp") : null);
        if (!isPanelValid(minimapPersp)) {
            state.drawOverUiActive = false;
            state.drawOverUiNextReassertMs = 0;
            return;
        }

        captureMinimapOriginalParent(minimapPersp);

        var targetRoot = resolveHudRootForMinimapDraw(root);
        var reparented = false;
        if (targetRoot && minimapPersp.GetParent && minimapPersp.GetParent() !== targetRoot && minimapPersp.SetParent) {
            minimapPersp.SetParent(targetRoot);
            reparented = true;
        }

        var shouldReassertOrder = reparented ||
            !state.drawOverUiActive ||
            nowMs >= (state.drawOverUiNextReassertMs || 0);
        if (targetRoot && shouldReassertOrder && targetRoot.GetChildCount && targetRoot.GetChild && targetRoot.MoveChildAfter) {
            var count = targetRoot.GetChildCount();
            if (count > 0) {
                var lastChild = targetRoot.GetChild(count - 1);
                if (lastChild && lastChild !== minimapPersp) {
                    targetRoot.MoveChildAfter(minimapPersp, lastChild);
                }
            }
        }

        state.drawOverUiNextReassertMs = nowMs + DRAW_OVER_UI_REASSERT_MS;
        if (minimapPersp.style.zIndex !== "2147483647") {
            minimapPersp.style.zIndex = "2147483647";
        }
        state.drawOverUiActive = true;
    }

    function restoreDrawOverUi(minimapPersp) {
        if (!isPanelValid(minimapPersp)) return;
        if (state.drawOverUiActive ||
            (state.drawOverUiOriginalParent && minimapPersp.GetParent &&
                minimapPersp.GetParent() !== state.drawOverUiOriginalParent)) {
            restoreMinimapOriginalOrder(minimapPersp);
        }
        if (minimapPersp.style.zIndex !== "0") {
            minimapPersp.style.zIndex = "0";
        }
        state.drawOverUiActive = false;
        state.drawOverUiNextReassertMs = 0;
        state.drawOverUiOriginalParent = null;
        state.drawOverUiOriginalIndex = -1;
    }

    function capturePanelStyle(panel, keys) {
        var saved = {};
        if (!panel || !panel.style) return saved;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            try {
                saved[key] = panel.style[key];
            } catch (e) {
                saved[key] = "";
            }
        }
        return saved;
    }

    function applyPanelStyle(panel, saved) {
        if (!panel || !panel.style || !saved) return;
        for (var key in saved) {
            if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
            try {
                panel.style[key] = saved[key];
            } catch (e) {}
        }
    }

    function captureSavedStyles(minimapPanels, minimapPersp, rotateTarget) {
        var saved = { panels: [], persp: null, rotateTarget: null };
        for (var i = 0; i < minimapPanels.length; i++) {
            var panel = minimapPanels[i];
            saved.panels.push({
                panel: panel,
                style: capturePanelStyle(panel, STYLE_KEYS)
            });
        }
        if (isPanelValid(minimapPersp)) {
            saved.persp = {
                panel: minimapPersp,
                style: capturePanelStyle(minimapPersp, STYLE_KEYS)
            };
        }
        if (isPanelValid(rotateTarget)) {
            saved.rotateTarget = {
                panel: rotateTarget,
                style: capturePanelStyle(rotateTarget, STYLE_KEYS)
            };
        }
        state.savedStyles = saved;
    }

    function restoreSavedStyles() {
        if (!state.savedStyles) return;
        var saved = state.savedStyles;
        for (var i = 0; i < saved.panels.length; i++) {
            var entry = saved.panels[i];
            if (isPanelValid(entry.panel)) {
                applyPanelStyle(entry.panel, entry.style);
            }
        }
        if (saved.persp && isPanelValid(saved.persp.panel)) {
            applyPanelStyle(saved.persp.panel, saved.persp.style);
        }
        if (saved.rotateTarget && isPanelValid(saved.rotateTarget.panel)) {
            applyPanelStyle(saved.rotateTarget.panel, saved.rotateTarget.style);
        }
        state.savedStyles = null;
    }

    function setPanelOpacity(panel, opacity) {
        if (!panel || !panel.style) return;
        var op = clamp(opacity, 0, 1);
        panel.style.opacity = op.toFixed(3);
    }

    function updateMinimapCastRangeScale(root, activeTargetSize) {
        var scale = Number(activeTargetSize) / MINIMAP_CAST_RANGE_BASE_SIZE;
        if (!Number.isFinite(scale) || scale <= 0) scale = 1.0;
        if (scale < 0.25) scale = 0.25;
        if (scale > 2.0) scale = 2.0;
        var scaleText = scale.toFixed(3) + ", " + scale.toFixed(3);

        var hudMinimapPanel = root && root.FindChildTraverse ? root.FindChildTraverse(PANEL_ID_MINIMAP) : null;
        var rangePanels = [];
        if (hudMinimapPanel && hudMinimapPanel.FindChildrenWithClassTraverse) {
            var mapButtons = hudMinimapPanel.FindChildrenWithClassTraverse("map_button") || [];
            for (var i = 0; i < mapButtons.length; i++) {
                var castRange = mapButtons[i] && mapButtons[i].FindChildTraverse
                    ? mapButtons[i].FindChildTraverse("CastRange")
                    : null;
                if (castRange) rangePanels.push(castRange);
            }
        }
        for (var j = 0; j < rangePanels.length; j++) {
            var panel = rangePanels[j];
            if (!panel || !panel.style) continue;
            panel.style.preTransformScale2d = scaleText;
        }
    }

    function applyFx(root, cfg, dtSec) {
        var minimapPanels = ensureMinimapPanelCache(root);
        if (!minimapPanels || minimapPanels.length <= 0) return false;

        var minimapPersp = root.FindChildTraverse ? root.FindChildTraverse("minimap_persp") : null;
        var rotateTarget = findMinimapRotateTarget(root);
        if (!state.savedStyles) {
            captureSavedStyles(minimapPanels, minimapPersp, rotateTarget);
        }

        var targetSize = Math.round(clamp(cfg.size, 50, 1400));
        var sizeText = targetSize + "px";
        var opacity = clamp(cfg.opacity, 0, 1);
        state.spinAngle = (state.spinAngle + cfg.spinDegPerSec * dtSec) % 360;
        var rotateText = state.spinAngle.toFixed(2) + "deg";

        updateMinimapCastRangeScale(root, targetSize);
        updateZoomDrawOverUi(root, minimapPersp);

        for (var i = 0; i < minimapPanels.length; i++) {
            var panel = minimapPanels[i];
            if (!panel || !panel.style) continue;
            panel.style.width = sizeText;
            panel.style.height = sizeText;
            if (panel.id === "minimap_persp") {
                panel.style.preTransformScale2d = "1.00, 1.00";
                panel.style.transformOrigin = "50% 50%";
                panel.style.align = "center center";
                panel.style.margin = "0px 0px 0px 0px";
                panel.style.transform = "none";
            }
            if (panel.id !== PANEL_ID_MINIMAP) {
                setPanelOpacity(panel, opacity);
            }
        }

        if (isPanelValid(rotateTarget) && rotateTarget.style) {
            rotateTarget.style.preTransformRotate2d = rotateText;
        }

        return true;
    }

    function revertFx(root) {
        var minimapPersp = root && root.FindChildTraverse ? root.FindChildTraverse("minimap_persp") : null;
        restoreDrawOverUi(minimapPersp);
        restoreSavedStyles();
        state.spinAngle = 0;
        state.lastTickMs = 0;
        state.fxWasActive = false;
        state.cachedPanels.minimap = null;
        state.cachedPanels.minimapRotateTarget = null;
    }

    function tick(gen) {
        if (gen !== state.gen) return;

        var root = findRootPanel();
        if (!isPanelValid(root)) {
            $.Schedule(TICK_SEC, function () { tick(gen); });
            return;
        }

        logConvarProbe(false);

        var cfg = readFxConfig();
        var nowMs = perfNowMs();
        var dtSec = state.lastTickMs > 0 ? Math.max(0, (nowMs - state.lastTickMs) / 1000) : TICK_SEC;
        state.lastTickMs = nowMs;

        if (cfg.active) {
            if (!state.fxWasActive) {
                $.Msg("[twitch_minimap_fx] effect active size=" + cfg.size + " spin=" + cfg.spinDegPerSec + "\n");
            }
            state.fxWasActive = true;
            applyFx(root, cfg, dtSec);
        } else if (state.fxWasActive || state.savedStyles) {
            $.Msg("[twitch_minimap_fx] effect reverted\n");
            revertFx(root);
        }

        $.Schedule(TICK_SEC, function () { tick(gen); });
    }

    function boot() {
        var ctx = $.GetContextPanel();
        if (!ctx || !isPanelValid(ctx)) {
            $.Schedule(0.5, boot);
            return;
        }
        state.gen++;
        state.lastTickMs = 0;
        dispatchConvarBootstrap();
        $.Msg("[twitch_minimap_fx] loaded (bridge convars: " + CV_ACTIVE + ", " + CV_SIZE + ", " + CV_SPIN + ", " + CV_OPACITY + ")\n");
        $.Schedule(0.25, function () { logConvarProbe(true); });
        tick(state.gen);
    }

    boot();
})();
