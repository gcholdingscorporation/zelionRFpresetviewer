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
        if (Array.isArray(m.d)) { return m.d.join(','); }
        return String(m.d);
    }

    function valueDisplay(entry) {
        if (!entry) { return null; }
        if (Array.isArray(entry.value)) { return entry.value.join(','); }
        return String(entry.value);
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

        if (m && m.lut && isNaN(Number(shown))) {
            var sel = el('select');
            sel.appendChild(el('option', null, shown));
            sel.disabled = true;
            return sel;
        }

        if (shown === 'ON' || shown === 'OFF') {
            var box = el('input');
            box.type = 'checkbox';
            box.checked = shown === 'ON';
            box.disabled = true;
            box.setAttribute('aria-label', shown);
            return box;
        }

        var input = el('input', 'value' + (String(shown).length > 12 ? ' wide' : ''));
        input.type = 'text';
        input.value = shown;
        input.disabled = true;
        return input;
    }

    /* One setting, as a Field row: label on the left, control on the right,
     * unit after the label. `present` is the parsed entry, or null when the
     * file left the setting at its default - the normal case in a `diff`. */
    function settingRow(name, present) {
        var m = meta(name);
        var label = S.prettify(name);
        if (!matchesFilter(name, label)) { return null; }

        var shown = present ? valueDisplay(present) : defaultDisplay(name);
        var def = defaultDisplay(name);
        var known = !!m;
        var changed = !!present && def !== null && shown !== def;

        if (state.onlyChanged && !changed) { return null; }

        var field = el('div', 'field' + (changed ? ' is-changed' : ''));
        var content = el('div', 'content');

        var lab = el('label');
        var text = el('span', 'field-label');
        text.appendChild(document.createTextNode(label));
        text.appendChild(el('span', 'cli-name', name));
        lab.appendChild(text);

        var unit = known ? S.unitFor(name) : '';
        if (unit) { lab.appendChild(el('span', 'units', '[ ' + unit + ' ]')); }
        content.appendChild(lab);

        var control = el('div', 'control');
        control.appendChild(controlFor(name, m, shown));

        var d = el('span', 'default');
        if (!known) {
            d.textContent = 'not in metadata';
        } else if (def === null) {
            d.textContent = 'default ?';
        } else if (changed) {
            d.textContent = 'was ' + def;
        } else {
            d.textContent = 'default';
        }
        control.appendChild(d);
        content.appendChild(control);

        field.appendChild(content);
        field.title = rowTooltip(name, m, present);
        return field;
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
        var section = el('div', 'rf-section');
        var container = el('div', 'container');
        var header = el('div', 'header');
        header.appendChild(el('span', 'title', title));
        header.appendChild(el('span', 'grow'));
        if (hint) { header.appendChild(el('span', 'hint', hint)); }
        container.appendChild(header);
        container.appendChild(el('div', 'content'));
        section.appendChild(container);
        return section;
    }

    function panelBody(section) { return section.firstChild.lastChild; }

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
    function leftoverGroups(tabId) {
        var names = Object.keys(INDEX.byTab[tabId] ? INDEX.byTab[tabId].names : {});
        var groups = {};
        names.forEach(function (n) {
            if (INDEX.claimed[n]) { return; }
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

        S.SECTIONS.filter(function (s) { return s.tab === tabId; }).forEach(function (sec) {
            var secScope = sec.profileScope ? 'profile'
                         : sec.rateScope ? 'rateprofile' : 'master';
            var secIndex = secScope === 'profile' ? state.profile
                         : secScope === 'rateprofile' ? state.rateProfile : null;

            var box = panel(sec.title, secScope === 'master' ? '' :
                (secScope === 'profile' ? 'profile ' + secIndex : 'rateprofile ' + secIndex));
            var body = panelBody(box);
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

        leftoverGroups(tabId).forEach(function (g) {
            var box = panel(S.pgTitle(g.pg), g.pg === 'UNKNOWN' ? 'unrecognised' : '');
            var body = panelBody(box);
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
        var bar = el('div', 'profile-tabs');
        var isRate = kind === 'rateprofile';
        bar.appendChild(el('span', 'lbl', isRate ? 'Rate profile' : 'Profile'));

        var sections = isRate ? state.parsed.rateProfiles : state.parsed.profiles;
        var active = isRate ? state.parsed.activeRateProfile : state.parsed.activeProfile;
        var current = isRate ? state.rateProfile : state.profile;

        for (var i = 0; i < 6; i++) {
            (function (n) {
                var has = sections[n] && Object.keys(sections[n]).length;
                var p = el('div', 'profile-tab' + (n === current ? ' active' : '') +
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
        var fwb = panelBody(fw);
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
        var bdb = panelBody(bd);
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
        var ftb = panelBody(ft);
        if (!p.features.length) {
            ftb.appendChild(el('div', 'empty-note', 'No feature changes in this file.'));
        } else {
            p.features.forEach(function (f) {
                var field = el('div', 'field');
                var content = el('div', 'content');
                var lab = el('label');
                lab.appendChild(el('span', 'field-label', f.name));
                content.appendChild(lab);
                var control = el('div', 'control');
                var box = el('input');
                box.type = 'checkbox';
                box.checked = f.enabled;
                box.disabled = true;
                control.appendChild(box);
                control.appendChild(el('span', 'default', f.enabled ? 'enabled' : 'disabled'));
                content.appendChild(control);
                field.appendChild(content);
                ftb.appendChild(field);
            });
        }
        grid.appendChild(ft);

        var st = panel('Contents');
        var stb = panelBody(st);
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
        var field = el('div', 'field');
        var content = el('div', 'content');
        var lab = el('label');
        lab.appendChild(el('span', 'field-label', label));
        content.appendChild(lab);
        var control = el('div', 'control');
        var input = el('input', 'value wide');
        input.type = 'text';
        input.value = value === null || value === undefined ? '—' : String(value);
        input.disabled = true;
        control.appendChild(input);
        content.appendChild(control);
        field.appendChild(content);
        return field;
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

    function renderServos() {
        var frag = document.createDocumentFragment();
        var box = panel('Servos', rows('servo').length + ' configured');
        panelBody(box).appendChild(table(
            ['Servo', 'Centre', 'Min', 'Max', 'Neg scale', 'Pos scale',
             'Rate (Hz)', 'Speed', 'Flags'],
            rows('servo').map(function (s) {
                return [
                    { text: 'Servo ' + s.index, cls: 'name' },
                    s.mid, s.min, s.max, s.rneg, s.rpos, s.rate, s.speed,
                    { text: '0x' + Number(s.flags).toString(16), cls: 'dim' }
                ];
            }),
            { empty: 'No servo lines in this file (all servos at their defaults).' }));
        frag.appendChild(box);
        frag.appendChild(el('div', 'note',
            'Centre, min and max are in the firmware\'s servo units as printed by the CLI ' +
            '(<code>servo &lt;n&gt; &lt;mid&gt; &lt;min&gt; &lt;max&gt; &lt;rneg&gt; ' +
            '&lt;rpos&gt; &lt;rate&gt; &lt;speed&gt; &lt;flags&gt;</code>). ' +
            'They are shown exactly as stored, not converted.'));
        frag.appendChild(renderSettingsTab('servos', { quiet: true }));
        return frag;
    }

    // ------------------------------------------------------------ mixer tab

    function renderMixer() {
        var frag = document.createDocumentFragment();

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

        frag.appendChild(renderSettingsTab('mixer', { quiet: true }));
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
                var shown = valueDisplay(s.entry);
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

    var RENDERERS = {
        setup: renderSetup,
        ports: renderPorts,
        modes: renderModes,
        adjustments: renderAdjustments,
        servos: renderServos,
        mixer: renderMixer,
        ledstrip: renderLedStrip,
        beepers: renderBeepers,
        board: renderBoard,
        all: renderAll,
        cli: renderCli
    };

    var SCOPED = { profiles: 'profile', governor: 'profile', rescue: 'profile', rates: 'rateprofile' };

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
        meta$.appendChild(el('span', 'chip kind-' + p.kind, p.kind));
        function kv(k, v) {
            var s = el('span');
            s.appendChild(document.createTextNode(k + ' '));
            s.appendChild(el('b', null, v));
            return s;
        }
        meta$.appendChild(kv('file', state.fileName || 'pasted'));
        if (p.header.craftName) { meta$.appendChild(kv('craft', p.header.craftName)); }
        if (p.header.version) { meta$.appendChild(kv('fw', p.header.version)); }
        if (p.header.board_name) { meta$.appendChild(kv('board', p.header.board_name)); }
        meta$.appendChild(kv('metadata', state.dbKey || 'none'));
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

        var body = RENDERERS[def.id]
            ? RENDERERS[def.id]()
            : renderSettingsTab(def.id, { scope: SCOPED[def.id] || 'master' });
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
