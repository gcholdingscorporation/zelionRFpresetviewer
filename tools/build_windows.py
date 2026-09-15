#!/usr/bin/env python3
"""
Build the portable Windows executable.

    python3 tools/build_windows.py

Cross-compiles from anything Zig runs on. Zig is used purely as a C compiler
with a bundled mingw-w64: it needs no Windows machine, no Visual Studio and no
separate toolchain install.

    pip install ziglang

The result, dist/RotorflightPresetViewer.exe, is a single file that depends only
on kernel32 and shell32 - part of Windows itself. There is nothing to install
next to it.
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'dist', 'rotorflight-preset-viewer.html')
SOURCE = os.path.join(ROOT, 'tools', 'win_launcher.c')
OUT = os.path.join(ROOT, 'dist', 'RotorflightPresetViewer.exe')


def zig(*args):
    return subprocess.run([sys.executable, '-m', 'ziglang'] + list(args),
                          capture_output=True, text=True)


def main():
    probe = zig('version')
    if probe.returncode != 0:
        raise SystemExit('zig not available - run: pip install ziglang')
    print('zig %s' % probe.stdout.strip())

    # The launcher embeds the single-file page, so build that first.
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_single.py')],
                   check=True)
    if not os.path.exists(PAGE):
        raise SystemExit('missing %s' % PAGE)

    # Two steps on purpose. zig cc's -nostdlib also suppresses the bundled
    # mingw headers, so the object is compiled with them available and only the
    # link step drops the C runtime.
    obj = os.path.join(ROOT, 'dist', 'win_launcher.obj')

    print('compiling %s ...' % os.path.basename(SOURCE))
    result = zig(
        'cc',
        '-target', 'x86_64-windows-gnu',
        '-std=c23',                 # for #embed, which inlines the page
        '-O2',
        # Stop the compiler rewriting this file's own memcpy/memset into calls
        # to themselves once the C runtime is gone.
        '-fno-builtin-memcpy',
        '-fno-builtin-memset',
        '-fno-stack-protector',
        '-Wall',
        '-c', SOURCE,
        '-o', obj,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit('compile failed')
    if result.stderr.strip():
        sys.stderr.write(result.stderr)

    print('linking ...')
    result = zig(
        'cc',
        '-target', 'x86_64-windows-gnu',
        # No C runtime: the only imports are Windows' own DLLs. Linking the CRT
        # would add a dependency on the Universal CRT, which Windows versions
        # before 10 do not ship.
        '-nostdlib',
        obj,
        '-o', OUT,
        '-lkernel32', '-lshell32', '-luser32',
        # GUI subsystem, so double-clicking the .exe opens no console window.
        '-Wl,--subsystem,windows',
        '-Wl,-e,launcher_entry',
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit('link failed')
    os.remove(obj)
    # The linker drops debug symbols next to the binary; they are not part of
    # the distributable.
    pdb = os.path.splitext(OUT)[0] + '.pdb'
    if os.path.exists(pdb):
        os.remove(pdb)

    size = os.path.getsize(OUT)
    print('wrote %s (%.1f MB)' % (OUT, size / (1024.0 * 1024.0)))


if __name__ == '__main__':
    main()
