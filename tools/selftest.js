/*
 * Self-check for the parser and the generated metadata.
 *
 *     node tools/selftest.js
 *
 * It runs headless (no DOM) by giving the browser modules a `window` stand-in,
 * so it can run in CI without a browser.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global;

require(path.join(ROOT, 'data/rf-4.5.js'));
require(path.join(ROOT, 'data/rf-4.6.js'));
require(path.join(ROOT, 'js/parser.js'));
require(path.join(ROOT, 'js/schema.js'));

let failures = 0;

function check(what, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) { failures++; }
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}` +
        (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
}

function ok(what, cond) {
    if (!cond) { failures++; }
    console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`);
}

// ---------------------------------------------------------------- metadata

for (const version of ['4.5', '4.6']) {
    const db = window.RF_DB[version];
    ok(`${version}: database present`, !!db);
    ok(`${version}: over 600 settings`, Object.keys(db.settings).length > 600);
    ok(`${version}: lookup tables present`, Object.keys(db.luts).length > 40);
    ok(`${version}: mode boxes present`, Object.keys(db.extras.boxes).length > 20);
    ok(`${version}: adjustment names present`, Object.keys(db.extras.adjfuncs).length > 50);

    const withDefault = Object.values(db.settings).filter(s => s.d !== undefined).length;
    ok(`${version}: defaults known for most settings (${withDefault})`,
       withDefault > Object.keys(db.settings).length * 0.95);

    // A parameter group id must be a plain PG_ name; an entry that captured a
    // macro call instead means the value table was mis-parsed.
    check(`${version}: parameter group ids are well formed`,
          Object.entries(db.settings)
              .filter(([, s]) => s.pg && !/^PG_[A-Z0-9_]+$/.test(s.pg)).map(([n]) => n), []);

    // Every lookup a setting names must actually exist, or enum values cannot
    // be resolved at display time.
    const missing = Object.entries(db.settings)
        .filter(([, s]) => s.lut && !db.luts[s.lut]).map(([n]) => n);
    check(`${version}: every referenced lookup table exists`, missing, []);

    // Spot checks against the firmware source these were generated from.
    // Some are version-specific: 4.6 renamed the governor modes and changed the
    // motor-pole and error-limit defaults.
    const expected = version === '4.5' ? {
        govModes: ['OFF', 'PASSTHROUGH', 'STANDARD'],
        motorPoles: [8, 8, 8, 8],
        errorLimit: [30, 30, 45]
    } : {
        govModes: ['OFF', 'LIMIT', 'DIRECT'],
        motorPoles: [0, 0, 0, 0],
        errorLimit: [45, 45, 60]
    };
    check(`${version}: gov_mode values`, db.luts[db.settings.gov_mode.lut].slice(0, 3),
          expected.govModes);
    check(`${version}: pitch_p_gain default`, db.settings.pitch_p_gain.d, 50);
    check(`${version}: yaw_cw_stop_gain default`, db.settings.yaw_cw_stop_gain.d, 120);
    check(`${version}: motor_poles default`, db.settings.motor_poles.d, expected.motorPoles);
    check(`${version}: error_limit default`, db.settings.error_limit.d, expected.errorLimit);
    check(`${version}: vbat_scale reads through the array-element offset`,
          db.settings.vbat_scale.pg, 'PG_VOLTAGE_SENSOR_ADC_CONFIG');
    check(`${version}: pitch_p_gain scope`, db.settings.pitch_p_gain.s, 'profile');
    check(`${version}: roll_rc_rate scope`, db.settings.roll_rc_rate.s, 'rateprofile');
    check(`${version}: control channel count`, db.extras.controlChannelCount, 5);
    check(`${version}: ARM is permanent id 0`, db.extras.boxes['0'], 'ARM');
}

// ------------------------------------------------------------- real sample

const diff = window.RFParser.parse(
    fs.readFileSync(path.join(ROOT, 'samples/RTFL_cli_M7R_diff_all.txt'), 'utf8'));

check('diff: recognised as a diff', diff.kind, 'diff');
check('diff: firmware version', diff.header.version, '4.5.1');
check('diff: git hash', diff.header.gitHash, 'e69823a');
check('diff: MSP API', diff.header.mspApi, '12.8');
check('diff: board name', diff.header.board_name, 'NEXUS_XR');
check('diff: craft name', diff.header.craftName, 'M7R');
check('diff: six PID profiles', Object.keys(diff.profiles).length, 6);
check('diff: six rate profiles', Object.keys(diff.rateProfiles).length, 6);
check('diff: selected PID profile', diff.activeProfile, 0);
check('diff: selected rate profile', diff.activeRateProfile, 0);
check('diff: four servos', diff.rows.servo.length, 4);
check('diff: servo 1 centre', diff.rows.servo[0].mid, 295);
check('diff: servo 1 flags', diff.rows.servo[0].flags, 2);
check('diff: four mixer inputs', diff.rows.mixerInput.length, 4);
check('diff: mixer input SY range', [diff.rows.mixerInput[2].min, diff.rows.mixerInput[2].max],
      [-2075, 1633]);
check('diff: profile 0 headspeed', diff.profiles[0].gov_headspeed.value, 1450);
check('diff: profile 2 headspeed', diff.profiles[2].gov_headspeed.value, 2150);
check('diff: rateprofile 1 yaw srate', diff.rateProfiles[1].yaw_srate.value, 63);
check('diff: array value parsed as numbers', diff.master.motor_poles.value, [10, 8, 8, 8]);
check('diff: enum value kept as text', diff.master.gov_mode.value, 'MODE1');
check('diff: nothing unrecognised', diff.unknown, []);
check('diff: features', diff.features.length, 6);
check('diff: DYN_NOTCH disabled',
      { name: diff.features[0].name, enabled: diff.features[0].enabled },
      { name: 'DYN_NOTCH', enabled: false });
ok('diff: every set statement captured', diff.allSettings().length === diff.setCount);

// The uploaded file is 4.5.1, so the 4.5 metadata must recognise every name.
const db45 = window.RF_DB['4.5'];
const unknownNames = diff.allSettings()
    .map(s => s.name).filter(n => !db45.settings[n]);
check('diff: all names known to the 4.5 metadata', unknownNames, []);

// Scope agreement: a value the file puts in a profile block must be a profile
// setting according to the firmware, and likewise for rate profiles.
const scopeMismatch = diff.allSettings()
    .filter(s => db45.settings[s.name] && db45.settings[s.name].s !== s.scope)
    .map(s => `${s.name}: file=${s.scope} firmware=${db45.settings[s.name].s}`);
check('diff: scopes agree with the firmware', scopeMismatch, []);

// ------------------------------------------------------- synthetic dump

const dump = window.RFParser.parse(
    fs.readFileSync(path.join(ROOT, 'samples/synthetic_dump_all.txt'), 'utf8'));

check('dump: recognised as a dump', dump.kind, 'dump');
check('dump: version', dump.header.version, '4.6.0');
check('dump: three serial ports', dump.rows.serial.length, 3);
check('dump: ESC sensor port mask', dump.rows.serial[2].functions, 1024);
check('dump: two mixer rules', dump.rows.mixerRule.length, 2);
// Line numbers are incidental to these checks, so compare the rest of the row.
function withoutLine(row) {
    const copy = Object.assign({}, row);
    delete copy.line;
    return copy;
}

check('dump: mixer rule 1', withoutLine(dump.rows.mixerRule[1]),
      { index: 1, op: 'add', input: 'SP', output: 'S2', weight: 800, offset: -20 });
check('dump: beeper lines', dump.rows.beeper.map(withoutLine),
      [{ name: 'ON_USB', enabled: false },
       { name: 'GYRO_CALIBRATED', enabled: true }]);
check('dump: rxfail with value', withoutLine(dump.rows.rxfail[0]),
      { channel: 3, mode: 's', value: 1000 });
check('dump: rxfail without value', withoutLine(dump.rows.rxfail[1]),
      { channel: 4, mode: 'h', value: null });
check('dump: rxrange', withoutLine(dump.rows.rxrange[0]), { channel: 0, min: 990, max: 2010 });
check('dump: led', withoutLine(dump.rows.led[0]), { index: 0, spec: '0,0::C:0' });
check('dump: mode colour', withoutLine(dump.rows.mode_color[0]), { mode: 0, func: 1, color: 2 });
check('dump: rescue mode on AUX3', withoutLine(dump.rows.aux[1]),
      { slot: 1, mode: 53, channel: 2, start: 1300, end: 1700, logic: 0, linkedTo: 0 });
check('dump: adjustment slot', dump.rows.adjfunc[0].adjChannel, 3);
check('dump: selected profile', dump.activeProfile, 1);
check('dump: selected rate profile', dump.activeRateProfile, 2);
check('dump: profile 1 value', dump.profiles[1].pitch_p_gain.value, 60);
check('dump: rateprofile 2 value', dump.rateProfiles[2].roll_rc_rate.value, 18);
check('dump: pin annotations captured', dump.rows.pinNote.length, 2);
check('dump: resource line', dump.rows.resource[0].args, ['BEEPER', '1', 'C15']);

// A name the metadata has never heard of still reaches the viewer.
ok('dump: unknown setting is kept, not dropped',
   !!dump.master.an_unknown_setting_from_the_future);
ok('dump: unknown setting is absent from the 4.6 metadata',
   !window.RF_DB['4.6'].settings.an_unknown_setting_from_the_future);

// -------------------------------------------------------------- schema

const S = window.RFSchema;
// The Configurator splits the governor: master settings on its own tab, the
// per-profile gains in a box on Profiles.
check('schema: gov_headspeed shows on the Profiles tab, as it is per profile',
      S.tabFor('gov_headspeed', db45.settings.gov_headspeed), 'profiles');
check('schema: gov_mode shows on the Governor tab',
      S.tabFor('gov_mode', db45.settings.gov_mode), 'governor');
// The Configurator has no Rescue tab; rescue is a box on Profiles.
check('schema: rescue_mode shows on the Profiles tab',
      S.tabFor('rescue_mode', db45.settings.rescue_mode), 'profiles');
check('schema: pitch_p_gain shows on the PID Profiles tab',
      S.tabFor('pitch_p_gain', db45.settings.pitch_p_gain), 'profiles');
check('schema: roll_rc_rate shows on the Rates tab',
      S.tabFor('roll_rc_rate', db45.settings.roll_rc_rate), 'rates');
check('schema: gyro_lpf1_static_hz shows on the Gyro tab',
      S.tabFor('gyro_lpf1_static_hz', db45.settings.gyro_lpf1_static_hz), 'gyro');

// Every curated panel must name a real tab, or its settings would vanish.
const tabIds = new Set(S.TABS.map(t => t.id));
check('schema: every panel targets a real tab',
      S.SECTIONS.filter(s => !tabIds.has(s.tab)).map(s => s.title), []);
// And every parameter group must map to a real tab.
check('schema: every parameter group targets a real tab',
      Object.entries(S.PG_TAB).filter(([, t]) => !tabIds.has(t)).map(([pg]) => pg), []);
// Every parameter group the firmware uses must have a home.
for (const version of ['4.5', '4.6']) {
    const pgs = new Set(Object.values(window.RF_DB[version].settings)
        .map(s => s.pg).filter(Boolean));
    check(`schema: ${version} parameter groups all mapped`,
          [...pgs].filter(pg => !S.PG_TAB[pg]), []);
}

// ---------------------------------------------------- transcribed layouts
//
// A layout is a transcription, and a transcription can carry a typo that no
// firmware would ever reject: a setting name that does not exist, an enum that
// names no table, a condition that names no function. Each of those fails
// silently at render time - the row simply does not appear - so they are
// checked here instead.

require(path.join(ROOT, 'data/layout-2.3.js'));
require(path.join(ROOT, 'data/enums-2.3.js'));
require(path.join(ROOT, 'data/scales-2.3.js'));
require(path.join(ROOT, 'data/labels-2.3.js'));

const allNames = new Set();
for (const version of ['4.5', '4.6']) {
    Object.keys(window.RF_DB[version].settings).forEach(n => allNames.add(n));
}

const layoutRows = [];
for (const [tabId, layout] of Object.entries(window.RF_LAYOUT)) {
    const walk = (specs) => specs.forEach(spec => {
        if (spec.rows) { walk(spec.rows); }
        layoutRows.push({ tab: tabId, spec });
    });
    layout.boxes.forEach(box => walk(box.rows));
}
ok(`layout: rows to check (${layoutRows.length})`, layoutRows.length > 100);

check('layout: every `cli` names a real setting',
      layoutRows.filter(r => r.spec.cli && !allNames.has(r.spec.cli))
          .map(r => `${r.tab}: ${r.spec.cli}`), []);

// A row that picks one element of an array must be addressing an array.
check('layout: every `idx` addresses an array setting',
      layoutRows.filter(r => r.spec.idx !== undefined && r.spec.cli)
          .filter(r => {
              const m = window.RF_DB['4.6'].settings[r.spec.cli]
                  || window.RF_DB['4.5'].settings[r.spec.cli];
              return m && m.m !== 'array';
          }).map(r => `${r.tab}: ${r.spec.cli}[${r.spec.idx}]`), []);

const enumTables = new Set([
    ...Object.keys(window.RF_ENUMS.byId),
    ...Object.keys(window.RF_ENUM_LISTS || {}),
]);
check('layout: every `enum` names a table',
      layoutRows.filter(r => r.spec.enum && !enumTables.has(r.spec.enum))
          .map(r => `${r.tab}: ${r.spec.enum}`), []);

// The predicates and derived values live in app.js, which needs a DOM, so the
// names are read out of its source rather than called.
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const declared = (block, src) => {
    const m = src.match(new RegExp(`var ${block} = \\{([\\s\\S]*?)\\n    \\};`));
    return new Set(m ? [...m[1].matchAll(/^\s*(\w+):/gm)].map(x => x[1]) : []);
};
const whens = declared('WHEN', appSrc);
const derived = declared('DERIVED', appSrc);

check('layout: every `when` names a predicate',
      layoutRows.filter(r => r.spec.when && !whens.has(r.spec.when))
          .map(r => `${r.tab}: ${r.spec.when}`), []);
check('layout: every `toggle` names a predicate',
      layoutRows.filter(r => r.spec.toggle && !whens.has(r.spec.toggle))
          .map(r => `${r.tab}: ${r.spec.toggle}`), []);
check('layout: every `calc` names a derived value',
      layoutRows.filter(r => r.spec.calc && !derived.has(r.spec.calc))
          .map(r => `${r.tab}: ${r.spec.calc}`), []);

// A setting shown twice on the same tab would be a transcription slip.
const seen = {};
const twice = [];
layoutRows.filter(r => r.spec.cli).forEach(r => {
    const key = `${r.tab}:${r.spec.cli}:${r.spec.idx}:${r.spec.ver || ''}:${r.spec.when || ''}`;
    if (seen[key]) { twice.push(key); }
    seen[key] = true;
});
check('layout: no setting is transcribed twice on a tab', twice, []);

// Every layout tab must be a real tab.
check('layout: every layout names a real tab',
      Object.keys(window.RF_LAYOUT).filter(id => !tabIds.has(id)), []);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
