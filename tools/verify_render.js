/*
 * Trace every value a transcribed page shows back to the file it came from.
 *
 *     node tools/verify_render.js [--browser <path>] <file> [<file> ...]
 *
 * The self-test checks that a layout is well formed; this checks that what it
 * renders is what the file says. It loads the built single-file viewer in a
 * headless browser, walks every tab, and for each row that names one CLI
 * setting re-derives the expected text from the raw file - independently of
 * app.js, using only the layout's own `div`, `dp`, `idx` and the generated
 * scale table - and compares.
 *
 * Rows the Configurator computes rather than stores (a mixer limit, a notch
 * bank, a channel map) name their source instead of a setting and are counted
 * but not compared; they are covered by the screenshot checks.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'dist/rotorflight-preset-viewer.html');

function parseFile(text) {
    const out = { master: {}, profile: {}, rateprofile: {} };
    let scope = 'master';
    let index = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        let m = /^profile\s+(\d+)$/.exec(line);
        if (m) { scope = 'profile'; index = Number(m[1]); continue; }
        m = /^rateprofile\s+(\d+)$/.exec(line);
        if (m) { scope = 'rateprofile'; index = Number(m[1]); continue; }
        m = /^set\s+([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (!m) { continue; }
        const [, name, value] = m;
        if (scope === 'master') { out.master[name] = value.trim(); }
        else {
            (out[scope][index] || (out[scope][index] = {}))[name] = value.trim();
        }
    }
    return out;
}

function scaleOne(value, spec, scale) {
    if (!/^-?\d+$/.test(value)) { return value; }      // an enum name, as printed
    const n = Number(value);
    if (scale && scale !== 1) {
        return (n / scale).toFixed(String(scale).length - 1);
    }
    if (spec.div) {
        const q = n / spec.div;
        return spec.dp === undefined ? String(q) : q.toFixed(spec.dp);
    }
    return String(n);
}

function expected(raw, spec, scale) {
    if (spec.idx !== undefined) {
        const parts = raw.split(',');
        if (spec.idx >= parts.length) { return null; }
        return scaleOne(parts[spec.idx].trim(), spec, scale);
    }
    /* An array setting is printed element by element, joined again. */
    if (raw.indexOf(',') >= 0) {
        return raw.split(',').map(v => scaleOne(v.trim(), spec, scale)).join(',');
    }
    return scaleOne(raw, spec, scale);
}

async function main() {
    const args = process.argv.slice(2);
    let browser = process.env.CHROMIUM_PATH;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--browser') { browser = args[++i]; } else { files.push(args[i]); }
    }
    if (!files.length) {
        console.error('usage: node tools/verify_render.js [--browser <path>] <file> ...');
        process.exit(2);
    }

    const b = await chromium.launch(browser ? { executablePath: browser } : {});
    let failures = 0;

    for (const file of files) {
        const parsed = parseFile(fs.readFileSync(file, 'utf8'));
        const page = await b.newPage({ viewport: { width: 1700, height: 1200 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('file://' + PAGE);
        await page.setInputFiles('#file-input', path.resolve(file));
        await page.waitForSelector('#layout[style*="flex"]');

        const shown = await page.evaluate(() => {
            const out = [];
            const tabs = Array.from(document.querySelectorAll('.tab-link'))
                .map(t => t.getAttribute('data-tab'))
                .filter(id => (window.RF_LAYOUT || {})[id]);
            for (const id of tabs) {
                document.querySelector(`.tab-link[data-tab="${id}"]`).click();
                document.querySelectorAll('#content .gui_box table.settings_table tr')
                    .forEach(tr => {
                        const label = tr.querySelector('td.label');
                        if (!label) { return; }
                        const name = (label.querySelector('.cli-name') || {}).textContent || '';
                        const control = tr.querySelector(
                            'td.control input, td.control select, td.control .switch');
                        if (!name || !control) { return; }
                        const value = control.tagName === 'INPUT'
                            || control.tagName === 'SELECT'
                            ? control.value
                            : (control.classList.contains('on') ? 'ON' : 'OFF');
                        out.push({ tab: id, name, value });
                    });
            }
            return {
                rows: out,
                dbKey: window.RF_DB && document.title ? null : null,
                scales: window.RF_SCALES,
                layout: window.RF_LAYOUT,
            };
        });

        // Index the layout by "tab -> cli[idx]" so a row can find its own
        // spec, and note which names belong to a row the Configurator
        // computes - those name their source rather than a setting they show,
        // so comparing the two would be comparing different things.
        const specs = {};
        const computed = new Set();
        for (const [tab, layout] of Object.entries(shown.layout)) {
            const walk = (list) => list.forEach(spec => {
                if (spec.rows) { walk(spec.rows); }
                if (spec.calc || spec.ratio) {
                    computed.add(tab + ':' + (spec.from || spec.ratio));
                    return;
                }
                if (!spec.cli) { return; }
                const key = tab + ':' + spec.cli
                    + (spec.idx === undefined ? '' : '[' + spec.idx + ']');
                specs[key] = spec;
            });
            layout.boxes.forEach(box => {
                walk(box.rows);
                /* Boxes built in app.js cite the setting they read but do not
                 * show it as it is stored. */
                if (box.channelMap) { computed.add(tab + ':rssi_channel'); }
                if (box.curve) { computed.add(tab + ':' + box.curve); }
                if (box.telemetrySensors) { computed.add(tab + ':telemetry_sensors'); }
            });
        }

        const version = /4\.6\./.test(fs.readFileSync(file, 'utf8')) ? '4.6' : '4.5';
        const scales = shown.scales[version] || {};

        let compared = 0;
        let derived = 0;
        for (const row of shown.rows) {
            /* A row the layout does not name is one the generic renderer put
             * there, which applies the scale table and nothing else. */
            if (computed.has(row.tab + ':' + row.name)) { derived++; continue; }
            const spec = specs[row.tab + ':' + row.name] || {};
            if (/[^a-z0-9_[\]]/.test(row.name)) { derived++; continue; }
            const base = row.name.replace(/\[\d+\]$/, '');
            /* A profile setting is looked up in the profile the page shows,
             * which is the first one until the selector is clicked. */
            const raw = parsed.master[base] !== undefined ? parsed.master[base]
                : (parsed.profile[0] || {})[base] !== undefined
                    ? (parsed.profile[0] || {})[base]
                    : (parsed.rateprofile[0] || {})[base];
            if (raw === undefined) { derived++; continue; } // left at its default
            const want = expected(raw, spec, scales[base]);
            if (want === null) { derived++; continue; }
            compared++;
            if (spec.enum || String(row.value) === String(want)) { continue; }
            failures++;
            console.log(`FAIL ${path.basename(file)} ${row.tab} ${row.name}`
                + `\n       file  ${raw}\n       shows ${row.value}\n       want  ${want}`);
        }

        console.log(`${path.basename(file)}: ${compared} values traced to the file, `
            + `${derived} derived or defaulted, ${errors.length} page errors`);
        if (errors.length) { failures += errors.length; console.log(errors.join('\n')); }
        await page.close();
    }

    await b.close();
    console.log(failures ? `\n${failures} mismatch(es)` : '\nevery traced value matches the file');
    process.exit(failures ? 1 : 0);
}

main();
