#!/usr/bin/env python3
"""
Extract the Configurator's own wording for enumerated settings.

    python3 tools/gen_enums.py <configurator-checkout> data/enums-2.3.js

The CLI prints an enum as the firmware's symbol - `swash_type = CP120`,
`main_rotor_dir = CW`, `tail_rotor_mode = VARIABLE`. The Configurator never
shows those; it shows "CCPM 120", "Clockwise", "Variable pitch". The wording
lives in its dropdowns, whose <option> text is a locale key, so this reads the
dropdowns and resolves the keys.

Two indexes come out of it, because the viewer needs both:

  byName  cli setting -> {stored value: wording}
          for an ordinary MODE_LOOKUP setting, where a dropdown's option value
          is the number the firmware stores.

  byId    element id  -> {option value: wording}
          for the ones the Configurator computes rather than stores, such as
          the four control-direction dropdowns on the Mixer tab, whose values
          are +1/-1 derived from the sign of a mixer input rate.

The Configurator is GPL-3.0; see LICENSE and NOTICE.
"""

import html
import json
import os
import re
import sys


def read(path):
    with open(path, encoding='utf-8', errors='replace') as fh:
        return fh.read()


def walk(root, suffix):
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name.endswith(suffix):
                yield os.path.join(dirpath, name)


def load_messages(cfg):
    raw = json.loads(read(os.path.join(cfg, 'locales', 'en', 'messages.json')))
    out = {}
    for key, value in raw.items():
        message = value.get('message')
        if not message:
            continue
        text = html.unescape(re.sub(r'<[^>]+>', '', message))
        text = re.sub(r'\s+', ' ', text).strip()
        if text and '{{' not in text:
            out[key] = text
    return out


def normalise(element_id):
    spaced = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', element_id)
    return spaced.replace('-', '_').lower()


def load_db(repo):
    """Every firmware's settings and lookup tables, keyed by version."""
    out = {}
    data = os.path.join(repo, 'data')
    for path in sorted(os.listdir(data)):
        if path.startswith('rf-') and path.endswith('.js'):
            text = read(os.path.join(data, path))
            body = text[text.index('] = ') + 4:].rstrip().rstrip(';')
            out[path[3:-3]] = json.loads(body)
    return out


def selects_from_html(cfg, messages, by_id):
    for path in walk(os.path.join(cfg, 'src', 'tabs'), '.html'):
        text = read(path)
        for m in re.finditer(r'<select\b([^>]*)>(.*?)</select>', text, re.S):
            sid = re.search(r'id="([^"]+)"', m.group(1))
            if not sid:
                continue
            options = {}
            for o in re.finditer(r'<option\b([^>]*)>(.*?)</option>',
                                 m.group(2), re.S):
                val = re.search(r'value="([^"]*)"', o.group(1))
                if not val:
                    continue
                key = re.search(r'i18n="([^"]+)"', o.group(1))
                if key:
                    word = messages.get(key.group(1))
                else:
                    word = re.sub(r'\s+', ' ', html.unescape(
                        re.sub(r'<[^>]+>', '', o.group(2)))).strip()
                if word:
                    options[val.group(1)] = word
            if options:
                by_id.setdefault(sid.group(1), {}).update(options)


def numbered_keys(messages, prefix):
    """`mixerSwashType0..9` -> {0: 'None', 1: 'Direct', ...}, gaps dropped."""
    out = {}
    for key, word in messages.items():
        m = re.fullmatch(re.escape(prefix) + r'(\d+)', key)
        if m and word:
            out[m.group(1)] = word
    return out


def js_lists(cfg, messages, by_id):
    """Dropdowns the Configurator fills from a list of locale keys in JS.

    `Mixer.swashTypes` is a list of key names, indexed by the stored value, and
    tabs/mixer.js walks it to build the dropdown. The list is the only place
    that order is written down, so it is read rather than assumed.
    """
    pairs = []
    for path in walk(os.path.join(cfg, 'src', 'js'), '.js'):
        text = read(path)
        for m in re.finditer(r'(\w+)\s*:\s*\[\s*((?:\'[A-Za-z]\w*\d*\'\s*,\s*)+)\]',
                             text):
            keys = re.findall(r"'([^']+)'", m.group(2))
            if len(keys) < 2 or not all(k in messages for k in keys):
                continue
            pairs.append((m.group(1), keys))
    for listname, keys in pairs:
        table = {str(i): messages[k] for i, k in enumerate(keys)}
        by_id.setdefault('js:' + listname, {}).update(table)


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    cfg, out_path = sys.argv[1], sys.argv[2]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isdir(os.path.join(cfg, 'src', 'tabs')):
        raise SystemExit('not a configurator checkout: %s' % cfg)

    messages = load_messages(cfg)
    db = load_db(repo)

    by_id = {}
    selects_from_html(cfg, messages, by_id)
    js_lists(cfg, messages, by_id)
    print('%d dropdowns read' % len(by_id))

    # A dropdown whose id names a CLI setting gives that setting its wording.
    by_name = {}
    all_names = set()
    for spec in db.values():
        all_names.update(spec['settings'])
    for sid, options in by_id.items():
        name = normalise(sid)
        if name in all_names and all(re.fullmatch(r'\d+', k) for k in options):
            by_name.setdefault(name, {}).update(options)

    # Mixer.swashTypes is indexed by the stored value of swash_type.
    if 'js:swashTypes' in by_id:
        by_name.setdefault('swash_type', {}).update(by_id['js:swashTypes'])

    print('%d settings given Configurator wording' % len(by_name))
    for name in sorted(by_name):
        print('   %-28s %s' % (name, ', '.join(
            by_name[name][k] for k in sorted(by_name[name], key=int))[:70]))

    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/gen_enums.py from the Rotorflight\n'
                 '// Configurator (GPL-3.0; see NOTICE). Do not edit by hand.\n'
                 '// The wording the Configurator shows for an enumerated value.\n')
        fh.write('window.RF_ENUMS = %s;\n' % json.dumps(
            {'byId': by_id, 'byName': by_name},
            separators=(',', ':'), sort_keys=True))
    print('wrote %s (%d bytes)' % (out_path, os.path.getsize(out_path)))


if __name__ == '__main__':
    main()
