// Vote start/end banner. Loaded from citadel_hud_top_bar.xml.
// Trigger is the shop PNG `banner` slot, written onto HudCore. No SetImage here.
(function () {
    "use strict";

    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.__twitch_bridge_vote_announce_booted) return;
            globalThis.__twitch_bridge_vote_announce_booted = true;
        }
    } catch (eBoot) {}

    var HOLD_SEC = 6;
    var POLL_SEC = 0.3;
    /** Test: pin the banner on boot and leave it up. Turn off after the HUD check. */
    var TEST_PIN = false;

    var state = {
        bannerGen: 0,
        lastSeq: 0
    };

    function startSubtitle(stage) {
        if (stage === "voting_category") return "Категория";
        if (stage === "voting_tier") return "Тир";с 
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

    function findHost() {
        var ctx = contextPanel();
        var roots = [ctx];
        try {
            if (valid(ctx) && typeof ctx.GetParent === "function") roots.push(ctx.GetParent());
        } catch (eParent) {}
        for (var i = 0; i < roots.length; i++) {
            var root = roots[i];
            if (!valid(root) || typeof root.FindChildTraverse !== "function") continue;
            try {
                var host = root.FindChildTraverse("BridgeVoteAnnounceHost");
                if (valid(host)) return host;
            } catch (eFind) {}
        }
        return null;
    }

    function placeOnHud(host) {
        var ctx = contextPanel();
        var hud = null;
        try {
            hud = valid(ctx) && typeof ctx.GetParent === "function" ? ctx.GetParent() : null;
        } catch (eHud) {}
        if (!valid(hud)) return;
        try {
            if (typeof host.GetParent === "function" && host.GetParent() !== hud && typeof host.SetParent === "function") {
                host.SetParent(hud);
            }
        } catch (eMove) {}
        try { hud.style.overflow = "noclip"; } catch (eOv) {}
        try {
            host.style.width = "fit-children";
            host.style.height = "fit-children";
            host.style.horizontalAlign = "center";
            host.style.verticalAlign = "top";
            host.style.marginTop = "48px";
            host.style.zIndex = "1000";
            host.style.overflow = "noclip";
            host.style.backgroundColor = "#102018f2";
        } catch (eStyle) {}
    }

    function logLayout(host, why) {
        $.Schedule(0.2, function () {
            if (!valid(host)) return;
            var w = 0;
            var h = 0;
            var parentId = "";
            try { w = Number(host.actuallayoutwidth) || 0; } catch (eW) {}
            try { h = Number(host.actuallayoutheight) || 0; } catch (eH) {}
            try {
                var parent = host.GetParent();
                parentId = parent && parent.id ? String(parent.id) : "";
            } catch (eP) {}
            try {
                $.Msg("[twitch_bridge] vote announce layout " + why + " " + w + "x" + h + " parent=" + parentId);
            } catch (eMsg) {}
            if (w > 0 && h > 0) return;
            var hud = null;
            try {
                var ctx = contextPanel();
                var top = valid(ctx) && typeof ctx.GetParent === "function" ? ctx.GetParent() : null;
                if (valid(top) && typeof top.FindChildTraverse === "function") {
                    hud = top.FindChildTraverse("gameplay_hud");
                }
            } catch (eHud) {}
            if (!valid(hud) || typeof host.SetParent !== "function") return;
            try { host.SetParent(hud); } catch (eMove) {}
            try { hud.style.overflow = "noclip"; } catch (eOv) {}
            try {
                $.Msg("[twitch_bridge] vote announce moved to gameplay_hud");
            } catch (eMoveMsg) {}
        });
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
        placeOnHud(host);
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
        logLayout(host, "show");
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

    function findHudCore() {
        var panel = contextPanel();
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
        if (!valid(root) || typeof root.FindChildrenWithClassTraverse !== "function") return null;
        try {
            var found = root.FindChildrenWithClassTraverse("HudCore");
            if (found && found.length) return found[0];
        } catch (eFind) {}
        return null;
    }

    function readBanner() {
        var hud = findHudCore();
        if (!valid(hud) || typeof hud.GetAttributeInt !== "function") return null;
        var seq = 0;
        try { seq = hud.GetAttributeInt("bridge_banner_gen", 0) || 0; } catch (eSeq) { return null; }
        if (!seq) return null;
        var kind = 0;
        var win = 0;
        try { kind = Number(hud.GetAttributeString("bridge_banner_kind", "0")) || 0; } catch (eKind) {}
        try { win = Number(hud.GetAttributeString("bridge_banner_win", "0")) || 0; } catch (eWin) {}
        return { seq: seq, kind: kind, win: win };
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

    function onBannerCmd(kind, win) {
        if (kind === 1) showBanner("Голосование началось", startSubtitle("voting_category"));
        else if (kind === 2) showBanner("Голосование началось", startSubtitle("voting_tier"));
        else if (kind === 3) showBanner("Голосование началось", startSubtitle("voting_combined"));
        else if (kind === 4) showBanner("Голосование закончилось", winnerFromCode(win));
    }

    function pollBanner() {
        var cmd = readBanner();
        if (cmd && cmd.seq && cmd.seq !== state.lastSeq) {
            state.lastSeq = cmd.seq;
            onBannerCmd(cmd.kind, cmd.win);
        }
        $.Schedule(POLL_SEC, pollBanner);
    }

    function boot() {
        var ctx = (typeof $ !== "undefined" && typeof $.GetContextPanel === "function")
            ? $.GetContextPanel()
            : null;
        if (!valid(ctx)) {
            $.Schedule(0.5, boot);
            return;
        }
        var host = findHost();
        if (valid(host)) setBannerHidden(host, true);
        if (TEST_PIN) {
            if (!showBanner("Голосование началось", "тест баннера")) $.Schedule(0.5, boot);
            return;
        }
        var cmd = readBanner();
        state.lastSeq = cmd && cmd.seq ? cmd.seq : 0;
        $.Schedule(0.4, pollBanner);
    }

    boot();
})();
