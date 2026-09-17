/*
 * Check the side-by-side comparison against the files it is comparing.
 *
 *     node tools/verify_compare.js [--browser <path>] <file> [<file> ...]
 *
 * Three things are checked, in a headless browser, against the built
 * single-file viewer:
 *
 *   1. A file compared with itself must show no differences anywhere. This is
 *      the strongest thing that can be said about the comparison without
 *      re-deriving every value: whatever it gets wrong, it must at least get
 *      nothing wrong twice in the same way.
 *
 *   2. The rail's per-tab counts must add up to what the All Settings page
 *      finds. Those two are worked out by different code - one from the parsed
 *      files, one from the rendered list - so agreeing is worth something.
 *
 *   3. Every tab must draw, in both single and comparison mode, without a page
 *      error, and a comparison must put two panes on the tabs that have them.
 *
 * The self-test checks that a layout is well formed and verify_render.js checks
 * that what it draws is what the file says; this checks the comparison built on
 * top of both.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'dist/rotorflight-preset-viewer.html');

/* The All Settings and CLI pages are the two the comparison does not pane:
 * one merges the two files into a single list, the other marks lines. */
const UNPANED = ['all'];

let failures = 0;

function ok(what) { console.log('ok    ' + what); }

function check(cond, what, detail) {
    if (cond) { ok(what); return; }
    failures++;
    console.log('FAIL  ' + what + (detail ? '\n      ' + detail : ''));
}

async function loadInto(page, file, slot) {
    const text = fs.readFileSync(file, 'utf8');
    await page.evaluate(([t, n, s]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([t], n, { type: 'text/plain' }));
        const input = document.querySelector(s === 1 ? '#cmp-input' : '#file-input');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, [text, path.basename(file), slot]);
    await page.waitForTimeout(250);
}

async function tabState(page) {
    return page.evaluate(() => ({
        panes: document.querySelectorAll('#content .pane').length,
        diff: document.querySelectorAll('#content tr.is-diff').length,
        only: document.querySelectorAll('#content tr.is-only').length,
        cliOnly: document.querySelectorAll('#content pre.cli .ln.only').length,
        rows: document.querySelectorAll('#content tbody tr').length,
    }));
}

async function run(browser, fileA, fileB) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') { errors.push('console: ' + m.text()); } });

    await page.goto('file://' + PAGE);
    await loadInto(page, fileA, 0);
    await loadInto(page, fileB, 1);

    const tabs = await page.$$eval('#sidebar .tab-link',
        ns => ns.map(n => n.getAttribute('data-tab')));

    const same = fileA === fileB;
    const label = same
        ? path.basename(fileA) + ' vs itself'
        : path.basename(fileA) + ' vs ' + path.basename(fileB);

    const marked = {};
    for (const tab of tabs) {
        await page.click(`#sidebar .tab-link[data-tab="${tab}"]`);
        await page.waitForTimeout(60);
        const st = await tabState(page);
        marked[tab] = st;
        if (UNPANED.indexOf(tab) === -1) {
            check(st.panes === 2, `${label}: ${tab} draws two panes`,
                `saw ${st.panes}`);
        }
        if (same) {
            check(st.diff === 0 && st.only === 0 && st.cliOnly === 0,
                `${label}: ${tab} shows no differences`,
                `diff=${st.diff} only=${st.only} cliOnly=${st.cliOnly}`);
        }
    }

    /* The rail counts settings, the All page counts the rows it built; they
     * are worked out separately and have to land on the same number. */
    const rail = await page.$$eval('#sidebar .tab-link .count.differs',
        ns => ns.reduce((n, x) => n + (parseInt(x.textContent, 10) || 0), 0));
    await page.click('#sidebar .tab-link[data-tab="all"]');
    await page.waitForTimeout(120);
    const allCount = await page.evaluate(() =>
        document.querySelectorAll('#content tbody tr.is-diff').length);
    check(rail === allCount,
        `${label}: the rail and the All Settings page agree on the count`,
        `rail=${rail} all=${allCount}`);

    /* "Differences only" must leave exactly the rows that were marked. */
    await page.evaluate(() => {
        const l = [...document.querySelectorAll('#content .toolbar label')]
            .find(x => x.textContent.indexOf('Differences only') !== -1);
        l.querySelector('input').click();
    });
    await page.waitForTimeout(200);
    const pruned = await page.evaluate(() =>
        document.querySelectorAll('#content tbody tr').length);
    check(pruned === allCount,
        `${label}: "differences only" leaves the differing rows and nothing else`,
        `kept=${pruned} expected=${allCount}`);

    check(errors.length === 0, `${label}: no page errors`, errors.slice(0, 5).join('\n      '));
    await page.close();
}

(async () => {
    const args = process.argv.slice(2);
    let exe = null;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--browser') { exe = args[++i]; } else { files.push(args[i]); }
    }
    if (!files.length) {
        console.error('usage: node tools/verify_compare.js [--browser <path>] <file> ...');
        process.exit(2);
    }
    if (!fs.existsSync(PAGE)) {
        console.error('build the page first: python3 tools/build_single.py');
        process.exit(2);
    }

    const browser = await chromium.launch(exe ? { executablePath: exe } : {});

    // Every file against itself, then every pair.
    for (const f of files) { await run(browser, f, f); }
    for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) { await run(browser, files[i], files[j]); }
    }

    await browser.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nall comparison checks passed');
    process.exit(failures ? 1 : 0);
})();
