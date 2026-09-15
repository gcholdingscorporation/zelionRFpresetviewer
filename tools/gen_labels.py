#!/usr/bin/env python3
"""
Extract the Rotorflight Configurator's own labels for CLI settings.

    python3 tools/gen_labels.py <configurator-checkout> data/labels-2.3.js

The viewer would otherwise have to invent a label for each setting from its CLI
name, which reads nothing like the Configurator. The Configurator already has a
label for most of them, in its English locale, so this takes them from source:

  src/tabs/**/*.svelte   <Section label="KEY">, <SubSection label="KEY"> and
                         <Field id="..." label="KEY" unit="...">
  src/tabs/*.html        .gui_box titles, and <label for="ID"><span i18n="KEY">
  locales/en/messages.json  KEY -> English

A control's element id is the link back to the CLI: the Configurator spells its
ids in kebab or camel case ("gov-handover-throttle", "errorDecayTimeGround")
where the CLI uses snake case, so an id is matched by normalising both. Ids
that name no CLI setting are skipped rather than guessed at - the viewer falls
back to its own label for those.

The Configurator is GPL-3.0; see LICENSE and NOTICE.
"""

import json
import os
import re
import sys


def load_messages(cfg):
    path = os.path.join(cfg, 'locales', 'en', 'messages.json')
    with open(path, encoding='utf-8') as fh:
        raw = json.load(fh)
    out = {}
    for key, value in raw.items():
        message = value.get('message')
        if not message:
            continue
        # Locale strings carry markup and placeholders; neither belongs in a label.
        text = re.sub(r'<[^>]+>', '', message)
        text = re.sub(r'\s+', ' ', text).strip()
        if text and '{{' not in text:
            out[key] = text
    return out


def normalise(element_id):
    """`gov-handover-throttle` and `errorDecayTimeGround` -> snake case."""
    spaced = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', element_id)
    return spaced.replace('-', '_').lower()


def walk(root, suffix):
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name.endswith(suffix):
                yield os.path.join(dirpath, name)


def read(path):
    with open(path, encoding='utf-8', errors='replace') as fh:
        return fh.read()


def from_svelte(cfg, messages, cli_names, labels, sections):
    """Fields, and the section each one sits under, from the Svelte tabs."""
    for path in walk(os.path.join(cfg, 'src', 'tabs'), '.svelte'):
        text = read(path)

        # The section heading in force is the nearest <Section> above a field.
        section_at = []
        for m in re.finditer(r'<Section\b[^>]*?label="([^"]+)"', text):
            section_at.append((m.start(), messages.get(m.group(1))))

        def section_for(pos):
            title = None
            for start, name in section_at:
                if start < pos:
                    title = name
                else:
                    break
            return title

        for m in re.finditer(r'<Field\b([^>]*?)>', text, re.S):
            attrs = m.group(1)
            fid = re.search(r'id="([^"]+)"', attrs)
            key = re.search(r'label="([^"]+)"', attrs)
            if not fid or not key:
                continue
            name = normalise(fid.group(1))
            if name not in cli_names or name in labels:
                continue
            label = messages.get(key.group(1))
            if not label:
                continue
            labels[name] = {'l': label}
            unit = re.search(r'unit="([^"]+)"', attrs)
            if unit:
                labels[name]['u'] = unit.group(1)
            title = section_for(m.start())
            if title:
                sections[name] = title


def from_html(cfg, messages, cli_names, labels, sections):
    """Fields, and their box titles, from the legacy HTML tabs."""
    for path in walk(os.path.join(cfg, 'src', 'tabs'), '.html'):
        text = read(path)

        title_at = []
        for m in re.finditer(r'class="spacer_box_title"\s+i18n="([^"]+)"', text):
            title_at.append((m.start(), messages.get(m.group(1))))

        def title_for(pos):
            title = None
            for start, name in title_at:
                if start < pos:
                    title = name
                else:
                    break
            return title

        for m in re.finditer(
                r'<label[^>]*for="([^"]+)"[^>]*>\s*<span\s+i18n="([^"]+)"', text):
            name = normalise(m.group(1))
            if name not in cli_names or name in labels:
                continue
            label = messages.get(m.group(2))
            if not label:
                continue
            # These labels often carry their unit inline, e.g. "Decay Time [s]".
            unit = re.search(r'\[\s*([^\]]{1,12})\s*\]\s*$', label)
            entry = {'l': label}
            if unit:
                entry['l'] = label[:unit.start()].strip()
                entry['u'] = unit.group(1).strip()
            labels[name] = entry
            title = title_for(m.start())
            if title:
                sections[name] = title


def load_cli_names(repo):
    names = set()
    for path in sorted(os.listdir(os.path.join(repo, 'data'))):
        if not path.startswith('rf-') or not path.endswith('.js'):
            continue
        text = read(os.path.join(repo, 'data', path))
        body = text[text.index('] = ') + 4:].rstrip().rstrip(';')
        names.update(json.loads(body)['settings'])
    return names


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    cfg, out_path = sys.argv[1], sys.argv[2]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if not os.path.isdir(os.path.join(cfg, 'src', 'tabs')):
        raise SystemExit('not a configurator checkout: %s' % cfg)

    messages = load_messages(cfg)
    cli_names = load_cli_names(repo)
    print('%d locale strings, %d CLI settings to label' % (len(messages), len(cli_names)))

    labels, sections = {}, {}
    from_svelte(cfg, messages, cli_names, labels, sections)
    print('  after the Svelte tabs: %d labelled' % len(labels))
    from_html(cfg, messages, cli_names, labels, sections)
    print('  after the HTML tabs:   %d labelled' % len(labels))

    for name, title in sections.items():
        if name in labels:
            labels[name]['s'] = title

    with_unit = sum(1 for v in labels.values() if 'u' in v)
    print('  %d carry a unit' % with_unit)

    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/gen_labels.py from the Rotorflight\n'
                 '// Configurator (GPL-3.0; see NOTICE). Do not edit by hand.\n')
        fh.write('window.RF_LABELS = %s;\n'
                 % json.dumps(labels, separators=(',', ':'), sort_keys=True))
    print('wrote %s (%d bytes)' % (out_path, os.path.getsize(out_path)))


if __name__ == '__main__':
    main()
