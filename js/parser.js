/*
 * Parser for Rotorflight CLI output: `dump all`, `diff all`, and the preset
 * snippets that share the same syntax.
 *
 * Nothing here is interpreted or rescaled - every value is kept exactly as the
 * flight controller printed it. Interpretation (defaults, enum names, ranges)
 * happens later, against the metadata generated from the firmware source.
 */

(function (global) {
    'use strict';

    // Lines that are pure CLI plumbing and carry no configuration.
    var NOISE = /^(batch\s+(start|end)|defaults\s+nosave|save|exit)\b/i;

    // `# Rotorflight / STM32F7X2 (S7X2) 4.5.1 Jul 25 2025 / 06:37:48 (e69823a) MSP API: 12.8`
    var VERSION_RE = new RegExp(
        '^#\\s*(\\w[\\w-]*)\\s*/\\s*(\\S+)\\s*(?:\\(([^)]*)\\))?\\s+' +
        '(\\d+\\.\\d+\\.\\d+\\S*)\\s+(.*?)' +
        '(?:\\s*\\(([0-9a-f]{6,})\\))?' +
        '(?:\\s*MSP API:\\s*(\\S+))?\\s*$', 'i');

    function blankSection() {
        return Object.create(null);
    }

    function parseNumberList(text) {
        var parts = String(text).split(',');
        var nums = parts.map(function (p) {
            var t = p.trim();
            if (t === '' || !/^-?\d+$/.test(t)) { return null; }
            return parseInt(t, 10);
        });
        return nums.indexOf(null) === -1 ? nums : null;
    }

    /* Turn the right-hand side of `set x = y` into a JS value.
     * Numbers become numbers, comma lists become arrays of numbers, and
     * anything else (enum names, strings, empty) stays a string. */
    function coerce(text) {
        var t = String(text).trim();
        if (t === '') { return ''; }
        if (/^-?\d+$/.test(t)) { return parseInt(t, 10); }
        if (t.indexOf(',') !== -1) {
            var list = parseNumberList(t);
            if (list) { return list; }
        }
        return t;
    }

    function splitWords(text) {
        return text.trim().split(/\s+/).filter(function (w) { return w.length; });
    }

    function nums(words) {
        return words.map(function (w) {
            var n = parseInt(w, 10);
            return isNaN(n) ? w : n;
        });
    }

    function Parsed() {
        this.kind = 'unknown';
        this.header = {};
        this.master = blankSection();
        this.profiles = {};
        this.rateProfiles = {};
        this.activeProfile = null;
        this.activeRateProfile = null;
        this.features = [];
        this.rows = {};          // command name -> array of parsed rows
        this.unknown = [];
        this.warnings = [];
        this.raw = '';
        this.lineCount = 0;
        this.setCount = 0;
    }

    Parsed.prototype.row = function (kind, obj) {
        (this.rows[kind] || (this.rows[kind] = [])).push(obj);
    };

    Parsed.prototype.profile = function (n) {
        if (!this.profiles[n]) { this.profiles[n] = blankSection(); }
        return this.profiles[n];
    };

    Parsed.prototype.rateProfile = function (n) {
        if (!this.rateProfiles[n]) { this.rateProfiles[n] = blankSection(); }
        return this.rateProfiles[n];
    };

    /* Every `set` in the file, flattened, so the search tab can list them all. */
    Parsed.prototype.allSettings = function () {
        var out = [];
        var self = this;
        Object.keys(this.master).forEach(function (k) {
            out.push({ scope: 'master', index: null, name: k, entry: self.master[k] });
        });
        Object.keys(this.profiles).forEach(function (p) {
            Object.keys(self.profiles[p]).forEach(function (k) {
                out.push({ scope: 'profile', index: +p, name: k, entry: self.profiles[p][k] });
            });
        });
        Object.keys(this.rateProfiles).forEach(function (p) {
            Object.keys(self.rateProfiles[p]).forEach(function (k) {
                out.push({ scope: 'rateprofile', index: +p, name: k, entry: self.rateProfiles[p][k] });
            });
        });
        return out;
    };

    function parseHeaderComment(out, body, lineNo) {
        var m = VERSION_RE.exec('# ' + body);
        if (m) {
            out.header.firmware = m[1];
            out.header.mcuTarget = m[2];
            out.header.targetShort = m[3] || '';
            out.header.version = m[4];
            out.header.buildDate = (m[5] || '').trim();
            out.header.gitHash = m[6] || '';
            out.header.mspApi = m[7] || '';
            return true;
        }
        var nameMatch = /^name:\s*(.*)$/i.exec(body);
        if (nameMatch) {
            out.header.craftName = nameMatch[1].trim();
            return true;
        }
        // `# pin A08: TIM1 CH1 (AF1)` - an annotation on the line above.
        var pin = /^pin\s+(\S+):\s*(.*)$/i.exec(body);
        if (pin) {
            out.row('pinNote', { line: lineNo, pin: pin[1], note: pin[2] });
            return true;
        }
        return false;
    }

    function parse(text) {
        var out = new Parsed();
        out.raw = text;

        var lines = text.split(/\r?\n/);
        out.lineCount = lines.length;

        // Where subsequent `set` lines land.
        var target = out.master;
        var scope = { kind: 'master', index: null };
        var sawDumpAll = false;
        var sawDiffAll = false;

        for (var i = 0; i < lines.length; i++) {
            var lineNo = i + 1;
            var line = lines[i];
            var trimmed = line.trim();
            if (!trimmed) { continue; }

            if (trimmed.charAt(0) === '#') {
                var body = trimmed.replace(/^#+\s*/, '');
                if (/^diff\s+all\b/i.test(body)) { sawDiffAll = true; continue; }
                if (/^dump\s+all\b/i.test(body)) { sawDumpAll = true; continue; }
                parseHeaderComment(out, body, lineNo);
                continue;
            }

            if (NOISE.test(trimmed)) { continue; }

            var sp = trimmed.indexOf(' ');
            var cmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
            var rest = sp === -1 ? '' : trimmed.slice(sp + 1).trim();

            switch (cmd) {
            case 'set': {
                var eq = rest.indexOf('=');
                if (eq === -1) { out.unknown.push({ line: lineNo, text: trimmed }); break; }
                var key = rest.slice(0, eq).trim();
                var rawValue = rest.slice(eq + 1).trim();
                target[key] = {
                    value: coerce(rawValue),
                    raw: rawValue,
                    line: lineNo,
                    scope: scope.kind,
                    index: scope.index
                };
                out.setCount++;
                break;
            }

            case 'profile': {
                var pn = parseInt(rest, 10);
                if (isNaN(pn)) { out.unknown.push({ line: lineNo, text: trimmed }); break; }
                target = out.profile(pn);
                scope = { kind: 'profile', index: pn };
                out.activeProfile = pn;
                break;
            }

            case 'rateprofile': {
                var rn = parseInt(rest, 10);
                if (isNaN(rn)) { out.unknown.push({ line: lineNo, text: trimmed }); break; }
                target = out.rateProfile(rn);
                scope = { kind: 'rateprofile', index: rn };
                out.activeRateProfile = rn;
                break;
            }

            case 'feature': {
                var neg = rest.charAt(0) === '-';
                var fname = neg ? rest.slice(1).trim() : rest;
                if (fname) { out.features.push({ name: fname, enabled: !neg, line: lineNo }); }
                break;
            }

            case 'beeper':
            case 'beacon': {
                var bneg = rest.charAt(0) === '-';
                out.row(cmd, {
                    line: lineNo,
                    name: bneg ? rest.slice(1).trim() : rest,
                    enabled: !bneg
                });
                break;
            }

            // `servo <n> <mid> <min> <max> <rneg> <rpos> <rate> <speed> <flags>`
            case 'servo': {
                var sw = nums(splitWords(rest));
                out.row('servo', {
                    line: lineNo, index: sw[0], mid: sw[1], min: sw[2], max: sw[3],
                    rneg: sw[4], rpos: sw[5], rate: sw[6], speed: sw[7], flags: sw[8]
                });
                break;
            }

            case 'mixer': {
                var mw = splitWords(rest);
                var sub = (mw.shift() || '').toLowerCase();
                if (sub === 'input') {
                    // `mixer input <NAME> <min> <max> <rate>`
                    out.row('mixerInput', {
                        line: lineNo, input: mw[0],
                        min: parseInt(mw[1], 10), max: parseInt(mw[2], 10),
                        rate: parseInt(mw[3], 10)
                    });
                } else if (sub === 'rule') {
                    // `mixer rule <i> <op> <input> <output> <weight> <offset>`
                    out.row('mixerRule', {
                        line: lineNo, index: parseInt(mw[0], 10), op: mw[1],
                        input: mw[2], output: mw[3],
                        weight: parseInt(mw[4], 10), offset: parseInt(mw[5], 10)
                    });
                } else if (sub === 'override') {
                    out.row('mixerOverride', {
                        line: lineNo, input: mw[0], value: mw[1]
                    });
                } else {
                    out.unknown.push({ line: lineNo, text: trimmed });
                }
                break;
            }

            // `aux <slot> <modePermanentId> <channel> <start> <end> <logic> <linkedTo>`
            case 'aux': {
                var aw = nums(splitWords(rest));
                out.row('aux', {
                    line: lineNo, slot: aw[0], mode: aw[1], channel: aw[2],
                    start: aw[3], end: aw[4], logic: aw[5], linkedTo: aw[6]
                });
                break;
            }

            // `adjfunc <slot> <function> <enaCh> <enaStart> <enaEnd> <adjCh>
            //          <adj1Start> <adj1End> <adj2Start> <adj2End> <step> <min> <max>`
            case 'adjfunc': {
                var jw = nums(splitWords(rest));
                out.row('adjfunc', {
                    line: lineNo, slot: jw[0], func: jw[1],
                    enaChannel: jw[2], enaStart: jw[3], enaEnd: jw[4],
                    adjChannel: jw[5], adj1Start: jw[6], adj1End: jw[7],
                    adj2Start: jw[8], adj2End: jw[9],
                    step: jw[10], min: jw[11], max: jw[12]
                });
                break;
            }

            // `serial <id> <functionMask> <msp> <gps> <telemetry> <blackbox>`
            case 'serial': {
                var pw = nums(splitWords(rest));
                out.row('serial', {
                    line: lineNo, id: pw[0], functions: pw[1],
                    mspBaud: pw[2], gpsBaud: pw[3],
                    telemetryBaud: pw[4], blackboxBaud: pw[5]
                });
                break;
            }

            case 'rxrange': {
                var rw = nums(splitWords(rest));
                out.row('rxrange', { line: lineNo, channel: rw[0], min: rw[1], max: rw[2] });
                break;
            }

            case 'rxfail': {
                var fw = splitWords(rest);
                out.row('rxfail', {
                    line: lineNo, channel: parseInt(fw[0], 10),
                    mode: fw[1], value: fw.length > 2 ? parseInt(fw[2], 10) : null
                });
                break;
            }

            case 'led': {
                var lw = splitWords(rest);
                out.row('led', { line: lineNo, index: parseInt(lw[0], 10), spec: lw.slice(1).join(' ') });
                break;
            }

            case 'color': {
                var cw = splitWords(rest);
                out.row('color', { line: lineNo, index: parseInt(cw[0], 10), spec: cw.slice(1).join(' ') });
                break;
            }

            case 'mode_color': {
                var mc = nums(splitWords(rest));
                out.row('mode_color', { line: lineNo, mode: mc[0], func: mc[1], color: mc[2] });
                break;
            }

            case 'timer':
            case 'dma':
            case 'resource': {
                out.row(cmd, { line: lineNo, args: splitWords(rest), text: rest });
                break;
            }

            case 'vtxtable':
            case 'vtx': {
                out.row(cmd, { line: lineNo, text: rest });
                break;
            }

            // Board identity: single-token assignments printed without `set`.
            case 'board_name':
            case 'board_design':
            case 'manufacturer_id':
            case 'mcu_id':
            case 'signature':
            case 'craft_name': {
                out.header[cmd] = rest;
                break;
            }

            default:
                out.unknown.push({ line: lineNo, text: trimmed });
            }
        }

        // `diff all` ends by restoring the selected profile, so the last
        // `profile`/`rateprofile` statement in the file is the active one.
        if (sawDiffAll) {
            out.kind = 'diff';
        } else if (sawDumpAll) {
            out.kind = 'dump';
        } else {
            // A file with no banner: call it a dump if it carries settings that
            // a diff would normally have omitted, otherwise treat it as a preset.
            out.kind = out.setCount > 300 ? 'dump' : 'preset';
        }

        if (out.setCount === 0 && !out.rows.servo && out.features.length === 0) {
            out.warnings.push('No Rotorflight CLI content was recognised in this file.');
        }

        return out;
    }

    global.RFParser = { parse: parse, coerce: coerce };
}(window));
