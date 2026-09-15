# Rotorflight Preset Viewer

A read-only viewer for Rotorflight CLI files. Load a `dump all`, a `diff all`, or a
preset snippet and it is laid out the way the
[Rotorflight Configurator](https://github.com/rotorflight/rotorflight-configurator)
lays out its tabs — Setup, Configuration, Ports, Receiver, Modes, Adjustments,
Failsafe, Power, Motors, Governor, Servos, Mixer, Filters, Rates, PID Profiles,
Rescue, Blackbox, OSD, LED Strip, Beepers, GPS and Board.

It does not talk to a flight controller and cannot change one. It reads a file
and shows you what is in it.

## Download

Ready-to-run packages for every platform are on the
[Releases page](https://github.com/gcholdingscorporation/zelionRFpresetviewer/releases/latest):
the Windows `.exe`, the Android `.apk`, and the single `.html` that covers
everything else. Each release is rebuilt from source by CI and published with
checksums.

## Running it

Four ways, none of which install a dependency.

**Windows — `dist/RotorflightPresetViewer.exe`** (~300 KB). Double-click it and
the viewer opens in its own window, with no tabs or address bar. The window comes
from Edge's application mode, so nothing extra is installed; if neither Edge nor
Chrome is registered, the page opens in the default browser instead. The
executable imports only `kernel32`, `shell32`, `user32` and `advapi32` — all
parts of Windows — so there is no runtime, no framework, no bundled browser
engine, and deliberately no dependency on the Universal C Runtime. Dropping a CLI
dump onto the .exe, or using *Open with*, opens the viewer with that file already
loaded.

**Android — `RotorflightPresetViewer.apk`**. Built by CI (see below) because the
Android SDK is needed. It declares **no permissions at all**: the viewer is
inside the APK, so the app never touches the network. Open a dump through the
app's own *Open file* button, or send one to it from a file manager or chat app
with *Open with* / *Share*. Android 8.0 or newer. It is signed with the
throwaway key in `android/sideload-debug.keystore`, so Android will ask you to
allow installing from an unknown source.

**Phone or tablet, no install — `dist/rotorflight-preset-viewer.html`** (~295 KB).
One file with everything embedded. Save it to your phone and open it from the
Files app; Android and iOS both render it, and the layout switches to a single
column with a slide-out tab drawer on narrow screens. It works with no signal —
there is nothing to fetch. This is the only option on iPhone.

**From source** — no build step and no server:

```
git clone https://github.com/gcholdingscorporation/zelionRFpresetviewer
cd zelionRFpresetviewer
xdg-open index.html          # or just double-click index.html
```

The metadata ships as plain `.js` files rather than JSON so that the page works
straight off the filesystem, where `fetch()` is blocked. Serving the directory
over HTTP (or GitHub Pages) works equally well.

Load a file by dragging it onto the page, using **Open file…**, or pasting CLI
text into the box on the start screen.

### Rebuilding the distributables

```
python3 tools/build_single.py     # dist/rotorflight-preset-viewer.html
python3 tools/build_windows.py    # dist/RotorflightPresetViewer.exe
cd android && gradle assembleRelease   # needs the Android SDK
```

All three carry the same page: `tools/build_single.py` produces it, and the .exe
embeds it while the APK copies it into its assets, so the builds cannot drift
apart.

`.github/workflows/build.yml` builds the .exe and the .apk on every push and
uploads both, and asserts that the .exe still imports nothing but Windows' own
DLLs. Download them from the run's **Artifacts** section on the Actions tab.

To cut a release, push a tag:

```
git tag v1.1.0 && git push origin v1.1.0
```

`.github/workflows/release.yml` rebuilds all three packages from the tagged
source — never from `dist/`, so a release cannot ship a stale binary — checks
that the page embedded in the .exe and the .apk is byte for byte the published
.html, and publishes them with a `SHA256SUMS.txt`.

The Windows build cross-compiles from Linux or macOS and needs only
`pip install ziglang` — Zig acts as a C compiler with a bundled mingw-w64, so
there is no Visual Studio and no Windows machine involved. `tools/win_launcher.c`
embeds the single-file page with C23 `#embed`, unpacks it to
`%TEMP%\RotorflightPresetViewer\viewer.html` and hands it to the default
browser.

## What it shows

Each setting appears as a row with its Configurator-style label, its CLI name,
the value from the file, and the factory default for the firmware version that
produced the file:

- **Highlighted rows** are values the file changed from the default.
- **Greyed rows** are settings the file left alone. A `diff all` only lists what
  changed, so the viewer fills in the rest from the firmware defaults and marks
  them as such — you get the whole picture, not just the delta.
- **Hovering a row** shows the setting's type, its permitted range or its full
  list of enum values, its parameter group, and the line it came from.

Structured CLI lines get purpose-built tables rather than raw text: `servo`,
`mixer input` / `mixer rule`, `aux` (with mode names resolved), `adjfunc` (with
adjustment-function names resolved), `serial` (with the port function bitmask
decoded), `beeper`, `led`, `color`, `timer`, `dma` and `resource`.

Two tabs exist so nothing can hide:

- **All Settings** lists every `set` in the file with its value, default, the tab
  it was filed under, and its line number. Anything the metadata does not
  recognise — a setting from a newer firmware, say — is listed here and flagged.
- **CLI** shows the original file with line numbers and search highlighting.

### Values are not rescaled

Every value is displayed exactly as the CLI printed it. Rotorflight stores a
number of settings in scaled integer units (for instance `vbat_full_cell_voltage
= 420`), and the Configurator converts some of them for display. This viewer does
not, because guessing a scale factor would silently produce wrong numbers. A unit
is shown only where the setting's own name states one (`*_hz`, `*_ms`, `*_kb`).

## How closely it follows the Configurator

The viewer reproduces the Configurator 2.3 layout language rather than
approximating it: its colour tokens, its section cards with a dark header, and
its field rows — label on the left, a read-only control on the right, the unit in
orange after the label. `tools/gen_labels.py` takes the Configurator's own label,
unit and section heading for each setting straight from its tab sources and
English locale, so where it has a name for a setting, that is the name you see.

Where it has no label for a setting, the viewer falls back to a readable form of
the CLI name, and the CLI name is shown under every label either way so a value
can always be traced back to the line it came from.

## Where the setting metadata comes from

Setting names, scopes, types, ranges, enum values and factory defaults are
**generated from the Rotorflight firmware source**, not hand-written:

| Source file | What is taken from it |
| --- | --- |
| `src/main/cli/settings.c` | the CLI `valueTable`: every `set` name, its scope (master / profile / rateprofile), C type, display mode, range, and lookup table |
| `src/main/cli/settings.h` | the `TABLE_*` enum, paired with the lookup arrays in `settings.c` |
| `src/main/fc/parameter_names.h` | `PARAM_NAME_*` macros → CLI names |
| `src/main/pg/*.c` and other reset blocks | `PG_RESET_TEMPLATE` / `RESET_CONFIG` / `pgResetFn_*` → factory defaults |
| `src/main/msp/msp_box.c` | flight-mode names and their permanent ids, used by `aux` |
| `src/main/fc/rc_adjustments.h` | adjustment function names, used by `adjfunc` |
| `src/main/io/serial.h` | serial port function bits |
| `src/main/telemetry/sensors.h` | custom telemetry slot ids |

Regenerate after a firmware release:

```
python3 tools/gen_settings.py /path/to/rotorflight-firmware 4.6 data/rf-4.6.js
```

The generator reports its coverage. At the time of writing it extracts 711
settings for 4.5 and 727 for 4.6, with factory defaults known for about 97% of
them.

A note on defaults: `pgResetInstance()` zeroes a parameter group before applying
its reset block, and both `PG_RESET_TEMPLATE` and `RESET_CONFIG` build a whole
struct from a designated initializer. A field that its group's reset block never
mentions is therefore genuinely zero at defaults, and the generator records it as
such. Where a default is stated symbolically in a way the generator cannot
evaluate (a target-specific constant, say), it is reported as unknown rather than
guessed, and the row reads "default unknown".

### Firmware versions

Metadata is bundled for **Rotorflight 4.5** and **4.6**. The viewer reads the
version banner at the top of the file and picks the matching set; a file with no
banner, or from a newer release, falls back to the newest metadata available and
any unrecognised names are flagged rather than dropped. The tab layout follows
the current Configurator (2.3.x).

## Checking it still works

```
node tools/selftest.js
```

This runs the parser over both sample files and checks the generated metadata —
that every referenced lookup table exists, that parameter groups all map to a
tab, and that a set of values spot-checked against the firmware source still
match. It needs no browser.

`samples/` holds a real 4.5.1 `diff all` and a synthetic 4.6 `dump all` that
exercises the line types the real one does not use.

## Layout

```
index.html                the page
css/app.css               Configurator-style light and dark themes
js/parser.js              CLI dump / diff / preset parser
js/schema.js              which tab and panel each setting belongs to
js/app.js                 rendering
data/rf-4.5.js            generated firmware metadata
data/rf-4.6.js
dist/…viewer.html         single-file build, everything embedded
dist/…Viewer.exe          portable Windows build
tools/gen_settings.py     regenerates data/ from a firmware checkout
tools/build_single.py     inlines everything into one .html
tools/build_windows.py    cross-compiles the .exe with Zig
tools/win_launcher.c      the Windows launcher
tools/selftest.js         parser and metadata checks
samples/                  example files
```

## Licence

GPL-3.0, because it contains material derived from the Rotorflight Configurator
and firmware, both GPL-3.0. `NOTICE` says exactly what is derived and from where.
Not affiliated with or endorsed by the Rotorflight project.

## Known limitations

- OSD element positions are shown as raw packed values; there is no OSD preview.
- LED strip entries are shown as their CLI definition strings, not as a
  rendered strip.
- `resource`, `timer` and `dma` lines are listed verbatim with the pin
  annotations the CLI prints alongside them; they are not validated against a
  target definition.
- Settings whose default is target-specific are reported as unknown.
- Not every setting has a Configurator label yet; those fall back to a readable
  form of the CLI name. Re-run `tools/gen_labels.py` after a Configurator
  release to pick up more.
- The Configurator's richer per-tab widgets — the swashplate diagram, rate
  curves, channel bars, the throttle curve — are not reproduced; this is a
  viewer, not a tuning surface.
- There is no iOS app. Apple only allows browser engines and app installs through
  Xcode and the App Store, so the single-file HTML is the iPhone answer; "Add to
  Home Screen" from Safari gives it an icon.
- The Android app relies on the system WebView, which updates itself through the
  Play Store. A device whose WebView has not been updated in years may render the
  layout poorly.
