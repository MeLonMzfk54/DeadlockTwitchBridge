// Hide Panorama HUD panels while /api/hud-hide.png seq > 0.
// One SetImage on #BridgeHudHideNetHost. Width is seq; height is unused.
// Opacity only — no visibility/overflow/reparent (phase detector uses those).
// EscapeMenu, popups, and tooltips stay so the player can open the menu.
(function () {
    "use strict";

    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.__twitch_bridge_hud_hide_booted) return;
            globalThis.__twitch_bridge_hud_hide_booted = true;
        }
    } catch (eBoot) {}

    var POLL_SEC = 0.5;
    var HOST_RETRY_SEC = 0.5;
    var STYLE_SEC = 0.1;
    var PNG_STEP = 9;
    var PNG_BASE = 15;
    var PROBE_W = 600;
    var PROBE_H = 1000;
    var LEVEL_MAX = 100;
    var IMG_DIM_POLL = 0.05;
    var IMG_TIMEOUT_MS = 8000;
    var IMG_PROBE_ATTEMPTS = 3;
    var BRIDGE = "http://127.0.0.1:3920";

    var NET_HOST_IDS = {
        BridgeVoteNetHost: true,
        BridgeCrosshairNetHost: true,
        BridgeHudHideNetHost: true
    };

    var KEEP_IDS = {
        EscapeMenu: true,
        PopupManager: true,
        ContextMenuManager: true,
        TooltipManager: true,
        TopBar: true
    };

    var state = {
        seq: 0,
        paintedOn: false,
        painted: [],
        imgScaleX: 1,
        imgScaleY: 1,
        imgSwap: false,
        imgCalibrated: false,
        imgCalibrating: false,
        imgReq: 0
    };

    function valid(panel) {
        if (!panel) return false;
        try {
            if (typeof panel.IsValid === "function" && !panel.IsValid()) return false;
        } catch (e) {
            return false;
        }
        return true;
    }

    function contextPanel() {
        return (typeof $ !== "undefined" && typeof $.GetContextPanel === "function")
            ? $.GetContextPanel()
            : null;
    }

    function findNamed(id) {
        var ctx = contextPanel();
        if (!valid(ctx) || typeof ctx.FindChildTraverse !== "function") return null;
        try {
            var host = ctx.FindChildTraverse(id);
            if (valid(host)) return host;
        } catch (eFind) {}
        return null;
    }

    function findNetHost() {
        return findNamed("BridgeHudHideNetHost");
    }

    function findHudRoot() {
        var panel = contextPanel();
        var hops = 0;
        while (valid(panel) && hops < 12) {
            var parent = null;
            try {
                parent = typeof panel.GetParent === "function" ? panel.GetParent() : null;
            } catch (eParent) {
                parent = null;
            }
            if (!valid(parent)) break;
            panel = parent;
            hops += 1;
        }
        return panel;
    }

    function findHudCore() {
        var panel = contextPanel();
        var hops = 0;
        while (valid(panel) && hops < 16) {
            try {
                if (typeof panel.BHasClass === "function" && panel.BHasClass("HudCore")) return panel;
            } catch (eClass) {}
            var parent = null;
            try {
                parent = typeof panel.GetParent === "function" ? panel.GetParent() : null;
            } catch (eParent) {
                parent = null;
            }
            if (!valid(parent)) break;
            panel = parent;
            hops += 1;
        }
        var root = findHudRoot();
        if (!valid(root) || typeof root.FindChildrenWithClassTraverse !== "function") return null;
        try {
            var found = root.FindChildrenWithClassTraverse("HudCore");
            if (found && found.length) return found[0];
        } catch (eFind) {}
        return null;
    }

    function panelId(panel) {
        try {
            return String(panel.id || "");
        } catch (eId) {
            return "";
        }
    }

    function panelSize(panel) {
        var w = 0;
        var h = 0;
        if (!valid(panel)) return { w: 0, h: 0 };
        try { w = Number(panel.actuallayoutwidth) || 0; } catch (eW) {}
        try { h = Number(panel.actuallayoutheight) || 0; } catch (eH) {}
        return { w: w, h: h };
    }

    function clampLevel(level, max) {
        var n = Number(level);
        if (!Number.isFinite(n) || n < 0) return 0;
        if (n > max) return max;
        return Math.round(n);
    }

    function decodeLevel(dim, scale, max) {
        if (!Number.isFinite(dim) || !Number.isFinite(scale) || scale <= 0) return 0;
        return clampLevel((dim / scale - PNG_BASE) / PNG_STEP, max);
    }

    function setOpacity(panel, value) {
        if (!valid(panel) || !panel.style) return;
        try {
            panel.style.opacity = value;
        } catch (eOp) {}
    }

    function hidePanel(panel) {
        if (!valid(panel)) return;
        setOpacity(panel, "0");
        state.painted.push(panel);
    }

    function shouldKeep(panel) {
        var id = panelId(panel);
        if (KEEP_IDS[id]) return true;
        if (NET_HOST_IDS[id]) return true;
        return false;
    }

    function hideChildren(parent, skipKeep) {
        if (!valid(parent) || typeof parent.GetChildCount !== "function") return;
        var n = 0;
        try { n = parent.GetChildCount(); } catch (eN) { return; }
        for (var i = 0; i < n; i++) {
            var child = null;
            try { child = parent.GetChild(i); } catch (eChild) {}
            if (!valid(child)) continue;
            if (skipKeep && shouldKeep(child)) continue;
            hidePanel(child);
        }
    }

    function restorePainted() {
        for (var i = 0; i < state.painted.length; i++) {
            var panel = state.painted[i];
            if (!valid(panel)) continue;
            setOpacity(panel, null);
        }
        state.painted = [];
        state.paintedOn = false;
    }

    function paintHide() {
        state.painted = [];
        var hudCore = findHudCore();
        if (valid(hudCore)) {
            hideChildren(hudCore, true);
            var parent = null;
            try {
                parent = typeof hudCore.GetParent === "function" ? hudCore.GetParent() : null;
            } catch (eParent) {
                parent = null;
            }
            if (valid(parent) && typeof parent.GetChildCount === "function") {
                var n = 0;
                try { n = parent.GetChildCount(); } catch (eN) { n = 0; }
                for (var i = 0; i < n; i++) {
                    var sibling = null;
                    try { sibling = parent.GetChild(i); } catch (eSib) {}
                    if (!valid(sibling) || sibling === hudCore) continue;
                    if (shouldKeep(sibling)) continue;
                    hidePanel(sibling);
                }
            }
        }
        var topBar = contextPanel();
        if (valid(topBar)) {
            hideChildren(topBar, true);
        }
        state.paintedOn = true;
    }

    function paintStyle() {
        if (state.seq > 0) {
            paintHide();
            return true;
        }
        if (state.paintedOn) restorePainted();
        return false;
    }

    function styleLoop() {
        try {
            paintStyle();
        } catch (eStyle) {}
        $.Schedule(STYLE_SEC, styleLoop);
    }

    function cacheUrl(path) {
        state.imgReq += 1;
        return BRIDGE + path + (path.indexOf("?") === -1 ? "?" : "&") +
            "rnd=" + Math.random() + "x" + state.imgReq;
    }

    function rawImgRequest(url, onDone, onError) {
        var host = findNetHost();
        if (!valid(host) || typeof $.CreatePanel !== "function") {
            try { onError("no_host"); } catch (eNo) {}
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
            try { onDone(w, h); } catch (e3) {}
        }
        function finishErr(why) {
            if (finished) return;
            finished = true;
            cleanup();
            try { onError(why || "fail"); } catch (e4) {}
        }
        try {
            state.imgReq += 1;
            img = $.CreatePanel("Image", host, "bridge_hud_hide_img_" + state.imgReq);
            img.style.position = "0px 0px 0px";
            img.SetImage(url);
        } catch (eCreate) {
            finishErr("exception");
            return;
        }
        try {
            if (typeof img.SetPanelEvent === "function") {
                img.SetPanelEvent("ImageFailedLoad", function () {
                    finishErr("failed");
                });
            }
        } catch (eFailEvt) {}
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
    }

    function calibrateImg(onOk, onFail) {
        if (state.imgCalibrated) {
            try { onOk(); } catch (eOk0) {}
            return;
        }
        if (state.imgCalibrating) return;
        state.imgCalibrating = true;

        function attempt(n) {
            rawImgRequest(
                cacheUrl("/api/shop-probe.png"),
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
                        retryOrFail(n);
                        return;
                    }
                    var ratio = Math.abs(sx - sy) / Math.max(sx, sy);
                    if (ratio > 0.2) {
                        retryOrFail(n);
                        return;
                    }
                    state.imgSwap = sw;
                    state.imgScaleX = sx;
                    state.imgScaleY = sy;
                    state.imgCalibrated = true;
                    state.imgCalibrating = false;
                    try { onOk(); } catch (eOk) {}
                },
                function () {
                    retryOrFail(n);
                }
            );
        }

        function retryOrFail(n) {
            if (n < IMG_PROBE_ATTEMPTS) {
                attempt(n + 1);
                return;
            }
            state.imgCalibrating = false;
            try { onFail(); } catch (eFail) {}
        }

        attempt(1);
    }

    function applyFrame(rawW, rawH) {
        var w = Number(rawW);
        var h = Number(rawH);
        if (state.imgSwap) {
            var tmp = w;
            w = h;
            h = tmp;
        }
        var seq = decodeLevel(w, state.imgScaleX, LEVEL_MAX);
        if (seq === state.seq) return;
        state.seq = seq;
        try {
            $.Msg("[twitch_bridge] hud_hide seq=" + seq);
        } catch (eMsg) {}
    }

    function schedulePoll(sec) {
        $.Schedule(sec, pollHudHide);
    }

    function pollHudHide() {
        var host = findNetHost();
        var hs = panelSize(host);
        if (!valid(host) || hs.w <= 0 || hs.h <= 0) {
            schedulePoll(HOST_RETRY_SEC);
            return;
        }
        if (!state.imgCalibrated) {
            calibrateImg(
                function () { schedulePoll(0.05); },
                function () { schedulePoll(POLL_SEC); }
            );
            return;
        }
        rawImgRequest(
            cacheUrl("/api/hud-hide.png"),
            function (w, h) {
                applyFrame(w, h);
                schedulePoll(POLL_SEC);
            },
            function () {
                schedulePoll(POLL_SEC);
            }
        );
    }

    function boot() {
        if (!valid(contextPanel())) {
            $.Schedule(0.5, boot);
            return;
        }
        styleLoop();
        schedulePoll(0.4);
    }

    boot();
})();
