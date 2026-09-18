# Rotorflight Preset Viewer

A read-only viewer for Rotorflight CLI files. It loads a `dump all`, a `diff all`
or a preset and lays it out the way the Rotorflight Configurator 2.3 lays out its
tabs. It can load a second file and show the two side by side with their
differences marked.

It ships as one self-contained `.html`, a dependency-free Windows `.exe` that
opens in its own window, and an Android `.apk`. All three are published from
GitHub Releases and all three carry the same page.

**It is a viewer.** It never talks to a flight controller, it cannot flash or
configure one, and it never rewrites a value it was given. Any change that would
make it write, connect or "fix" something is out of scope.

## Hard constraints

These are not preferences. Check each one before committing.

- **The repository is public.** Anything committed is published.
- **Every sample must have its `mcu_id` redacted** before it is committed. It is
  the board's unique hardware serial. One slipped through once and had to be
  scrubbed out of 51 commits with a history rewrite and a force-push.
- **`android/sideload-debug.keystore` is a deliberately public throwaway key.**
  It exists so a sideload APK can be signed at all. It must never be used to
  publish to a store, and nothing may claim it secures anything.
- **Do not create a pull request unless asked.** Work goes to the branch named
  in the session brief.
- **The user's email is for git authorship only.** Never send it anywhere else.

## Standing decisions

- **Match the Configurator, do not improve on it.** If the Configurator's page
  does not have a box, a row or a column, the viewer does not either. Its tab
  rail, its wording, its two visual languages, its icons. Screenshots of the
  real Configurator are the reference; when one exists, it wins over reasoning.
- **Never invent a default.** A firmware default that depends on a build-time
  macro is reported as unknown, not guessed. `gen_settings.py` retires
  conflicting `#define`s rather than picking one.
- **Never invent a scale factor.** Display scaling comes from
  `tools/gen_scales.py`, which extracts the Configurator's own bindings per
  firmware release. A setting with no binding is shown exactly as the CLI
  printed it.
- **Say what is uncertain, on the page.** Where the viewer cannot be sure — a
  board default overriding a firmware one, a `dump` compared against a `diff` —
  the page carries a note saying so rather than quietly showing something wrong.
- **Two tabs are the viewer's own, not the Configurator's:** `All Settings`
  (every value in the file, so nothing can hide) and `CLI` (the raw text).
  Everything else on the rail is the Configurator's.

## Layout

```
index.html                the page
css/app.css               Configurator-style light and dark themes
js/parser.js              CLI dump / diff / preset parser
js/schema.js              TABS, SECTIONS, and which tab each setting belongs to
js/app.js                 all rendering, including the comparison engine
data/rf-4.5.js            generated firmware metadata (names, ranges, defaults)
data/rf-4.6.js
data/layout-2.3.js        Configurator page layouts, transcribed box by box
data/labels-2.3.js        Configurator labels and units
data/scales-2.3.js        Configurator display scale factors, per release
data/enums-2.3.js         Configurator enum wording
data/icons-2.3.js         Configurator tab icons as data URIs
tools/gen_*.py            regenerate data/ from firmware and Configurator checkouts
tools/build_single.py     inline everything into one .html
tools/build_windows.py    cross-compile the .exe with Zig
tools/selftest.js         parser, metadata and layout checks (no browser)
tools/verify_render.js    every rendered value traced back to its file
tools/verify_compare.js   the comparison, checked against the files it compares
samples/                  example files, mcu_id redacted
android/                  the APK wrapper
```

### How a page gets drawn

`data/layout-2.3.js` records what the Configurator actually renders: the boxes in
order, the rows in each box in order, which rows hang off a toggle, and the label
and unit for each. `js/app.js` walks that. A row whose CLI setting is missing from
the loaded firmware's metadata is skipped, so one layout serves several releases.

The Configurator has **two visual languages** and the difference is visible: its
older HTML tabs put the control on the left and the label to its right; the tabs
it has rewritten in Svelte put the label left and the control against the right
edge. A layout says which it is (`style: 'svelte'`), a box may override it, and
`rowOrder()` assembles the row that way round.

### How the comparison works

Two files are compared by **drawing the same page twice**, once per file, and
pairing the rows of the two panes afterwards. No renderer knows a second file
exists — they all read `state.parsed`, so `useFile(i)` points that at one file,
the page is built, then the other.

Comparing the *rendered page* rather than the parsed files means the comparison
is of what the viewer actually shows — scaled, named, computed and all.

Rows pair by key, scoped to the box they sit in and numbered where a key repeats.
A settings row carries its CLI name (`data-k`); a table row is keyed by its first
column, which in these tables is an identity rather than a value. Cells marked
`nodiff` are excluded from the signature — a line number is a fact about the
file, not about the setting.

Two pages are deliberately **not** paned: `All Settings` merges into one list
with a column per file, and `CLI` marks lines rather than rows.

## Checking it still works

Run all three before committing anything that touches rendering:

```
node tools/selftest.js
python3 tools/build_single.py
node tools/verify_render.js samples/*.txt
node tools/verify_compare.js samples/*.txt
```

The last two need Playwright and a browser; pass `--browser <path>` to point at
an existing Chromium instead of downloading one. All three run in CI on every
push, and the release workflow runs them too — a release is exactly when it
matters that the pages render what the file says.

`verify_compare.js` checks the strongest invariant available: **a file compared
with itself must show no differences anywhere.** It also checks that the rail's
per-tab counts equal what the All Settings page finds; those are computed by
separate code paths, so agreeing means something.

## Conventions

- **ES5-style JavaScript**, no build step, no framework, no dependencies. The
  page must open from a USB stick with nothing installed.
- **Comments explain why, not what.** The existing comments say what the
  Configurator does and why the code follows it; match that register. Do not
  add comments that restate the line below them.
- **Commit messages** are a one-line summary in the imperative, then prose
  paragraphs explaining the reasoning and the trade-offs. Not bullet lists.
- Non-ASCII characters appear literally in the source as well as as `\uXXXX`
  escapes; both are fine, the files are UTF-8.

### A trap worth knowing

`js/app.js` contains literal JS escapes like `’`. A non-raw Python string
in an edit script converts those to the character and then fails to match. Use
raw strings, anchor on unique text, assert the match count, and re-check with
`grep` afterwards — a script that dies mid-way silently discards the edits it
had already made in memory.

## Known gaps

- **The Android app has never been run on a real device.**
- 18 of the 39 Configurator screenshots were never opened; their content is
  covered indirectly by shared layouts and group counts.
- Around 48 master-scope settings disagree with the firmware default. They are
  believed to be board defaults — voltage dividers, bus and pin assignments,
  gyro alignment — but only six have been confirmed by reading firmware source.
- Blackbox has no screenshot to compare against, so its single box is a
  judgement rather than a transcription.
- The GPL-3.0 licence and `NOTICE` were added because the project derives from
  the Configurator and the firmware. The user has never confirmed whether to
  keep them.

## Releasing

Tag-triggered, or run the `release` workflow by hand with a tag name. It rebuilds
all three packages from the tagged source — never from `dist/` — runs every
check, verifies the `.exe` imports only Windows DLLs and the `.apk` requests no
permissions, confirms the page inside both is byte-identical to the published
`.html`, then publishes with SHA256 sums.
