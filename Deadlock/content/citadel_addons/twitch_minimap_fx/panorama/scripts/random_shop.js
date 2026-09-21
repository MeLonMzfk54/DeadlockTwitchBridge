(function () {
    'use strict';

    var _Async = (typeof Async !== 'undefined') ? Async : null;
    if (!_Async) {
        _Async = {};
        _Async.Delay = function (d) { return new Promise(function (r) { $.Schedule(d, r); }); };
        _Async.NextFrame = function () { return _Async.Delay(0); };
        _Async.Condition = function (pred) {
            return new Promise(async function (resolve) {
                while (true) {
                    if (pred()) { resolve(); return; }
                    await _Async.NextFrame();
                }
            });
        };
    }

    var ALL_MOD_CLASSES = [
        'closeRange', 'clipSize', 'item_passive', 'headshotBooster', 'berserker',
        'highVelocityMag', 'rapidRounds', 'medicBullets', 'activeReload', 'fleetfootBoots',
        'intensifyingClip', 'kineticSash', 'longRange', 'meleeCharge', 'explosiveBullets',
        'pristineEmblem', 'absorbingArmor', 'slowingBullets', 'techResistShredder',
        'titanicMagazine', 'fireRatePlus', 'armorBreakingBullets', 'bansheeSlugs', 'fervor',
        'glassCannon', 'critshot', 'ricochet', 'empBullets', 'magicOverflow', 'headhunter',
        'bulletDamageAura', 'hollowPoint', 'bulletArmorReductionAura', 'pointBlank',
        'cloakingDevice', 'longshot', 'spellslingerHeadshots', 'electrifiedBullets',
        'toxicBullets', 'techGrenade', 'item_gadget', 'fireRatePlusPlus', 'item_gadget_enemy',
        'reinforcingCasings',
        'upgrade_health', 'healthStealingBullets', 'endurance', 'improvedStamina',
        'bulletShield', 'stimPak', 'lifestrikeGauntlets', 'parryRebuttal', 'sprintBooster',
        'debuffReducer', 'techArmorPulse', 'cardioCalibrator',
        'savior', 'healbane', 'healingBooster', 'vexBarrier', 'restorativeLocket', 'lastStand',
        'healthStealingTech', 'improvedBulletArmor', 'debuffRemover', 'revitalizer',
        'surgingPower', 'healthNova', 'boxingGlove', 'rocketBooster', 'metalSkin', 'medicBeam',
        'techPurge', 'superiorStamina', 'veilWalker', 'warpStone', 'tormentAura', 'colossus',
        'healBuff', 'infuser', 'inhibitor', 'juggernaut', 'leech', 'phantomStrike',
        'siphon_bullets', 'unstoppable',
        'extraCharge', 'goldenEgg', 'techPower', 'magicBurst', 'techRange', 'slowingTech', 'acolytesGlove',
        'arcaneSurge', 'bulletResistShredder', 'iceBlast', 'advancedRecharge', 'durationExtender',
        'soaringSpirit', 'techVulnerability', 'immobilize', 'focusedSilence', 'weaponJammer',
        'rupture', 'disarm', 'spiritualDominion', 'knockdown', 'megaSpirit', 'rapidRecharge',
        'targetedSilence', 'spiritSnatch', 'spiritualFlow', 'superiorDuration', 'magicStorm',
        'magicShock', 'glitch', 'powerShard', 'escalatingExposure', 'shiftingShroud',
        'ultimateBurst', 'magicCarpet', 'magicReverb', 'abilityRefresher', 'areaImmobilize'
    ];

    var ALL_SHOWING = ['showingWeapon', 'showingArmor', 'showingTech', 'showingFavorites', 'showingSearch'];
    var LIST_IDS    = ['ShopModsListWeapon', 'ShopModsListArmor', 'ShopModsListTech'];
    var TIER_COSTS  = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };

    // Suppresses the native-tab watcher while loadAllItemsThenRoll dispatches
    // CitadelShopModsActivate to populate item lists.
    var _suppressDeactivation = false;

    // Snapshot of showingX classes that were present when Random tab was activated.
    // The watcher only deactivates if a NEW showingX class appears (not one from this list).
    var _activatedWithShowing = [];

    var state = { mode: 'idle', itemClass: '', itemTier: 0, itemListId: '', itemType: 0 };

    // One-shot purchase state machine (avoids buy/sell toggle loops).
    // pending → attempting → confirmed | waiting_shop | failed
    var purchase = {
        phase: 'idle',
        path: null,
        gen: 0,
        backgroundAttempts: 0,
        uiFallbackDone: false,
        soulsBefore: -1,
        lastWaitingReason: ''
    };

    var _enabledLists = { 'ShopModsListWeapon': true, 'ShopModsListArmor': true, 'ShopModsListTech': true };
    var LIST_FILTER_IDS   = { 'ShopModsListWeapon': 'RSFilterWeapon', 'ShopModsListArmor': 'RSFilterArmor', 'ShopModsListTech': 'RSFilterTech' };
    var CATEGORY_NAMES    = { 'ShopModsListWeapon': 'Weapon', 'ShopModsListArmor': 'Vitality', 'ShopModsListTech': 'Spirit' };
    var _rollGen = 0;

    var MAX_BACKGROUND_ATTEMPTS = 1;
    var BACKGROUND_RETRY_SEC = 2.0;
    var WAIT_POLL_SEC = 1.0;
    var ATTEMPT_TIMEOUT_SEC = 2.5;
    var PURCHASE_DEADLINE_SEC = 120.0;
    var _pendingRollSeq = 0;

    /** Survive shop HUD recreate: roll often happens while panel is closed. */
    function savePendingRoll(info) {
        try {
            if (typeof globalThis === 'undefined') return;
            if (!info || !info.cls) {
                globalThis.__rs_pending_roll = null;
                return;
            }
            globalThis.__rs_pending_roll = {
                cls: info.cls,
                tier: info.tier || 0,
                listId: info.listId || '',
                itemType: info.itemType || 0,
                name: info.name || '',
                seq: info.seq || 0
            };
        } catch (eSave) {}
    }

    function clearPendingRoll() {
        try {
            if (typeof globalThis !== 'undefined') globalThis.__rs_pending_roll = null;
        } catch (eClear) {}
    }

    function readPendingRoll() {
        try {
            if (typeof globalThis === 'undefined') return null;
            var p = globalThis.__rs_pending_roll;
            if (!p || !p.cls) return null;
            return p;
        } catch (eRead) {
            return null;
        }
    }

    /**
     * Restore rolled item after script/HUD reboot so the icon shows and purchase resumes.
     * Returns true if a pending roll was restored.
     */
    function tryRestorePendingRoll(reason) {
        if (state.mode === 'rolled' && state.itemClass) return false;
        var pending = readPendingRoll();
        if (!pending) return false;
        $.Msg('[RandomShop] restore pending roll (' + (reason || 'boot') + '): ' + pending.cls + ' T' + pending.tier);
        state.itemClass = pending.cls;
        state.itemTier = pending.tier || 0;
        state.itemListId = pending.listId || '';
        state.itemType = pending.itemType || 0;
        _pendingRollSeq = pending.seq || 0;
        ActivateRandomTab();
        setMode('rolled');
        updateRolledDisplay();
        startPurchaseMachine();
        return true;
    }

    function getEnabledCatString() {
        var cats = [];
        for (var i = 0; i < LIST_IDS.length; i++) {
            if (_enabledLists[LIST_IDS[i]]) cats.push(CATEGORY_NAMES[LIST_IDS[i]]);
        }
        return cats.join('/');
    }

    // ============================================================
    // Random tab activation / deactivation
    // ============================================================
    /** Vote/apply/wait stages that must keep the Random overlay open. */
    function voteWantsRandomTab() {
        var vs = '';
        try {
            if (typeof globalThis !== 'undefined') {
                vs = String(globalThis.__twitch_bridge_last_vote_stage || '');
            }
        } catch (eVs) {}
        return vs === 'voting_category' ||
            vs === 'voting_tier' ||
            vs === 'voting_combined' ||
            vs === 'applying' ||
            vs === 'rolled' ||
            vs === 'waiting_shop';
    }

    function snapshotShowingClasses(root) {
        _activatedWithShowing = [];
        for (var i = 0; i < ALL_SHOWING.length; i++) {
            if (root.BHasClass(ALL_SHOWING[i])) _activatedWithShowing.push(ALL_SHOWING[i]);
        }
    }

    function ActivateRandomTab() {
        var root = $.GetContextPanel();
        var already = false;
        try { already = root.BHasClass('gShowingRandom'); } catch (eAl) {}
        snapshotShowingClasses(root);
        root.AddClass('gShowingRandom');
        updateAffordability();
        // Engine may add showingWeapon/Armor/Tech a frame later — refresh snapshot
        // so watchNativeTabActivation does not treat it as a user tab switch.
        $.Schedule(0.08, function () {
            try {
                var r = $.GetContextPanel();
                if (r && r.BHasClass('gShowingRandom')) snapshotShowingClasses(r);
            } catch (eSnap) {}
        });
        if (!already) $.Msg('[RandomShop] Random tab activated');
    }

    function DeactivateRandomTab() {
        var root = $.GetContextPanel();
        if (!root.BHasClass('gShowingRandom')) return;
        // Keep Random open for the whole vote/apply/wait pipeline.
        if (voteWantsRandomTab()) {
            return;
        }
        // Keep rolled item + purchase queue visible (vote may buy when player enters shop range).
        // Do NOT remove gShowingRandom while purchase is still pending — overlay would blank the item.
        if (state.mode === 'rolled' && (purchase.phase === 'pending' || purchase.phase === 'attempting' || purchase.phase === 'waiting_shop')) {
            $.Msg('[RandomShop] Random tab stay — purchase still pending');
            return;
        }
        root.RemoveClass('gShowingRandom');
        if (state.mode === 'rolled') {
            cancelPurchaseMachine('tab_deactivated');
            clearPendingRoll();
            state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
            setMode('idle');
            var msg = root.FindChildTraverse('RSNoItemsMsg');
            if (msg) msg.text = '';
            var status = root.FindChildTraverse('RSPurchaseStatus');
            if (status) status.text = '';
        }
        $.Msg('[RandomShop] Random tab deactivated');
    }

    function isShopUiOpen() {
        try {
            var root = $.GetContextPanel();
            return !!(root && root.IsValid() && root.BHasClass('gShopOpen'));
        } catch (e) {
            return false;
        }
    }

    function emitPurchaseWaiting(reason) {
        if (purchase.lastWaitingReason === reason) return;
        purchase.lastWaitingReason = reason;
        var payload = {
            reason: reason,
            cls: state.itemClass,
            tier: state.itemTier,
            listId: state.itemListId,
            itemType: state.itemType,
            name: state.itemClass ? getItemName(state.itemClass, state.itemListId) : '',
            hero: getLocalHeroName(),
            seq: _pendingRollSeq || undefined
        };
        try {
            if (typeof globalThis !== 'undefined' && typeof globalThis.__twitch_bridge_on_shop_purchase_waiting === 'function') {
                globalThis.__twitch_bridge_on_shop_purchase_waiting(payload);
            }
        } catch (eHook) {}
        var sl = $.GetContextPanel().FindChildTraverse('RSPurchaseStatus');
        if (sl) {
            if (reason === 'awaiting_shop_range' || reason === 'shop_ui_closed' || reason === 'out_of_range') {
                sl.text = 'Approach shop to buy';
            } else if (reason === 'souls_unknown') sl.text = 'Approach shop to buy';
            else if (reason === 'cant_afford') sl.text = 'Waiting for souls…';
            else sl.text = 'Waiting: ' + reason;
        }
    }

    function cancelPurchaseMachine(reason) {
        purchase.gen += 1;
        purchase.phase = 'idle';
        purchase.path = null;
        purchase.backgroundAttempts = 0;
        purchase.uiFallbackDone = false;
        purchase.soulsBefore = -1;
        purchase.lastWaitingReason = '';
        if (reason) $.Msg('[RandomShop] purchase cancelled: ' + reason);
    }

    /** Cancel rolled/waiting state so a new vote seq can roll immediately. */
    function RandomShopCancelRoll(reason) {
        cancelPurchaseMachine(reason || 'cancel_roll');
        clearPendingRoll();
        _rollGen += 1;
        _pendingRollSeq = 0;
        state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
        setMode('idle');
        var root = $.GetContextPanel();
        var msg = root.FindChildTraverse('RSNoItemsMsg'); if (msg) msg.text = '';
        var sts = root.FindChildTraverse('RSPurchaseStatus'); if (sts) sts.text = '';
        scheduleAffordabilityUpdate();
        $.Msg('[RandomShop] CancelRoll: ' + (reason || ''));
        return true;
    }

    // Poll every 50ms: deactivate Random tab only when a NEW showingX class appears
    // (one that was not present when Random was activated). This prevents false
    // triggers from the pre-existing showingX class of the previously active tab.
    // During vote/apply/wait, ignore native tab switches entirely.
    function watchNativeTabActivation() {
        if (!_suppressDeactivation && !voteWantsRandomTab()) {
            var root = $.GetContextPanel();
            if (root.BHasClass('gShowingRandom')) {
                for (var i = 0; i < ALL_SHOWING.length; i++) {
                    if (root.BHasClass(ALL_SHOWING[i])) {
                        var wasPresent = false;
                        for (var j = 0; j < _activatedWithShowing.length; j++) {
                            if (_activatedWithShowing[j] === ALL_SHOWING[i]) { wasPresent = true; break; }
                        }
                        if (!wasPresent) { DeactivateRandomTab(); break; }
                    }
                }
            }
        }
        $.Schedule(0.05, watchNativeTabActivation);
    }

    // ============================================================
    // Helpers
    // ============================================================
    function getTierFromPanel(panel, listRoot) {
        var p = panel;
        while (p && p !== listRoot) {
            var pid = p.id || '';
            if (pid.length > 0 && pid.toLowerCase().indexOf('tier') !== -1) {
                var digits = pid.replace(/\D/g, '');
                if (digits.length > 0) return parseInt(digits, 10);
            }
            p = p.GetParent();
        }
        return 0;
    }

    function findShopModPanels(listRoot, out, depth) {
        if (!listRoot || !listRoot.IsValid() || (depth || 0) > 14) return;
        try {
            if ((listRoot.paneltype || '') === 'CitadelShopMod') {
                out.push(listRoot);
                return;
            }
        } catch (eType) {}
        var n = 0;
        try { n = listRoot.GetChildCount ? listRoot.GetChildCount() : 0; } catch (eN) { return; }
        for (var i = 0; i < n; i++) {
            var ch = null;
            try { ch = listRoot.GetChild(i); } catch (eCh) { continue; }
            if (ch) findShopModPanels(ch, out, (depth || 0) + 1);
        }
    }

    function resolveModClass(shopMod) {
        if (!shopMod || !shopMod.IsValid()) return '';
        var ci;
        for (ci = 0; ci < ALL_MOD_CLASSES.length; ci++) {
            var cls = ALL_MOD_CLASSES[ci];
            try {
                if (typeof shopMod.BHasClass === 'function' && shopMod.BHasClass(cls)) return cls;
            } catch (eHas) {}
            try {
                if (typeof shopMod.FindChildrenWithClassTraverse === 'function') {
                    var icons = shopMod.FindChildrenWithClassTraverse(cls);
                    if (icons && icons.length) return cls;
                }
            } catch (eFind) {}
        }
        return '';
    }

    function findIconForClass(shopMod, cls) {
        if (!shopMod || !cls) return shopMod;
        try {
            if (typeof shopMod.BHasClass === 'function' && shopMod.BHasClass(cls)) return shopMod;
        } catch (e) {}
        try {
            if (typeof shopMod.FindChildrenWithClassTraverse === 'function') {
                var icons = shopMod.FindChildrenWithClassTraverse(cls);
                if (icons && icons.length) return icons[0];
            }
        } catch (e2) {}
        return shopMod;
    }

    function isShopModBuyable(shopMod) {
        if (!shopMod || !shopMod.IsValid()) return false;
        try {
            if (shopMod.BHasClass('owned')) return false;
            if (shopMod.BHasClass('usedAsComponent')) return false;
            if (shopMod.BHasClass('itemDisabled')) return false;
            if (shopMod.BHasClass('disabledFromPurchasing')) return false;
        } catch (e) {}
        return true;
    }

    var ITEM_TYPE_ATTRS = ['ItemType', 'item_type', 'upgrade_type', 'item_id', 'shopmod_type', 'component_type', 'upgradeid'];

    function getItemType(iconPanel) {
        if (!iconPanel || !iconPanel.IsValid()) return 0;
        var p = iconPanel;
        for (var i = 0; i < 8; i++) {
            if (!p || !p.IsValid()) break;
            for (var a = 0; a < ITEM_TYPE_ATTRS.length; a++) {
                var t = p.GetAttributeInt(ITEM_TYPE_ATTRS[a], 0);
                if (t) { $.Msg('[RandomShop] getItemType=' + t + ' attr=' + ITEM_TYPE_ATTRS[a]); return t; }
            }
            p = p.GetParent();
        }
        return 0;
    }

    /** Prefer CitadelShopMod DOM scan; fall back to ALL_MOD_CLASSES class traverse. */
    function collectItemsForTier(tierNum) {
        var root = $.GetContextPanel();
        var result = [];
        var li;
        for (li = 0; li < LIST_IDS.length; li++) {
            if (!_enabledLists[LIST_IDS[li]]) continue;
            var list = root.FindChildTraverse(LIST_IDS[li]);
            if (!list || !list.IsValid()) continue;

            var mods = [];
            findShopModPanels(list, mods, 0);
            var mi;
            for (mi = 0; mi < mods.length; mi++) {
                var shopMod = mods[mi];
                if (!isShopModBuyable(shopMod)) continue;
                var tier = getTierFromPanel(shopMod, list);
                if (tier !== tierNum) continue;
                var cls = resolveModClass(shopMod);
                if (!cls) continue;
                var icon = findIconForClass(shopMod, cls);
                var dup = false;
                var di;
                for (di = 0; di < result.length; di++) {
                    if (result[di].icon === icon || result[di].shopMod === shopMod) { dup = true; break; }
                }
                if (!dup) {
                    result.push({
                        icon: icon,
                        shopMod: shopMod,
                        type: getItemType(icon),
                        cls: cls,
                        listId: LIST_IDS[li]
                    });
                }
            }
        }

        if (result.length > 0) return result;

        // Fallback: known CSS classes (legacy / empty CitadelShopMod tree).
        for (li = 0; li < LIST_IDS.length; li++) {
            if (!_enabledLists[LIST_IDS[li]]) continue;
            var listFb = root.FindChildTraverse(LIST_IDS[li]);
            if (!listFb || !listFb.IsValid()) continue;
            var ci;
            for (ci = 0; ci < ALL_MOD_CLASSES.length; ci++) {
                var icons = listFb.FindChildrenWithClassTraverse(ALL_MOD_CLASSES[ci]);
                var ii;
                for (ii = 0; ii < icons.length; ii++) {
                    var iconFb = icons[ii];
                    if (!iconFb || !iconFb.IsValid()) continue;
                    if (iconFb.BHasClass('owned')) continue;
                    if (iconFb.BHasClass('usedAsComponent')) continue;
                    if (iconFb.BHasClass('itemDisabled')) continue;
                    var tierFb = getTierFromPanel(iconFb, listFb);
                    if (tierFb !== tierNum) continue;
                    var dupFb = false;
                    for (di = 0; di < result.length; di++) {
                        if (result[di].icon === iconFb) { dupFb = true; break; }
                    }
                    if (!dupFb) {
                        result.push({
                            icon: iconFb,
                            type: getItemType(iconFb),
                            cls: ALL_MOD_CLASSES[ci],
                            listId: LIST_IDS[li]
                        });
                    }
                }
            }
        }
        return result;
    }

    function readTierCostFromPanel(tierNum) {
        try {
            var root = $.GetContextPanel();
            var btn = root.FindChildTraverse('RSTier' + tierNum);
            if (btn && btn.IsValid()) {
                var labels = [];
                try {
                    if (typeof btn.FindChildrenWithClassTraverse === 'function') {
                        labels = btn.FindChildrenWithClassTraverse('RSTierCost') || [];
                    }
                } catch (eL) {}
                if (labels.length) {
                    var text = labels[0].text || '';
                    var n = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(n) && n > 0) return n;
                }
            }
        } catch (eBtn) {}

        // Fallback: first buyable CitadelShopMod in that tier — scan numeric labels.
        try {
            var items = collectItemsForTier(tierNum);
            if (items.length) {
                var panel = items[0].shopMod || items[0].icon;
                var nums = [];
                collectNumbers(panel, nums, 0);
                var ni;
                for (ni = 0; ni < nums.length; ni++) {
                    var cand = nums[ni];
                    if (cand === 800 || cand === 1600 || cand === 3200 || cand === 6400) return cand;
                }
                // Closest known tier cost among found numbers.
                for (ni = 0; ni < nums.length; ni++) {
                    if (nums[ni] >= 500 && nums[ni] <= 20000) return nums[ni];
                }
            }
        } catch (eItem) {}
        return TIER_COSTS[tierNum] || 0;
    }

    function getTierCost(tierNum) {
        var live = readTierCostFromPanel(tierNum);
        return live > 0 ? live : (TIER_COSTS[tierNum] || 0);
    }

    // Collect all numbers from labels in a panel tree into out[].
    function collectNumbers(panel, out, depth) {
        if (!panel || !panel.IsValid() || (depth || 0) > 6) return;
        if ((panel.paneltype || '').toLowerCase() === 'label') {
            var text = panel.text || '';
            if (/[0-9]/.test(text)) {
                var n = parseInt(text.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(n)) out.push(n);
            }
        }
        for (var i = 0; i < panel.GetChildCount(); i++) {
            collectNumbers(panel.GetChild(i), out, (depth || 0) + 1);
        }
    }

    function getSouls() {
        try {
            var root = $.GetContextPanel();
            var goldAP = root.FindChildTraverse('GoldAPContainer');
            if (goldAP && goldAP.IsValid()) {
                var nums = [];
                collectNumbers(goldAP, nums, 0);
                if (nums.length > 0) {
                    // Souls are at index 2 in GoldAPContainer's label list.
                    var souls = nums.length > 2 ? nums[2] : nums[0];
                    return souls;
                }
            }
            // Fallback: SoulAmount shows total collected (less accurate)
            var soulPanel = root.FindChildTraverse('SoulAmount');
            if (soulPanel && soulPanel.IsValid()) {
                var nums2 = [];
                collectNumbers(soulPanel, nums2, 0);
                if (nums2.length > 0) {
                    nums2.sort(function (a, b) { return b - a; });
                    return nums2[0];
                }
            }
        } catch (e) { $.Msg('[RandomShop] getSouls error: ' + e); }
        return -1;
    }

    function setMode(mode) {
        state.mode = mode;
        $.GetContextPanel().SetHasClass('rs-mode-rolled', mode === 'rolled');
    }

    // Maps JS class name (+ optional '|listId') to internal item name (= image filename without _psd.vtex).
    // Source: ability_icons.css — the image filename IS the localization key suffix (#upgrade_X).
    var ITEM_LOCKEYS = {
        // --- Weapon ---
        'activeReload':                             'active_reload',
        'armorBreakingBullets':                     'armor_breaking_bullets',
        'bansheeSlugs':                             'banshee_slugs',
        'berserker':                                'berserker',
        'bulletArmorReductionAura':                 'bullet_armor_reduction_aura',
        'bulletDamageAura':                         'bullet_damage_aura',
        'closeRange':                               'close_range',
        'cloakingDevice':                           'cloaking_device',
        'critshot':                                 'crit_damage',
        'electrifiedBullets':                       'electrified_bullets',
        'empBullets':                               'emp_bullets',
        'explosiveBullets':                         'explosive_bullets',
        'fervor':                                   'fervor',
        'fleetfootBoots':                           'fleetfoot_boots',
        'glassCannon':                              'glass_cannon',
        'headhunter':                               'headhunter',
        'headshotBooster':                          'headshot_booster',
        'highVelocityMag':                          'high_velocity_mag',
        'hollowPoint':                              'hollow_point',
        'clipSize':                                 'clip_size',
        'intensifyingClip':                         'auto_reloader',
        'item_gadget':                              'item_gadget',
        'item_gadget_enemy':                        'item_gadget_enemy',
        'kineticSash':                              'kinetic_sash',
        'longRange':                                'long_range',
        'longshot':                                 'longshot',
        'magicOverflow':                            'magic_overflow',
        'medicBullets':                             'medic_bullets',
        'meleeCharge':                              'melee_charge',
        'pointBlank':                               'point_blank',
        'pristineEmblem':                           'pristine_emblem',
        'rapidRounds':                              'rapid_rounds',
        'reinforcingCasings':                       'bullet_armor_plus',
        'ricochet':                                 'ricochet',
        'slowingBullets':                           'slowing_bullets',
        'spellslingerHeadshots':                    'spellslinger_headshots',
        'techGrenade':                              'thermal_detonator',
        'techResistShredder':                       'tech_resist_shredder',
        'titanicMagazine':                          'titanic_magazine',
        'toxicBullets':                             'toxic_bullets',
        // --- Ambiguous: same CSS class, different list ---
        'absorbingArmor|ShopModsListWeapon':        'arcane_medallion',
        'absorbingArmor|ShopModsListArmor':         'arcane_medallion',
        'item_passive|ShopModsListWeapon':          'item_passive',
        'item_passive|ShopModsListArmor':           'item_passive',
        'item_passive|ShopModsListTech':            'item_passive',
        'fireRatePlus|ShopModsListWeapon':          'fire_rate_plus',
        'fireRatePlusPlus|ShopModsListWeapon':      'fire_rate_plus_plus',
        'fireRatePlus|ShopModsListTech':            'fire_rate_plus',
        'fireRatePlusPlus|ShopModsListTech':        'fire_rate_plus_plus',
        'endurance|ShopModsListArmor':              'endurance',
        'endurance|ShopModsListTech':               'endurance',
        'tormentAura|ShopModsListArmor':            'torment_aura',
        'tormentAura|ShopModsListTech':             'torment_aura',
        // --- Vitality ---
        'boxingGlove':                              'boxing_glove',
        'bulletShield':                             'bullet_shield',
        'cardioCalibrator':                         'cardio_calibrator',
        'colossus':                                 'colossus',
        'debuffReducer':                            'debuff_reducer',
        'debuffRemover':                            'debuff_remover',
        'healBuff':                                 'heal_buff',
        'healbane':                                 'healbane',
        'healthNova':                               'health_nova',
        'healthSstealingBullets':                   'health_stealing_bullets',
        'healthStealingBullets':                    'health_stealing_bullets',
        'healthStealingTech':                       'health_stealing_tech',
        'healingBooster':                           'healing_booster',
        'improvedBulletArmor':                      'improved_bullet_armor',
        'improvedStamina':                          'improved_stamina',
        'infuser':                                  'infuser',
        'inhibitor':                                'inhibitor',
        'juggernaut':                               'juggernaut',
        'lastStand':                                'return_fire',
        'leech':                                    'leech',
        'lifestrikeGauntlets':                      'lifestrike_gauntlets',
        'medicBeam':                                'medic_beam',
        'metalSkin':                                'metal_skin',
        'parryRebuttal':                            'parry_rebuttal',
        'phantomStrike':                            'phantom_strike',
        'restorativeLocket':                        'restorative_locket',
        'revitalizer':                              'revitalizer',
        'rocketBooster':                            'rocket_booster',
        'savior':                                   'savior',
        'siphon_bullets':                           'siphon_bullets',
        'sprintBooster':                            'sprint_booster',
        'stimPak':                                  'stimpak',
        'superiorStamina':                          'superior_stamina',
        'surgingPower':                             'vampiric_burst',
        'techArmorPulse':                           'tech_shield_pulse',
        'techPurge':                                'tech_purge',
        'unstoppable':                              'unstoppable',
        'upgrade_health':                           'health',
        'veilWalker':                               'veil_walker',
        'vexBarrier':                               'last_stand',
        'warpStone':                                'warp_stone',
        // --- Spirit ---
        'abilityRefresher':                         'refresher_module',
        'acolytesGlove':                            'acolytes_glove',
        'advancedRecharge':                         'advanced_recharge',
        'areaImmobilize':                           'area_immobilize',
        'arcaneSurge':                              'arcane_surge',
        'bulletResistShredder':                     'bullet_resist_shredder',
        'disarm':                                   'disarm',
        'durationExtender':                         'duration_extender',
        'escalatingExposure':                       'escalating_exposure',
        'extraCharge':                              'extra_charge',
        'goldenEgg':                                'golden_egg',
        'focusedSilence':                           'focused_silence',
        'glitch':                                   'glitch',
        'iceBlast':                                 'ice_blast',
        'immobilize':                               'immobilize',
        'knockdown':                                'knockdown',
        'magicBurst':                               'magic_burst',
        'magicCarpet':                              'magic_carpet',
        'magicReverb':                              'magic_reverb',
        'magicShock':                               'magic_shock',
        'magicStorm':                               'magic_storm',
        'megaSpirit':                               'boundless_spirit',
        'powerShard':                               'echo_shard',
        'rapidRecharge':                            'rapid_recharge',
        'rupture':                                  'rupture',
        'shiftingShroud':                           'shifting_shroud',
        'slowingTech':                              'slowing_tech',
        'soaringSpirit':                            'soaring_spirit',
        'spiritSnatch':                             'spirit_snatch',
        'spiritualDominion':                        'spiritual_dominion',
        'spiritualFlow':                            'spiritual_flow',
        'superiorDuration':                         'arcane_persistance',
        'targetedSilence':                          'targeted_silence',
        'techPower':                                'tech_damage',
        'techRange':                                'tech_range',
        'techVulnerability':                        'tech_vulnerability',
        'ultimateBurst':                            'adrenaline_rush',
        'weaponJammer':                             'weapon_jammer',
    };

    function getItemName(itemClass, listId) {
        var internalName = ITEM_LOCKEYS[itemClass + '|' + listId] || ITEM_LOCKEYS[itemClass];
        if (internalName) {
            var key = '#upgrade_' + internalName;
            var loc = $.Localize(key);
            if (loc && loc !== key) return loc;
            // Localize failed — convert snake_case to Title Case
            return internalName.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        }
        return itemClass;
    }

    function getLocalHeroName() {
        try {
            var root = $.GetContextPanel();
            if (root && typeof root.GetDialogVariable === 'function') {
                var d = root.GetDialogVariable('hero_name');
                if (d && String(d).indexOf('{') === -1) return String(d);
            }
        } catch (e) {}
        return '';
    }

    function updateRolledDisplay() {
        var root = $.GetContextPanel();
        var wrapper = root.FindChildTraverse('RSBigIconWrapper');
        if (wrapper) {
            for (var ci = 0; ci < ALL_MOD_CLASSES.length; ci++) wrapper.RemoveClass(ALL_MOD_CLASSES[ci] + '-style');
            for (var li = 0; li < LIST_IDS.length; li++) wrapper.RemoveClass(LIST_IDS[li]);
            if (state.itemClass) wrapper.AddClass(state.itemClass + '-style');
            if (state.itemListId) wrapper.AddClass(state.itemListId);
        }
        var itemName = state.itemClass ? getItemName(state.itemClass, state.itemListId) : '';
        var nameLabel = root.FindChildTraverse('RSItemName');
        if (nameLabel) nameLabel.text = itemName;
        var tierLabel = root.FindChildTraverse('RSItemTier');
        if (tierLabel) {
            tierLabel.text = state.itemTier ? ('Tier ' + state.itemTier) : '';
            for (var t = 1; t <= 4; t++) tierLabel.RemoveClass('rs-tier' + t);
            if (state.itemTier) tierLabel.AddClass('rs-tier' + state.itemTier);
        }
        var header = root.FindChildTraverse('RSRolledHeader');
        if (header) header.text = 'ITEM TO BUY';
        var sub = root.FindChildTraverse('RSSubtitle');
        if (sub && state.mode === 'rolled' && itemName) {
            sub.text = itemName + ' · Tier ' + state.itemTier;
        }
        var sts = root.FindChildTraverse('RSPurchaseStatus');
        if (sts && state.mode === 'rolled') {
            if (!sts.text || sts.text === '') {
                sts.text = isShopUiOpen() ? 'Purchasing when ready…' : 'Approach shop to buy';
            }
        }
    }

    // Cycle all three lists to force DOM population.
    // Suppression keeps gShowingRandom alive during our own dispatches.
    function loadAllItemsThenRoll(tierNum, onReady) {
        var root = $.GetContextPanel();
        _suppressDeactivation = true;
        $.DispatchEvent('CitadelShopModsActivate', 'EItemSlotType_WeaponMod');
        $.Schedule(0.06, function () {
            $.DispatchEvent('CitadelShopModsActivate', 'EItemSlotType_Armor');
            $.Schedule(0.06, function () {
                $.DispatchEvent('CitadelShopModsActivate', 'EItemSlotType_Tech');
                $.Schedule(0.10, function () {
                    root.AddClass('gShowingRandom');
                    snapshotShowingClasses(root);
                    $.Schedule(0.15, function () { _suppressDeactivation = false; });
                    onReady(tierNum);
                });
            });
        });
    }

    function findItemShopModPanel() {
        var root = $.GetContextPanel();
        var list = root.FindChildTraverse(state.itemListId);
        if (!list || !list.IsValid()) return null;
        var panels = list.FindChildrenWithClassTraverse(state.itemClass);
        for (var i = 0; i < panels.length; i++) {
            var icon = panels[i];
            if (!icon || !icon.IsValid()) continue;
            if (getTierFromPanel(icon, list) !== state.itemTier) continue;
            var p = icon;
            while (p && p.IsValid()) { if (p.paneltype === 'CitadelShopMod') return p; p = p.GetParent(); }
        }
        return null;
    }

    function isRolledItemOwned() {
        if (!state.itemClass || !state.itemListId) return false;
        var shopMod = findItemShopModPanel();
        if (shopMod && shopMod.IsValid()) {
            try {
                if (shopMod.BHasClass('owned')) return true;
            } catch (e) {}
        }
        var root = $.GetContextPanel();
        var list = root.FindChildTraverse(state.itemListId);
        if (!list || !list.IsValid()) return false;
        var panels = list.FindChildrenWithClassTraverse(state.itemClass);
        for (var i = 0; i < panels.length; i++) {
            var p = panels[i];
            if (!p || !p.IsValid()) continue;
            if (getTierFromPanel(p, list) !== state.itemTier) continue;
            if (p.BHasClass('owned')) return true;
        }
        return false;
    }

    var LIST_TO_EVENT = {
        'ShopModsListWeapon': 'EItemSlotType_WeaponMod',
        'ShopModsListArmor':  'EItemSlotType_Armor',
        'ShopModsListTech':   'EItemSlotType_Tech'
    };

    // Navigate to the item's native tab (so C++ registers the active list),
    // keep gShowingRandom overlay active, update snapshot, then call cb().
    function navigateToListThenCall(cb) {
        var evtType = LIST_TO_EVENT[state.itemListId];
        if (!evtType) { cb(); return; }
        _suppressDeactivation = true;
        $.DispatchEvent('CitadelShopModsActivate', evtType);
        $.Schedule(0.12, function () {
            var root = $.GetContextPanel();
            root.AddClass('gShowingRandom');
            snapshotShowingClasses(root);
            $.Schedule(0.08, function () {
                _suppressDeactivation = false;
                cb();
            });
        });
    }

    // Background path: semantic purchase event only (no panel click = no sell toggle).
    function triggerBackgroundPurchase() {
        if (!state.itemType) {
            $.Msg('[RandomShop] background purchase: no itemType');
            return false;
        }
        if (isRolledItemOwned()) return false;
        $.Msg('[RandomShop] Background CitadelShopPurchaseMod type=' + state.itemType);
        try { $.DispatchEvent('CitadelShopPurchaseMod', state.itemType); } catch (e) {}
        return true;
    }

    // UI fallback: single Activated click on non-owned CitadelShopMod panel.
    function triggerUiFallbackPurchase() {
        if (isRolledItemOwned()) return false;
        var shopMod = findItemShopModPanel();
        if (!shopMod || !shopMod.IsValid()) {
            $.Msg('[RandomShop] UI fallback: panel not found for cls=' + state.itemClass);
            return false;
        }
        try {
            if (shopMod.BHasClass('owned')) return false;
        } catch (eOwned) {}
        $.Msg('[RandomShop] UI fallback Activated id=' + (shopMod.id || '?'));
        try { shopMod.SetFocus(); } catch (e) {}
        try { $.DispatchEvent('Activated', shopMod, 'mouse'); } catch (e2) {}
        return true;
    }

    function onItemPurchased(wasPurchased) {
        if (purchase.phase === 'confirmed' || purchase.phase === 'failed') return;
        if (state.mode !== 'rolled' && !state.itemClass) return;
        $.Msg('[RandomShop] ' + (wasPurchased ? 'Purchase confirmed' : 'Timeout/fail'));
        purchase.phase = wasPurchased ? 'confirmed' : 'failed';
        purchase.gen += 1;
        var purchasePayload = {
            ok: !!wasPurchased,
            cls: state.itemClass,
            tier: state.itemTier,
            listId: state.itemListId,
            name: state.itemClass ? getItemName(state.itemClass, state.itemListId) : '',
            hero: getLocalHeroName()
        };
        try {
            if (typeof globalThis !== 'undefined' && typeof globalThis.__twitch_bridge_on_shop_purchase === 'function') {
                globalThis.__twitch_bridge_on_shop_purchase(purchasePayload);
            }
        } catch (eHook) {}
        clearPendingRoll();
        state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
        _pendingRollSeq = 0;
        purchase.path = null;
        purchase.backgroundAttempts = 0;
        purchase.uiFallbackDone = false;
        purchase.soulsBefore = -1;
        purchase.lastWaitingReason = '';
        setMode('idle');
        var root = $.GetContextPanel();
        var msg = root.FindChildTraverse('RSNoItemsMsg');    if (msg) msg.text = '';
        var sts = root.FindChildTraverse('RSPurchaseStatus'); if (sts) sts.text = '';
        scheduleAffordabilityUpdate();
        updateItemAvailability();
    }

    function schedulePurchaseTick(gen, delaySec) {
        $.Schedule(delaySec, function () { purchaseTick(gen); });
    }

    function purchaseTick(gen) {
        if (gen !== purchase.gen) return;
        if (state.mode !== 'rolled') return;
        if (purchase.phase === 'confirmed' || purchase.phase === 'failed' || purchase.phase === 'idle') return;

        if (isRolledItemOwned()) {
            onItemPurchased(true);
            return;
        }

        var cost = getTierCost(state.itemTier);
        var souls = getSouls();
        var shopOpen = isShopUiOpen();
        var sl = $.GetContextPanel().FindChildTraverse('RSPurchaseStatus');

        // Can't afford — wait (do not fire purchase events).
        if (souls >= 0 && souls < cost) {
            purchase.phase = 'waiting_shop';
            emitPurchaseWaiting('cant_afford');
            schedulePurchaseTick(gen, WAIT_POLL_SEC);
            return;
        }

        // Currently attempting — wait for owned confirmation before any new event.
        if (purchase.phase === 'attempting') {
            schedulePurchaseTick(gen, WAIT_POLL_SEC);
            return;
        }

        // Quiet wait while shop UI closed: no spam. Buy only when in range signal appears.
        if (!shopOpen) {
            // Signal "in range": souls readable (>=0) after we were waiting — one background try.
            var canTryBackground =
                souls >= 0 &&
                purchase.backgroundAttempts < MAX_BACKGROUND_ATTEMPTS &&
                purchase.phase === 'pending';
            if (canTryBackground) {
                purchase.phase = 'attempting';
                purchase.path = 'background';
                purchase.soulsBefore = souls;
                purchase.backgroundAttempts += 1;
                if (sl) sl.text = 'Purchasing…';
                triggerBackgroundPurchase();
                $.Schedule(ATTEMPT_TIMEOUT_SEC, function () {
                    if (gen !== purchase.gen) return;
                    if (purchase.phase !== 'attempting') return;
                    if (isRolledItemOwned()) {
                        onItemPurchased(true);
                        return;
                    }
                    purchase.phase = 'waiting_shop';
                    purchase.path = null;
                    emitPurchaseWaiting('awaiting_shop_range');
                    schedulePurchaseTick(gen, WAIT_POLL_SEC);
                });
                return;
            }
            purchase.phase = 'waiting_shop';
            emitPurchaseWaiting('awaiting_shop_range');
            schedulePurchaseTick(gen, WAIT_POLL_SEC);
            return;
        }

        // Shop UI open: one Activated click fallback if not already done.
        if (!purchase.uiFallbackDone) {
            purchase.phase = 'attempting';
            purchase.path = 'ui_fallback';
            purchase.uiFallbackDone = true;
            purchase.soulsBefore = souls;
            if (sl) sl.text = 'Purchasing…';
            navigateToListThenCall(function () {
                if (gen !== purchase.gen) return;
                if (isRolledItemOwned()) {
                    onItemPurchased(true);
                    return;
                }
                triggerUiFallbackPurchase();
                $.Schedule(ATTEMPT_TIMEOUT_SEC, function () {
                    if (gen !== purchase.gen) return;
                    if (isRolledItemOwned()) {
                        onItemPurchased(true);
                        return;
                    }
                    purchase.phase = 'waiting_shop';
                    purchase.path = null;
                    if (sl) sl.text = 'Approach shop to buy';
                    emitPurchaseWaiting('awaiting_shop_range');
                    schedulePurchaseTick(gen, WAIT_POLL_SEC);
                });
            });
            return;
        }

        purchase.phase = 'waiting_shop';
        emitPurchaseWaiting('awaiting_shop_range');
        schedulePurchaseTick(gen, WAIT_POLL_SEC);
    }

    function startPurchaseMachine() {
        cancelPurchaseMachine('');
        purchase.gen += 1;
        var gen = purchase.gen;
        purchase.phase = 'pending';
        purchase.path = null;
        purchase.backgroundAttempts = 0;
        purchase.uiFallbackDone = false;
        purchase.soulsBefore = getSouls();
        purchase.lastWaitingReason = '';

        // If UI already closed, go straight to quiet wait (no Purchasing spam).
        if (!isShopUiOpen()) {
            purchase.phase = 'waiting_shop';
            emitPurchaseWaiting('awaiting_shop_range');
        }

        $.Schedule(PURCHASE_DEADLINE_SEC, function () {
            if (gen !== purchase.gen) return;
            if (state.mode !== 'rolled') return;
            if (isRolledItemOwned()) {
                onItemPurchased(true);
                return;
            }
            onItemPurchased(false);
        });

        schedulePurchaseTick(gen, isShopUiOpen() ? 0.25 : 0.5);
    }

    // Public: re-queue purchase for an already-rolled item (bridge / manual).
    function RandomShopBuyItem() {
        if (state.mode !== 'rolled' || !state.itemClass) {
            $.Msg('[RandomShop] RandomShopBuyItem: nothing rolled');
            return false;
        }
        if (isRolledItemOwned()) {
            onItemPurchased(true);
            return true;
        }
        purchase.backgroundAttempts = 0;
        purchase.uiFallbackDone = false;
        purchase.lastWaitingReason = '';
        purchase.phase = isShopUiOpen() ? 'pending' : 'waiting_shop';
        purchase.gen += 1;
        var gen = purchase.gen;
        $.Msg('[RandomShop] RandomShopBuyItem re-queue');
        if (!isShopUiOpen()) emitPurchaseWaiting('awaiting_shop_range');
        schedulePurchaseTick(gen, 0.05);
        return true;
    }

    function notifyShopOpenChanged(open) {
        if (open) {
            // HUD may have rebooted while waiting — restore rolled icon + purchase queue.
            if (tryRestorePendingRoll('shop_open')) return;
            if (state.mode === 'rolled' || voteWantsRandomTab()) {
                ActivateRandomTab();
                if (state.mode === 'rolled') {
                    updateRolledDisplay();
                    if (purchase.phase === 'waiting_shop' || purchase.phase === 'pending') {
                        purchase.lastWaitingReason = '';
                        purchase.uiFallbackDone = false;
                        purchase.phase = 'pending';
                        schedulePurchaseTick(purchase.gen, 0.1);
                    }
                }
            }
        }
    }

    function watchShopOpen() {
        var open = isShopUiOpen();
        if (typeof watchShopOpen._last !== 'boolean') {
            watchShopOpen._last = open;
        } else if (watchShopOpen._last !== open) {
            watchShopOpen._last = open;
            // Open/close transitions only (not every poll).
            $.Msg('[RandomShop] gShopOpen -> ' + open);
            notifyShopOpenChanged(open);
            try {
                if (typeof globalThis !== 'undefined' && typeof globalThis.__twitch_bridge_on_shop_open_change === 'function') {
                    globalThis.__twitch_bridge_on_shop_open_change(open);
                }
            } catch (eHook) {}
        }
        // Watchdog: pending roll + shop open but UI idle → force restore (HUD recreate).
        if (open && state.mode !== 'rolled' && readPendingRoll()) {
            tryRestorePendingRoll('watchdog');
        } else if (open && state.mode === 'rolled' && state.itemClass) {
            // Keep Random tab + card painted while waiting to buy.
            var root = $.GetContextPanel();
            try {
                if (root && !root.BHasClass('gShowingRandom')) ActivateRandomTab();
                if (root && !root.BHasClass('rs-mode-rolled')) setMode('rolled');
            } catch (eKeep) {}
        } else if (open && voteWantsRandomTab()) {
            // Vote/apply in progress — keep Random tab even if engine cleared the class.
            try {
                ActivateRandomTab();
            } catch (eKeepV) {}
        }
        $.Schedule(0.1, watchShopOpen);
    }

    function updateAffordability() {
        var souls = getSouls(); var root = $.GetContextPanel();
        for (var t = 1; t <= 4; t++) {
            var btn = root.FindChildTraverse('RSTier' + t);
            if (!btn || !btn.IsValid()) continue;
            var cost = getTierCost(t);
            btn.SetHasClass('rs-cant-afford', (souls >= 0) && (souls < cost));
            try {
                var costLabels = btn.FindChildrenWithClassTraverse
                    ? btn.FindChildrenWithClassTraverse('RSTierCost')
                    : [];
                if (costLabels && costLabels.length && cost > 0) {
                    costLabels[0].text = String(cost);
                }
            } catch (eCost) {}
        }
    }

    function updateItemAvailability() {
        var root = $.GetContextPanel();
        for (var t = 1; t <= 4; t++) {
            var btn = root.FindChildTraverse('RSTier' + t);
            if (!btn || !btn.IsValid()) continue;
            btn.SetHasClass('rs-no-items', collectItemsForTier(t).length === 0);
        }
    }

    function scheduleAffordabilityUpdate() {
        updateAffordability();
        $.Schedule(2.0, function () { if (state.mode === 'idle') scheduleAffordabilityUpdate(); });
    }

    function areSlotsFullForItems(items) {
        for (var i = 0; i < Math.min(items.length, 5); i++) {
            var icon = items[i].icon;
            if (!icon || !icon.IsValid()) continue;
            var p = icon;
            for (var d = 0; d < 12; d++) {
                if (!p || !p.IsValid()) break;
                if (p.paneltype === 'CitadelShopMod') {
                    if (p.BHasClass('disabledFromPurchasing')) { $.Msg('[RandomShop] slots full'); return true; }
                    break;
                }
                p = p.GetParent();
            }
        }
        return false;
    }

    function emitShopError(payload) {
        try {
            if (typeof globalThis !== 'undefined' && typeof globalThis.__twitch_bridge_on_shop_error === 'function') {
                globalThis.__twitch_bridge_on_shop_error(payload);
            }
        } catch (eErr) {}
    }

    function finishSuccessfulRoll(picked, tierNum, seq) {
        state.itemClass = picked.cls; state.itemTier = tierNum;
        state.itemListId = picked.listId; state.itemType = picked.type;
        _pendingRollSeq = seq || 0;
        var itemName = getItemName(picked.cls, picked.listId);
        savePendingRoll({
            cls: picked.cls,
            tier: tierNum,
            listId: picked.listId,
            itemType: picked.type,
            name: itemName,
            seq: seq || 0
        });
        $.Msg('[RandomShop] Rolled: cls=' + picked.cls + ' tier=' + tierNum + ' type=' + picked.type + ' seq=' + (seq || 0));
        ActivateRandomTab();
        setMode('rolled');
        updateRolledDisplay();
        try {
            if (typeof globalThis !== 'undefined' && typeof globalThis.__twitch_bridge_on_shop_rolled === 'function') {
                globalThis.__twitch_bridge_on_shop_rolled({
                    cls: picked.cls,
                    tier: tierNum,
                    listId: picked.listId,
                    itemType: picked.type,
                    name: itemName,
                    hero: getLocalHeroName(),
                    seq: seq || 0
                });
            }
        } catch (eHook) {}
        _rollGen += 1;
        startPurchaseMachine();
    }

    function doAutoPurchase(tierNum, seq) {
        var root = $.GetContextPanel();
        var msg  = root.FindChildTraverse('RSNoItemsMsg');
        var cost = getTierCost(tierNum);
        var souls = getSouls();
        if (souls >= 0 && souls < cost) {
            $.Msg('[RandomShop] Not enough souls yet (' + souls + '/' + cost + ') — rolling anyway, purchase will wait');
        }
        var items = collectItemsForTier(tierNum);
        if (items.length === 0) {
            if (msg) msg.text = 'All ' + getEnabledCatString() + ' Tier ' + tierNum + ' items owned!';
            emitShopError({
                reason: 'no_items',
                tier: tierNum,
                categories: getEnabledCatString(),
                seq: seq || 0
            });
            return false;
        }
        if (areSlotsFullForItems(items)) {
            if (msg) msg.text = 'All slots full - sell an item first!';
            emitShopError({ reason: 'slots_full', tier: tierNum, seq: seq || 0 });
            return false;
        }
        if (msg) msg.text = '';
        var picked = items[Math.floor(Math.random() * items.length)];
        finishSuccessfulRoll(picked, tierNum, seq);
        return true;
    }

    /**
     * Force a roll for vote/bridge. Cancels stale rolled state first.
     * opts: { seq?: number, force?: boolean }
     * Returns true if roll was started (async populate); false if rejected immediately.
     */
    function RandomShopForceRoll(tierNum, opts) {
        opts = opts || {};
        var seq = opts.seq || 0;
        if (state.mode === 'rolled' && opts.force !== false) {
            RandomShopCancelRoll('force_new_seq');
        }
        if (state.mode !== 'idle') {
            emitShopError({ reason: 'roll_busy', tier: tierNum, seq: seq });
            return false;
        }
        ActivateRandomTab();
        loadAllItemsThenRoll(tierNum, function (t) {
            doAutoPurchase(t, seq);
        });
        return true;
    }

    function RandomShopRollTier(tierNum) {
        if (state.mode !== 'idle') return false;
        ActivateRandomTab();
        loadAllItemsThenRoll(tierNum, function (t) {
            doAutoPurchase(t, 0);
        });
        return true;
    }

    function RandomShopToggleCategory(listId) {
        if (state.mode !== 'idle') return;
        var enabledCount = 0;
        for (var i = 0; i < LIST_IDS.length; i++) { if (_enabledLists[LIST_IDS[i]]) enabledCount++; }
        if (_enabledLists[listId] && enabledCount <= 1) return;
        _enabledLists[listId] = !_enabledLists[listId];
        var root = $.GetContextPanel();
        var btn = root.FindChildTraverse(LIST_FILTER_IDS[listId]);
        if (btn && btn.IsValid()) {
            btn.SetHasClass('rs-filter-on',  _enabledLists[listId]);
            btn.SetHasClass('rs-filter-off', !_enabledLists[listId]);
        }
        $.Msg('[RandomShop] Toggle ' + listId + ' -> ' + _enabledLists[listId]);
        updateItemAvailability();
    }

    var ctx = $.GetContextPanel();
    ctx.RandomShopRollTier       = RandomShopRollTier;
    ctx.RandomShopForceRoll      = RandomShopForceRoll;
    ctx.RandomShopCancelRoll     = RandomShopCancelRoll;
    ctx.RandomShopBuyItem        = RandomShopBuyItem;
    ctx.ActivateRandomTab        = ActivateRandomTab;
    ctx.DeactivateRandomTab      = DeactivateRandomTab;
    ctx.RandomShopToggleCategory = RandomShopToggleCategory;
    ctx.RandomShopIsShopOpen     = isShopUiOpen;
    ctx.RandomShopGetPurchasePhase = function () { return purchase.phase; };
    ctx.RandomShopGetMode        = function () { return state.mode; };
    ctx.RandomShopGetRollSeq     = function () { return _pendingRollSeq || 0; };
    ctx.RandomShopTryRestorePending = function () { return tryRestorePendingRoll('api'); };
    ctx.RandomShopGetPendingRoll = function () {
        if (state.mode === 'rolled' && state.itemClass) {
            return {
                cls: state.itemClass,
                tier: state.itemTier,
                listId: state.itemListId,
                itemType: state.itemType,
                name: getItemName(state.itemClass, state.itemListId),
                seq: _pendingRollSeq || 0
            };
        }
        return readPendingRoll();
    };

    function cancelSlotsFullRoll(root) {
        $.Msg('[RandomShop] Slots full - canceling roll');
        RandomShopCancelRoll('slots_full');
        var buildPanel = root.FindChildTraverse('ShopModsSelectedBuild');
        if (buildPanel && buildPanel.IsValid()) {
            try { $.DispatchEvent('Cancelled',      buildPanel); } catch (e) {}
            try { $.DispatchEvent('PopupDismissed', buildPanel); } catch (e) {}
        }
        var msg = root.FindChildTraverse('RSNoItemsMsg');
        if (msg) msg.text = 'All slots full - sell an item first!';
        emitShopError({ reason: 'slots_full' });
    }

    function watchReplacementDialog() {
        var root = $.GetContextPanel();
        if (root.BHasClass('gEditingBuilds') && state.mode === 'rolled') cancelSlotsFullRoll(root);
        $.Schedule(state.mode === 'rolled' ? 0 : 0.1, watchReplacementDialog);
    }

    $.Msg('[RandomShop] loaded (vote force-roll + quiet wait)');
    scheduleAffordabilityUpdate();
    watchReplacementDialog();
    watchNativeTabActivation();
    watchShopOpen();
    // Script/HUD may reboot after a roll while shop was closed — restore immediately.
    tryRestorePendingRoll('boot');

})();
