#!/usr/bin/env python3
"""
Inline the viewer into one self-contained .html file.

    python3 tools/build_single.py [output.html]

The result has no external references at all: stylesheet, scripts and the
generated firmware metadata are all embedded. It opens from a phone's Files app,
a USB stick or an email attachment with nothing installed, and it is also what
the desktop and Android builds wrap.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'dist', 'rotorflight-preset-viewer.html')


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
        return fh.read()


def build():
    html = read('index.html')

    # A </script> or </style> sequence inside embedded code would end the tag
    # early, so break it up. No JS or CSS meaning changes.
    def safe(text):
        return re.sub(r'</(script|style)', r'<\\/\1', text, flags=re.I)

    def inline_css(m):
        return '<style>\n%s\n</style>' % safe(read(m.group(1)))

    def inline_js(m):
        return '<script>\n%s\n</script>' % safe(read(m.group(1)))

    html, n_css = re.subn(
        r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>', inline_css, html)
    html, n_js = re.subn(
        r'<script\s+src="([^"]+)"\s*></script>', inline_js, html)

    if not n_css or not n_js:
        raise SystemExit('nothing was inlined - has index.html changed shape?')

    # Nothing may remain that the browser would have to fetch.
    leftovers = re.findall(r'(?:src|href)="(?!#|https?:|data:)([^"]+)"', html)
    leftovers = [f for f in leftovers if not f.startswith('mailto:')]
    if leftovers:
        raise SystemExit('still references external files: %s' % ', '.join(leftovers))

    html = html.replace(
        '<title>Rotorflight Preset Viewer</title>',
        '<!-- Built by tools/build_single.py. Everything is embedded: '
        'no network access, no install, no dependencies. -->\n'
        '<title>Rotorflight Preset Viewer</title>')
    return html, n_css, n_js


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    html, n_css, n_js = build()
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print('inlined %d stylesheet(s) and %d script(s)' % (n_css, n_js))
    print('wrote %s (%.1f KB)' % (out_path, os.path.getsize(out_path) / 1024.0))


if __name__ == '__main__':
    main()
