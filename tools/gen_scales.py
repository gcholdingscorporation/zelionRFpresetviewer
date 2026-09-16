#!/usr/bin/env python3
"""
Extract the Configurator's display scaling for CLI settings.

    python3 tools/gen_scales.py <configurator-checkout> data/scales-2.3.js

A number of Rotorflight settings are stored in tenths: the CLI prints
`gov_spoolup_time = 300` where the Configurator shows `30.0 s`. A viewer that
prints the raw number is not wrong, but it does not match what the pilot sees,
so the factor has to come from somewhere reliable.

It comes from the Configurator's own bindings. Each field binds one of:

    bind:value={FC.GOVERNOR.gov_autorotation_timeout}      -> shown as stored
    bind:value={fields.gov_throttle_hold_timeout}          -> via a /10 proxy
    bind:value={() => FC.GOVERNOR.gov_d_filter / 10, ...}  -> divided inline

which is worth stressing, because the two governor timeouts sit next to each
other on the same page and scale differently: one is declared in the proxy list
but binds directly anyway, so reading the list alone would get it wrong. Only
the binding on the field itself is authoritative.

The Configurator is GPL-3.0; see LICENSE and NOTICE.
"""

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


def proxy_factors(text):
    """Fields routed through a `for (const field of [...]) { ... / N }` proxy."""
    out = {}
    for m in re.finditer(
            r'for\s*\(\s*const\s+field\s+of\s*\[(.*?)\]\s*\)\s*\{(.*?)\n\s*\}',
            text, re.S):
        names = re.findall(r'"([^"]+)"', m.group(1))
        div = re.search(r'/\s*(\d+)', m.group(2))
        if not div:
            continue
        for name in names:
            out[name] = int(div.group(1))
    return out


def field_blocks(text):
    """Yield each <Field> ... </Field> with the {#if} conditions guarding it.

    Some settings are bound twice, once for each firmware generation, and scale
    differently between them - gov_autorotation_timeout is stored in tenths up
    to 4.5 and whole seconds from 4.6. The guarding condition is what says
    which, so it is carried along with the block.
    """
    tokens = re.finditer(r'\{#if\s+(.*?)\}|\{:else\s*if\s+(.*?)\}|\{:else\}|\{/if\}'
                         r'|<Field\b(.*?)</Field>', text, re.S)
    stack = []
    for m in tokens:
        if m.group(0).startswith('{#if'):
            stack.append(' '.join(m.group(1).split()))
        elif m.group(0).startswith('{:else if'):
            if stack:
                stack[-1] = ' '.join(m.group(2).split())
        elif m.group(0).startswith('{:else'):
            if stack:
                stack[-1] = 'not(' + stack[-1] + ')'
        elif m.group(0) == '{/if}':
            if stack:
                stack.pop()
        else:
            yield m.group(3), list(stack)


def versions_for(conditions, all_versions):
    """Which firmware versions a guarded field applies to.

    `is_12_9` is the Configurator's test for MSP API 12.9, which arrived with
    firmware 4.6.
    """
    joined = ' && '.join(conditions)
    if not re.search(r'is_12_9', joined):
        return all_versions
    negated = re.search(r'(!|not\()\s*is_12_9', joined)
    if negated:
        return [v for v in all_versions if v < '4.6']
    return [v for v in all_versions if v >= '4.6']


def scales_from(text, cli_names, scales, conflicts, all_versions):
    proxies = proxy_factors(text)

    for block, conditions in field_blocks(text):
        versions = versions_for(conditions, all_versions)
        for bind in re.findall(r'bind:value=\{(.*?)\}\s*\n', block, re.S) or \
                    re.findall(r'bind:value=\{([^{}]*)\}', block):
            bind = ' '.join(bind.split())

            # () => FC.X.name / N   (an inline conversion)
            m = re.search(r'FC\.\w+\.(\w+)\s*/\s*(\d+)', bind)
            if m and m.group(1) in cli_names:
                record(scales, conflicts, m.group(1), int(m.group(2)), versions)
                continue

            # fields.name          (the proxy declared above)
            m = re.search(r'\bfields\.(\w+)', bind)
            if m:
                name = m.group(1)
                if name in cli_names and name in proxies:
                    record(scales, conflicts, name, proxies[name], versions)
                continue

            # FC.X.name            (shown exactly as stored)
            m = re.fullmatch(r'FC\.\w+\.(\w+)', bind)
            if m and m.group(1) in cli_names:
                record(scales, conflicts, m.group(1), 1, versions)


def record(scales, conflicts, name, factor, versions):
    for version in versions:
        table = scales.setdefault(version, {})
        if name in table and table[name] != factor:
            conflicts.setdefault((version, name), set()).update([table[name], factor])
            continue
        table[name] = factor


def load_cli_names(repo):
    names = set()
    data = os.path.join(repo, 'data')
    for path in sorted(os.listdir(data)):
        if path.startswith('rf-') and path.endswith('.js'):
            text = read(os.path.join(data, path))
            body = text[text.index('] = ') + 4:].rstrip().rstrip(';')
            names.update(json.loads(body)['settings'])
    return names


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    cfg, out_path = sys.argv[1], sys.argv[2]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    cli_names = load_cli_names(repo)
    all_versions = sorted(
        p[3:-3] for p in os.listdir(os.path.join(repo, 'data'))
        if p.startswith('rf-') and p.endswith('.js'))

    scales, conflicts = {}, {}
    for path in walk(os.path.join(cfg, 'src', 'tabs'), '.svelte'):
        scales_from(read(path), cli_names, scales, conflicts, all_versions)

    for (version, name), seen in sorted(conflicts.items()):
        print('  ! %s (%s) is bound with more than one factor: %s - skipped'
              % (name, version, sorted(seen)), file=sys.stderr)
        scales.get(version, {}).pop(name, None)

    out = {}
    for version, table in sorted(scales.items()):
        scaled = {k: v for k, v in table.items() if v != 1}
        out[version] = scaled
        print('%s: %d fields bound, %d scaled' % (version, len(table), len(scaled)))
        for name, factor in sorted(scaled.items()):
            print('   /%-4d %s' % (factor, name))

    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/gen_scales.py from the Rotorflight\n'
                 '// Configurator (GPL-3.0; see NOTICE). Do not edit by hand.\n'
                 '// Divisor applied to a stored value for display, per firmware.\n')
        fh.write('window.RF_SCALES = %s;\n'
                 % json.dumps(out, separators=(',', ':'), sort_keys=True))
    print('wrote %s' % out_path)


if __name__ == '__main__':
    main()
