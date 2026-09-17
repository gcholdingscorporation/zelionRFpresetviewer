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
        /* 'legacy' (control left, label right) or 'svelte' (label left,
         * control right) - see rowOrder(). */
        rowStyle: 'legacy',
        filter: '',
        onlyChanged: false,
        showCli: false,
        fileName: '',
        /* Up to two loaded files. Every renderer below reads `state.parsed`,
         * so a side-by-side is drawn by pointing that at one file and then the
         * other, rather than by teaching each of them about a second file. */
        files: [],
        active: 0,
        /* In a comparison, hide everything the two files agree on. */
        diffOnly: false
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

    function comparing() { return state.files.length > 1; }

    /* Point the renderers at one of the loaded files. */
    function useFile(i) {
        var f = state.files[i];
        if (!f) { return; }
        state.active = i;
        state.parsed = f.parsed;
        state.db = f.db;
        state.dbKey = f.dbKey;
        state.fileName = f.name;
    }

    function fileLabel(i) {
        var f = state.files[i];
        if (!f) { return ''; }
        return (comparing() ? (i === 0 ? 'A \u00b7 ' : 'B \u00b7 ') : '')
            + (f.name || 'pasted text');
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

    /* An empty name is printed as a dash by the CLI, so an empty default has
     * to be shown the same way or every unnamed profile reads as changed. */
    function emptyName(m, value) {
        return m && m.m === 'string' && (value === '' || value === 0);
    }

    /* A MODE_BITSET setting is one bit of a flags word, and the CLI prints it
     * as OFF or ON rather than as the number it is stored in. */
    function bitsetWord(m, value) {
        if (!m || m.m !== 'bitset' || typeof value !== 'number') { return null; }
        return value ? 'ON' : 'OFF';
    }

    /* The CLI prints enum settings by name, so a default stored as an index has
     * to be mapped through the same table before the two can be compared. */
    function defaultDisplay(name) {
        var m = meta(name);
        if (!m || m.d === undefined) { return null; }
        if (emptyName(m, m.d)) { return '-'; }
        var bit = bitsetWord(m, m.d);
        if (bit) { return bit; }
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

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(label));
        var unit = known ? S.unitFor(name) : '';
        if (unit) { lab.appendChild(el('span', 'units', '[' + unit + ']')); }
        lab.appendChild(el('span', 'cli-name', name));

        var was = el('td', 'was');
        if (!known) {
            was.textContent = 'not in metadata';
        } else if (def === null) {
            was.textContent = 'default ?';
        } else if (changed) {
            was.textContent = 'was ' + def;
        }

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = rowTooltip(name, m, present);
        help.appendChild(icon);
        rowOrder(row, control, lab, was, help);
        row.setAttribute('data-k', 'set:' + name);

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
            /* The table carries the layout, so a page can hold a box from the
             * Configurator's other visual language. */
            var table = el('table', 'settings_table'
                + (state.rowStyle === 'svelte' ? ' svelte' : ''));
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
        // Names from the file, or from either file, that the metadata does
        // not cover.
        state.files.forEach(function (f) {
            f.parsed.allSettings().forEach(function (s) {
                if (!meta(s.name)) { add('all', s.name); }
            });
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
                if (spec.toggle === 'customTelemetry') { out.crsf_telemetry_mode = true; }
                /* A derived row names the line it read in `from`; when that is
                 * a setting, the layout has accounted for it too. */
                if (spec.from && /^[a-z0-9_]+$/.test(spec.from)) { out[spec.from] = true; }
                if (spec.ratio) { out[spec.ratio] = true; }

            });
        }
        layout.boxes.forEach(function (box) {
            walk(box.rows);
            if (box.channelMap) { out.rssi_channel = true; }
            if (box.telemetrySensors) { out.telemetry_sensors = true; }
            if (box.curve) { out[box.curve] = true; }
        });
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

        /* The caller may have drawn the profile selector already. */
        if (scope !== 'master' && !opts.noProfileBar) { frag.appendChild(profileBar(scope)); }

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
            /* The first column of these tables is an identity - a servo
             * number, a mode name, a setting name - so it is what pairs a row
             * with its opposite number when two files are shown side by side.
             * Keying it here saves every caller from saying so. */
            var first = cells.length ? cells[0] : null;
            if (first !== null && first !== undefined && !(first instanceof Node)) {
                r.setAttribute('data-k', 'row:' + String(
                    typeof first === 'object' ? first.text : first));
            }
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

    /* The Configurator's Setup page is six buttons - calibrate, reset, save,
     * boot loader, mass storage, reboot - and a line of advice beside each.
     * Every one of them talks to a flight controller, so a viewer has none of
     * them, and inventing boxes of its own here is exactly what this page
     * should not do. What a file says about itself is in the header and the
     * footer strip; the file itself is on the CLI tab. */
    function renderSetup() {
        var frag = document.createDocumentFragment();
        frag.appendChild(el('div', 'note',
            'The Configurator\u2019s Setup page is a set of actions on a connected '
            + 'flight controller \u2014 calibrate, reset, save, reboot \u2014 and none of '
            + 'them apply to a file. This file\u2019s own details are in the bar above '
            + 'and the strip below; the text of it is on the CLI tab.'));
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
        row.setAttribute('data-k', 'info:' + label);
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

    /* The Configurator lists the serial ports on its Configuration page, named
     * S.BUS, TELEM, Int.Rx and so on. Those names are in the board's target
     * definition rather than in the file, so the ports are listed by the UART
     * number the file does carry. */
    function serialPortsTable() {
        return table(
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
            { empty: 'No serial port lines in this file (all ports at their defaults).' });
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

    /* The Modes tab, from src/tabs/auxiliary.html.
     *
     * The Configurator lists every mode the board offers, whether or not it is
     * assigned, and in the order the firmware built its box list - which is a
     * board and feature dependent order that reaches it over MSP and is not in
     * a file. The modes are therefore listed by permanent id, which is the one
     * order a file does determine.
     */
    function renderModes() {
        var frag = document.createDocumentFragment();
        var boxes = extras('boxes');
        var used = rows('aux').filter(auxInUse);

        var byMode = {};
        used.forEach(function (a) { (byMode[a.mode] || (byMode[a.mode] = [])).push(a); });

        var ids = Object.keys(boxes).map(Number).sort(function (a, b) { return a - b; });
        var box = panel('Modes', used.length + ' of ' + rows('aux').length + ' slots in use');
        panelBody(box).appendChild(table(
            ['Mode', 'Channel', 'Range', 'Logic', 'Linked to'],
            ids.map(function (id) {
                var entries = byMode[id];
                if (!entries) {
                    return [{ text: boxes[id], cls: 'name dim' }, '', '', '', ''];
                }
                var a = entries[0];
                return [
                    { text: boxes[id], cls: 'name' },
                    channelName(a.channel),
                    a.start + ' \u2013 ' + a.end,
                    a.logic ? 'OR' : 'AND',
                    a.linkedTo ? (boxes[a.linkedTo] || a.linkedTo) : '\u2014'
                ];
            }),
            { empty: 'No mode ranges are configured in this file.' }));
        frag.appendChild(box);

        /* A mode with more than one range is rare but legal. */
        var extra = [];
        Object.keys(byMode).forEach(function (id) {
            byMode[id].slice(1).forEach(function (a) { extra.push([id, a]); });
        });
        if (extra.length) {
            var eb = panel('Further Ranges', extra.length + ' more');
            panelBody(eb).appendChild(table(
                ['Mode', 'Channel', 'Range', 'Logic'],
                extra.map(function (pair) {
                    var a = pair[1];
                    return [{ text: boxes[pair[0]] || pair[0], cls: 'name' },
                            channelName(a.channel), a.start + ' \u2013 ' + a.end,
                            a.logic ? 'OR' : 'AND'];
                })));
            frag.appendChild(eb);
        }

        return frag;
    }

    // ------------------------------------------------------ adjustments tab

    function renderAdjustments() {
        var frag = document.createDocumentFragment();
        var funcs = extras('adjfuncs');
        var used = rows('adjfunc').filter(function (a) { return a.func; });

        /* adjustments.js: a slot is Off with no function, Stepped when it
         * carries a step, and Mapped otherwise. The function names are the
         * Configurator's own, which are longer than the CLI's. */
        var named = ((window.RF_ENUMS || {}).byId || {}).adjustmentFunctions || {};
        var box = panel('Adjustments',
            used.length + ' of ' + rows('adjfunc').length + ' slots in use');
        /* The Configurator's own columns. It has no slot number and no step
         * column: a step only exists in Stepped mode, where it reads as part
         * of the mode. */
        panelBody(box).appendChild(table(
            ['Mode', 'Function', 'Enable Channel', 'Enable range',
             'Value Channel', 'Value range', 'Value Ranges'],
            used.map(function (a) {
                var mode = !a.func ? 'Off'
                    : (a.step > 0 ? 'Stepped by ' + a.step : 'Mapped');
                return [
                    { text: mode, cls: 'name' },
                    { text: named[String(a.func)] || funcs[a.func] || ('id ' + a.func),
                      cls: 'name' },
                    a.enaChannel === 255 ? 'ALWAYS' : channelName(a.enaChannel),
                    a.enaStart + ' \u2013 ' + a.enaEnd,
                    a.adjChannel === 255 ? 'AUTO' : channelName(a.adjChannel),
                    a.adj1Start + ' \u2013 ' + a.adj1End,
                    a.min + ' \u2013 ' + a.max
                ];
            }),
            { empty: 'No adjustment functions are configured in this file.' }));
        frag.appendChild(box);
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

        return frag;
    }

    // --------------------------------------------------------- ledstrip tab

    /* The LED Strip tab, from src/tabs/led_strip.html and
     * src/js/tabs/led_strip.js.
     *
     * The grid and its colour wheel are an editor, not a readout, so what the
     * viewer can show is which LEDs are in use, how many are left, the sixteen
     * colours as colours, and the global settings - including the blink tempo,
     * which the tab prints in beats per minute rather than the milliseconds
     * the setting holds (led_strip.js msToBpm: 60 x 250 / ms).
     */
    function ledInUse(spec) {
        /* `0,0::C:0:0:0:0` is an LED at the origin with no function: unused. */
        return !/^0,0::/.test(spec);
    }

    /* `color N h,s,v` - hue in degrees, the other two 0-255, and the middle
     * one is whiteness rather than saturation: 0 is the full colour and 255 is
     * white, which is why the firmware's white is 0,255,255 and its red is
     * 0,0,255. This is led_strip.js HsvToColor(), kept as it is written so the
     * swatch is the colour the Configurator draws. */
    function hsvSwatch(spec) {
        var parts = String(spec).split(',');
        if (parts.length < 3) { return null; }
        var h = Number(parts[0]);
        var s = Number(parts[1]);
        var v = Number(parts[2]);
        if (isNaN(h) || isNaN(s) || isNaN(v)) { return null; }
        if (s === 0 && v === 0) { return null; }

        s = 1 - s / 255;
        v = v / 255;
        var l = (2 - s) * v / 2;
        var sat = l && l < 1 ? s * v / (l < 0.5 ? l * 2 : 2 - l * 2) : 0;

        var box = el('span', 'swatch');
        box.style.background = 'hsl(' + h + ',' + (sat * 100) + '%,' + (l * 100) + '%)';
        box.title = 'H ' + parts[0] + '  S ' + parts[1] + '  V ' + parts[2];
        return box;
    }

    function renderLedStrip() {
        var frag = document.createDocumentFragment();
        var leds = rows('led');
        var used = leds.filter(function (l) { return ledInUse(l.spec); });

        if (leds.length) {
            var lb = panel('LED Strip', (leds.length - used.length) + ' remaining');
            if (used.length) {
                panelBody(lb).appendChild(table(['#', 'Definition'],
                    used.map(function (l) {
                        return [{ text: l.index, cls: 'name' }, { text: l.spec, cls: 'name' }];
                    })));
            } else {
                panelBody(lb).appendChild(el('div', 'empty-note',
                    'None of the ' + leds.length + ' LEDs is placed on the grid, '
                    + 'so the strip is unused.'));
            }
            frag.appendChild(lb);
        }

        var colors = rows('color');
        if (colors.length) {
            var cb = panel('Colors', colors.length + ' defined');
            panelBody(cb).appendChild(table(['#', '', 'H,S,V'],
                colors.map(function (c) {
                    var swatch = hsvSwatch(c.spec);
                    return [{ text: c.index, cls: 'name' },
                            swatch || '', { text: c.spec, cls: 'name' }];
                })));
            frag.appendChild(cb);
        }

        var gb = panel('LED Strip Global Settings');
        var tbody = settingsTable(gb);
        var shown = 0;
        [{ cli: 'ledstrip_profile', label: 'Profile', enum: 'ledStripProfile' },
         { calc: 'blinkTempo', label: 'Blink tempo', unit: 'BPM', from: 'ledstrip_blink_period_ms' },
         { cli: 'ledstrip_fade_rate', label: 'Fade rate' },
         { cli: 'ledstrip_flicker_rate', label: 'Flicker rate' },
         { cli: 'ledstrip_brightness', label: 'Overall brightness' }].forEach(function (spec) {
            var row = layoutRow(spec, 0);
            if (row) { tbody.appendChild(row); shown++; }
        });
        if (shown) { frag.appendChild(gb); }

        return frag;
    }

    // ---------------------------------------------------------- beepers tab

    /* The Beepers tab, from src/tabs/beepers.html and src/js/Beepers.js.
     *
     * A `beeper` line names a condition the file turns on or off; anything the
     * file does not mention stays at its firmware default. The Configurator
     * lists its own conditions in its own order with a description for each,
     * so that is the list, and the file's state is looked up against it. Its
     * ESC beacon box offers the same conditions the beacon supports. */
    var BEACON_CONDITIONS = ['RX_LOST', 'RX_SET'];

    function beeperState(kind, name) {
        var found = null;
        rows(kind).forEach(function (b) {
            if (b.name === name) { found = b.enabled; }
        });
        return found;
    }

    function beeperTable(kind, list, only) {
        return table(['', 'Condition', ''], list.filter(function (b) {
            return !only || only.indexOf(b.n) >= 0;
        }).map(function (b) {
            return [
                flagSwitch(beeperState(kind, b.c) === true),
                { text: b.n, cls: 'name' },
                { text: b.d, cls: 'dim' }
            ];
        }), { empty: 'No ' + kind + ' lines in this file (all at their defaults).' });
    }

    function renderBeepers() {
        var frag = document.createDocumentFragment();
        var list = (window.RF_ENUMS || {}).beepers || [];

        if (list.length) {
            var box = panel('Buzzer Configuration', rows('beeper').length + ' lines in this file');
            panelBody(box).appendChild(beeperTable('beeper', list));
            frag.appendChild(box);

            /* The beacon has its own conditions, set by `beacon` lines. */
            var beacon = panel('ESC Beacon Configuration');
            var tbody = settingsTable(beacon);
            var tone = layoutRow({ cli: 'beeper_dshot_beacon_tone', label: 'Dshot Beacon Tone' }, 0);
            if (tone) { tbody.appendChild(tone); }
            panelBody(beacon).appendChild(beeperTable('beacon', list, BEACON_CONDITIONS));
            frag.appendChild(beacon);
        } else {
            var bs = rows('beeper');
            var plain = panel('Beeper Conditions', bs.length + ' changed');
            panelBody(plain).appendChild(table(['Condition', 'State'],
                bs.map(function (b) {
                    return [{ text: b.name, cls: 'name' },
                            { text: b.enabled ? 'ON' : 'OFF', cls: b.enabled ? 'on' : 'off' }];
                })));
            frag.appendChild(plain);
        }

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

        /* Worth saying plainly, because the column invites the comparison a
         * `diff all` makes and will not always agree with it. */
        var caveat = el('div', 'note',
            'The default column is the firmware\u2019s own, read from its source. '
            + 'A board sets some of its own on top of those \u2013 the voltage '
            + 'dividers, the bus and pin assignments, the gyro alignment \u2013 and '
            + 'those are in the board\u2019s configuration rather than the firmware\u2019s, '
            + 'so a hardware setting can be shown as changed when the aircraft has it '
            + 'at its board default. Flight tuning is unaffected.');
        panelBody(box).appendChild(caveat);

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
                    { text: s.entry.line, cls: 'dim nodiff' }
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
        /* ChannelRange.svelte: the throttle range is automatic when both ends
         * are zero, and the two endpoints are hidden while it is. */
        autoThrottleRange: function () {
            return masterValue('rc_min_throttle') === 0 && masterValue('rc_max_throttle') === 0;
        },
        fixedThrottleRange: function () { return !WHEN.autoThrottleRange(); },
        customTelemetry: function () { return lookupIndex('crsf_telemetry_mode') > 0; },
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

        /* led_strip.js msToBpm(): 60 x 250 / ms, clamped to 30..300. */
        blinkTempo: function () {
            var ms = masterValue('ledstrip_blink_period_ms');
            if (!ms) { return null; }
            var bpm = Math.round(60 * 250 / ms);
            return String(Math.min(300, Math.max(30, bpm)));
        },

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
        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(label));
        if (unit) { lab.appendChild(el('span', 'units', '[' + unit + ']')); }
        lab.appendChild(el('span', 'cli-name', provenance));
        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = why;
        help.appendChild(icon);
        row.setAttribute('data-k', 'derived:' + provenance);
        return rowOrder(row, control, lab, el('td', 'was'), help);
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

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(spec.label));
        if (spec.unit) { lab.appendChild(el('span', 'units', '[' + spec.unit + ']')); }
        if (spec.from) { lab.appendChild(el('span', 'cli-name', spec.from)); }

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = 'The Configurator computes this from ' + (spec.from || 'the mixer setup')
            + '. It is not a stored setting, so it has no firmware default.';
        help.appendChild(icon);
        row.setAttribute('data-k', 'calc:' + spec.calc);
        return rowOrder(row, control, lab, el('td', 'was'), help);
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

        var lab = el('td', 'label');
        lab.appendChild(document.createTextNode(spec.label));
        if (spec.unit) { lab.appendChild(el('span', 'units', '[' + spec.unit + ']')); }
        /* A ramp time is also printed as the rate it works out to. */
        if (spec.rate && versionOk(spec.rate) && Number(shown) > 0) {
            lab.appendChild(el('span', 'dim', (100 / Number(shown)).toFixed(1) + ' %/s'));
        }
        var cli = spec.cli + (spec.idx === undefined ? '' : '[' + spec.idx + ']');
        lab.appendChild(el('span', 'cli-name', cli));

        var was = el('td', 'was');
        if (changed) { was.textContent = 'was ' + def; }

        var help = el('td', 'help');
        var icon = el('div', 'helpicon', '?');
        icon.title = rowTooltip(spec.cli, m, present);
        help.appendChild(icon);
        row.setAttribute('data-k', 'set:' + cli);
        return rowOrder(row, control, lab, was, help);
    }

    /* Render a value the way the file or the firmware states it. */
    function format(value, m, name) {
        if (value === null || value === undefined) { return null; }
        if (emptyName(m, value)) { return '-'; }
        var bitWord = bitsetWord(m, value);
        if (bitWord) { return bitWord; }
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
            head.setAttribute('data-k', 'group:' + spec.group);
            tbody.appendChild(head);
        }

        rows.forEach(function (r) {
            r.className = (r.className ? r.className + ' ' : '') + 'suboption';
            tbody.appendChild(r);
        });
        return rows.length;
    }

    /* The Configurator draws this curve as a red line on a grid, which says
     * more at a glance than the list of percentages beside it. */
    function curveGraph(points) {
        var W = 300, H = 150, pad = 6;
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('class', 'curve-graph');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Governor bypass throttle curve');

        function add(tag, attrs) {
            var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
            svg.appendChild(node);
            return node;
        }

        for (var g = 0; g <= 4; g++) {
            var gx = pad + (W - 2 * pad) * g / 4;
            var gy = pad + (H - 2 * pad) * g / 4;
            add('line', { x1: gx, y1: pad, x2: gx, y2: H - pad, class: 'curve-grid' });
            add('line', { x1: pad, y1: gy, x2: W - pad, y2: gy, class: 'curve-grid' });
        }

        var xs = [], ys = [];
        points.forEach(function (v, i) {
            xs.push(pad + (W - 2 * pad) * i / Math.max(1, points.length - 1));
            ys.push(H - pad - (H - 2 * pad) * Math.min(1, (v / 2) / 100));
        });

        add('polyline', {
            points: xs.map(function (x, i) { return x + ',' + ys[i]; }).join(' '),
            class: 'curve-line'
        });
        xs.forEach(function (x, i) {
            add('circle', { cx: x, cy: ys[i], r: 3, class: 'curve-dot' });
        });
        return svg;
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
        wrap.appendChild(curveGraph(points));
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
            var table = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
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

    /* The failsafe channel fallbacks. These are `rxfail` lines, one per
     * channel: `a` auto, `h` hold, `s <value>` a fixed pulse width. The
     * Configurator offers Auto only for the five control channels
     * (src/tabs/failsafe/Failsafe.svelte). */
    var FALLBACK_MODES = { a: 'Auto', h: 'Hold', s: 'Set' };
    var CONTROL_AXES = ['Roll', 'Pitch', 'Yaw', 'Collective', 'Throttle'];

    function fallbacksBox() {
        var lines = rows('rxfail');
        if (!lines.length) { return null; }
        var table = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
        var tbody = el('tbody');
        table.appendChild(tbody);
        lines.forEach(function (line) {
            var name = line.channel < CONTROL_AXES.length
                ? CONTROL_AXES[line.channel]
                : 'AUX ' + (line.channel - CONTROL_AXES.length + 1);
            var mode = FALLBACK_MODES[line.mode] || line.mode;
            var shown = line.mode === 's' && line.value !== null
                ? mode + ' ' + line.value : mode;
            tbody.appendChild(simpleRow(name, null, shown,
                'rxfail ' + line.channel,
                'From the file\u2019s `rxfail` line for this channel.'));
        });
        return table;
    }

    // ------------------------------------------------------ telemetry sensors
    //
    // `telemetry_sensors` is a list of sensor ids, in the order they are sent.
    // The Receiver tab shows them as switches, grouped the way crsf.js groups
    // them, each group headed with how many of it are on.

    function telemetrySensorsBox() {
        var groups = (window.RF_ENUMS || {}).telemetrySensors || [];
        var chosen = masterValue('telemetry_sensors');
        if (!groups.length || !Array.isArray(chosen)) { return null; }

        var on = {};
        var order = [];
        chosen.forEach(function (id) {
            if (id > 0 && !on[id]) { on[id] = true; order.push(id); }
        });

        var byId = {};
        groups.forEach(function (g) {
            g.s.forEach(function (s) { byId[s.i] = s.l; });
        });

        var frag = document.createDocumentFragment();

        /* The order matters - it is the order they go out in - so it is
         * spelled out before the groups. */
        frag.appendChild(el('div', 'note', 'Sent in this order: '
            + order.map(function (id) { return byId[id] || ('id ' + id); }).join(', ')
            + '.'));

        groups.forEach(function (group) {
            var live = group.s.filter(function (s) { return !!on[s.i]; }).length;
            var table = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
            var tbody = el('tbody');
            table.appendChild(tbody);

            var head = el('tr', 'subheading');
            var cell = el('td', 'label');
            cell.colSpan = 4;
            cell.textContent = group.t;
            cell.appendChild(el('span', 'dim', live + ' / ' + group.s.length));
            head.appendChild(cell);
            tbody.appendChild(head);

            group.s.forEach(function (sensor) {
                tbody.appendChild(simpleRow(sensor.l, null, on[sensor.i] ? 'ON' : 'OFF',
                    'sensor ' + sensor.i,
                    'On when telemetry_sensors carries id ' + sensor.i + '.'));
            });
            frag.appendChild(table);
        });
        return frag;
    }

    // ------------------------------------------------------- channel assignment
    //
    // `map AECR1T23` gives one letter per RC channel, saying which control it
    // carries. The letters are the firmware's own (rx/rx.c:
    // "AERCT12345678"), and the CLI writes them as
    // `buf[rcmap[i]] = rcChannelLetters[i]`, so the letter at position N is
    // simply what RC channel N+1 is assigned to.

    var RC_LETTERS = 'AERCT12345678';
    var RC_FUNCTIONS = ['Roll', 'Pitch', 'Yaw', 'Collective', 'Throttle'];

    function functionName(index) {
        return index < RC_FUNCTIONS.length
            ? RC_FUNCTIONS[index]
            : 'AUX ' + (index - RC_FUNCTIONS.length + 1);
    }

    /* The Configurator names a map that matches one of its presets. */
    function presetFor(letters) {
        var rcmap = [];
        for (var i = 0; i < letters.length; i++) {
            rcmap[i] = letters.indexOf(RC_LETTERS.charAt(i));
        }
        var presets = (window.RF_ENUM_LISTS || {}).channelPresets || [];
        for (var p = 0; p < presets.length; p++) {
            var map = presets[p].map;
            if (map.length !== rcmap.length) { continue; }
            var same = true;
            for (var j = 0; j < map.length; j++) {
                if (map[j] !== rcmap[j]) { same = false; break; }
            }
            if (same) { return presets[p].label; }
        }
        return null;
    }

    function channelMapBox(gui) {
        var line = rows('map')[0];
        if (!line) { return null; }
        var letters = line.letters;

        var preset = presetFor(letters);
        var wrap = document.createDocumentFragment();
        if (preset) {
            var head = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
            var hbody = el('tbody');
            head.appendChild(hbody);
            hbody.appendChild(simpleRow('Apply Preset', null, preset, 'map',
                'The Configurator names a channel map that matches one of its presets.'));
            wrap.appendChild(head);
        }

        var table = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
        var tbody = el('tbody');
        table.appendChild(tbody);

        /* Channels past the map are fixed: the ninth is always AUX 4. */
        var total = Math.max(letters.length, 16);
        for (var ch = 0; ch < total; ch++) {
            var name;
            if (ch < letters.length) {
                var index = RC_LETTERS.indexOf(letters.charAt(ch));
                if (index < 0) { continue; }
                name = functionName(index);
            } else {
                name = functionName(ch);
            }
            tbody.appendChild(simpleRow(String(ch + 1), null, name, 'map',
                'From the file\u2019s `map` line: the letter in position '
                + (ch + 1) + ' names this channel.'));
        }
        wrap.appendChild(table);

        /* ChannelAssignment.svelte: the RSSI source reads ADC when the
         * feature is on, the named channel when one is set past the control
         * channels, and AUTO otherwise. */
        var rt = el('table', 'settings_table' + (state.rowStyle === 'svelte' ? ' svelte' : ''));
        var rb = el('tbody');
        rt.appendChild(rb);
        var channel = masterValue('rssi_channel');
        var source = featureOn('RSSI_ADC') ? 'ADC'
            : (channel > RC_FUNCTIONS.length ? functionName(channel - 1) : 'AUTO');
        rb.appendChild(simpleRow('RSSI', null, source, 'rssi_channel',
            'ADC when `feature RSSI_ADC` is on, a channel when rssi_channel '
            + 'names one past the control channels, AUTO otherwise.'));
        wrap.appendChild(rt);
        return wrap;
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
            /* A page can carry a box from the other visual language: the
             * Governor Settings box on Profiles is the Svelte governor
             * component embedded in a legacy page. */
            state.rowStyle = box.style || layout.style || 'legacy';
            var gui = panel(box.title, layout.scope
                ? layout.scope.replace('rateprofile', 'rate') + ' ' + index : '');

            if (box.when && WHEN[box.when] && !WHEN[box.when]()) { return; }

            if (box.serialPorts) {
                panelBody(gui).appendChild(serialPortsTable());
                grid.appendChild(gui);
                rendered++;
                return;
            }

            if (box.telemetrySensors) {
                var sensors = telemetrySensorsBox();
                if (sensors) {
                    panelBody(gui).appendChild(sensors);
                    grid.appendChild(gui);
                    rendered++;
                }
                return;
            }

            if (box.channelMap) {
                var cm = channelMapBox(gui);
                if (cm) { panelBody(gui).appendChild(cm); grid.appendChild(gui); rendered++; }
                return;
            }

            if (box.fallbacks) {
                var fb = fallbacksBox();
                if (fb) { panelBody(gui).appendChild(fb); grid.appendChild(gui); rendered++; }
                return;
            }

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

        state.rowStyle = layout.style || 'legacy';
        frag.appendChild(grid);

        /* A transcribed page shows the boxes the Configurator's page shows
         * and nothing else. A setting it has no box for is still in the
         * file and still readable, on the All Settings tab. */

        if (!rendered) { frag.appendChild(el('div', 'empty-note', emptyMessage())); }
        return frag;
    }

    var RENDERERS = {
        setup: renderSetup,
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
            configuration: ['serial'],
            servos: ['servo'], mixer: ['mixerInput'],
            beepers: ['beeper', 'beacon'], ledstrip: ['led', 'color'],
            receiver: ['map'], failsafe: ['rxfail']
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
        var icons = window.RF_ICONS || {};
        S.TABS.forEach(function (t) {
            var count = tabContentCount(t.id);
            var link = el('div', 'tab-link' +
                (t.id === state.tab ? ' active' : '') +
                (!DIFFS && count === 0 ? ' empty' : ''));
            link.setAttribute('data-tab', t.id);

            /* The Configurator's own icon, masked so it takes the tab's
             * colour rather than needing a second file for the selected one. */
            var icon = el('span', 'tabicon');
            if (icons[t.id]) {
                icon.style.webkitMaskImage = 'url("' + icons[t.id] + '")';
                icon.style.maskImage = 'url("' + icons[t.id] + '")';
            }
            link.appendChild(icon);

            link.appendChild(el('span', 'tabname', t.name));
            /* In a comparison the useful number is not how much of the file a
             * tab holds but whether the two files disagree anywhere on it. */
            if (DIFFS) {
                var d = t.id === 'cli' ? null : (DIFFS[t.id] || 0);
                if (d !== null) {
                    var mark = el('span', 'count' + (d ? ' differs' : ''), d || '');
                    mark.title = d
                        ? d + ' setting' + (d === 1 ? '' : 's') + ' differ between the two files'
                        : 'The two files agree on every setting this tab covers';
                    link.appendChild(mark);
                }
            } else if (count !== null) {
                var badge = el('span', 'count', count);
                badge.title = count + ' value' + (count === 1 ? '' : 's') + ' from this file';
                link.appendChild(badge);
            }
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

        function fileLine(f, tag) {
            var row = el('div');
            if (tag) { row.appendChild(el('span', 'pane-tag', tag)); }
            row.appendChild(el('span', 'chip kind-' + f.parsed.kind, f.parsed.kind));
            row.appendChild(document.createTextNode(' ' + (f.name || 'pasted text')));
            return row;
        }

        if (comparing()) {
            meta$.appendChild(fileLine(state.files[0], 'A'));
            meta$.appendChild(fileLine(state.files[1], 'B'));
        } else {
            meta$.appendChild(fileLine(state.files[0], ''));
        }

        var firmware = (p.header.version || 'unknown')
            + (p.header.firmware ? ' ' + p.header.firmware : '');
        var target = (p.header.board_name || '?')
            + (p.header.mcuTarget ? '(' + p.header.mcuTarget + ')' : '');
        if (!comparing()) {
            meta$.appendChild(line('Firmware', firmware));
            meta$.appendChild(line('Target', target));
        }

        var footer = clear($('#footertext'));
        if (footer) {
            /* One file fills the strip the way the Configurator's does. Two
             * share it, tagged, because which file a number belongs to matters
             * more here than the labels do. */
            if (comparing()) {
                state.files.forEach(function (f, i) {
                    var q = f.parsed;
                    var item = el('span');
                    item.appendChild(el('span', 'pane-tag', i === 0 ? 'A' : 'B'));
                    item.appendChild(el('b', null, q.header.craftName || '\u2014'));
                    item.appendChild(document.createTextNode(' \u00b7 ' + q.setCount
                        + ' settings \u00b7 RF ' + (q.header.version || '?')
                        + ' \u00b7 ' + (q.header.board_name || '?')));
                    footer.appendChild(item);
                });
            } else {
                [['Craft', p.header.craftName || '\u2014'],
                 ['Settings', String(p.setCount)],
                 ['Profiles', Object.keys(p.profiles).length + ' PID, '
                     + Object.keys(p.rateProfiles).length + ' rate'],
                 ['Firmware', firmware],
                 ['Target', target]].forEach(function (pair) {
                    var item = el('span');
                    item.appendChild(document.createTextNode(pair[0] + ': '));
                    item.appendChild(el('b', null, pair[1]));
                    footer.appendChild(item);
                });
            }
        }

        var status = $('#statustext');
        if (status) {
            if (comparing()) {
                var total = 0;
                Object.keys(DIFFS || {}).forEach(function (k) { total += DIFFS[k]; });
                var a = state.files[0];
                var b = state.files[1];
                status.textContent = 'Comparing ' + (a.name || 'pasted text')
                    + ' with ' + (b.name || 'pasted text') + ' \u2014 '
                    + total + ' setting' + (total === 1 ? '' : 's') + ' differ'
                    + (total === 1 ? 's' : '') + ' \u2014 read with Rotorflight '
                    + (a.dbKey === b.dbKey ? (a.dbKey || '?')
                        : (a.dbKey || '?') + ' and ' + (b.dbKey || '?')) + ' metadata';
            } else {
                status.textContent = (p.header.craftName ? p.header.craftName + ' \u2014 ' : '') +
                    p.setCount + ' settings, ' +
                    Object.keys(p.profiles).length + ' profiles, ' +
                    Object.keys(p.rateProfiles).length + ' rate profiles \u2014 ' +
                    'read with Rotorflight ' + (state.dbKey || '?') + ' metadata';
            }
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

            /* Off by default: the Configurator shows a label and nothing else,
             * and a second line under every label is the loudest way this page
             * stops looking like it. */
            var nameLab = el('label');
            var nameCb = el('input');
            nameCb.type = 'checkbox';
            nameCb.checked = state.showCli;
            nameCb.onchange = function () {
                state.showCli = nameCb.checked;
                applyCliNames();
            };
            nameLab.appendChild(nameCb);
            nameLab.appendChild(document.createTextNode('CLI names'));
            bar.appendChild(nameLab);

            if (comparing()) {
                var diffLab = el('label');
                var diffCb = el('input');
                diffCb.type = 'checkbox';
                diffCb.checked = state.diffOnly;
                diffCb.onchange = function () {
                    state.diffOnly = diffCb.checked;
                    renderContentOnly();
                };
                diffLab.appendChild(diffCb);
                diffLab.appendChild(document.createTextNode('Differences only'));
                bar.appendChild(diffLab);
            }
        }

        host.appendChild(bar);
        return bar;
    }

    // ------------------------------------------------------- comparison

    /* Two files are compared by drawing the same page twice, once per file,
     * and then pairing the rows of the two panes. Doing it on the rendered
     * page rather than on the parsed files means the comparison is of what the
     * viewer actually shows - scaled, named, computed and all - which is what
     * the reader is comparing. It also means no renderer has to know that a
     * second file exists.
     *
     * Rows pair by key. A settings row carries its CLI name; a table row is
     * keyed by its first column, which in these tables is an identity rather
     * than a value. Keys are scoped to the box they sit in, because the same
     * name turns up in more than one box, and a key that repeats inside one
     * box is numbered by the order it appears in. */

    var SEP = String.fromCharCode(0);
    var USEP = String.fromCharCode(31);

    function nearestBox(node) {
        var n = node;
        while (n && n !== document) {
            if (n.classList && n.classList.contains('gui_box')) { return n; }
            n = n.parentNode;
        }
        return null;
    }

    function boxTitleOf(node) {
        var box = nearestBox(node);
        var title = box ? box.querySelector('.spacer_box_title') : null;
        return title ? title.textContent : '';
    }

    function rowKey(tr) {
        var k = tr.getAttribute('data-k');
        if (!k) {
            var first = tr.firstElementChild;
            k = 'cell:' + (first ? (first.textContent || '').trim() : '');
        }
        return boxTitleOf(tr) + SEP + k;
    }

    /* What a cell shows, whichever widget it shows it in. */
    function cellText(td) {
        var input = td.querySelector('input');
        if (input) { return input.value; }
        var sel = td.querySelector('select');
        if (sel) { return (sel.textContent || '').trim(); }
        var sw = td.querySelector('.switch');
        if (sw) { return sw.classList.contains('on') ? 'ON' : 'OFF'; }
        return (td.textContent || '').trim();
    }

    /* What a row is compared on: the value in its control where it has one,
     * and otherwise every cell of it except those marked as a fact about the
     * file rather than about the setting, such as a line number. */
    function rowSignature(tr) {
        var control = tr.querySelector('td.control');
        if (control) { return cellText(control); }
        var out = [];
        for (var i = 0; i < tr.children.length; i++) {
            var td = tr.children[i];
            if (td.classList.contains('nodiff')) { continue; }
            out.push(cellText(td));
        }
        return out.join(USEP);
    }

    function indexPane(pane) {
        var map = {};
        var seen = {};
        var list = pane.querySelectorAll('tr');
        for (var i = 0; i < list.length; i++) {
            var tr = list[i];
            if (tr.parentNode && tr.parentNode.tagName === 'THEAD') { continue; }
            if (tr.classList.contains('subheading')) { continue; }
            var k = rowKey(tr);
            seen[k] = (seen[k] || 0) + 1;
            map[k + SEP + seen[k]] = tr;
        }
        return map;
    }

    /* Mark every row the two panes disagree on, and every row only one of them
     * has. Returns how many rows that came to. */
    function markDifferences(paneA, paneB) {
        var a = indexPane(paneA);
        var b = indexPane(paneB);
        var n = 0;

        Object.keys(a).forEach(function (k) {
            var ra = a[k];
            var rb = b[k];
            if (!rb) {
                ra.classList.add('is-only');
                ra.title = 'B’s page does not have this row.';
                n++;
                return;
            }
            var sa = rowSignature(ra);
            var sb = rowSignature(rb);
            if (sa === sb) { return; }
            ra.classList.add('is-diff');
            rb.classList.add('is-diff');
            ra.title = 'B has ' + (sb === '' ? '(nothing)' : sb);
            rb.title = 'A has ' + (sa === '' ? '(nothing)' : sa);
            n++;
        });

        Object.keys(b).forEach(function (k) {
            if (a[k]) { return; }
            b[k].classList.add('is-only');
            b[k].title = 'A’s page does not have this row.';
            n++;
        });

        return n;
    }

    /* "Differences only": drop the rows the two files agree on, then the
     * tables and boxes that emptied out, so what is left is the disagreement
     * and nothing else. */
    function pruneToDifferences(root) {
        var i, j;
        var bodies = root.querySelectorAll('tbody');
        for (i = 0; i < bodies.length; i++) {
            var kept = [].slice.call(bodies[i].children);
            for (j = 0; j < kept.length; j++) {
                var tr = kept[j];
                if (tr.classList.contains('is-diff') || tr.classList.contains('is-only')) {
                    continue;
                }
                tr.parentNode.removeChild(tr);
            }
        }
        var tables = root.querySelectorAll('table');
        for (i = 0; i < tables.length; i++) {
            var tb = tables[i].querySelector('tbody');
            if (tb && !tb.children.length) {
                var wrap = tables[i].parentNode;
                wrap.removeChild(tables[i]);
                if (wrap.classList.contains('tablewrap') && !wrap.children.length) {
                    wrap.parentNode.removeChild(wrap);
                }
            }
        }
        var boxes = root.querySelectorAll('.gui_box');
        for (i = 0; i < boxes.length; i++) {
            if (!boxes[i].querySelector('tbody tr')) {
                boxes[i].parentNode.removeChild(boxes[i]);
            }
        }
    }

    /* How many settings the two files disagree on, per tab, read from the
     * parsed files rather than from the page so the rail can say it for every
     * tab at once. A value a file leaves out is at its firmware default, which
     * is what it is compared at: a `diff` prints only what changed where a
     * `dump` prints everything, and those two should not read as disagreeing
     * over a value they both leave alone. */
    function shownFor(file, name, entry) {
        var wasDb = state.db;
        var wasKey = state.dbKey;
        state.db = file.db;
        state.dbKey = file.dbKey;
        var out = entry ? valueDisplay(entry, name) : defaultDisplay(name);
        state.db = wasDb;
        state.dbKey = wasKey;
        return out;
    }

    function tabDiffCounts() {
        var fa = state.files[0];
        var fb = state.files[1];
        if (!fb) { return null; }
        var counts = {};
        var wasDb = state.db;
        state.db = fa.db;

        function bump(name) {
            var tab = S.tabFor(name, meta(name));
            counts[tab] = (counts[tab] || 0) + 1;
        }

        function compareSections(secA, secB) {
            var names = {};
            Object.keys(secA || {}).forEach(function (n) { names[n] = true; });
            Object.keys(secB || {}).forEach(function (n) { names[n] = true; });
            Object.keys(names).forEach(function (n) {
                var x = shownFor(fa, n, secA && secA[n]);
                var y = shownFor(fb, n, secB && secB[n]);
                if (x !== y) { bump(n); }
            });
        }

        compareSections(fa.parsed.master, fb.parsed.master);
        for (var i = 0; i < 6; i++) {
            compareSections(fa.parsed.profiles[i], fb.parsed.profiles[i]);
            compareSections(fa.parsed.rateProfiles[i], fb.parsed.rateProfiles[i]);
        }
        state.db = wasDb;
        return counts;
    }

    var DIFFS = null;

    /* The strip at the top of each pane saying which file it is showing. */
    function paneHead(i) {
        var f = state.files[i];
        var head = el('div', 'pane-head');
        head.appendChild(el('span', 'pane-tag', i === 0 ? 'A' : 'B'));
        head.appendChild(el('span', 'pane-name', f.name || 'pasted text'));
        head.appendChild(el('span', 'chip kind-' + f.parsed.kind, f.parsed.kind));
        if (f.parsed.header.version) {
            head.appendChild(el('span', 'pane-fw', 'RF ' + f.parsed.header.version));
        }
        head.appendChild(el('span', 'grow'));
        if (i === 1) {
            var close = el('button', 'btn tiny', 'Close');
            close.type = 'button';
            close.title = 'Stop comparing and go back to the first file';
            close.onclick = function () {
                state.files = [state.files[0]];
                useFile(0);
                render();
            };
            head.appendChild(close);
        }
        return head;
    }

    /* The CLI tab has no rows to pair, so its two panes are compared line by
     * line instead: a line is marked when the other file has no copy of it
     * left over to match it with. */
    function markCliLines(paneA, paneB) {
        function lines(pane) { return pane.querySelectorAll('pre.cli .ln'); }
        function tally(list) {
            var t = {};
            for (var i = 0; i < list.length; i++) {
                var k = (list[i].textContent || '').trim();
                t[k] = (t[k] || 0) + 1;
            }
            return t;
        }
        var n = 0;

        function mark(list, other) {
            for (var i = 0; i < list.length; i++) {
                var k = (list[i].textContent || '').trim();
                if (k === '') { continue; }
                if (other[k]) { other[k]--; continue; }
                list[i].classList.add('only');
                n++;
            }
        }
        mark(lines(paneA), tally(lines(paneB)));
        mark(lines(paneB), tally(lines(paneA)));
        return n;
    }

    /* The Configurator is written in two visual languages and the difference is
     * plain on screen: its older tabs put the control on the left and the label
     * to its right, and the Svelte ones it has been rewriting into put the
     * label on the left with the control against the right edge. A layout says
     * which it is, and the rows are assembled that way round. */
    function rowOrder(row, control, label, was, help) {
        if (state.rowStyle === 'svelte') {
            row.appendChild(label);
            row.appendChild(was);
            row.appendChild(control);
            row.appendChild(help);
        } else {
            row.appendChild(control);
            row.appendChild(label);
            row.appendChild(was);
            row.appendChild(help);
        }
        return row;
    }

    function applyCliNames() {
        document.body.classList.toggle('show-cli', !!state.showCli);
    }

    function currentTabDef() {
        return S.TABS.filter(function (t) { return t.id === state.tab; })[0] || S.TABS[0];
    }

    /* The page for whichever file `state` is pointed at: its own warnings,
     * then whatever this tab renders. Pulled out of renderContentOnly() so a
     * comparison can call it once per file without either call knowing the
     * other happened. */
    function buildTabBody(def) {
        var frag = document.createDocumentFragment();
        if (state.parsed.warnings.length) {
            state.parsed.warnings.forEach(function (w) {
                frag.appendChild(el('div', 'note warn', w));
            });
        }
        if (!state.db && state.tab !== 'cli') {
            frag.appendChild(el('div', 'note warn',
                'No firmware metadata is loaded, so defaults and value names are unavailable.'));
        }
        frag.appendChild(RENDERERS[def.id] ? RENDERERS[def.id]()
            : renderLayoutTab(def.id)
            || renderSettingsTab(def.id, { scope: SCOPED[def.id] || 'master' }));
        return frag;
    }

    /* The All Settings page of a comparison is the one page that should not be
     * two lists side by side. A `dump` prints every setting and a `diff` prints
     * only what it changed, so paired that way almost every row of the longer
     * list would have no opposite number and the page would say "only in A"
     * a thousand times over. One list of every setting either file names, with
     * a column each, says the same thing in a form that can be read.
     *
     * A setting a file leaves out is at its firmware default, which is what it
     * is compared at, so a `dump` and a `diff` of the same aircraft agree. */
    function renderAllCompare() {
        var frag = document.createDocumentFragment();
        var fa = state.files[0];
        var fb = state.files[1];
        var seen = {};
        var list = [];

        [fa, fb].forEach(function (f) {
            f.parsed.allSettings().forEach(function (e) {
                var at = (e.index === null || e.index === undefined) ? '' : e.index;
                var key = e.scope + ':' + at + ':' + e.name;
                if (seen[key]) { return; }
                seen[key] = true;
                list.push({ name: e.name, scope: e.scope, index: e.index });
            });
        });

        list.sort(function (a, b) {
            if (a.scope !== b.scope) { return a.scope < b.scope ? -1 : 1; }
            if (a.index !== b.index) { return (a.index || 0) - (b.index || 0); }
            return a.name < b.name ? -1 : 1;
        });

        /* What one file shows for one setting, read with that file's own
         * metadata: the two can be from different releases, and a factor or a
         * value name that moved between them belongs to the file that used it. */
        function shownIn(f, e) {
            var section = e.scope === 'profile' ? f.parsed.profiles[e.index]
                        : e.scope === 'rateprofile' ? f.parsed.rateProfiles[e.index]
                        : f.parsed.master;
            var entry = section && section[e.name];
            return {
                text: entry ? shownFor(f, e.name, entry) : null,
                resolved: shownFor(f, e.name, entry)
            };
        }

        var differing = 0;
        var built = [];
        list.forEach(function (e) {
            if (!matchesFilter(e.name, S.prettify(e.name))) { return; }
            var a = shownIn(fa, e);
            var b = shownIn(fb, e);
            var differs = a.resolved !== b.resolved;
            if (differs) { differing++; }
            if (state.diffOnly && !differs) { return; }

            var tabId = S.tabFor(e.name, meta(e.name));
            var tabDef = S.TABS.filter(function (t) { return t.id === tabId; })[0];

            function cell(v, side) {
                return v.text === null
                    ? { text: v.resolved === null ? 'no default known'
                        : v.resolved + ' (default)', cls: 'dim wrap ' + side }
                    : { text: v.text, cls: 'wrap ' + side + (differs ? ' on' : '') };
            }

            built.push({
                differs: differs,
                cells: [
                    { text: e.name, cls: 'name' },
                    { text: e.scope === 'master' ? 'master' : e.scope + ' ' + e.index, cls: 'dim' },
                    cell(a, 'va'),
                    cell(b, 'vb'),
                    { text: tabDef ? tabDef.name : tabId, cls: 'dim tabcol' }
                ]
            });
        });

        var box = panel('Every value in either file',
            differing + ' of ' + list.length + ' differ');
        panelBody(box).appendChild(el('div', 'note',
            'A setting one file leaves out is at its firmware default, and that '
            + 'is what it is compared at — a `dump all` prints every value '
            + 'where a `diff all` prints only what was changed, so the two files '
            + 'of the same aircraft agree here rather than disagreeing on every '
            + 'line one of them omits. The default it falls back to is the '
            + 'firmware’s own, and a board sets some of its own on top of '
            + 'those — the voltage dividers, the bus and pin assignments, the '
            + 'gyro alignment — so a `dump` compared with a `diff` will differ '
            + 'on exactly those: the `dump` prints the board’s value and the '
            + '`diff` leaves it out as unchanged. Flight tuning is unaffected.'
            + (fa.dbKey === fb.dbKey ? '' :
                ' The two files are from different releases (' + fa.dbKey + ' and '
                + fb.dbKey + '), so each is read with its own metadata and some '
                + 'defaults differ between them.')));

        panelBody(box).appendChild(table(
            ['Setting', 'Scope', 'A · ' + (fa.name || 'pasted text'),
             'B · ' + (fb.name || 'pasted text'), 'Tab'],
            built.map(function (r) { return r.cells; }),
            { empty: state.diffOnly
                ? 'The two files agree on every setting either of them names.'
                : 'Nothing matches the current filter.' }));

        /* `table` builds the rows, so the marking goes on afterwards. */
        var grid$ = panelBody(box).querySelector('table.rf');
        if (grid$) { grid$.classList.add('cmp'); }
        var trs = panelBody(box).querySelectorAll('tbody tr');
        for (var i = 0; i < built.length && i < trs.length; i++) {
            if (built[i].differs) { trs[i].classList.add('is-diff'); }
        }

        frag.appendChild(box);
        return { frag: frag, count: differing };
    }

    function renderContentOnly() {
        var host = clear($('#content'));
        var def = currentTabDef();

        /* Which of the Configurator's two layouts this page uses. */
        var layout = (window.RF_LAYOUT || {})[def.id];
        var baseStyle = (layout && layout.style) || 'legacy';
        state.rowStyle = baseStyle;
        host.className = 'style-' + baseStyle + (comparing() ? ' comparing' : '');

        var title = el('div', 'tab_title');
        title.appendChild(document.createTextNode(def.name));
        /* A `diff` leaves most settings out, and the page fills them in from
         * the firmware, which is worth saying once per page rather than never. */
        if (!comparing() && state.parsed.kind === 'diff') {
            title.appendChild(el('span', 'sub',
                'a diff carries only what changed; the rest are shown at their '
                + 'firmware default'));
        }
        host.appendChild(title);

        var bar = renderToolbar(host);

        /* A `dump all` prints every beeper, LED, colour and failsafe channel
         * where a `diff all` prints none of them, so those parts of a page
         * will read as differing when the two files are of different kinds and
         * the aircraft is the same. Worth saying once, where it will be read.
         * The All Settings page is unaffected: it compares a missing value at
         * its firmware default. */
        if (comparing() && state.files[0].parsed.kind !== state.files[1].parsed.kind) {
            host.appendChild(el('div', 'note',
                'These are a ' + state.files[0].parsed.kind + ' and a '
                + state.files[1].parsed.kind + '. A `dump` prints every beeper, '
                + 'LED, colour and failsafe channel where a `diff` prints only '
                + 'what was changed, so rows built from those lines can be marked '
                + 'as differing on two files that describe the same aircraft. '
                + 'Settings themselves are compared at what they resolve to, so '
                + 'they are not affected.'));
        }

        if (!comparing()) {
            host.appendChild(buildTabBody(def));
            applyCliNames();
            return;
        }

        if (def.id === 'all') {
            var merged = renderAllCompare();
            host.appendChild(merged.frag);
            if (bar) { bar.appendChild(diffSummary(def, merged.count)); }
            applyCliNames();
            return;
        }

        /* Each pane is the whole page drawn again for the other file. The row
         * style has to be reset before each one because a box is allowed to
         * change it part way down a page. */
        var panes = el('div', 'panes');
        var bodies = [];
        state.files.forEach(function (f, i) {
            var pane = el('div', 'pane');
            pane.appendChild(paneHead(i));
            useFile(i);
            state.rowStyle = baseStyle;
            var body = el('div', 'pane-body style-' + baseStyle);
            body.appendChild(buildTabBody(def));
            pane.appendChild(body);
            panes.appendChild(pane);
            bodies.push(body);
        });
        useFile(0);
        host.appendChild(panes);

        var n = def.id === 'cli'
            ? markCliLines(bodies[0], bodies[1])
            : markDifferences(bodies[0], bodies[1]);

        if (state.diffOnly && def.id !== 'cli') {
            bodies.forEach(pruneToDifferences);
            bodies.forEach(function (body) {
                if (!body.querySelector('.gui_box, table')) {
                    body.appendChild(el('div', 'empty-note',
                        'Nothing on this page differs between the two files.'));
                }
            });
        }

        if (bar) { bar.appendChild(diffSummary(def, n)); }
        applyCliNames();
    }

    /* What the comparison found on this page, said once, in the toolbar. */
    function diffSummary(def, n) {
        var chip = el('span', 'diffcount' + (n ? ' on' : ''));
        if (def.id === 'cli') {
            chip.textContent = n
                ? n + ' line' + (n === 1 ? '' : 's') + ' only in one file'
                : 'Both files carry the same lines';
            chip.title = 'Lines are matched by their text, so a line the other '
                + 'file has a copy of is not marked wherever it sits in it.';
        } else {
            chip.textContent = n
                ? (def.id === 'all'
                    ? n + ' setting' + (n === 1 ? ' differs' : 's differ')
                    : n + (n === 1 ? ' row differs' : ' rows differ') + ' on this page')
                : 'The two files agree on this page';
            chip.title = 'Counted on what the page shows, so a value the two '
                + 'files write differently but display the same does not count.';
        }
        return chip;
    }

    function render() {
        if (!state.parsed) { renderWelcome(); return; }
        useFile(0);
        DIFFS = comparing() ? tabDiffCounts() : null;
        INDEX = buildIndex();
        $('#welcome-wrap').style.display = 'none';
        $('#layout').style.display = 'flex';
        $('#new-btn').hidden = false;
        $('#cmp-btn').hidden = false;
        $('#cmp-btn').textContent = comparing() ? 'Change file B\u2026' : 'Compare with\u2026';
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
        $('#cmp-btn').hidden = true;
    }

    // ------------------------------------------------------- file loading

    /* One loaded file: the parsed text, and the firmware metadata that matches
     * the release it came from. The two files of a comparison can be from
     * different releases, so each carries its own. */
    function makeFile(text, name) {
        var parsed = window.RFParser.parse(text);
        var dbKey = chooseDb(parsed.header.version);
        return {
            parsed: parsed,
            name: name || '',
            dbKey: dbKey,
            db: dbKey ? window.RF_DB[dbKey] : null
        };
    }

    /* `slot` 1 loads the file to compare against; anything else replaces what
     * is loaded and ends any comparison in progress. */
    function load(text, name, slot) {
        var f;
        try {
            f = makeFile(text, name);
        } catch (e) {
            window.alert('Could not parse that file: ' + e.message);
            return;
        }

        if (slot === 1 && state.files.length) {
            state.files[1] = f;
        } else {
            state.files = [f];
            state.tab = 'setup';
            state.filter = '';
            state.diffOnly = false;
            state.profile = f.parsed.activeProfile === null ? 0 : f.parsed.activeProfile;
            state.rateProfile = f.parsed.activeRateProfile === null
                ? 0 : f.parsed.activeRateProfile;
        }
        useFile(0);
        render();
    }

    function readFile(file, slot, then) {
        var reader = new FileReader();
        reader.onload = function () {
            load(String(reader.result), file.name, slot);
            if (then) { then(); }
        };
        reader.onerror = function () { window.alert('Could not read ' + file.name); };
        reader.readAsText(file);
    }

    /* Two files dropped together: the first becomes the page, the second the
     * one it is compared with. Read in turn, because the second can only be
     * slotted in behind a file that is already loaded. */
    function readPair(a, b) {
        readFile(a, 0, function () { readFile(b, 1); });
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
            /* Two files at once is the comparison, said in one gesture. */
            var dropped = e.dataTransfer.files;
            if (dropped && dropped.length > 1) {
                readPair(dropped[0], dropped[1]);
            } else if (dropped && dropped.length) {
                readFile(dropped[0]);
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
            var picked = e.target.files;
            if (!picked || !picked.length) { return; }
            /* Picking two at once is the comparison, said in one gesture. */
            if (picked.length > 1) { readPair(picked[0], picked[1]); }
            else { readFile(picked[0]); }
        };
        $('#open-btn').onclick = function () { $('#file-input').click(); };
        $('#open-btn-2').onclick = function () { $('#file-input').click(); };

        /* The second file of a comparison has its own picker so that choosing
         * it never risks replacing the first. */
        $('#cmp-input').onchange = function (e) {
            if (e.target.files && e.target.files[0]) { readFile(e.target.files[0], 1); }
        };
        $('#cmp-btn').onclick = function () { $('#cmp-input').click(); };

        $('#new-btn').onclick = function () {
            state.parsed = null;
            state.files = [];
            DIFFS = null;
            $('#file-input').value = '';
            $('#cmp-input').value = '';
            clear($('#filemeta'));
            clear($('#footertext'));
            $('#statustext').textContent = 'No file loaded';
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
