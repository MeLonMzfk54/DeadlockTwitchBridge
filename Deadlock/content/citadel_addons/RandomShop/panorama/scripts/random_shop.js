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
        'upgrade_health', 'healthSstealingBullets', 'endurance', 'improvedStamina',
        'bulletShield', 'stimPak', 'lifestrikeGauntlets', 'parryRebuttal', 'sprintBooster',
        'healthStealingBullets', 'debuffReducer', 'techArmorPulse', 'cardioCalibrator',
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

    var _enabledLists = { 'ShopModsListWeapon': true, 'ShopModsListArmor': true, 'ShopModsListTech': true };
    var LIST_FILTER_IDS   = { 'ShopModsListWeapon': 'RSFilterWeapon', 'ShopModsListArmor': 'RSFilterArmor', 'ShopModsListTech': 'RSFilterTech' };
    var CATEGORY_NAMES    = { 'ShopModsListWeapon': 'Weapon', 'ShopModsListArmor': 'Vitality', 'ShopModsListTech': 'Spirit' };

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
    function snapshotShowingClasses(root) {
        _activatedWithShowing = [];
        for (var i = 0; i < ALL_SHOWING.length; i++) {
            if (root.BHasClass(ALL_SHOWING[i])) _activatedWithShowing.push(ALL_SHOWING[i]);
        }
    }

    function ActivateRandomTab() {
        var root = $.GetContextPanel();
        snapshotShowingClasses(root);
        root.AddClass('gShowingRandom');
        updateAffordability();
        $.Msg('[RandomShop] Random tab activated');
    }

    function DeactivateRandomTab() {
        var root = $.GetContextPanel();
        if (!root.BHasClass('gShowingRandom')) return;
        root.RemoveClass('gShowingRandom');
        if (state.mode === 'rolled') {
            state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
            setMode('idle');
            var msg = root.FindChildTraverse('RSNoItemsMsg');
            if (msg) msg.text = '';
            var status = root.FindChildTraverse('RSPurchaseStatus');
            if (status) status.text = '';
        }
        $.Msg('[RandomShop] Random tab deactivated');
    }

    // Poll every 50ms: deactivate Random tab only when a NEW showingX class appears
    // (one that was not present when Random was activated). This prevents false
    // triggers from the pre-existing showingX class of the previously active tab.
    function watchNativeTabActivation() {
        if (!_suppressDeactivation) {
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

    function collectItemsForTier(tierNum) {
        var root = $.GetContextPanel(); var result = [];
        for (var li = 0; li < LIST_IDS.length; li++) {
            if (!_enabledLists[LIST_IDS[li]]) continue;
            var list = root.FindChildTraverse(LIST_IDS[li]);
            if (!list || !list.IsValid()) continue;
            for (var ci = 0; ci < ALL_MOD_CLASSES.length; ci++) {
                var icons = list.FindChildrenWithClassTraverse(ALL_MOD_CLASSES[ci]);
                for (var ii = 0; ii < icons.length; ii++) {
                    var icon = icons[ii];
                    if (!icon || !icon.IsValid()) continue;
                    if (icon.BHasClass('owned')) continue;
                    if (icon.BHasClass('usedAsComponent')) continue;
                    if (icon.BHasClass('itemDisabled')) continue;
                    var tier = getTierFromPanel(icon, list);
                    if (tier !== tierNum) continue;
                    var dup = false;
                    for (var di = 0; di < result.length; di++) { if (result[di].icon === icon) { dup = true; break; } }
                    if (!dup) result.push({ icon: icon, type: getItemType(icon), cls: ALL_MOD_CLASSES[ci], listId: LIST_IDS[li] });
                }
            }
        }
        return result;
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
                    $.Msg('[RandomShop] GoldAP nums=' + nums.join(','));
                    // Souls are at index 2 in GoldAPContainer's label list.
                    var souls = nums.length > 2 ? nums[2] : nums[0];
                    $.Msg('[RandomShop] getSouls GoldAP=' + souls);
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
                    $.Msg('[RandomShop] getSouls SoulAmount(fallback)=' + nums2[0]);
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

    function updateRolledDisplay() {
        var root = $.GetContextPanel();
        var wrapper = root.FindChildTraverse('RSBigIconWrapper');
        if (wrapper) {
            for (var ci = 0; ci < ALL_MOD_CLASSES.length; ci++) wrapper.RemoveClass(ALL_MOD_CLASSES[ci] + '-style');
            for (var li = 0; li < LIST_IDS.length; li++) wrapper.RemoveClass(LIST_IDS[li]);
            if (state.itemClass) wrapper.AddClass(state.itemClass + '-style');
            if (state.itemListId) wrapper.AddClass(state.itemListId);
        }
        var nameLabel = root.FindChildTraverse('RSItemName');
        if (nameLabel) nameLabel.text = getItemName(state.itemClass, state.itemListId);
        var tierLabel = root.FindChildTraverse('RSItemTier');
        if (tierLabel) {
            tierLabel.text = 'Tier ' + state.itemTier;
            for (var t = 1; t <= 4; t++) tierLabel.RemoveClass('rs-tier' + t);
            tierLabel.AddClass('rs-tier' + state.itemTier);
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

    function triggerPurchase() {
        var shopMod = findItemShopModPanel();
        if (shopMod && shopMod.IsValid()) {
            $.Msg('[RandomShop] Triggering purchase id=' + (shopMod.id || '?') + ' type=' + shopMod.paneltype);
            try { shopMod.SetFocus(); } catch (e) {}
            try { shopMod.SetInputFocus(); } catch (e) {}
            try { $.DispatchEvent('Activated',             shopMod, 'mouse'); } catch (e) {}
            try { $.DispatchEvent('PanelActivated',        shopMod);          } catch (e) {}
            try { $.DispatchEvent('MouseButtonActivate',   shopMod, 0);       } catch (e) {}
            try { $.DispatchEvent('UIEvent.MouseActivate', shopMod);          } catch (e) {}
        } else {
            $.Msg('[RandomShop] triggerPurchase: panel not found for cls=' + state.itemClass + ' list=' + state.itemListId);
        }
        if (state.itemType) {
            try { $.DispatchEvent('CitadelShopPurchaseMod', state.itemType); } catch (e) {}
            try { $.DispatchEvent('CitadelPurchaseItem',    state.itemType); } catch (e) {}
            try { $.DispatchEvent('CitadelModPurchase',     state.itemType); } catch (e) {}
        }
    }

    async function monitorPurchase(targetClass, targetTier, targetListId) {
        var deadline = Date.now() + 30000; var purchased = false;
        await _Async.Condition(function () {
            if (Date.now() > deadline) { $.Msg('[RandomShop] timeout 30s'); return true; }
            var root = $.GetContextPanel();
            var list = root.FindChildTraverse(targetListId);
            if (!list || !list.IsValid()) return false;
            var panels = list.FindChildrenWithClassTraverse(targetClass);
            for (var i = 0; i < panels.length; i++) {
                var p = panels[i];
                if (!p || !p.IsValid()) continue;
                if (getTierFromPanel(p, list) !== targetTier) continue;
                if (p.BHasClass('owned')) { purchased = true; return true; }
            }
            return false;
        });
        onItemPurchased(purchased);
    }

    function onItemPurchased(wasPurchased) {
        $.Msg('[RandomShop] ' + (wasPurchased ? 'Purchase confirmed' : 'Timeout'));
        state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
        setMode('idle');
        var root = $.GetContextPanel();
        var msg = root.FindChildTraverse('RSNoItemsMsg');    if (msg) msg.text = '';
        var sts = root.FindChildTraverse('RSPurchaseStatus'); if (sts) sts.text = '';
        scheduleAffordabilityUpdate();
        updateItemAvailability();
    }

    function updateAffordability() {
        var souls = getSouls(); var root = $.GetContextPanel();
        for (var t = 1; t <= 4; t++) {
            var btn = root.FindChildTraverse('RSTier' + t);
            if (!btn || !btn.IsValid()) continue;
            btn.SetHasClass('rs-cant-afford', (souls >= 0) && (souls < (TIER_COSTS[t] || 0)));
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

    function doAutoPurchase(tierNum) {
        var root = $.GetContextPanel();
        var msg  = root.FindChildTraverse('RSNoItemsMsg');
        var cost = TIER_COSTS[tierNum] || 0;
        var souls = getSouls();
        if (souls >= 0 && souls < cost) { if (msg) msg.text = 'Need ' + cost + ' souls (have ' + souls + ')'; return; }
        var items = collectItemsForTier(tierNum);
        if (items.length === 0) { if (msg) msg.text = 'All ' + getEnabledCatString() + ' Tier ' + tierNum + ' items owned!'; return; }
        if (areSlotsFullForItems(items)) { if (msg) msg.text = 'All slots full - sell an item first!'; return; }
        if (msg) msg.text = '';
        var picked = items[Math.floor(Math.random() * items.length)];
        state.itemClass = picked.cls; state.itemTier = tierNum;
        state.itemListId = picked.listId; state.itemType = picked.type;
        $.Msg('[RandomShop] Rolled: cls=' + picked.cls + ' tier=' + tierNum);
        setMode('rolled');
        updateRolledDisplay();
        // gShowingRandom stays active — do NOT dispatch CitadelShopModsActivate here
        // (it would set showingX and trigger the native-tab watcher).
        // Panels are in DOM; triggerPurchase dispatches events directly to them.

        function pollForPurchaseCondition() {
            if (state.mode !== 'rolled') return;
            var r  = $.GetContextPanel();
            var s  = getSouls();
            var c  = TIER_COSTS[state.itemTier] || 0;
            var sl = r.FindChildTraverse('RSPurchaseStatus');
            if ((s < 0) || (s >= c)) {
                if (sl) sl.text = 'Purchasing...';
                navigateToListThenCall(triggerPurchase);
                $.Schedule(1.5, pollForPurchaseCondition);
            } else {
                if (sl) sl.text = 'Waiting for souls... (' + s + '/' + c + ')';
                $.Schedule(0.5, pollForPurchaseCondition);
            }
        }
        $.Schedule(0.25, pollForPurchaseCondition);
        monitorPurchase(picked.cls, tierNum, picked.listId);
    }

    function RandomShopRollTier(tierNum) {
        if (state.mode !== 'idle') return;
        loadAllItemsThenRoll(tierNum, doAutoPurchase);
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
    ctx.RandomShopBuyItem        = function () {};
    ctx.ActivateRandomTab        = ActivateRandomTab;
    ctx.DeactivateRandomTab      = DeactivateRandomTab;
    ctx.RandomShopToggleCategory = RandomShopToggleCategory;

    function cancelSlotsFullRoll(root) {
        $.Msg('[RandomShop] Slots full - canceling roll');
        var buildPanel = root.FindChildTraverse('ShopModsSelectedBuild');
        if (buildPanel && buildPanel.IsValid()) {
            try { $.DispatchEvent('Cancelled',      buildPanel); } catch (e) {}
            try { $.DispatchEvent('PopupDismissed', buildPanel); } catch (e) {}
        }
        state.itemClass = ''; state.itemTier = 0; state.itemListId = ''; state.itemType = 0;
        setMode('idle');
        var msg = root.FindChildTraverse('RSNoItemsMsg');     if (msg) msg.text = 'All slots full - sell an item first!';
        var sts = root.FindChildTraverse('RSPurchaseStatus'); if (sts) sts.text = '';
        scheduleAffordabilityUpdate();
    }

    function watchReplacementDialog() {
        var root = $.GetContextPanel();
        if (root.BHasClass('gEditingBuilds') && state.mode === 'rolled') cancelSlotsFullRoll(root);
        $.Schedule(state.mode === 'rolled' ? 0 : 0.1, watchReplacementDialog);
    }

    $.Msg('[RandomShop] loaded');
    scheduleAffordabilityUpdate();
    watchReplacementDialog();
    watchNativeTabActivation();

})();
