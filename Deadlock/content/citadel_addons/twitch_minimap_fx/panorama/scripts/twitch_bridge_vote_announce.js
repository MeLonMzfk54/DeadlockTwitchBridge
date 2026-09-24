// Vote start/end banner. Loaded from citadel_hud_top_bar.xml.
// One SetImage of slot=banner on #BridgeVoteNetHost. No convars, no HudCore, no reparent.
(function () {
    "use strict";

    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.__twitch_bridge_vote_announce_booted) return;
            globalThis.__twitch_bridge_vote_announce_booted = true;
        }
    } catch (eBoot) {}

    var HOLD_SEC = 6;
    var POLL_SEC = 1.0;
    var HOST_RETRY_SEC = 0.5;
    var PNG_STEP = 9;
    var PNG_BASE = 15;
    var PROBE_W = 600;
    var PROBE_H = 1000;
    var CMD_SEQ_MAX = 200;
    var BANNER_H_MAX = 200;
    var IMG_DIM_POLL = 0.05;
    var IMG_TIMEOUT_MS = 8000;
    var IMG_PROBE_ATTEMPTS = 3;
    var BRIDGE = "http://127.0.0.1:3920";
    /** Test: pin the banner on boot and leave it up. Turn off after the HUD check. */
    var TEST_PIN = false;

    var state = {
        bannerGen: 0,
        lastSeq: 0,
        imgScaleX: 1,
        imgScaleY: 1,
        imgSwap: false,
        imgCalibrated: false,
        imgCalibrating: false,
        imgReq: 0
    };

    function startSubtitle(stage) {
        if (stage === "voting_category") return "Категория";
        if (stage === "voting_tier") return "Тир";
        if (stage === "voting_combined") return "Категория и тир";
        return "";
    }

    function winnerFromSnap(snap) {
        var names = { weapon: "Weapon", vitality: "Vitality", spirit: "Spirit" };
        var cat = snap && snap.winnerCategory ? names[snap.winnerCategory] || "" : "";
        var tier = snap && snap.winnerTier != null ? Number(snap.winnerTier) : 0;
        if (!Number.isFinite(tier)) tier = 0;
        if (cat && tier >= 1 && tier <= 4) return cat + " T" + tier;
        if (cat) return cat;
        if (tier >= 1 && tier <= 4) return "T" + tier;
        return "";
    }

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

    function findHost() {
        return findNamed("BridgeVoteAnnounceHost");
    }

    function findNetHost() {
        return findNamed("BridgeVoteNetHost");
    }

    function panelSize(panel) {
        var w = 0;
        var h = 0;
        if (!valid(panel)) return { w: 0, h: 0 };
        try { w = Number(panel.actuallayoutwidth) || 0; } catch (eW) {}
        try { h = Number(panel.actuallayoutheight) || 0; } catch (eH) {}
        return { w: w, h: h };
    }

    function setBannerHidden(host, hidden) {
        if (!valid(host)) return;
        try {
            if (hidden) {
                if (typeof host.AddClass === "function") host.AddClass("Hidden");
                host.style.opacity = "0";
                host.style.visibility = "collapse";
            } else {
                if (typeof host.RemoveClass === "function") host.RemoveClass("Hidden");
                host.style.opacity = "1";
                host.style.visibility = "visible";
            }
        } catch (eHide) {}
    }

    function showBanner(title, description) {
        var host = findHost();
        if (!valid(host)) {
            try { $.Msg("[twitch_bridge] vote announce missing host"); } catch (eMiss) {}
            return false;
        }
        try {
            var titleLabel = host.FindChildTraverse("BridgeVoteTitle");
            var descLabel = host.FindChildTraverse("BridgeVoteDesc");
            if (titleLabel) titleLabel.text = title;
            if (descLabel) descLabel.text = description || "";
        } catch (eText) {}
        setBannerHidden(host, false);
        try {
            $.Msg("[twitch_bridge] vote announce: " + title + (description ? " / " + description : ""));
        } catch (eMsg) {}
        state.bannerGen += 1;
        var gen = state.bannerGen;
        if (TEST_PIN) return true;
        $.Schedule(HOLD_SEC, function () {
            if (gen !== state.bannerGen) return;
            setBannerHidden(host, true);
            try { $.Msg("[twitch_bridge] vote announce hidden"); } catch (eGone) {}
        });
        return true;
    }

    function paintPngDebug(text) {
        try { $.Msg("[twitch_bridge] " + (text || "")); } catch (eText) {}
    }

    function winnerFromCode(code) {
        var n = Number(code) || 0;
        if (n < 11) return "";
        var cat = Math.floor(n / 10);
        var tier = n % 10;
        var cats = ["", "weapon", "vitality", "spirit"];
        return winnerFromSnap({
            winnerCategory: cats[cat] || "",
            winnerTier: tier
        });
    }

    function stageForBannerKind(kind) {
        if (kind === 1) return "voting_category";
        if (kind === 2) return "voting_tier";
        if (kind === 3) return "voting_combined";
        return "";
    }

    function setLastVoteStage(stage) {
        if (!stage) return;
        try {
            if (typeof globalThis !== "undefined") {
                globalThis.__twitch_bridge_last_vote_stage = stage;
            }
        } catch (eSt) {}
    }

    function panelHasClass(panel, className) {
        if (!valid(panel) || !className) return false;
        try {
            if (typeof panel.BHasClass === "function" && panel.BHasClass(className)) return true;
        } catch (eHas) {}
        return false;
    }

    /** Shop panel from the top bar. Same climb as findHeroShopPanel in events. */
    function findHeroShop() {
        var climb = contextPanel();
        var hops = 0;
        while (valid(climb) && hops < 12) {
            try {
                var parent = typeof climb.GetParent === "function" ? climb.GetParent() : null;
                if (!valid(parent)) break;
                climb = parent;
            } catch (eClimb) {
                break;
            }
            hops += 1;
        }
        var root = valid(climb) ? climb : contextPanel();
        if (!valid(root)) return null;
        try {
            if (typeof root.FindChildTraverse === "function") {
                var byId = root.FindChildTraverse("CitadelHudHeroShop");
                if (valid(byId)) return byId;
            }
        } catch (eId) {}
        var queue = [{ panel: root, depth: 0 }];
        var seen = 0;
        while (queue.length && seen < 400) {
            var item = queue.shift();
            seen += 1;
            var panel = item.panel;
            var depth = item.depth;
            if (!valid(panel)) continue;
            try {
                if (panel.paneltype === "CitadelHudHeroShop") return panel;
            } catch (eType) {}
            if (panelHasClass(panel, "CitadelHudHeroShop")) return panel;
            if (depth >= 16) continue;
            try {
                var n = typeof panel.GetChildCount === "function" ? panel.GetChildCount() : 0;
                for (var i = 0; i < n; i++) {
                    var child = panel.GetChild(i);
                    if (valid(child)) queue.push({ panel: child, depth: depth + 1 });
                }
            } catch (eChild) {}
        }
        return null;
    }

    /**
     * Vote start is known here while the shop is still closed.
     * Arm gShowingRandom now so opening the shop lands on Random.
     * One retry if the shop script has not attached ActivateRandomTab yet.
     */
    function armRandomTab(attempt) {
        var shop = findHeroShop();
        if (valid(shop) && typeof shop.ActivateRandomTab === "function") {
            try {
                shop.ActivateRandomTab();
                $.Msg("[twitch_bridge] random tab armed before shop open");
            } catch (eAct) {}
            return;
        }
        if ((attempt || 0) < 1) {
            $.Schedule(0.5, function () { armRandomTab(1); });
        }
    }

    function onBannerCmd(kind, win) {
        var stage = stageForBannerKind(kind);
        if (stage) {
            setLastVoteStage(stage);
            armRandomTab(0);
        }
        if (kind === 1) showBanner("Голосование началось", startSubtitle("voting_category"));
        else if (kind === 2) showBanner("Голосование началось", startSubtitle("voting_tier"));
        else if (kind === 3) showBanner("Голосование началось", startSubtitle("voting_combined"));
        else if (kind === 4) showBanner("Голосование закончилось", winnerFromCode(win));
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

    function decodeBanner(rawW, rawH) {
        var w = Number(rawW);
        var h = Number(rawH);
        if (state.imgSwap) {
            var t = w;
            w = h;
            h = t;
        }
        return {
            w: decodeLevel(w, state.imgScaleX, CMD_SEQ_MAX),
            h: decodeLevel(h, state.imgScaleY, BANNER_H_MAX)
        };
    }

    function cacheUrl(path) {
        state.imgReq += 1;
        return BRIDGE + path + (path.indexOf("?") === -1 ? "?" : "&") +
            "rnd=" + Math.random() + "x" + state.imgReq;
    }

    function schedulePoll(sec) {
        $.Schedule(sec, pollBanner);
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
            img = $.CreatePanel("Image", host, "bridge_banner_img_" + state.imgReq);
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

    function paintLoadFail(why) {
        var hs = panelSize(findNetHost());
        if (why === "host0" || hs.w <= 0 || hs.h <= 0) {
            paintPngDebug("banner host 0x0");
            return;
        }
        paintPngDebug("banner timeout");
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

    function applyBannerFrame(rawW, rawH) {
        var decoded = decodeBanner(rawW, rawH);
        var kind = Math.floor((Number(decoded.h) || 0) / 40);
        var win = (Number(decoded.h) || 0) % 40;
        var hs = panelSize(findNetHost());
        paintPngDebug(
            "banner " + rawW + "x" + rawH +
            " seq=" + decoded.w +
            " kind=" + kind +
            " win=" + win +
            " host " + hs.w + "x" + hs.h
        );
        if (decoded.w > 0 && decoded.w !== state.lastSeq && kind >= 1 && kind <= 4) {
            state.lastSeq = decoded.w;
            onBannerCmd(kind, win);
        }
    }

    function pollBanner() {
        var host = findNetHost();
        var hs = panelSize(host);
        if (!valid(host) || hs.w <= 0 || hs.h <= 0) {
            paintPngDebug("banner host 0x0");
            schedulePoll(HOST_RETRY_SEC);
            return;
        }
        if (!state.imgCalibrated) {
            calibrateImg(
                function () { schedulePoll(0.05); },
                function () {
                    paintLoadFail("timeout");
                    schedulePoll(POLL_SEC);
                }
            );
            return;
        }
        rawImgRequest(
            cacheUrl("/api/shop-vote-hud.png?slot=banner"),
            function (w, h) {
                applyBannerFrame(w, h);
                schedulePoll(POLL_SEC);
            },
            function (why) {
                paintLoadFail(why);
                schedulePoll(POLL_SEC);
            }
        );
    }

    function boot() {
        var ctx = contextPanel();
        if (!valid(ctx)) {
            $.Schedule(0.5, boot);
            return;
        }
        var host = findHost();
        if (valid(host)) setBannerHidden(host, true);
        paintPngDebug("banner png: waiting");
        if (TEST_PIN) showBanner("Голосование началось", "тест баннера");
        schedulePoll(0.4);
    }

    boot();
})();
