// Random obstructive reticle. Loaded from citadel_hud_top_bar.xml.
// One SetImage of /api/crosshair-hud.png on #BridgeCrosshairNetHost.
// Width is seq. Height is shape * 20 + color.
// Shape 0 scales GunGrosshair and hides Dot/DotOutline. Other shapes are HUD panels.
// Shop (gShopOpen) and the escape menu hide the effect until they close.
// Hero-specific reticles are other panels and are left alone.
(function () {
    "use strict";

    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.__twitch_bridge_crosshair_booted) return;
            globalThis.__twitch_bridge_crosshair_booted = true;
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
    var SHAPE_COUNT = 3;
    var COLOR_COUNT = 20;
    var SCALE = "scale3d(10, 10, 1)";
    var SCALE_OFF = "scale3d(1, 1, 1)";
    var IMG_DIM_POLL = 0.05;
    var IMG_TIMEOUT_MS = 8000;
    var IMG_PROBE_ATTEMPTS = 3;
    var BRIDGE = "http://127.0.0.1:3920";
    var GROSSHAIR_ID = "GunGrosshair";
    var DOT_IDS = ["Dot", "DotOutline"];

    var state = {
        seq: 0,
        shape: 0,
        colorIndex: 0,
        paintedOn: false,
        drawnShape: -1,
        drawnColor: -1,
        covered: false,
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
        return findNamed("BridgeCrosshairNetHost");
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

    function findInHud(id) {
        var root = findHudRoot();
        if (!valid(root) || typeof root.FindChildTraverse !== "function") return null;
        try {
            var found = root.FindChildTraverse(id);
            if (valid(found)) return found;
        } catch (eFind) {}
        return null;
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

    function colorFromIndex(index) {
        var i = clampLevel(index, COLOR_COUNT - 1);
        var hue = (i / COLOR_COUNT) * 360;
        var hp = hue / 60;
        var x = 1 - Math.abs((hp % 2) - 1);
        var r1 = 0;
        var g1 = 0;
        var b1 = 0;
        if (hp < 1) { r1 = 1; g1 = x; }
        else if (hp < 2) { r1 = x; g1 = 1; }
        else if (hp < 3) { g1 = 1; b1 = x; }
        else if (hp < 4) { g1 = x; b1 = 1; }
        else if (hp < 5) { r1 = x; b1 = 1; }
        else { r1 = 1; b1 = x; }
        function hex(v) {
            var n = Math.round(v * 255);
            if (n < 0) n = 0;
            if (n > 255) n = 255;
            var s = n.toString(16);
            return s.length < 2 ? "0" + s : s;
        }
        return "#" + hex(r1) + hex(g1) + hex(b1);
    }

    function unpackPacked(packed) {
        var n = clampLevel(packed, LEVEL_MAX);
        var maxPacked = SHAPE_COUNT * COLOR_COUNT - 1;
        if (n > maxPacked) n = maxPacked;
        return {
            shape: Math.floor(n / COLOR_COUNT),
            color: n % COLOR_COUNT
        };
    }

    function paintGrosshair(panel, mode, wash) {
        if (!valid(panel) || !panel.style) return;
        try { panel.style.transformOrigin = "50% 50%"; } catch (eOrigin) {}
        try {
            if (mode === "huge") panel.style.transform = SCALE;
            else panel.style.transform = SCALE_OFF;
        } catch (eScale) {}
        try { panel.style.washColor = mode === "huge" ? wash : "none"; } catch (eWash) {}
        try { panel.style.opacity = mode === "hide" ? "0" : "1"; } catch (eOpacity) {}
        try { panel.style.visibility = "visible"; } catch (eVis) {}
    }

    // HUD rewrites Dot every frame; hide it every frame while shape 0 is up.
    function paintDot(panel, mode) {
        if (!valid(panel) || !panel.style) return;
        try { panel.style.transformOrigin = "50% 50%"; } catch (eOrigin) {}
        try { panel.style.transform = SCALE_OFF; } catch (eScale) {}
        try { panel.style.washColor = "none"; } catch (eWash) {}
        if (mode === "huge" || mode === "hide") {
            try { panel.style.opacity = "0"; } catch (eOpacity) {}
            try { panel.style.visibility = "collapse"; } catch (eVis) {}
            return;
        }
        try { panel.style.opacity = "1"; } catch (eOpacity) {}
        try { panel.style.visibility = "visible"; } catch (eVis) {}
    }

    function paintReticle(mode, wash) {
        paintGrosshair(findInHud(GROSSHAIR_ID), mode, wash);
        for (var i = 0; i < DOT_IDS.length; i++) {
            paintDot(findInHud(DOT_IDS[i]), mode);
        }
    }

    function findShapeHost() {
        var root = findHudRoot();
        if (!valid(root) || typeof root.FindChildTraverse !== "function") return null;
        try {
            var found = root.FindChildTraverse("BridgeCrosshairShape");
            if (valid(found)) return found;
        } catch (eFind) {}
        return null;
    }

    function styleHost(host) {
        try { host.hittest = false; } catch (eHit) {}
        try { host.hittestchildren = false; } catch (eHitKids) {}
        if (!host.style) return;
        try { host.style.width = "960px"; } catch (eW) {}
        try { host.style.height = "960px"; } catch (eH) {}
        try { host.style.horizontalAlign = "center"; } catch (eHa) {}
        try { host.style.verticalAlign = "center"; } catch (eVa) {}
        try { host.style.overflow = "noclip"; } catch (eOv) {}
        try { host.style.backgroundColor = "#00000000"; } catch (eBg) {}
        try { host.style.zIndex = "50"; } catch (eZ) {}
        try { host.style.flowChildren = "none"; } catch (eFlow) {}
    }

    function clearHost(host) {
        if (!valid(host)) return;
        try {
            if (typeof host.RemoveAndDeleteChildren === "function") {
                host.RemoveAndDeleteChildren();
                return;
            }
        } catch (eClear) {}
        try {
            var n = typeof host.GetChildCount === "function" ? host.GetChildCount() : 0;
            for (var i = n - 1; i >= 0; i--) {
                var child = host.GetChild(i);
                if (valid(child) && typeof child.DeleteAsync === "function") child.DeleteAsync(0);
            }
        } catch (eKids) {}
    }

    function ensureShapeHost() {
        var existing = findShapeHost();
        if (valid(existing)) return existing;
        var root = findHudRoot();
        if (!valid(root) || typeof $.CreatePanel !== "function") return null;
        var host = null;
        try {
            host = $.CreatePanel("Panel", root, "BridgeCrosshairShape");
        } catch (eCreate) {
            return null;
        }
        if (!valid(host)) return null;
        styleHost(host);
        return host;
    }

    function addPart(host, spec) {
        if (!valid(host) || typeof $.CreatePanel !== "function") return;
        var panel = null;
        try {
            panel = $.CreatePanel("Panel", host, "");
        } catch (eCreate) {
            return;
        }
        if (!valid(panel) || !panel.style) return;
        try { panel.hittest = false; } catch (eHit) {}
        try { panel.hittestchildren = false; } catch (eHitKids) {}
        try { panel.style.width = spec.w; } catch (eW) {}
        try { panel.style.height = spec.h; } catch (eH) {}
        try { panel.style.horizontalAlign = "center"; } catch (eHa) {}
        try { panel.style.verticalAlign = "center"; } catch (eVa) {}
        try { panel.style.transformOrigin = "50% 50%"; } catch (eOrigin) {}
        try { panel.style.backgroundColor = spec.bg || "#00000000"; } catch (eBg) {}
        try { panel.style.borderRadius = spec.radius || "0px"; } catch (eRadius) {}
        try { panel.style.border = spec.border || "0px solid #00000000"; } catch (eBorder) {}
        try { panel.style.overflow = "noclip"; } catch (eOv) {}
        try { panel.style.transform = spec.transform || "none"; } catch (eTransform) {}
    }

    function buildArc(host, wash, arc) {
        var n = arc.segments;
        var span = arc.toRad - arc.fromRad;
        var step = n > 1 ? span / (n - 1) : span;
        var chord = Math.abs(arc.radius * step);
        var len = Math.round(chord * 1.45);
        if (len < arc.thick) len = arc.thick;
        for (var i = 0; i < n; i++) {
            var theta = arc.fromRad + step * i;
            var x = arc.cx + arc.radius * Math.cos(theta);
            var y = arc.cy + arc.radius * Math.sin(theta);
            var deg = Math.atan2(Math.cos(theta), -Math.sin(theta)) * 180 / Math.PI;
            addPart(host, {
                w: len + "px",
                h: arc.thick + "px",
                bg: wash,
                radius: "50%",
                transform: "translateX(" + Math.round(x) + "px) translateY(" + Math.round(y) + "px) rotateZ(" + deg.toFixed(1) + "deg)"
            });
        }
    }

    function buildStickman(host, wash) {
        var thick = 40;
        var headW = 118;
        var headH = 142;
        var headY = -220;
        var bodyTop = -175;
        var peakY = 36;
        var bodyH = peakY - bodyTop;
        var bodyY = bodyTop + bodyH / 2;
        var armY = -95;
        var armHalf = 145;
        var cornerR = 78;
        var forearm = 96;

        buildArc(host, wash, {
            cx: 0,
            cy: peakY + 210,
            radius: 210,
            fromRad: Math.PI,
            toRad: Math.PI * 2,
            segments: 9,
            thick: thick
        });
        addPart(host, {
            w: (armHalf * 2) + "px",
            h: thick + "px",
            bg: wash,
            radius: "50%",
            transform: "translateY(" + armY + "px)"
        });
        buildArc(host, wash, {
            cx: -armHalf,
            cy: armY - cornerR,
            radius: cornerR,
            fromRad: Math.PI / 2,
            toRad: Math.PI,
            segments: 4,
            thick: thick
        });
        buildArc(host, wash, {
            cx: armHalf,
            cy: armY - cornerR,
            radius: cornerR,
            fromRad: 0,
            toRad: Math.PI / 2,
            segments: 4,
            thick: thick
        });
        addPart(host, {
            w: thick + "px",
            h: forearm + "px",
            bg: wash,
            radius: "50%",
            transform: "translateX(" + Math.round(-(armHalf + cornerR)) + "px) translateY(" + Math.round(armY - cornerR - forearm / 2) + "px)"
        });
        addPart(host, {
            w: thick + "px",
            h: forearm + "px",
            bg: wash,
            radius: "50%",
            transform: "translateX(" + Math.round(armHalf + cornerR) + "px) translateY(" + Math.round(armY - cornerR - forearm / 2) + "px)"
        });
        addPart(host, {
            w: headW + "px",
            h: headH + "px",
            bg: "#00000000",
            radius: "50%",
            border: "34px solid " + wash,
            transform: "translateY(" + headY + "px)"
        });
        addPart(host, {
            w: thick + "px",
            h: Math.round(bodyH) + "px",
            bg: wash,
            radius: "50%",
            transform: "translateY(" + Math.round(bodyY) + "px)"
        });
    }

    function buildX(host, wash) {
        addPart(host, {
            w: "900px",
            h: "56px",
            bg: wash,
            transform: "rotateZ(45deg)"
        });
        addPart(host, {
            w: "900px",
            h: "56px",
            bg: wash,
            transform: "rotateZ(-45deg)"
        });
    }

    function removeShape() {
        state.drawnShape = -1;
        state.drawnColor = -1;
        var host = findShapeHost();
        if (!valid(host)) return;
        try {
            if (typeof host.DeleteAsync === "function") host.DeleteAsync(0);
        } catch (eDel) {}
    }

    function syncShape(wash) {
        if (state.drawnShape === state.shape && state.drawnColor === state.colorIndex && valid(findShapeHost())) {
            return;
        }
        var host = ensureShapeHost();
        if (!valid(host)) return;
        styleHost(host);
        clearHost(host);
        if (state.shape === 1) buildStickman(host, wash);
        else buildX(host, wash);
        state.drawnShape = state.shape;
        state.drawnColor = state.colorIndex;
    }

    function hasClass(panel, className) {
        if (!valid(panel) || typeof panel.BHasClass !== "function") return false;
        try {
            return !!panel.BHasClass(className);
        } catch (eClass) {}
        return false;
    }

    function ancestorHasClass(panel, className) {
        var hops = 0;
        while (valid(panel) && hops < 8) {
            if (hasClass(panel, className)) return true;
            try {
                panel = typeof panel.GetParent === "function" ? panel.GetParent() : null;
            } catch (eParent) {
                break;
            }
            hops += 1;
        }
        return false;
    }

    function uiCoversCrosshair() {
        var shop = findInHud("CitadelHudHeroShop");
        if (hasClass(shop, "gShopOpen")) return true;
        // EscapeMenu is always full-screen once laid out. Open state is the class.
        if (ancestorHasClass(findInHud("EscapeMenu"), "ShowEscapeMenu")) return true;
        return false;
    }

    function paintStyle() {
        var covered = uiCoversCrosshair();
        if (covered !== state.covered) {
            state.covered = covered;
            try {
                $.Msg("[twitch_bridge] crosshair cover=" + (covered ? "shop_or_menu" : "play"));
            } catch (eCover) {}
        }
        var on = state.seq > 0 && !covered;
        if (!on && !state.paintedOn && state.drawnShape < 0) return false;
        var wash = colorFromIndex(state.colorIndex);
        var mode = "clear";
        if (on) mode = state.shape === 0 ? "huge" : "hide";
        paintReticle(mode, wash);
        if (on && state.shape > 0) syncShape(wash);
        else removeShape();
        state.paintedOn = on;
        return on && mode === "huge";
    }

    function styleLoop() {
        var needFrame = false;
        try {
            needFrame = !!paintStyle();
        } catch (eStyle) {}
        $.Schedule(needFrame ? 0.0 : STYLE_SEC, styleLoop);
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
            img = $.CreatePanel("Image", host, "bridge_crosshair_img_" + state.imgReq);
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
        var unpacked = unpackPacked(decodeLevel(h, state.imgScaleY, LEVEL_MAX));
        if (seq === state.seq && unpacked.shape === state.shape && unpacked.color === state.colorIndex) return;
        state.seq = seq;
        state.shape = seq > 0 ? unpacked.shape : 0;
        state.colorIndex = seq > 0 ? unpacked.color : 0;
        try {
            $.Msg("[twitch_bridge] crosshair seq=" + seq + " shape=" + state.shape + " color=" + state.colorIndex);
        } catch (eMsg) {}
    }

    function schedulePoll(sec) {
        $.Schedule(sec, pollCrosshair);
    }

    function pollCrosshair() {
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
            cacheUrl("/api/crosshair-hud.png"),
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
