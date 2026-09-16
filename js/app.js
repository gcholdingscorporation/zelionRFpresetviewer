/*
 * Rotorflight Preset Viewer.
 *
 * Loads a `dump all` / `diff all` / preset file and lays its settings out the
 * way the Rotorflight Configurator lays out its tabs. Read-only: it never talks
 * to a flight controller, and it never rewrites a value it was given.
 */

(function () {
    'use strict';

    var S = window.RFSchema;

    var state = {
        parsed: null,
        db: null,
        dbKey: null,
        tab: 'setup',
        profile: 0,
        rateProfile: 0,
        filter: '',
        onlyChanged: false,
        fileName: ''
    };

    // ------------------------------------------------------------ helpers

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) { n.className = cls; }
        if (text !== undefined && text !== null) { n.textContent = String(text); }
        return n;
    }

    function $(sel) { return document.querySelector(sel); }

    function clear(node) {
        while (node.firstChild) { node.removeChild(node.firstChild); }
        return node;
    }

    function dbKeys() {
        return Object.keys(window.RF_DB || {}).sort();
    }

    /* Pick the metadata set matching the firmware that produced the file.
     * Falls back to the newest available, which is still useful: names that
     * moved between releases simply show up as unrecognised. */
    function chooseDb(version) {
        var keys = dbKeys();
        if (!keys.length) { return null; }
        if (version) {
            var mm = /^(\d+)\.(\d+)/.exec(version);
            if (mm) {
                var want = mm[1] + '.' + mm[2];
                if (keys.indexOf(want) !== -1) { return want; }
                // Nearest older release, otherwise the oldest we have.
                var older = keys.filter(function (k) { return k <= want; });
                if (older.length) { return older[older.length - 1]; }
                return keys[0];
            }
        }
        return keys[keys.length - 1];
    }

    function meta(name) {
        return state.db && state.db.settings[name] ? state.db.settings[name] : null;
    }

    /* Some settings are stored in tenths and shown scaled: the CLI prints
     * `gov_spoolup_time = 300` where the Configurator shows `30.0 s`. The
     * factors are extracted from the Configurator's own bindings, per firmware,
     * because a few of them changed between releases. */
    function scaleFor(name) {
        var table = (window.RF_SCALES || {})[state.dbKey];
        return (table && table[name]) || 1;
    }

    /* Apply a setting's display scale, keeping the decimals the factor implies
     * so a tenth reads as "5.0" rather than "5". */
    function scaled(value, name) {
        var factor = scaleFor(name);
        if (factor === 1 || typeof value !== 'number') { return value; }
        var places = String(factor).length - 1;
        return (value / factor).toFixed(places);
    }

    function lut(m) {
        if (!m || !m.lut || !state.db.luts) { return null; }
        return state.db.luts[m.lut] || null;
    }

    /* The CLI prints enum settings by name, so a default stored as an index has
     * to be mapped through the same table before the two can be compared. */
    function defaultDisplay(name) {
        var m = meta(name);
        if (!m || m.d === undefined) { return null; }
        var table = lut(m);
        if (table && typeof m.d === 'number' && table[m.d] !== undefined) {
            return table[m.d];
        }
        if (Array.isArray(m.d)) {
            return m.d.map(function (v) { return scaled(v, name); }).join(',');
        }
        return String(scaled(m.d, name));
    }

    function valueDisplay(entry, name) {
        if (!entry) { return null; }
        if (Array.isArray(entry.value)) {
            return entry.value.map(function (v) { return scaled(v, name); }).join(',');
        }
        return String(scaled(entry.value, name));
    }

    function lookupSection(scope, index) {
        if (!state.parsed) { return null; }
        if (scope === 'profile') { return state.parsed.profiles[index] || null; }
        if (scope === 'rateprofile') { return state.parsed.rateProfiles[index] || null; }
        return state.parsed.master;
    }

    function entryFor(name, scope, index) {
        var section = lookupSection(scope, index);
        return section && section[name] ? section[name] : null;
    }

    function scopeOf(name) {
        var m = meta(name);
        return m ? m.s : 'master';
    }

    function matchesFilter(name, label) {
        if (!state.filter) { return true; }
        var f = state.filter.toLowerCase();
        return name.toLowerCase().indexOf(f) !== -1 ||
               label.toLowerCase().indexOf(f) !== -1;
    }

    // --------------------------------------------------------- row builder

    /* The read-only control a value is shown in. The Configurator puts every
     * setting in a real widget rather than in text, and which widget it is says
     * something about the setting, so the viewer picks the same way: a dropdown
     * for an enum, a checkbox for a switch, a number box for the rest. */
    function controlFor(name, m, shown) {
        if (shown === null || shown === undefined) {
            var none = el('input', 'value');
            none.type = 'text';
            none.value = '—';
            none.disabled = true;
            return none;
        }

        /* An on/off enum is a switch in the Configurator, not a dropdown, so
         * this is tested before the general enum case. */
        if (shown === 'ON' || shown === 'OFF') {
            var sw = el('div', 'switch' + (shown === 'ON' ? ' on' : ''));
            sw.setAttribute('role', 'img');
            sw.setAttribute('aria-label', shown);
            sw.title = shown;
            return sw;
        }

        if (m && m.lut && isNaN(Number(shown))) {
            var sel = el('select', 'value');
            sel.appendChild(el('option', null, shown));
            sel.disabled = true;
            return sel;
        }

        var input = el('input', 'value' + (String(shown).length > 12 ? ' wide' : ''));
        input.type = 'text';
        input.value = shown;
        input.disabled = true;
        return input;
    }

    /* One setting, as a Configurator settings row: the control in the first
     * cell, the label in the second, then what the file changed it from and a
     * help icon. `present` is the parsed entry, or null when the file left the
     * setting at its default - the normal case in a `diff`. */
    function settingRow(name, present) {
        var m = meta(name);
        var label = S.prettify(name);
        if (!matchesFilter(name, label)) { return null; }

        var shown = present ? valueDisplay(present, name) : defaultDisplay(name);
        var def = defaultDisplay(name);
        var known = !!m;
        var changed = !!present && def !== null && shown !== def;

        if (state.onlyChanged && !changed) { return null; }

        var row = el('tr', changed ? 'is-changed' : null);

        var control = el('td', 'control');
        control.appendChild(controlFor(name, m, shown));
        row.appendChild(control);

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(label));
        var unit = known ? S.unitFor(name) : '';
        if (unit) { lab.appendChild(el('span', 'units', '[' + unit + ']')); }
        lab.appendChild(el('span', 'cli-name', name));
        row.appendChild(lab);

        var was = el('td', 'was');
        if (!known) {
            was.textContent = 'not in metadata';
        } else if (def === null) {
            was.textContent = 'default ?';
        } else if (changed) {
            was.textContent = 'was ' + def;
        }
        row.appendChild(was);

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = rowTooltip(name, m, present);
        help.appendChild(icon);
        row.appendChild(help);

        return row;
    }

    function rowTooltip(name, m, present) {
        var bits = [name];
        if (m) {
            bits.push('scope: ' + m.s);
            bits.push('type: ' + m.t);
            if (m.m === 'lookup') {
                var t = lut(m);
                if (t) { bits.push('values: ' + t.join(', ')); }
            } else if (m.min !== undefined && m.max !== undefined) {
                bits.push('range: ' + m.min + ' .. ' + m.max);
            }
            if (m.d !== undefined) {
                bits.push('default: ' + defaultDisplay(name) +
                    (m.di ? ' (implicit - the firmware zeroes this group and its ' +
                            'reset block never sets this field)' : ''));
            } else {
                bits.push('default: not derivable from the firmware source');
            }
            if (m.pg) { bits.push(m.pg); }
        } else {
            bits.push('not present in the bundled firmware metadata');
        }
        if (name === 'telemetry_sensors' && present && Array.isArray(present.value)) {
            var sensors = extras('telemSensors');
            bits.push('slots: ' + present.value.filter(function (v) { return v; })
                .map(function (v) { return sensors[v] || ('id ' + v); }).join(', '));
        }
        if (present) { bits.push('file line ' + present.line); }
        return bits.join('\n');
    }

    function panel(title, hint) {
        var box = el('div', 'gui_box');
        var bar = el('div', 'gui_box_titlebar');
        bar.appendChild(el('div', 'spacer_box_title', title));
        bar.appendChild(el('div', 'grow'));
        if (hint) { bar.appendChild(el('div', 'hint', hint)); }
        box.appendChild(bar);
        box.appendChild(el('div', 'spacer_box'));
        return box;
    }

    /* The box's free-form area, for the panels that hold a table of their own. */
    function panelBody(box) { return box.lastChild; }

    /* The box's settings table. Rows put the control on the left and the label
     * on the right, which is how a Configurator settings row is built. */
    function settingsTable(box) {
        var body = panelBody(box);
        if (!body.firstChild) {
            var table = el('table', 'settings_table');
            table.appendChild(el('tbody'));
            body.appendChild(table);
        }
        return body.firstChild.firstChild;
    }

    // ------------------------------------------------------ tab inventory

    /* Every setting name the viewer knows about or the file mentions, grouped by
     * the tab it belongs to. Names the metadata does not know still land
     * somewhere (the "All settings" tab) rather than disappearing. */
    function buildIndex() {
        var byTab = {};
        var claimed = {};

        S.TABS.forEach(function (t) { byTab[t.id] = { sections: [], names: {} }; });

        function add(tab, name) {
            if (!byTab[tab]) { return; }
            byTab[tab].names[name] = true;
        }

        if (state.db) {
            Object.keys(state.db.settings).forEach(function (name) {
                add(S.tabFor(name, state.db.settings[name]), name);
            });
        }
        // Names from the file that the metadata does not cover.
        (state.parsed ? state.parsed.allSettings() : []).forEach(function (s) {
            if (!meta(s.name)) { add('all', s.name); }
        });

        S.SECTIONS.forEach(function (sec) {
            sec.names.forEach(function (n) { claimed[n] = true; });
        });

        return { byTab: byTab, claimed: claimed };
    }

    var INDEX = null;

    /* Settings on a tab that no curated panel picked up, grouped by their
     * firmware parameter group so the leftovers stay organised. */
    /* Every CLI setting a transcribed layout already puts on the page, so the
     * generic renderer does not show it a second time with a raw value. */
    function layoutNames(tabId) {
        var layout = (window.RF_LAYOUT || {})[tabId];
        var out = {};
        if (!layout) { return out; }
        function walk(specs) {
            specs.forEach(function (spec) {
                if (spec.rows) { walk(spec.rows); }
                if (spec.cli) { out[spec.cli] = true; }
                /* A derived row names the line it read in `from`; when that is
                 * a setting, the layout has accounted for it too. */
                if (spec.from && /^[a-z0-9_]+$/.test(spec.from)) { out[spec.from] = true; }
                if (spec.ratio) { out[spec.ratio] = true; }
            });
        }
        layout.boxes.forEach(function (box) { walk(box.rows); });
        if (layout.matrix) {
            layout.matrix.axes.forEach(function (axis) {
                layout.matrix.terms.forEach(function (term) {
                    out[axis.toLowerCase() + '_' + term.key + '_gain'] = true;
                });
            });
        }
        return out;
    }

    function leftoverGroups(tabId, skip) {
        var names = Object.keys(INDEX.byTab[tabId] ? INDEX.byTab[tabId].names : {});
        var groups = {};
        names.forEach(function (n) {
            if (INDEX.claimed[n] && !(skip && skip.sections)) { return; }
            if (skip && skip.names[n]) { return; }
            var m = meta(n);
            var key = m && m.pg ? m.pg : 'UNKNOWN';
            (groups[key] || (groups[key] = [])).push(n);
        });
        return Object.keys(groups).sort().map(function (k) {
            return { pg: k, names: groups[k].sort() };
        });
    }

    // ----------------------------------------------------- generic tab render

    function renderSettingsTab(tabId, opts) {
        opts = opts || {};
        var frag = document.createDocumentFragment();

        var scope = opts.scope || 'master';
        var index = scope === 'profile' ? state.profile
                  : scope === 'rateprofile' ? state.rateProfile : null;

        if (scope !== 'master') { frag.appendChild(profileBar(scope)); }

        var grid = el('div', 'columns');
        var rendered = 0;
        var seen = {};

        var skip = opts.skip ? { names: opts.skip, sections: true } : null;

        (skip ? [] : S.SECTIONS.filter(function (s) { return s.tab === tabId; })).forEach(function (sec) {
            var secScope = sec.profileScope ? 'profile'
                         : sec.rateScope ? 'rateprofile' : 'master';
            var secIndex = secScope === 'profile' ? state.profile
                         : secScope === 'rateprofile' ? state.rateProfile : null;

            var box = panel(sec.title, secScope === 'master' ? '' :
                (secScope === 'profile' ? 'profile ' + secIndex : 'rateprofile ' + secIndex));
            var body = settingsTable(box);
            var n = 0;
            sec.names.forEach(function (name) {
                if (seen[name]) { return; }
                if (!meta(name) && !entryFor(name, secScope, secIndex)) { return; }
                seen[name] = true;
                var row = settingRow(name, entryFor(name, secScope, secIndex));
                if (row) { body.appendChild(row); n++; }
            });
            if (n) { grid.appendChild(box); rendered += n; }
        });

        leftoverGroups(tabId, skip).forEach(function (g) {
            var box = panel(S.pgTitle(g.pg), opts.hint !== undefined ? opts.hint
                : (g.pg === 'UNKNOWN' ? 'unrecognised' : ''));
            var body = settingsTable(box);
            var n = 0;
            g.names.forEach(function (name) {
                var m = meta(name);
                var gScope = m ? m.s : 'master';
                var gIndex = gScope === 'profile' ? state.profile
                           : gScope === 'rateprofile' ? state.rateProfile : null;
                var row = settingRow(name, entryFor(name, gScope, gIndex));
                if (row) { body.appendChild(row); n++; }
            });
            if (n) { grid.appendChild(box); rendered += n; }
        });

        frag.appendChild(grid);
        if (!rendered && !opts.quiet) {
            frag.appendChild(el('div', 'empty-note', emptyMessage()));
        }
        return frag;
    }

    function emptyMessage() {
        if (state.filter) { return 'Nothing on this tab matches "' + state.filter + '".'; }
        if (state.onlyChanged) { return 'Every setting on this tab is at its firmware default.'; }
        return 'No settings on this tab.';
    }

    function profileBar(kind) {
        var bar = el('div', 'tab-container');
        var isRate = kind === 'rateprofile';

        var sections = isRate ? state.parsed.rateProfiles : state.parsed.profiles;
        var active = isRate ? state.parsed.activeRateProfile : state.parsed.activeProfile;
        var current = isRate ? state.rateProfile : state.profile;

        for (var i = 0; i < 6; i++) {
            (function (n) {
                var has = sections[n] && Object.keys(sections[n]).length;
                var p = el('div', (n === current ? 'active' : '') +
                    (has ? '' : ' dim'));
                p.appendChild(document.createTextNode(
                    (isRate ? 'Rate #' : 'Profile #') + (n + 1)));
                if (n === active) { p.appendChild(el('span', 'tag', 'selected')); }
                p.title = has ? (Object.keys(sections[n]).length + ' values in file')
                              : 'no values in file (all at default)';
                p.onclick = function () {
                    if (isRate) { state.rateProfile = n; } else { state.profile = n; }
                    render();
                };
                bar.appendChild(p);
            }(i));
        }
        return bar;
    }

    // ------------------------------------------------------- table helpers

    function table(headers, rows, opts) {
        opts = opts || {};
        var wrap = el('div', 'tablewrap');
        var t = el('table', 'rf');
        var thead = el('thead');
        var tr = el('tr');
        headers.forEach(function (h) { tr.appendChild(el('th', null, h)); });
        thead.appendChild(tr);
        t.appendChild(thead);
        var tb = el('tbody');
        rows.forEach(function (cells) {
            var r = el('tr');
            cells.forEach(function (c) {
                if (c && typeof c === 'object' && !(c instanceof Node)) {
                    r.appendChild(el('td', c.cls || null, c.text));
                } else if (c instanceof Node) {
                    var td = el('td');
                    td.appendChild(c);
                    r.appendChild(td);
                } else {
                    r.appendChild(el('td', null, c === null || c === undefined ? '—' : c));
                }
            });
            tb.appendChild(r);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        if (opts.empty && !rows.length) {
            wrap.appendChild(el('div', 'empty-note', opts.empty));
        }
        return wrap;
    }

    function extras(key) {
        return (state.db && state.db.extras && state.db.extras[key]) || {};
    }

    function rows(kind) {
        return (state.parsed && state.parsed.rows[kind]) || [];
    }

    // ------------------------------------------------------------ setup tab

    function renderSetup() {
        var p = state.parsed;
        var frag = document.createDocumentFragment();
        var grid = el('div', 'columns');

        var fw = panel('Firmware');
        var fwb = settingsTable(fw);
        [['File', state.fileName || '(pasted text)'],
         ['Content', p.kind === 'diff' ? 'diff all (only non-default values)'
                    : p.kind === 'dump' ? 'dump all (complete configuration)'
                    : 'preset / partial CLI snippet'],
         ['Firmware', p.header.firmware || '—'],
         ['Version', p.header.version || '—'],
         ['Build date', p.header.buildDate || '—'],
         ['Git hash', p.header.gitHash || '—'],
         ['MSP API', p.header.mspApi || '—'],
         ['Metadata used', state.dbKey ? 'Rotorflight ' + state.dbKey : 'none']
        ].forEach(function (kv) { fwb.appendChild(infoRow(kv[0], kv[1])); });
        grid.appendChild(fw);

        var bd = panel('Board');
        var bdb = settingsTable(bd);
        [['Craft name', p.header.craftName || (p.master.name && p.master.name.raw) || '—'],
         ['Target', p.header.mcuTarget || '—'],
         ['Board name', p.header.board_name || '—'],
         ['Board design', p.header.board_design || '—'],
         ['Manufacturer', p.header.manufacturer_id || '—'],
         ['MCU ID', p.header.mcu_id || '—'],
         ['Signature', p.header.signature || '(none)']
        ].forEach(function (kv) { bdb.appendChild(infoRow(kv[0], kv[1])); });
        grid.appendChild(bd);

        var ft = panel('Features', p.features.length + ' changed');
        var ftb = settingsTable(ft);
        if (!p.features.length) {
            ftb.appendChild(el('div', 'empty-note', 'No feature changes in this file.'));
        } else {
            p.features.forEach(function (f) {
                var row = el('tr');
                var control = el('td', 'control');
                var sw = el('div', 'switch' + (f.enabled ? ' on' : ''));
                sw.title = f.enabled ? 'enabled' : 'disabled';
                control.appendChild(sw);
                row.appendChild(control);
                row.appendChild(el('td', 'label', f.name));
                ftb.appendChild(row);
            });
        }
        grid.appendChild(ft);

        var st = panel('Contents');
        var stb = settingsTable(st);
        var profileCount = Object.keys(p.profiles).length;
        var rateCount = Object.keys(p.rateProfiles).length;
        [['set statements', p.setCount],
         ['Master values', Object.keys(p.master).length],
         ['PID profiles present', profileCount],
         ['Rate profiles present', rateCount],
         ['Selected PID profile', p.activeProfile === null ? '—' : p.activeProfile],
         ['Selected rate profile', p.activeRateProfile === null ? '—' : p.activeRateProfile],
         ['Servos', rows('servo').length],
         ['Mixer inputs', rows('mixerInput').length],
         ['Mixer rules', rows('mixerRule').length],
         ['Mode (aux) slots used', rows('aux').filter(auxInUse).length],
         ['Adjustments used', rows('adjfunc').filter(function (a) { return a.func; }).length],
         ['Unrecognised lines', p.unknown.length]
        ].forEach(function (kv) { stb.appendChild(infoRow(kv[0], kv[1])); });
        grid.appendChild(st);

        frag.appendChild(grid);
        return frag;
    }

    function infoRow(label, value) {
        var row = el('tr');
        var control = el('td', 'control');
        var input = el('input', 'value wide');
        input.type = 'text';
        input.value = value === null || value === undefined ? '—' : String(value);
        input.disabled = true;
        control.appendChild(input);
        row.appendChild(control);
        row.appendChild(el('td', 'label', label));
        return row;
    }

    // ------------------------------------------------------------ ports tab

    function decodeFunctions(mask) {
        var names = extras('serialFunctions');
        if (!mask) { return ['—']; }
        var out = [];
        Object.keys(names).forEach(function (bit) {
            if (mask & Number(bit)) { out.push(names[bit]); }
        });
        // Report any bits the table did not explain rather than hiding them.
        var explained = Object.keys(names).reduce(function (a, b) {
            return (mask & Number(b)) ? a | Number(b) : a;
        }, 0);
        if (mask & ~explained) { out.push('0x' + (mask & ~explained).toString(16)); }
        return out.length ? out : [String(mask)];
    }

    function baud(v) { return v === 0 ? 'auto' : v; }

    function renderPorts() {
        var frag = document.createDocumentFragment();
        var box = panel('Serial Ports', rows('serial').length + ' configured');
        panelBody(box).appendChild(table(
            ['Port', 'Functions', 'Mask', 'MSP', 'GPS', 'Telemetry', 'Blackbox'],
            rows('serial').map(function (s) {
                return [
                    { text: 'UART' + (s.id + 1) + '  (id ' + s.id + ')', cls: 'name' },
                    { text: decodeFunctions(s.functions).join(', '), cls: 'name' },
                    { text: s.functions, cls: 'dim' },
                    baud(s.mspBaud), baud(s.gpsBaud),
                    baud(s.telemetryBaud), baud(s.blackboxBaud)
                ];
            }),
            { empty: 'No serial port lines in this file (all ports at their defaults).' }));
        frag.appendChild(box);

        var settings = renderSettingsTab('ports', { quiet: true });
        frag.appendChild(settings);
        return frag;
    }

    // ------------------------------------------------------------ modes tab

    /* `aux` and `adjfunc` do not store an RC channel number: they store an index
     * past the control channels, read as rcInput[index + CONTROL_CHANNEL_COUNT]
     * (src/main/fc/rc_modes.h), so index 0 is the first aux channel. */
    function channelName(i) {
        var base = state.db && state.db.extras &&
                   state.db.extras.controlChannelCount !== undefined
            ? state.db.extras.controlChannelCount : 5;
        return 'AUX' + (i + 1) + ' (ch' + (i + base + 1) + ')';
    }

    /* Rotorflight stores an unused mode slot as mode 0 over a 900-900 range,
     * which is indistinguishable from "ARM, never active". */
    function auxInUse(a) {
        return a.mode !== 0 || (a.start !== a.end && a.start !== 900);
    }

    function renderModes() {
        var frag = document.createDocumentFragment();
        var boxes = extras('boxes');
        var used = rows('aux').filter(auxInUse);

        var box = panel('Mode Ranges', used.length + ' of ' + rows('aux').length + ' slots in use');
        panelBody(box).appendChild(table(
            ['Slot', 'Mode', 'Channel', 'Range', 'Logic', 'Linked to'],
            used.map(function (a) {
                return [
                    { text: a.slot, cls: 'name' },
                    { text: boxes[a.mode] || ('id ' + a.mode), cls: 'name' },
                    channelName(a.channel),
                    a.start + ' – ' + a.end,
                    a.logic ? 'OR' : 'AND',
                    a.linkedTo ? (boxes[a.linkedTo] || a.linkedTo) : '—'
                ];
            }),
            { empty: 'No mode ranges are configured in this file.' }));
        frag.appendChild(box);

        if (rows('aux').length && used.length < rows('aux').length) {
            frag.appendChild(el('div', 'note',
                (rows('aux').length - used.length) + ' further aux slots are present but ' +
                'empty (mode 0 with a 900–900 range), which is how Rotorflight stores an ' +
                'unused slot.'));
        }

        frag.appendChild(renderSettingsTab('modes', { quiet: true }));
        return frag;
    }

    // ------------------------------------------------------ adjustments tab

    function renderAdjustments() {
        var frag = document.createDocumentFragment();
        var funcs = extras('adjfuncs');
        var used = rows('adjfunc').filter(function (a) { return a.func; });

        var box = panel('Adjustment Functions',
            used.length + ' of ' + rows('adjfunc').length + ' slots in use');
        panelBody(box).appendChild(table(
            ['Slot', 'Function', 'Enable ch', 'Enable range', 'Adjust ch',
             'Range 1', 'Range 2', 'Step', 'Min', 'Max'],
            used.map(function (a) {
                return [
                    { text: a.slot, cls: 'name' },
                    { text: funcs[a.func] || ('id ' + a.func), cls: 'name' },
                    a.enaChannel === 255 ? 'always' : channelName(a.enaChannel),
                    a.enaStart + ' – ' + a.enaEnd,
                    a.adjChannel === 255 ? '—' : channelName(a.adjChannel),
                    a.adj1Start + ' – ' + a.adj1End,
                    a.adj2Start + ' – ' + a.adj2End,
                    a.step, a.min, a.max
                ];
            }),
            { empty: 'No adjustment functions are configured in this file.' }));
        frag.appendChild(box);
        frag.appendChild(renderSettingsTab('adjustments', { quiet: true }));
        return frag;
    }

    // ----------------------------------------------------------- servos tab

    /* The Configurator's Servo Configuration table, from src/tabs/servos.html.
     * The CLI prints the last field as one number; the Configurator splits it
     * into the two switches it actually is (src/js/tabs/servos.js). */
    var SERVO_FLAG_REVERSE = 1;
    var SERVO_FLAG_GEOCOR = 2;

    function flagSwitch(on) {
        var sw = el('div', 'switch' + (on ? ' on' : ''));
        sw.setAttribute('role', 'img');
        sw.setAttribute('aria-label', on ? 'on' : 'off');
        sw.title = on ? 'on' : 'off';
        return sw;
    }

    function renderServos() {
        var frag = document.createDocumentFragment();
        var servos = rows('servo');
        var box = panel('Servo Configuration', servos.length + ' configured');
        panelBody(box).appendChild(table(
            ['Servo', 'Center', 'Min', 'Max', 'Scale neg', 'Scale pos',
             'Rate [Hz]', 'Speed [ms]', 'Reverse', 'Geo cor'],
            servos.map(function (s) {
                var flags = Number(s.flags) || 0;
                return [
                    { text: '#' + s.index, cls: 'name' },
                    s.mid, s.min, s.max, s.rneg, s.rpos, s.rate, s.speed,
                    flagSwitch(flags & SERVO_FLAG_REVERSE),
                    flagSwitch(flags & SERVO_FLAG_GEOCOR)
                ];
            }),
            { empty: 'No servo lines in this file (all servos at their defaults).' }));
        frag.appendChild(box);
        frag.appendChild(el('div', 'note',
            'Center, min and max are in the firmware\'s servo units, as the CLI prints them ' +
            '(<code>servo &lt;n&gt; &lt;mid&gt; &lt;min&gt; &lt;max&gt; &lt;rneg&gt; ' +
            '&lt;rpos&gt; &lt;rate&gt; &lt;speed&gt; &lt;flags&gt;</code>); the Configurator ' +
            'shows the same numbers. Reverse and Geo cor are bits 0 and 1 of the flags field.'));
        frag.appendChild(renderSettingsTab('servos', { quiet: true }));
        return frag;
    }

    // ------------------------------------------------------------- rates tab
    //
    // Two grids, oriented differently: the rates themselves are one row per
    // axis, the dynamics one row per setting. Both come from src/tabs/rates.html
    // and the scaling from src/js/tabs/rates.js - see RF_RATES.

    var RATE_AXES = ['ROLL', 'PITCH', 'YAW', 'COLLECTIVE'];

    function rateProfileValue(name, index) {
        var present = entryFor(name, 'rateprofile', index);
        if (present) { return present.value; }
        var m = meta(name);
        return m && m.d !== undefined ? m.d : null;
    }

    function ratesType(index) {
        var value = rateProfileValue('rates_type', index);
        return lutIndexOf(meta('rates_type'), value);
    }

    function show(value, pair) {
        if (value === null || value === undefined || isNaN(Number(value))) { return null; }
        return (Number(value) * pair[0]).toFixed(pair[1]);
    }

    /* Max Vel is the rate curve evaluated at full stick. Only the two curves
     * that reduce to a closed form at that point are ported; for the rest the
     * column is left blank rather than filled with a guess. */
    function maxVel(kind, rate, srate) {
        if (rate === null) { return null; }
        if (kind === 'raceflight') { return Number(rate) * (1 + Number(srate) / 100); }
        if (kind === 'rotorflight') { return Number(rate); }
        return null;
    }

    function rateCell(text, title) {
        var cell = el('td', 'pid_data');
        var input = el('input', 'value');
        input.type = 'text';
        input.value = text === null || text === undefined ? '—' : text;
        input.disabled = true;
        if (title) { input.title = title; }
        cell.appendChild(input);
        return cell;
    }

    function ratesGrid(index) {
        var type = ratesType(index);
        var spec = (window.RF_RATES || {}).byType[type];
        if (!spec) { return null; }

        var box = panel('Rates', 'rate profile ' + index);
        var table = el('table', 'pid_table');
        var head = el('tr', 'pid_titlebar');
        head.appendChild(el('th', null, 'Rates'));
        spec.labels.forEach(function (l) { head.appendChild(el('th', null, l)); });
        head.appendChild(el('th', null, 'Max Vel [°/s]'));
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);

        var body = el('tbody');
        RATE_AXES.forEach(function (axis) {
            var key = axis.toLowerCase();
            var coll = key === 'collective';
            var row = el('tr', axis);
            row.appendChild(el('td', 'axis_title', axis));

            var rate = rateProfileValue(key + '_rc_rate', index);
            var srate = rateProfileValue(key + '_srate', index);
            var expo = rateProfileValue(key + '_expo', index);

            var shownRate = show(rate, coll ? spec.coll_rate : spec.rate);
            row.appendChild(rateCell(shownRate, key + '_rc_rate = ' + rate));
            row.appendChild(rateCell(show(srate, coll ? spec.coll_srate : spec.srate),
                key + '_srate = ' + srate));
            row.appendChild(rateCell(show(expo, coll ? spec.coll_expo : spec.expo),
                key + '_expo = ' + expo));

            var vel = maxVel(spec.maxVel, shownRate, show(srate, coll ? spec.coll_srate : spec.srate));
            row.appendChild(rateCell(vel === null ? null : vel.toFixed(coll ? 1 : 0),
                'The rate curve at full stick.'));
            body.appendChild(row);
        });
        table.appendChild(body);
        panelBody(box).appendChild(table);
        return box;
    }

    var DYNAMICS_ROWS = [
        { label: 'Response Time [ms]', per: '%_response' },
        { label: 'Setpoint Boost Gain', array: 'setpoint_boost_gain' },
        { label: 'Setpoint Boost Cutoff', array: 'setpoint_boost_cutoff' },
        { label: 'Dynamic Ceiling Gain', yaw: 'yaw_dynamic_ceiling_gain' },
        { label: 'Dynamic Deadband Gain', yaw: 'yaw_dynamic_deadband_gain' },
        { label: 'Dynamic Deadband Filter [Hz]', yaw: 'yaw_dynamic_deadband_filter', div: 10 }
    ];

    function dynamicsGrid(index) {
        var box = panel('Dynamics', 'rate profile ' + index);
        var table = el('table', 'pid_table');
        var head = el('tr', 'pid_titlebar');
        head.appendChild(el('th', null, 'Dynamics'));
        RATE_AXES.forEach(function (a) { head.appendChild(el('th', null, a)); });
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);

        var body = el('tbody');
        var shown = 0;
        DYNAMICS_ROWS.forEach(function (spec) {
            var row = el('tr');
            row.appendChild(el('td', 'axis_title', spec.label));
            var got = false;
            RATE_AXES.forEach(function (axis, i) {
                var key = axis.toLowerCase();
                var value = null, name = null;
                if (spec.per) {
                    name = spec.per.replace('%', key);
                    if (meta(name)) { value = rateProfileValue(name, index); }
                } else if (spec.array) {
                    name = spec.array;
                    var all = rateProfileValue(spec.array, index);
                    if (Array.isArray(all)) { value = all[i]; }
                } else if (spec.yaw && axis === 'YAW') {
                    name = spec.yaw;
                    if (meta(name)) { value = rateProfileValue(name, index); }
                }
                if (value === null || value === undefined) { row.appendChild(el('td', 'pid_data')); return; }
                got = true;
                var text = spec.div ? (Number(value) / spec.div).toFixed(1) : String(value);
                row.appendChild(rateCell(text, name + ' = ' + value));
            });
            if (got) { body.appendChild(row); shown++; }
        });
        table.appendChild(body);
        panelBody(box).appendChild(table);
        return shown ? box : null;
    }

    function renderRates() {
        var frag = document.createDocumentFragment();
        var index = state.rateProfile;
        frag.appendChild(profileBar('rateprofile'));

        var grid = el('div', 'columns');

        var typeBox = panel('Rates Type', 'rate profile ' + index);
        var tbody = settingsTable(typeBox);
        var typeRow = layoutRow({ cli: 'rates_type', label: 'Rates Type', enum: 'ratesTypes' }, index);
        if (typeRow) { tbody.appendChild(typeRow); }
        grid.appendChild(typeBox);

        var ringBox = panel('Cyclic Ring', 'rate profile ' + index);
        var ringBody = settingsTable(ringBox);
        [{ toggle: 'cyclicRing', label: 'Enable Cyclic Ring' },
         { cli: 'cyclic_ring', label: 'Cyclic Ring Level', when: 'cyclicRing' },
         { cli: 'cyclic_polar', label: 'Enable Polar Coordinates' }].forEach(function (spec) {
            var row = layoutRow(spec, index);
            if (row) { ringBody.appendChild(row); }
        });
        grid.appendChild(ringBox);

        var rates = ratesGrid(index);
        if (rates) { grid.appendChild(rates); }
        var dyn = dynamicsGrid(index);
        if (dyn) { grid.appendChild(dyn); }

        frag.appendChild(grid);
        frag.appendChild(renderSettingsTab('rates', {
            quiet: true,
            scope: 'rateprofile',
            skip: RATES_COVERED,
            hint: 'not on the Configurator’s Rates tab'
        }));
        return frag;
    }

    var RATES_COVERED = (function () {
        var out = { rates_type: true, cyclic_ring: true, cyclic_polar: true };
        RATE_AXES.forEach(function (axis) {
            var key = axis.toLowerCase();
            out[key + '_rc_rate'] = out[key + '_srate'] = out[key + '_expo'] = true;
            out[key + '_response'] = true;
        });
        DYNAMICS_ROWS.forEach(function (spec) {
            if (spec.array) { out[spec.array] = true; }
            if (spec.yaw) { out[spec.yaw] = true; }
        });
        return out;
    }());

    // ------------------------------------------------------------ mixer tab

    function renderMixer() {
        var frag = document.createDocumentFragment();

        var laid = renderLayoutTab('mixer');
        if (laid) { frag.appendChild(laid); }

        var inputs = rows('mixerInput');
        var ib = panel('Mixer Inputs', inputs.length + ' overridden');
        panelBody(ib).appendChild(table(
            ['Input', 'Min', 'Max', 'Rate'],
            inputs.map(function (i) {
                return [{ text: i.input, cls: 'name' }, i.min, i.max, i.rate];
            }),
            { empty: 'No mixer input lines in this file (all at their defaults).' }));
        frag.appendChild(ib);

        var rules = rows('mixerRule');
        if (rules.length) {
            var rb = panel('Mixer Rules', rules.length + ' active');
            panelBody(rb).appendChild(table(
                ['#', 'Operation', 'Input', 'Output', 'Weight', 'Offset'],
                rules.map(function (r) {
                    return [{ text: r.index, cls: 'name' },
                            { text: r.op, cls: 'name' }, r.input, r.output, r.weight, r.offset];
                })));
            frag.appendChild(rb);
        }

        var over = rows('mixerOverride');
        if (over.length) {
            var ob = panel('Mixer Overrides');
            panelBody(ob).appendChild(table(['Input', 'Value'],
                over.map(function (o) { return [{ text: o.input, cls: 'name' }, o.value]; })));
            frag.appendChild(ob);
        }

        frag.appendChild(renderSettingsTab('mixer', {
            quiet: true,
            skip: layoutNames('mixer'),
            hint: 'not on the Configurator\u2019s Mixer tab'
        }));
        return frag;
    }

    // --------------------------------------------------------- ledstrip tab

    function renderLedStrip() {
        var frag = document.createDocumentFragment();
        var leds = rows('led');
        if (leds.length) {
            var lb = panel('LEDs', leds.length + ' defined');
            panelBody(lb).appendChild(table(['#', 'Definition'],
                leds.map(function (l) {
                    return [{ text: l.index, cls: 'name' }, { text: l.spec, cls: 'name' }];
                })));
            frag.appendChild(lb);
        }
        var colors = rows('color');
        if (colors.length) {
            var cb = panel('Colours', colors.length + ' defined');
            panelBody(cb).appendChild(table(['#', 'H,S,V'],
                colors.map(function (c) {
                    return [{ text: c.index, cls: 'name' }, { text: c.spec, cls: 'name' }];
                })));
            frag.appendChild(cb);
        }
        var mc = rows('mode_color');
        if (mc.length) {
            var mb = panel('Mode Colours');
            panelBody(mb).appendChild(table(['Mode', 'Function', 'Colour'],
                mc.map(function (m) { return [m.mode, m.func, m.color]; })));
            frag.appendChild(mb);
        }
        frag.appendChild(renderSettingsTab('ledstrip', { quiet: true }));
        return frag;
    }

    // ---------------------------------------------------------- beepers tab

    function renderBeepers() {
        var frag = document.createDocumentFragment();
        var bs = rows('beeper');
        var box = panel('Beeper Conditions', bs.length + ' changed');
        panelBody(box).appendChild(table(['Condition', 'State'],
            bs.map(function (b) {
                return [{ text: b.name, cls: 'name' },
                        { text: b.enabled ? 'ON' : 'OFF', cls: b.enabled ? 'on' : 'off' }];
            }),
            { empty: 'No beeper lines in this file (all conditions at their defaults).' }));
        frag.appendChild(box);
        frag.appendChild(renderSettingsTab('beepers', { quiet: true }));
        return frag;
    }

    // ------------------------------------------------------------ board tab

    function renderBoard() {
        var frag = document.createDocumentFragment();
        var notes = {};
        rows('pinNote').forEach(function (n) { notes[n.pin] = n.note; });

        ['timer', 'dma', 'resource'].forEach(function (kind) {
            var rs = rows(kind);
            if (!rs.length) { return; }
            var box = panel(kind === 'dma' ? 'DMA' : kind.charAt(0).toUpperCase() + kind.slice(1),
                            rs.length + ' entries');
            panelBody(box).appendChild(table(['Definition', 'Hardware'],
                rs.map(function (r) {
                    var pin = r.args[r.args.length - 2];
                    return [{ text: kind + ' ' + r.text, cls: 'name' },
                            { text: notes[pin] || notes[r.args[0]] || '—', cls: 'dim' }];
                })));
            frag.appendChild(box);
        });

        frag.appendChild(renderSettingsTab('board', { quiet: true }));
        return frag;
    }

    // ----------------------------------------------------- all-settings tab

    function renderAll() {
        var frag = document.createDocumentFragment();
        var all = state.parsed.allSettings().sort(function (a, b) {
            if (a.scope !== b.scope) { return a.scope < b.scope ? -1 : 1; }
            if (a.index !== b.index) { return (a.index || 0) - (b.index || 0); }
            return a.name < b.name ? -1 : 1;
        });

        var list = all.filter(function (s) {
            return matchesFilter(s.name, S.prettify(s.name));
        });

        var box = panel('Every value in this file',
            list.length + ' of ' + all.length + ' shown');
        panelBody(box).appendChild(table(
            ['Setting', 'Scope', 'Value', 'Firmware default', 'Tab', 'Line'],
            list.map(function (s) {
                var def = defaultDisplay(s.name);
                var shown = valueDisplay(s.entry, s.name);
                var changed = def !== null && shown !== def;
                var tabId = S.tabFor(s.name, meta(s.name));
                var tabDef = S.TABS.filter(function (t) { return t.id === tabId; })[0];
                return [
                    { text: s.name, cls: 'name' },
                    { text: s.scope === 'master' ? 'master'
                          : s.scope + ' ' + s.index, cls: 'dim' },
                    { text: shown, cls: 'wrap' + (changed ? ' on' : '') },
                    { text: def === null ? (meta(s.name) ? '—' : 'unknown setting') : def,
                      cls: 'dim wrap' },
                    { text: tabDef ? tabDef.name : tabId, cls: 'dim' },
                    { text: s.entry.line, cls: 'dim' }
                ];
            }),
            { empty: 'Nothing matches the current filter.' }));
        frag.appendChild(box);

        if (state.parsed.unknown.length) {
            var ub = panel('Unrecognised lines', state.parsed.unknown.length);
            panelBody(ub).appendChild(table(['Line', 'Text'],
                state.parsed.unknown.map(function (u) {
                    return [{ text: u.line, cls: 'dim' }, { text: u.text, cls: 'name' }];
                })));
            frag.appendChild(ub);
        }
        return frag;
    }

    // ------------------------------------------------------------- CLI tab

    function renderCli() {
        var frag = document.createDocumentFragment();
        var pre = el('pre', 'cli');
        var lines = state.parsed.raw.split(/\r?\n/);
        var needle = state.filter.toLowerCase();
        lines.forEach(function (line, i) {
            var cls = 'ln ' + (line.trim().charAt(0) === '#' ? 'c' : 's');
            if (needle && line.toLowerCase().indexOf(needle) !== -1) { cls += ' hit'; }
            var n = el('span', cls, line);
            n.setAttribute('data-n', i + 1);
            pre.appendChild(n);
        });
        frag.appendChild(pre);
        return frag;
    }

    // ------------------------------------------------------------- chrome

    /* The Configurator leads its Profiles tab with a matrix: a row per axis,
     * colour-coded, and a column per PID term. It is the most recognisable
     * thing on the tab, so the viewer builds the same one. */
    function pidMatrix(spec, index) {
        var terms = spec.terms.filter(function (t) {
            return spec.axes.some(function (axis) {
                return !!meta(axis.toLowerCase() + '_' + t.key + '_gain');
            });
        });
        if (!terms.length) { return null; }

        var box = panel(spec.title, 'profile ' + index);
        var table = el('table', 'pid_table');

        var head = el('tr', 'pid_titlebar');
        head.appendChild(el('th', null, 'Axis'));
        terms.forEach(function (t) { head.appendChild(el('th', null, t.head)); });
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);

        var body = el('tbody');
        spec.axes.forEach(function (axis) {
            var row = el('tr', axis);
            row.appendChild(el('td', 'axis_title', axis));
            terms.forEach(function (t) {
                var name = axis.toLowerCase() + '_' + t.key + '_gain';
                var cell = el('td', 'pid_data');
                if (!meta(name)) { row.appendChild(cell); return; }

                var present = entryFor(name, 'profile', index);
                var shown = present ? valueDisplay(present, name) : defaultDisplay(name);
                var def = defaultDisplay(name);
                if (present && def !== null && shown !== def) {
                    cell.className = 'pid_data is-changed';
                }
                var input = el('input', 'value');
                input.type = 'text';
                input.value = shown === null ? '\u2014' : shown;
                input.disabled = true;
                input.title = rowTooltip(name, meta(name), present);
                cell.appendChild(input);
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
        table.appendChild(body);
        panelBody(box).appendChild(table);
        return box;
    }

    // ------------------------------------------- Configurator-transcribed tabs

    /* One element of an array setting, which is how the Configurator addresses
     * per-axis values like error_limit. */
    function sliceOf(value, idx) {
        if (idx === undefined || idx === null) { return value; }
        if (Array.isArray(value)) { return idx < value.length ? value[idx] : null; }
        return null;
    }


    // ---------------------------------------------------- derived page values
    //
    // The Mixer tab shows almost nothing the CLI stores directly: the pitch
    // limits, calibrations and control directions are all worked out from the
    // four stabilised `mixer input` lines and a handful of mixer settings.
    // These do the same arithmetic as the Configurator's src/js/tabs/mixer.js,
    // with the same constants, so the page reads the way the pilot's did.

    function mixerInput(name) {
        var found = null;
        rows('mixerInput').forEach(function (r) {
            if (r.input === name) { found = r; }
        });
        if (found) { return found; }
        // A `diff all` carries only the lines that changed; the rest are stock.
        var stock = (window.RF_MIXER_INPUT_DEFAULTS || {})[name];
        return stock ? { input: name, min: stock.min, max: stock.max, rate: stock.rate } : null;
    }

    function masterValue(name) {
        var present = entryFor(name, 'master', null);
        if (present) { return present.value; }
        var m = meta(name);
        return m && m.d !== undefined ? m.d : null;
    }

    /* A lookup setting reaches us as the firmware's symbol when it came from a
     * file and as an index when it came from the defaults; the index is what
     * the Configurator's dropdowns are keyed by. */
    function lutIndexOf(m, value) {
        if (typeof value === 'number') { return value; }
        var table = lut(m);
        if (!table) { return null; }
        var i = table.indexOf(value);
        return i < 0 ? null : i;
    }

    function lookupIndex(name) {
        return lutIndexOf(meta(name), masterValue(name));
    }

    /* The Configurator's own wording for an enumerated value. */
    function enumWord(key, value) {
        if (value === null || value === undefined) { return null; }
        var list = (window.RF_ENUM_LISTS || {})[key];
        if (list) { return list[value] === undefined ? null : list[value]; }
        var table = ((window.RF_ENUMS || {}).byId || {})[key];
        if (!table) { return null; }
        var word = table[String(value)];
        return word === undefined ? null : word;
    }

    /* `>=4.6` / `<4.6`: the Configurator guards a good deal of its markup on
     * MSP API 12.9, which arrived with firmware 4.6, and the two generations
     * lay the same page out differently. */
    function versionOk(rule) {
        if (!rule) { return true; }
        var m = /^(>=|<)(.+)$/.exec(rule);
        if (!m) { return true; }
        return m[1] === '>=' ? state.dbKey >= m[2] : state.dbKey < m[2];
    }

    var WHEN = {
        variableTail: function () { return lookupIndex('tail_rotor_mode') === 0; },
        motorisedTail: function () { return lookupIndex('tail_rotor_mode') > 0; },
        /* A filter is on when its own values say so, not by a flag
         * (src/tabs/gyro/LowpassFilter.svelte, NotchFilter.svelte). */
        lowpass1: function () { return lookupIndex('gyro_lpf1_type') > 0; },
        lowpass2: function () { return lookupIndex('gyro_lpf2_type') > 0; },
        lowpass1Dyn: function () {
            var min = masterValue('gyro_lpf1_dyn_min_hz');
            var max = masterValue('gyro_lpf1_dyn_max_hz');
            return min > 0 && min < max;
        },
        notch1: function () {
            return masterValue('gyro_notch1_hz') > 0 && masterValue('gyro_notch1_cutoff') > 0;
        },
        notch2: function () {
            return masterValue('gyro_notch2_hz') > 0 && masterValue('gyro_notch2_cutoff') > 0;
        },
        dynNotch: function () { return masterValue('dyn_notch_count') > 0; },
        /* configuration.js: the sensor switches are on unless the hardware is
         * set to NONE (index 1), and statistics are off at -1. */
        accelerometer: function () { return lookupIndex('acc_hardware') !== 1; },
        barometer: function () { return lookupIndex('baro_hardware') !== 1; },
        magnetometer: function () { return lookupIndex('mag_hardware') !== 1; },
        flightStats: function () { return masterValue('stats_min_armed_time_s') >= 0; },
        rescueAltHold: function () {
            var present = entryFor('rescue_mode', 'profile', state.profile);
            var m = meta('rescue_mode');
            var raw = present ? present.value : (m ? m.d : null);
            return lutIndexOf(m, raw) > 1;
        },
        cyclicRing: function () {
            return rateProfileValue('cyclic_ring', state.rateProfile) > 0;
        },
        rpmFilter: function () { return featureOn('RPM_FILTER'); },
        mainMotorNotch: function () { return !unityRatio('main_rotor_gear_ratio'); },
        tailMotorNotch: function () {
            return lookupIndex('tail_rotor_mode') > 0 && !unityRatio('tail_rotor_gear_ratio');
        },

        /* The Configurator hides the PWM timing settings unless the throttle
         * protocol is an analogue one (src/tabs/motors/state.svelte.js). */
        notDshot: function () {
            var proto = masterValue('motor_pwm_protocol');
            var name = typeof proto === 'number'
                ? (lut(meta('motor_pwm_protocol')) || [])[proto] : proto;
            return !/^(DSHOT|PROSHOT)/.test(String(name));
        }
    };

    /* The legacy tabs round a number input to the decimals its `step`
     * attribute implies, but only once a change event has fired on it, so two
     * fields with the same step can print 4.30 and 0.5. `dp` records which. */
    function divide(text, factor, places) {
        if (text === null || text === undefined || isNaN(Number(text))) { return text; }
        var value = Number(text) / factor;
        return places === undefined ? String(value) : value.toFixed(places);
    }

    function featureOn(name) {
        var on = false;
        if (!state.parsed) { return false; }
        state.parsed.features.forEach(function (f) {
            if (f.name === name) { on = f.enabled; }
        });
        return on;
    }

    function unityRatio(name) {
        var pair = masterValue(name);
        return Array.isArray(pair) && pair[0] === 1 && pair[1] === 1;
    }

    function times(value, factor, places) {
        if (value === null || value === undefined || isNaN(value)) { return null; }
        return (Number(value) * factor).toFixed(places === undefined ? 1 : places);
    }

    function inputField(name, key) {
        var input = mixerInput(name);
        return input ? Number(input[key]) : null;
    }

    function signOf(value) {
        return value === null || value === undefined ? null : (value < 0 ? -1 : 1);
    }

    function magnitude(value, factor) {
        return value === null ? null : times(Math.abs(value), factor);
    }

    var DERIVED = {
        aileronDirection:    function () { return signOf(inputField('SR', 'rate')); },
        elevatorDirection:   function () { return signOf(inputField('SP', 'rate')); },
        collectiveDirection: function () { return signOf(inputField('SC', 'rate')); },
        tailRotorDirection:  function () { return signOf(inputField('SY', 'rate')); },

        cyclicCalibration:     function () { return magnitude(inputField('SR', 'rate'), 0.1); },
        collectiveCalibration: function () { return magnitude(inputField('SC', 'rate'), 0.1); },
        tailRotorCalibration:  function () { return magnitude(inputField('SY', 'rate'), 0.1); },

        cyclicLimit:     function () { return times(inputField('SP', 'max'), 12 / 1000); },
        collectiveLimit: function () { return times(inputField('SC', 'max'), 12 / 1000); },
        totalPitchLimit: function () { return times(masterValue('swash_pitch_limit'), 12 / 1000); },

        collectiveGeoCorrection: function () { return times(masterValue('swash_geo_correction'), 1 / 5); },
        swashPhase:              function () { return times(masterValue('swash_phase'), 0.1); },
        swashRollTrim:           function () { return times(masterValue('swash_roll_trim'), 0.1); },
        swashPitchTrim:          function () { return times(masterValue('swash_pitch_trim'), 0.1); },
        swashCollectiveTrim:     function () { return times(masterValue('swash_collective_trim'), 0.1); },

        tailRotorCenterTrim: function () { return times(masterValue('tail_center_trim'), 24 / 1000); },
        tailMotorCenterTrim: function () { return times(masterValue('tail_center_trim'), 0.1); },
        tailRotorMinYaw:     function () { return times(inputField('SY', 'min'), -24 / 1000); },
        tailRotorMaxYaw:     function () { return times(inputField('SY', 'max'), 24 / 1000); },
        tailMotorMinYaw:     function () { return times(inputField('SY', 'min'), -0.1); },
        tailMotorMaxYaw:     function () { return times(inputField('SY', 'max'), 0.1); },

        /* configuration.js shows the total as whole hours and minutes. */
        flightTime: function () {
            var seconds = masterValue('stats_total_time_s');
            if (seconds === null || seconds === undefined) { return null; }
            var hours = Math.floor(seconds / 3600);
            var minutes = Math.floor((seconds / 60) % 60);
            return hours + (hours === 1 ? ' hour ' : ' hours ')
                + minutes + (minutes === 1 ? ' minute' : ' minutes');
        }
    };

    /* A switch the Configurator derives from the values it governs rather than
     * from a setting of its own. */
    function toggleRow(spec) {
        var fn = WHEN[spec.toggle];
        if (!fn) { return null; }
        if (state.onlyChanged) { return null; }
        if (!matchesFilter(spec.toggle, spec.label)) { return null; }
        return simpleRow(spec.label, null, fn() ? 'ON' : 'OFF', spec.toggle,
            'The Configurator works this switch out from the settings under it, '
            + 'not from a setting of its own.');
    }

    /* A switch the Configurator binds straight to the feature list, not to a
     * setting: the RPM Sensor toggle on the Motors tab is `feature
     * FREQ_SENSOR`. */
    function featureRow(spec) {
        if (!state.parsed) { return null; }
        var on = featureOn(spec.feature);
        if (state.onlyChanged) { return null; }
        if (!matchesFilter('feature ' + spec.feature, spec.label)) { return null; }
        var row = simpleRow(spec.label, spec.unit, on ? 'ON' : 'OFF',
            'feature ' + spec.feature,
            'Read from the file\u2019s `feature` lines, not from a `set`.');
        if (spec.desc) {
            row.querySelector('td.label').appendChild(el('span', 'dim', spec.desc));
        }
        return row;
    }

    /* A gear ratio is a pair, and the Configurator prints the ratio it works
     * out to beside the two numbers. */
    function ratioRow(spec) {
        var pair = masterValue(spec.ratio);
        if (!Array.isArray(pair) || pair.length < 2 || !pair[0]) { return null; }
        if (state.onlyChanged) { return null; }
        if (!matchesFilter(spec.ratio, spec.label)) { return null; }
        var row = simpleRow(spec.label, spec.unit, pair[0] + ' : ' + pair[1], spec.ratio,
            'The Configurator shows the pair and the ratio it works out to.');
        row.querySelector('td.label').appendChild(
            el('span', 'dim', '1:' + (pair[1] / pair[0]).toFixed(2)));
        return row;
    }

    /* One settings row that is not backed by a single CLI setting. */
    function simpleRow(label, unit, shown, provenance, why) {
        var row = el('tr', 'is-derived');
        var control = el('td', 'control');
        control.appendChild(controlFor(provenance, null, shown));
        row.appendChild(control);
        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(label));
        if (unit) { lab.appendChild(el('span', 'units', '[' + unit + ']')); }
        lab.appendChild(el('span', 'cli-name', provenance));
        row.appendChild(lab);
        row.appendChild(el('td', 'was'));
        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = why;
        help.appendChild(icon);
        row.appendChild(help);
        return row;
    }

    /* A row the Configurator computes rather than stores. It carries no "was",
     * because there is no single firmware default to compare one against. */
    function derivedRow(spec) {
        var fn = DERIVED[spec.calc];
        if (!fn) { return null; }
        var value = fn();
        if (value === null || value === undefined) { return null; }
        var shown = spec.enum ? enumWord(spec.enum, value) : String(value);
        if (shown === null) { return null; }
        if (state.onlyChanged) { return null; }
        if (!matchesFilter(spec.from || spec.calc, spec.label)) { return null; }

        var row = el('tr', 'is-derived');
        var control = el('td', 'control');
        control.appendChild(controlFor(spec.calc, null, shown));
        row.appendChild(control);

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(spec.label));
        if (spec.unit) { lab.appendChild(el('span', 'units', '[' + spec.unit + ']')); }
        if (spec.from) { lab.appendChild(el('span', 'cli-name', spec.from)); }
        row.appendChild(lab);

        row.appendChild(el('td', 'was'));

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = 'The Configurator computes this from ' + (spec.from || 'the mixer setup')
            + '. It is not a stored setting, so it has no firmware default.';
        help.appendChild(icon);
        row.appendChild(help);
        return row;
    }

    function layoutRow(spec, index) {
        if (!versionOk(spec.ver)) { return null; }
        if (spec.when && WHEN[spec.when] && !WHEN[spec.when]()) { return null; }
        if (spec.calc) { return derivedRow(spec); }
        if (spec.toggle) { return toggleRow(spec); }
        if (spec.feature) { return featureRow(spec); }
        if (spec.ratio) { return ratioRow(spec); }
        var m = meta(spec.cli);
        if (!m) { return null; }
        if (!matchesFilter(spec.cli, spec.label)) { return null; }

        var scope = m.s;
        var at = scope === 'master' ? null : index;
        var present = entryFor(spec.cli, scope, at);

        var shownAll = present ? present.value : (m.d === undefined ? null : m.d);
        var defAll = m.d === undefined ? null : m.d;

        var shown = format(sliceOf(shownAll, spec.idx), m, spec.cli);
        var def = format(sliceOf(defAll, spec.idx), m, spec.cli);

        /* Where the Configurator words an enum differently from the firmware -
         * `CP120` on the screen is "CCPM 120" - say it the way it does. */
        if (spec.enum) {
            var word = enumWord(spec.enum, lutIndexOf(m, sliceOf(shownAll, spec.idx)));
            if (word !== null) { shown = word; }
            var defWord = enumWord(spec.enum, lutIndexOf(m, sliceOf(defAll, spec.idx)));
            if (defWord !== null) { def = defWord; }
        }

        /* A divisor the MSP layer applies rather than the tab. */
        if (spec.div) {
            shown = divide(shown, spec.div, spec.dp);
            def = divide(def, spec.div, spec.dp);
        }

        var changed = !!present && def !== null && shown !== def;
        if (state.onlyChanged && !changed) { return null; }

        var classes = changed ? 'is-changed' : '';
        /* The Configurator highlights the battery profile in use. */
        if (spec.active && masterValue(spec.active) === spec.idx) {
            classes += (classes ? ' ' : '') + 'is-active';
        }
        var row = el('tr', classes || null);

        var control = el('td', 'control');
        control.appendChild(controlFor(spec.cli, m, shown));
        row.appendChild(control);

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(spec.label));
        if (spec.unit) { lab.appendChild(el('span', 'units', '[' + spec.unit + ']')); }
        /* A ramp time is also printed as the rate it works out to. */
        if (spec.rate && versionOk(spec.rate) && Number(shown) > 0) {
            lab.appendChild(el('span', 'dim', (100 / Number(shown)).toFixed(1) + ' %/s'));
        }
        var cli = spec.cli + (spec.idx === undefined ? '' : '[' + spec.idx + ']');
        lab.appendChild(el('span', 'cli-name', cli));
        row.appendChild(lab);

        var was = el('td', 'was');
        if (changed) { was.textContent = 'was ' + def; }
        row.appendChild(was);

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = rowTooltip(spec.cli, m, present);
        help.appendChild(icon);
        row.appendChild(help);
        return row;
    }

    /* Render a value the way the file or the firmware states it. */
    function format(value, m, name) {
        if (value === null || value === undefined) { return null; }
        if (Array.isArray(value)) {
            return value.map(function (v) { return scaled(v, name); }).join(',');
        }
        var table = lut(m);
        if (table && typeof value === 'number' && table[value] !== undefined) {
            return table[value];
        }
        return String(scaled(value, name));
    }

    /* A group is a toggle whose state the Configurator derives from whether the
     * setting it governs is switched on, with its members indented under it. */
    function layoutGroup(spec, index, tbody, flushSub) {
        if (spec.when && WHEN[spec.when] && !WHEN[spec.when]()) { return 0; }
        if (!versionOk(spec.ver)) { return 0; }
        var driver = meta(spec.on);
        var rows = [];
        spec.rows.forEach(function (r) {
            var row = layoutRow(r, index);
            if (row) { rows.push(row); }
        });
        if (!rows.length) { return 0; }

        if (flushSub) { flushSub(); }
        if (driver && !state.onlyChanged && !state.filter) {
            var at = driver.s === 'master' ? null : index;
            var present = entryFor(spec.on, driver.s, at);
            var raw = present ? present.value : driver.d;
            var on = !(raw === 0 || raw === 'OFF' || raw === undefined);

            var head = el('tr', 'group-head');
            var control = el('td', 'control');
            var sw = el('div', 'switch' + (on ? ' on' : ''));
            sw.title = on ? 'on' : 'off';
            control.appendChild(sw);
            head.appendChild(control);
            var lab = el('td', 'label');
            lab.appendChild(document.createTextNode(spec.group));
            head.appendChild(lab);
            head.appendChild(el('td', 'was'));
            head.appendChild(el('td', 'help'));
            tbody.appendChild(head);
        }

        rows.forEach(function (r) {
            r.className = (r.className ? r.className + ' ' : '') + 'suboption';
            tbody.appendChild(r);
        });
        return rows.length;
    }

    /* The governor bypass curve. The firmware stores nine points at twice
     * their percentage; ThrottleCurve.svelte shows five when every odd point
     * is the rounded average of its neighbours, which is how the Configurator
     * decides the "Points" figure. */
    function curveBox(name) {
        var raw = masterValue(name);
        if (!Array.isArray(raw)) { return null; }

        var points = raw;
        var reducible = raw.length === 9;
        for (var i = 0; reducible && i < raw.length - 2; i += 2) {
            if (Math.round((raw[i] + raw[i + 2]) / 2) !== raw[i + 1]) { reducible = false; }
        }
        if (reducible) { points = [raw[0], raw[2], raw[4], raw[6], raw[8]]; }

        var wrap = el('div', 'curve-box');
        wrap.appendChild(el('div', 'curve-points', 'Points ' + points.length));
        var list = el('ol', 'curve-list');
        points.forEach(function (v) {
            list.appendChild(el('li', null, (v / 2).toFixed(1) + '%'));
        });
        wrap.appendChild(list);
        var note = el('div', 'note',
            'The Configurator also shows a live \u201cThrottle:\u201d readout here; that is '
            + 'the current stick position, not something a file can carry. Stored as ');
        note.appendChild(el('code', null, name + ' = ' + raw.join(',')));
        note.appendChild(document.createTextNode('.'));
        wrap.appendChild(note);
        return wrap;
    }

    // -------------------------------------------------------- RPM filter notches
    //
    // The firmware stores the RPM filter as sixteen slots per axis - a source,
    // a Q and a centre offset each - and the Configurator reads them back into
    // one control per harmonic. Consecutive slots sharing a source and Q are
    // one multi-notch, and the offsets say whether it is double or triple.
    // This follows parseRpmFilterConfig2() in src/tabs/gyro/filter_config.js.

    var NOTCH_SOURCES = {
        motors: [
            { source: 10, label: 'Main Motor Notch Q', when: 'mainMotorNotch' },
            { source: 20, label: 'Tail Motor Notch Q', when: 'tailMotorNotch' }
        ],
        main: [
            { source: 11, label: 'Fundamental Frequency Notch Q', type: 'Fundamental Frequency Notch type' },
            { source: 12, label: '2nd Harmonic Notch Q', type: '2nd Harmonic Notch Type' },
            { source: 13, label: '3rd Harmonic Notch Q' },
            { source: 14, label: '4th Harmonic Notch Q' },
            { source: 15, label: '5th Harmonic Notch Q' },
            { source: 16, label: '6th Harmonic Notch Q' },
            { source: 17, label: '7th Harmonic Notch Q' },
            { source: 18, label: '8th Harmonic Notch Q' }
        ],
        tail: [
            { source: 21, label: 'Fundamental Frequency Notch Q', type: 'Fundamental Frequency Notch type' },
            { source: 22, label: '2nd Harmonic Notch Q', type: '2nd Harmonic Notch Type' },
            { source: 23, label: '3rd Harmonic Notch Q' },
            { source: 24, label: '4th Harmonic Notch Q' }
        ]
    };

    var NOTCH_TYPE_NAMES = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };
    var NOTCH_DEFAULT_Q = '2.5';

    function decodeNotches(axis) {
        var sources = masterValue('gyro_rpm_notch_source_' + axis);
        var qs = masterValue('gyro_rpm_notch_q_' + axis);
        var centres = masterValue('gyro_rpm_notch_center_' + axis);
        if (!Array.isArray(sources) || !Array.isArray(qs)) { return null; }

        var out = {};
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i];
            if (!source) { continue; }
            var q = qs[i];
            var run = 1;
            while (i + run < sources.length
                   && sources[i + run] === source && qs[i + run] === q) { run++; }
            out[source] = {
                type: run,
                value: (q / 10).toFixed(1),
                centres: (centres || []).slice(i, i + run)
            };
            i += run - 1;
        }
        return out;
    }

    function notchesBox(axes) {
        var wrap = el('div', 'notches');
        var any = false;

        axes.forEach(function (axis) {
            var found = decodeNotches(axis);
            if (!found) { return; }
            any = true;
            wrap.appendChild(el('div', 'notch-axis axis-' + axis,
                axis.charAt(0).toUpperCase() + axis.slice(1)));
            var table = el('table', 'settings_table');
            var tbody = el('tbody');
            table.appendChild(tbody);

            ['motors', 'main', 'tail'].forEach(function (group) {
                var specs = NOTCH_SOURCES[group].filter(function (s) {
                    return !s.when || (WHEN[s.when] && WHEN[s.when]());
                });
                if (!specs.length) { return; }
                var head = el('tr', 'subheading');
                var cell = el('td', 'label');
                cell.colSpan = 4;
                cell.textContent = { motors: 'Motors', main: 'Main Rotor', tail: 'Tail Rotor' }[group];
                head.appendChild(cell);
                tbody.appendChild(head);

                specs.forEach(function (spec) {
                    var notch = found[spec.source];
                    if (spec.type) {
                        tbody.appendChild(notchRow(spec.type,
                            notch ? NOTCH_TYPE_NAMES[notch.type] : 'SINGLE',
                            !!notch, 'notch source ' + spec.source));
                    }
                    tbody.appendChild(notchRow(spec.label,
                        notch ? notch.value : NOTCH_DEFAULT_Q,
                        !!notch, 'notch source ' + spec.source));
                });
            });
            wrap.appendChild(table);
        });

        return any ? wrap : null;
    }

    function notchRow(label, shown, on, provenance) {
        var row = el('tr', on ? 'is-derived' : 'is-derived is-off');
        var control = el('td', 'control');
        var sw = el('div', 'switch' + (on ? ' on' : ''));
        sw.title = on ? 'on' : 'off';
        control.appendChild(sw);
        row.appendChild(control);

        var value = el('td', 'control');
        value.appendChild(controlFor(provenance, null, shown));
        row.appendChild(value);

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(label));
        lab.appendChild(el('span', 'cli-name', provenance));
        row.appendChild(lab);
        row.appendChild(el('td', 'help'));
        return row;
    }

    /* A tab whose layout is transcribed from the Configurator. */
    function renderLayoutTab(tabId) {
        var layout = (window.RF_LAYOUT || {})[tabId];
        if (!layout) { return null; }

        var frag = document.createDocumentFragment();
        var index = layout.scope === 'rateprofile' ? state.rateProfile : state.profile;
        if (layout.scope) { frag.appendChild(profileBar(layout.scope)); }

        var grid = el('div', 'columns');
        var rendered = 0;

        if (layout.matrix && !state.filter && !state.onlyChanged) {
            var matrix = pidMatrix(layout.matrix, index);
            if (matrix) { grid.appendChild(matrix); rendered++; }
        }

        layout.boxes.forEach(function (box) {
            if (!versionOk(box.ver)) { return; }
            var gui = panel(box.title, layout.scope
                ? layout.scope.replace('rateprofile', 'rate') + ' ' + index : '');

            if (box.when && WHEN[box.when] && !WHEN[box.when]()) { return; }

            if (box.notches) {
                var boxes = notchesBox(['roll', 'pitch', 'yaw']);
                if (boxes) {
                    panelBody(gui).appendChild(el('div', 'note',
                        'The Configurator shows one axis at a time behind Roll / Pitch / '
                        + 'Yaw buttons; all three are laid out here.'));
                    panelBody(gui).appendChild(boxes);
                    grid.appendChild(gui);
                    rendered++;
                }
                return;
            }

            if (box.curve) {
                var curve = curveBox(box.curve);
                if (curve) { panelBody(gui).appendChild(curve); grid.appendChild(gui); rendered++; }
                return;
            }

            var tbody = settingsTable(gui);
            var n = 0;
            var pendingSub = null;

            function flushSub() {
                if (!pendingSub) { return; }
                var head = el('tr', 'subheading');
                var cell = el('td', 'label');
                cell.colSpan = 4;
                cell.textContent = pendingSub;
                head.appendChild(cell);
                tbody.appendChild(head);
                pendingSub = null;
            }

            box.rows.forEach(function (spec) {
                if (spec.note) {
                    if (state.filter || state.onlyChanged) { return; }
                    var noteRow = el('tr', 'note-row');
                    var noteCell = el('td', 'label');
                    noteCell.colSpan = 4;
                    noteCell.appendChild(el('div', 'inline-note', spec.note));
                    noteRow.appendChild(noteCell);
                    tbody.appendChild(noteRow);
                    return;
                }
                if (spec.sub) {
                    if (state.filter || state.onlyChanged) { return; }
                    if (!versionOk(spec.ver)) { return; }
                    /* Held back until something lands under it: the
                     * Configurator's sub-sections come and go with the
                     * settings they head. */
                    pendingSub = spec.sub;
                    return;
                }
                if (spec.group) {
                    var before = n;
                    n += layoutGroup(spec, index, tbody, flushSub);
                    if (n > before) { pendingSub = null; }
                    return;
                }
                var row = layoutRow(spec, index);
                if (row) { flushSub(); tbody.appendChild(row); n++; }
            });
            if (n) { grid.appendChild(gui); rendered += n; }
        });

        frag.appendChild(grid);

        /* Anything the Configurator's page leaves out still belongs somewhere,
         * so it follows in its own box rather than disappearing. */
        frag.appendChild(renderSettingsTab(tabId, {
            quiet: true,
            scope: layout.scope || 'master',
            skip: layoutNames(tabId),
            hint: 'not on the Configurator\u2019s page'
        }));

        if (!rendered) { frag.appendChild(el('div', 'empty-note', emptyMessage())); }
        return frag;
    }

    var RENDERERS = {
        setup: renderSetup,
        ports: renderPorts,
        modes: renderModes,
        adjustments: renderAdjustments,
        servos: renderServos,
        mixer: renderMixer,
        rates: renderRates,
        ledstrip: renderLedStrip,
        beepers: renderBeepers,
        board: renderBoard,
        all: renderAll,
        cli: renderCli
    };

    var SCOPED = { profiles: 'profile', rescue: 'profile', rates: 'rateprofile' };

    function tabContentCount(tabId) {
        if (!state.parsed) { return 0; }
        if (tabId === 'cli') { return state.parsed.lineCount; }
        if (tabId === 'all') { return state.parsed.setCount; }
        if (tabId === 'setup') { return null; }

        var n = 0;
        var names = INDEX.byTab[tabId] ? Object.keys(INDEX.byTab[tabId].names) : [];
        names.forEach(function (name) {
            var m = meta(name);
            var scope = m ? m.s : 'master';
            if (scope === 'master') {
                if (state.parsed.master[name]) { n++; }
            } else {
                var store = scope === 'profile' ? state.parsed.profiles : state.parsed.rateProfiles;
                Object.keys(store).forEach(function (k) { if (store[k][name]) { n++; } });
            }
        });
        // Structured rows count too - a tab can be non-empty without any `set`.
        var extraRows = {
            ports: ['serial'],
            servos: ['servo'], mixer: ['mixerInput', 'mixerRule', 'mixerOverride'],
            beepers: ['beeper'], ledstrip: ['led', 'color', 'mode_color'],
            board: ['timer', 'dma', 'resource']
        }[tabId] || [];
        extraRows.forEach(function (k) { n += rows(k).length; });
        if (tabId === 'modes') { n += rows('aux').filter(auxInUse).length; }
        if (tabId === 'adjustments') {
            n += rows('adjfunc').filter(function (a) { return a.func; }).length;
        }
        return n;
    }

    /* On a phone the tab rail is a drawer over the content, so it has to be
     * dismissed after a choice and whenever the viewport grows back. */
    function setDrawer(open) {
        $('#sidebar').classList.toggle('open', open);
        $('#scrim').classList.toggle('on', open);
        $('#menu-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeDrawer() { setDrawer(false); }

    function renderSidebar() {
        var bar = clear($('#sidebar'));
        bar.appendChild(el('div', 'rail-title', 'Tabs'));
        S.TABS.forEach(function (t) {
            var count = tabContentCount(t.id);
            var link = el('div', 'tab-link' +
                (t.id === state.tab ? ' active' : '') +
                (count === 0 ? ' empty' : ''));
            link.setAttribute('data-tab', t.id);
            link.appendChild(el('span', null, t.name));
            if (count !== null) { link.appendChild(el('span', 'count', count)); }
            link.onclick = function () { state.tab = t.id; closeDrawer(); render(); };
            bar.appendChild(link);
        });
    }

    function renderHeaderMeta() {
        var meta$ = clear($('#filemeta'));
        if (!state.parsed) { return; }
        var p = state.parsed;
        function line(label, value) {
            var row = el('div');
            row.appendChild(document.createTextNode(label + ': '));
            row.appendChild(el('b', null, value));
            return row;
        }

        var first = el('div');
        first.appendChild(el('span', 'chip kind-' + p.kind, p.kind));
        first.appendChild(document.createTextNode(' ' + (state.fileName || 'pasted text')));
        meta$.appendChild(first);
        meta$.appendChild(line('Firmware', (p.header.version || 'unknown') +
            (p.header.firmware ? ' ' + p.header.firmware : '')));
        meta$.appendChild(line('Target', (p.header.board_name || '?') +
            (p.header.mcuTarget ? '(' + p.header.mcuTarget + ')' : '')));

        var status = $('#statustext');
        if (status) {
            status.textContent = (p.header.craftName ? p.header.craftName + ' \u2014 ' : '') +
                p.setCount + ' settings, ' +
                Object.keys(p.profiles).length + ' profiles, ' +
                Object.keys(p.rateProfiles).length + ' rate profiles \u2014 ' +
                'read with Rotorflight ' + (state.dbKey || '?') + ' metadata';
        }
    }

    function renderToolbar(host) {
        var bar = el('div', 'toolbar');

        var search = el('input');
        search.type = 'search';
        search.placeholder = state.tab === 'cli'
            ? 'Highlight text in the raw file…'
            : 'Filter settings by name…';
        search.value = state.filter;
        search.oninput = function () {
            state.filter = search.value.trim();
            renderContentOnly();
            var again = $('#content input[type="search"]');
            if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        };
        bar.appendChild(search);

        if (state.tab !== 'cli' && state.tab !== 'setup') {
            var lab = el('label');
            var cb = el('input');
            cb.type = 'checkbox';
            cb.checked = state.onlyChanged;
            cb.onchange = function () { state.onlyChanged = cb.checked; renderContentOnly(); };
            lab.appendChild(cb);
            lab.appendChild(document.createTextNode('Only values set in this file'));
            bar.appendChild(lab);
        }

        host.appendChild(bar);
    }

    function currentTabDef() {
        return S.TABS.filter(function (t) { return t.id === state.tab; })[0] || S.TABS[0];
    }

    function renderContentOnly() {
        var host = clear($('#content'));
        var def = currentTabDef();

        var title = el('div', 'tab_title');
        title.appendChild(document.createTextNode(def.name));
        var sub = el('span', 'sub');
        sub.textContent = state.parsed.kind === 'diff'
            ? 'values absent from a diff are shown at their firmware default'
            : 'values shown exactly as printed by the CLI';
        title.appendChild(sub);
        host.appendChild(title);

        renderToolbar(host);

        if (state.parsed.warnings.length) {
            state.parsed.warnings.forEach(function (w) {
                host.appendChild(el('div', 'note warn', w));
            });
        }
        if (!state.db && state.tab !== 'cli') {
            host.appendChild(el('div', 'note warn',
                'No firmware metadata is loaded, so defaults and value names are unavailable.'));
        }

        var body = RENDERERS[def.id] ? RENDERERS[def.id]()
            : renderLayoutTab(def.id)
            || renderSettingsTab(def.id, { scope: SCOPED[def.id] || 'master' });
        host.appendChild(body);
    }

    function render() {
        if (!state.parsed) { renderWelcome(); return; }
        INDEX = buildIndex();
        $('#welcome-wrap').style.display = 'none';
        $('#layout').style.display = 'flex';
        $('#new-btn').hidden = false;
        renderHeaderMeta();
        renderSidebar();
        renderContentOnly();
        $('#content').scrollTop = 0;
    }

    // ------------------------------------------------------------ welcome

    function renderWelcome() {
        $('#layout').style.display = 'none';
        $('#welcome-wrap').style.display = 'block';
        $('#new-btn').hidden = true;
    }

    // ------------------------------------------------------- file loading

    function load(text, name) {
        var parsed;
        try {
            parsed = window.RFParser.parse(text);
        } catch (e) {
            window.alert('Could not parse that file: ' + e.message);
            return;
        }
        state.parsed = parsed;
        state.fileName = name || '';
        state.dbKey = chooseDb(parsed.header.version);
        state.db = state.dbKey ? window.RF_DB[state.dbKey] : null;
        state.profile = parsed.activeProfile === null ? 0 : parsed.activeProfile;
        state.rateProfile = parsed.activeRateProfile === null ? 0 : parsed.activeRateProfile;
        state.tab = 'setup';
        state.filter = '';
        render();
    }

    function readFile(file) {
        var reader = new FileReader();
        reader.onload = function () { load(String(reader.result), file.name); };
        reader.onerror = function () { window.alert('Could not read ' + file.name); };
        reader.readAsText(file);
    }

    function wireDragDrop() {
        var overlay = $('#drop');
        var depth = 0;
        window.addEventListener('dragenter', function (e) {
            e.preventDefault();
            depth++;
            overlay.classList.add('on');
        });
        window.addEventListener('dragover', function (e) { e.preventDefault(); });
        window.addEventListener('dragleave', function (e) {
            e.preventDefault();
            if (--depth <= 0) { depth = 0; overlay.classList.remove('on'); }
        });
        window.addEventListener('drop', function (e) {
            e.preventDefault();
            depth = 0;
            overlay.classList.remove('on');
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                readFile(e.dataTransfer.files[0]);
            } else {
                var t = e.dataTransfer.getData('text');
                if (t) { load(t, ''); }
            }
        });
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { window.localStorage.setItem('rfpv-theme', theme); } catch (e) { /* private mode */ }
        $('#theme-btn').textContent = theme === 'dark' ? 'Light' : 'Dark';
    }

    function init() {
        var saved = 'light';
        try { saved = window.localStorage.getItem('rfpv-theme') || 'light'; } catch (e) { /* ignore */ }
        applyTheme(saved);

        $('#menu-btn').onclick = function () {
            setDrawer(!$('#sidebar').classList.contains('open'));
        };
        $('#scrim').onclick = closeDrawer;
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeDrawer(); }
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth > 860) { closeDrawer(); }
        });

        $('#theme-btn').onclick = function () {
            applyTheme(document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'light' : 'dark');
        };

        $('#file-input').onchange = function (e) {
            if (e.target.files && e.target.files[0]) { readFile(e.target.files[0]); }
        };
        $('#open-btn').onclick = function () { $('#file-input').click(); };
        $('#open-btn-2').onclick = function () { $('#file-input').click(); };
        $('#new-btn').onclick = function () {
            state.parsed = null;
            $('#file-input').value = '';
            clear($('#filemeta'));
            renderWelcome();
        };
        $('#paste-btn').onclick = function () {
            var text = $('#paste-area').value;
            if (text.trim()) { load(text, ''); }
        };

        var zone = $('#welcome .dropbox');
        ['dragenter', 'dragover'].forEach(function (ev) {
            zone.addEventListener(ev, function () { zone.classList.add('hot'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            zone.addEventListener(ev, function () { zone.classList.remove('hot'); });
        });

        wireDragDrop();

        var versions = dbKeys();
        $('#db-note').textContent = versions.length
            ? 'Setting names, ranges and factory defaults are bundled for Rotorflight ' +
              versions.join(' and ') + '.'
            : 'No firmware metadata files were loaded.';

        renderWelcome();

        /* A wrapper (the Windows launcher, or any host that appends a script
         * block) can hand the viewer a file to open straight away. Exposed as a
         * function because that block may run before or after this one. */
        window.RFLoadPreload = function () {
            var pre = window.RF_PRELOAD;
            if (pre && typeof pre.text === 'string' && pre.text.length) {
                load(pre.text, pre.name || '');
            }
        };
        window.RFLoadPreload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
