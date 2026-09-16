#!/usr/bin/env python3
"""
Generate the setting-metadata database used by the Rotorflight Preset Viewer.

Everything this script emits is extracted from the Rotorflight *firmware*
source tree, which is the authoritative definition of the CLI:

  src/main/cli/settings.c      -> the CLI `valueTable`: every `set` name, its
                                  scope (master/profile/rateprofile), its C type,
                                  its display mode (direct/lookup/array/bitset/
                                  string), its value range and, for lookups, the
                                  enum strings the CLI accepts.
  src/main/fc/parameter_names.h-> PARAM_NAME_* macro -> CLI name.
  src/main/pg/*.c (+ others)   -> PG_RESET_TEMPLATE / RESET_CONFIG blocks, which
                                  hold the factory default of every setting.

The output is a plain .js file that assigns into `window.RF_DB`, so the viewer
works when opened straight off the filesystem (no server, no fetch(), no build).

Usage:
    python3 tools/gen_settings.py <firmware-src-tree> <version-key> <out.js>
    e.g. python3 tools/gen_settings.py /path/to/rotorflight-firmware 4.5 data/rf-4.5.js
"""

import json
import os
import re
import sys


# --------------------------------------------------------------------------
# Small C-ish helpers
# --------------------------------------------------------------------------

def strip_comments(text):
    """Remove /* */ and // comments, keeping newlines so line numbers survive."""
    def repl(m):
        s = m.group(0)
        if s.startswith('/'):
            return ' ' * 0 + '\n' * s.count('\n')
        return s
    pattern = re.compile(
        r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
        re.DOTALL)
    return pattern.sub(repl, text)


def strip_preprocessor(text):
    """Drop #if/#ifdef/#else/#endif lines but keep everything they guard.

    The viewer wants the union of all build configurations: a dump from any
    target should resolve. Conditional entries are kept and flagged instead.
    """
    out = []
    for line in text.split('\n'):
        if re.match(r'\s*#\s*(if|ifdef|ifndef|else|elif|endif)\b', line):
            out.append('')
        else:
            out.append(line)
    return '\n'.join(out)


def split_top_level(text, sep=','):
    """Split on `sep`, ignoring separators nested in (), [], {} or strings."""
    parts, depth, buf, i = [], 0, [], 0
    quote = None
    while i < len(text):
        c = text[i]
        if quote:
            buf.append(c)
            if c == '\\':
                if i + 1 < len(text):
                    buf.append(text[i + 1])
                    i += 1
            elif c == quote:
                quote = None
        elif c in '"\'':
            quote = c
            buf.append(c)
        elif c in '([{':
            depth += 1
            buf.append(c)
        elif c in ')]}':
            depth -= 1
            buf.append(c)
        elif c == sep and depth == 0:
            parts.append(''.join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    tail = ''.join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def iter_braced_blocks(text, start):
    """Yield each balanced {...} block found at nesting depth 1 from `start`.

    `start` must be the index of the opening brace of the enclosing array.
    """
    depth = 0
    i = start
    block_start = None
    while i < len(text):
        c = text[i]
        if c == '{':
            depth += 1
            if depth == 2:
                block_start = i
        elif c == '}':
            depth -= 1
            if depth == 1 and block_start is not None:
                yield text[block_start + 1:i]
                block_start = None
            elif depth == 0:
                return
        i += 1


def walk_c_files(root, exts=('.c', '.h')):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'obj')]
        for fn in filenames:
            if fn.endswith(exts):
                yield os.path.join(dirpath, fn)


# --------------------------------------------------------------------------
# Symbol table: #defines and enum constants, so defaults/ranges resolve to ints
# --------------------------------------------------------------------------

class Symbols:
    def __init__(self):
        self.values = {}
        # Names whose #define differs between targets or feature builds.
        self.conflicting = set()

    def load_tree(self, main_dir):
        define_re = re.compile(
            r'^\s*#\s*define\s+([A-Za-z_]\w*)\s+(\(?\s*-?\s*(?:0[xX][0-9a-fA-F]+|\d+)\s*\)?)\s*$')
        alias_re = re.compile(r'^\s*#\s*define\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*$')
        aliases = {}
        for path in walk_c_files(main_dir):
            try:
                with open(path, 'r', errors='replace') as fh:
                    raw = fh.read()
            except OSError:
                continue
            for line in raw.split('\n'):
                m = define_re.match(line)
                if m:
                    name, val = m.group(1), m.group(2).replace('(', '').replace(')', '').strip()
                    try:
                        number = int(val, 0)
                    except ValueError:
                        continue
                    # A macro defined more than once with different values is
                    # per-target or per-feature - ESC_SENSOR_TASK_FREQ_HZ is 50
                    # generically and 100, 200 or 250 depending on the board.
                    # There is no one answer, so the name is retired rather than
                    # resolved to whichever definition was read first.
                    if name in self.values and self.values[name] != number:
                        self.conflicting.add(name)
                    self.values.setdefault(name, number)
                    continue
                m = alias_re.match(line)
                if m:
                    aliases.setdefault(m.group(1), m.group(2))
            self._load_enums(strip_comments(raw))
        # Resolve one level of #define A B chains.
        for name, target in aliases.items():
            if name not in self.values and target in self.values:
                self.values[name] = self.values[target]

    def _load_enums(self, text):
        for m in re.finditer(r'\benum\b[^{;]*\{', text):
            open_brace = m.end() - 1
            depth, i = 0, open_brace
            while i < len(text):
                if text[i] == '{':
                    depth += 1
                elif text[i] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = text[open_brace + 1:i]
            counter = 0
            for item in split_top_level(body):
                item = item.strip()
                if not item:
                    continue
                if '=' in item:
                    name, expr = item.split('=', 1)
                    name = name.strip()
                    val = self.eval_expr(expr.strip())
                    if val is None:
                        counter += 1
                        continue
                    counter = val
                else:
                    name = item.strip()
                if re.fullmatch(r'[A-Za-z_]\w*', name):
                    self.values.setdefault(name, counter)
                counter += 1

    def eval_expr(self, expr):
        """Evaluate a simple integer C expression, or return None.

        A name whose definition depends on the build is not evaluated at all:
        answering with one target's number would be worse than admitting the
        default is not knowable from the source alone.
        """
        expr = expr.strip()
        if not expr:
            return None
        if re.fullmatch(r'-?\s*\d+', expr):
            return int(expr.replace(' ', ''))
        if re.fullmatch(r'0[xX][0-9a-fA-F]+', expr):
            return int(expr, 16)
        if expr == 'true':
            return 1
        if expr == 'false':
            return 0
        if expr == 'INIT_ZERO':
            return 0
        # A character literal is a number: serialConfig->reboot_character = 'R'.
        m = re.fullmatch(r"'(\\?.)'", expr)
        if m:
            text = m.group(1)
            escapes = {'\\0': 0, '\\n': 10, '\\r': 13, '\\t': 9}
            return escapes.get(text, ord(text[-1]))
        # BIT(x) is the firmware's bit-position macro (src/main/common/utils.h).
        expr = re.sub(r'\bBIT\s*\(([^()]*)\)', r'(1 << (\1))', expr)
        # Substitute known symbols, then evaluate if only arithmetic remains.
        if any(re.search(r'\b%s\b' % re.escape(name), expr)
               for name in self.conflicting):
            return None
        substituted = re.sub(
            r'[A-Za-z_]\w*',
            lambda m: str(self.values[m.group(0)]) if m.group(0) in self.values else m.group(0),
            expr)
        if re.fullmatch(r'[-+*/()<>\s\d|&]*', substituted) and re.search(r'\d', substituted):
            # A firmware expression may wrap over several lines; Python's eval
            # needs it on one.
            substituted = ' '.join(substituted.split())
            try:
                return int(eval(substituted, {'__builtins__': {}}, {}))  # noqa: S307
            except Exception:
                return None
        return None


# --------------------------------------------------------------------------
# settings.c: lookup tables and the CLI value table
# --------------------------------------------------------------------------

def parse_string_arrays(text):
    """Collect `const char * const NAME[] = { "A", "B" };` tables."""
    tables = {}
    for m in re.finditer(
            r'const\s+char\s*\*\s*const\s+(\w+)\s*\[[^\]]*\]\s*=\s*\{(.*?)\}\s*;',
            text, re.DOTALL):
        name, body = m.group(1), m.group(2)
        values = re.findall(r'"((?:\\.|[^"\\])*)"', body)
        if not values:
            # Some tables stringify through a macro, e.g. DEBUG_NAME(CYCLETIME).
            values = re.findall(r'\b\w+\s*\(\s*(\w+)\s*\)', body)
        # A table can be defined twice, once per side of an #if on an optional
        # feature - lookupTableLEDProfile is RACE/BEACON/STATUS/STATUS_ALT with
        # the status modes compiled in and RACE/BEACON without. The longer one
        # is the one a normal build has, and taking the last would silently
        # drop the entries a file can actually name.
        if name in tables and len(tables[name]) >= len(values):
            continue
        tables[name] = values
    return tables


def parse_lookup_index(settings_c, settings_h):
    """Map TABLE_* enum names to their lookupTableXxx array names.

    `lookupTables[]` in settings.c and `lookupTableIndex_e` in settings.h list
    their members in the same order behind the same #ifdefs, so zipping the two
    after dropping preprocessor lines pairs them correctly.
    """
    c_txt = strip_preprocessor(strip_comments(settings_c))
    h_txt = strip_preprocessor(strip_comments(settings_h))

    m = re.search(r'lookupTableEntry_t\s+lookupTables\s*\[\s*\]\s*=\s*\{(.*?)\n\};',
                  c_txt, re.DOTALL)
    arrays = re.findall(r'LOOKUP_TABLE_ENTRY\s*\(\s*(\w+)\s*\)', m.group(1)) if m else []

    m = re.search(r'typedef\s+enum\s*\{(.*?)\}\s*lookupTableIndex_e\s*;', h_txt, re.DOTALL)
    names = []
    if m:
        for item in split_top_level(m.group(1)):
            item = item.split('=')[0].strip()
            if item.startswith('TABLE_') and item != 'LOOKUP_TABLE_COUNT':
                names.append(item)

    if len(names) != len(arrays):
        print('  ! lookup index mismatch: %d enum names vs %d arrays'
              % (len(names), len(arrays)), file=sys.stderr)
    return dict(zip(names, arrays))


TYPE_BITS = {
    'VAR_UINT8': ('u8', 0, 255),
    'VAR_INT8': ('i8', -128, 127),
    'VAR_UINT16': ('u16', 0, 65535),
    'VAR_INT16': ('i16', -32768, 32767),
    'VAR_UINT32': ('u32', 0, 4294967295),
}

SCOPE_BITS = {
    'MASTER_VALUE': 'master',
    'PROFILE_VALUE': 'profile',
    'PROFILE_RATE_VALUE': 'rateprofile',
    'HARDWARE_VALUE': 'master',
}


def parse_value_table(settings_c, param_names, symbols, table_index):
    text = strip_preprocessor(strip_comments(settings_c))
    m = re.search(r'const\s+clivalue_t\s+valueTable\s*\[\s*\]\s*=\s*\{', text)
    if not m:
        raise SystemExit('valueTable not found in settings.c')
    open_brace = text.index('{', m.start())

    entries = []
    for block in iter_braced_blocks(text, open_brace):
        fields = split_top_level(block)
        if len(fields) < 3:
            continue

        raw_name = fields[0].strip()
        if raw_name.startswith('"'):
            name = raw_name.strip('"')
        elif raw_name in param_names:
            name = param_names[raw_name]
        else:
            continue

        flags = [f.strip() for f in fields[1].split('|')]
        ctype, tmin, tmax = 'u8', 0, 255
        scope, mode = 'master', 'direct'
        for f in flags:
            if f in TYPE_BITS:
                ctype, tmin, tmax = TYPE_BITS[f]
            elif f in SCOPE_BITS:
                scope = SCOPE_BITS[f]
            elif f.startswith('MODE_'):
                mode = f[len('MODE_'):].lower()

        entry = {'name': name, 'type': ctype, 'scope': scope, 'mode': mode}

        pg = None
        field = None
        for part in fields[2:]:
            part = part.strip()
            if part.startswith('PG_ARRAY_ELEMENT_OFFSET'):
                # PG_ARRAY_ELEMENT_OFFSET(type, index, member) addresses one
                # element of an array parameter group. It is an offset, not the
                # group id, which appears as a separate field in the same entry.
                inner = part[part.index('(') + 1:part.rindex(')')]
                bits = split_top_level(inner)
                if len(bits) >= 3:
                    entry['struct'] = bits[0].strip()
                    idx = symbols.eval_expr(bits[1])
                    entry['element'] = idx if idx is not None else bits[1].strip()
                    field = ','.join(bits[2:]).strip()
            elif part.startswith('PG_'):
                pg = part
            elif part.startswith('offsetof'):
                inner = part[part.index('(') + 1:part.rindex(')')]
                bits = split_top_level(inner)
                if len(bits) >= 2:
                    entry['struct'] = bits[0].strip()
                    field = ','.join(bits[1:]).strip()
            elif part.startswith('.config.lookup'):
                tbl = re.search(r'TABLE_\w+', part)
                if tbl:
                    entry['table'] = table_index.get(tbl.group(0), tbl.group(0))
            elif part.startswith('.config.minmaxUnsigned') or part.startswith('.config.minmax'):
                nums = re.search(r'\{(.*)\}', part, re.DOTALL)
                if nums:
                    lo, hi = (split_top_level(nums.group(1)) + ['', ''])[:2]
                    entry['min'] = symbols.eval_expr(lo)
                    entry['max'] = symbols.eval_expr(hi)
            elif part.startswith('.config.array.length'):
                entry['count'] = symbols.eval_expr(part.split('=', 1)[1])
            elif part.startswith('.config.string'):
                nums = re.search(r'\{(.*)\}', part, re.DOTALL)
                if nums:
                    bits = split_top_level(nums.group(1))
                    if len(bits) >= 2:
                        entry['max'] = symbols.eval_expr(bits[1])
            elif part.startswith('.config.bitpos'):
                entry['bitpos'] = symbols.eval_expr(part.split('=', 1)[1])

        if entry.get('min') is None:
            entry['min'] = tmin
        if entry.get('max') is None:
            entry['max'] = tmax
        entry['pg'] = pg
        if field:
            entry['field'] = field
        entries.append(entry)

    return entries


# --------------------------------------------------------------------------
# Factory defaults out of PG_RESET_TEMPLATE / RESET_CONFIG blocks
# --------------------------------------------------------------------------

class Unresolved(str):
    """A default the firmware states symbolically that we could not evaluate."""
    pass


def normalise_path(field, symbols):
    """`pid[PID_ROLL].P` -> `pid.0.P`; `a[idx]` with a non-constant idx -> `a.*`."""
    def sub(m):
        v = symbols.eval_expr(m.group(1))
        return '.%s' % (v if v is not None else '*')
    out = re.sub(r'\[\s*([^\]]*)\s*\]', sub, field)
    return re.sub(r'\s+', '', out)


def parse_designated_initializers(body, symbols):
    """Flatten a C designated-initializer body into {'field.path': value}.

    Handles `.a = 1`, `.a = { 1, 2 }`, `.a = { .b = 1 }` and
    `.a = { [IDX] = { .b = 1 } }`, which together cover the shapes the
    Rotorflight PG reset blocks actually use.
    """
    out = {}

    def walk(prefix, text):
        items = split_top_level(text)
        positional = 0
        for item in items:
            item = item.strip()
            if not item:
                continue
            key = None
            if item.startswith('.'):
                # A designator may be a chain: `.angle.level_strength`, `.a[2].b`
                m = re.match(r'\.\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^\]]*\])*)'
                             r'\s*=\s*(.*)$', item, re.DOTALL)
                if not m:
                    continue
                key, rest = normalise_path(m.group(1), symbols), m.group(2).strip()
            elif item.startswith('['):
                m = re.match(r'\[\s*([^\]]+)\s*\]\s*=\s*(.*)$', item, re.DOTALL)
                if not m:
                    continue
                idx = symbols.eval_expr(m.group(1))
                key = str(idx if idx is not None else m.group(1).strip())
                rest = m.group(2).strip()
            else:
                key = str(positional)
                positional += 1
                rest = item

            path = '%s.%s' % (prefix, key) if prefix else key
            if rest.startswith('{'):
                inner = rest[1:rest.rindex('}')] if rest.endswith('}') else rest[1:]
                if re.search(r'[.\[]', inner.split(',')[0] or ''):
                    walk(path, inner)
                else:
                    vals = []
                    simple = True
                    for v in split_top_level(inner):
                        if not v.strip():
                            continue
                        if v.strip().startswith(('.', '[')):
                            simple = False
                            break
                        ev = symbols.eval_expr(v)
                        vals.append(ev if ev is not None else v.strip())
                    if simple:
                        out[path] = vals
                    else:
                        walk(path, inner)
            else:
                if rest.startswith('"'):
                    out[path] = rest.strip('"')
                else:
                    ev = symbols.eval_expr(rest)
                    out[path] = ev if ev is not None else Unresolved(rest.strip())

    walk('', body)
    return out


RESET_FN_RE = re.compile(
    r'\bvoid\s+(pgResetFn_\w+|reset[A-Z]\w*)\s*\(\s*([A-Za-z_]\w*_t)\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\{')


def parse_reset_functions(text, symbols, defaults):
    """Harvest `cfg->field = value;` assignments from pgResetFn_* bodies.

    Many parameter groups reset themselves in a function rather than with a
    PG_RESET_TEMPLATE. Those bodies are plain assignments, sometimes inside a
    `for` loop over array elements; a loop index that is not a constant is
    recorded as `field.*`, meaning "every element gets this value".
    """
    for m in RESET_FN_RE.finditer(text):
        struct, var = m.group(2), m.group(3)
        open_brace = m.end() - 1
        depth, i = 0, open_brace
        while i < len(text):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = text[open_brace + 1:i]
        bucket = defaults.setdefault(struct, {})

        # Two assignments to the same field inside one reset function are the
        # two sides of an #if on an optional feature - ledstrip_profile is
        # STATUS with the status modes built in and RACE without - so the field
        # has no one default and is left unresolved rather than guessed.
        seen = {}
        for am in re.finditer(
                r'\b%s\s*->\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^\];]*\])*)'
                r'\s*=\s*([^;]+);' % re.escape(var), body):
            path = normalise_path(am.group(1), symbols)
            val = symbols.eval_expr(am.group(2))
            if val is None:
                continue
            if path in seen and seen[path] != val:
                seen[path] = None
            else:
                seen.setdefault(path, val)
        for path, val in seen.items():
            if val is not None:
                bucket.setdefault(path, val)

        # `memset(cfg->field, VALUE, sizeof(cfg->field))` fills an array with a
        # byte, which is how fbusMasterConfig marks every slot invalid. Without
        # this the array reads as all zeros, which is a real setting elsewhere.
        for mm in re.finditer(
                r'memset\s*\(\s*%s\s*->\s*([A-Za-z_]\w*)\s*,\s*([^,]+),' % re.escape(var),
                body):
            val = symbols.eval_expr(mm.group(2))
            if val is not None:
                bucket.setdefault(mm.group(1) + '.*', val)


def parse_defaults(main_dir, symbols):
    """Return {struct_type: {field_path: default}} for every reset block found."""
    defaults = {}
    macro_re = re.compile(r'\b(PG_RESET_TEMPLATE|RESET_CONFIG|RESET_CONFIG_2)\s*\(')
    for path in walk_c_files(main_dir, exts=('.c',)):
        try:
            with open(path, 'r', errors='replace') as fh:
                raw = fh.read()
        except OSError:
            continue
        text = strip_preprocessor(strip_comments(raw))
        parse_reset_functions(text, symbols, defaults)
        for m in macro_re.finditer(text):
            i = m.end() - 1
            depth, j = 0, i
            while j < len(text):
                if text[j] == '(':
                    depth += 1
                elif text[j] == ')':
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            args = split_top_level(text[i + 1:j])
            if len(args) < 3:
                continue
            struct = args[0].strip()
            body = ','.join(args[2:])
            parsed = parse_designated_initializers(body, symbols)
            bucket = defaults.setdefault(struct, {})
            for k, v in parsed.items():
                bucket.setdefault(k, v)
    return defaults


def resolve_default(entry, defaults, symbols):
    """Find the factory default for one CLI setting, or None."""
    struct = entry.get('struct')
    field = entry.get('field')
    if not struct or not field or struct not in defaults:
        return None
    table = defaults[struct]
    path = normalise_path(field, symbols)
    count = entry.get('count')

    if path in table:
        val = table[path]
        if count and not isinstance(val, list):
            return [val] * count
        # An array initialiser may be shorter than the array: the C rule is
        # that the rest is zero, and the CLI prints all of it, so a short
        # default would compare unequal against every file.
        if count and isinstance(val, list) and len(val) < count:
            return val + [0] * (count - len(val))
        return val

    # A `for` loop in a reset function assigns every element the same value.
    if path + '.*' in table:
        val = table[path + '.*']
        return [val] * count if count else val

    # An array setting whose elements were assigned one by one.
    if count:
        pieces = [table.get('%s.%d' % (path, i)) for i in range(count)]
        if all(p is not None and not isinstance(p, list) for p in pieces):
            return pieces

    # `a.b.2` may have been stored as the list `a.b`.
    parts = path.split('.')
    for cut in range(len(parts) - 1, 0, -1):
        head, tail = '.'.join(parts[:cut]), parts[cut:]
        if head in table:
            val = table[head]
            for t in tail:
                if isinstance(val, list) and t.isdigit() and int(t) < len(val):
                    val = val[int(t)]
                else:
                    return None
            return val
    return None


# --------------------------------------------------------------------------
# Extras: the name tables the CLI prints as bare numbers
# --------------------------------------------------------------------------

def read(path):
    with open(path, errors='replace') as fh:
        return fh.read()


def parse_indexed_array(text, array_name, symbols):
    """Parse `const char * const NAME[] = { [IDX] = "x", "y" };` into {index: name}."""
    m = re.search(r'const\s+char\s*\*\s*const\s+%s\s*\[[^\]]*\]\s*=\s*\{(.*?)\n\s*\}\s*;'
                  % re.escape(array_name), text, re.DOTALL)
    if not m:
        return {}
    out, pos = {}, 0
    for item in split_top_level(m.group(1)):
        item = item.strip()
        if not item:
            continue
        idx_m = re.match(r'\[\s*([^\]]+)\s*\]\s*=\s*(.*)$', item, re.DOTALL)
        if idx_m:
            idx = symbols.eval_expr(idx_m.group(1))
            value = idx_m.group(2).strip()
        else:
            idx, value = pos, item
        name_m = re.match(r'"((?:\\.|[^"\\])*)"', value)
        if idx is not None and name_m and name_m.group(1):
            out[int(idx)] = name_m.group(1)
        if idx is not None:
            pos = int(idx) + 1
        else:
            pos += 1
    return out


def parse_enum_members(text, prefix, stop=None):
    """Collect `PREFIX_X = n` members of an enum, following implicit numbering."""
    out, counter = {}, 0
    for m in re.finditer(r'\b(%s\w*)\s*(=\s*([^,}\n]+))?\s*[,}]' % re.escape(prefix),
                         strip_comments(text)):
        name = m.group(1)
        if m.group(3):
            val = None
            expr = m.group(3).strip()
            if re.fullmatch(r'\(?\s*1\s*<<\s*(\d+)\s*\)?', expr):
                val = 1 << int(re.search(r'<<\s*(\d+)', expr).group(1))
            else:
                try:
                    val = int(expr, 0)
                except ValueError:
                    val = None
            if val is None:
                continue
            counter = val
        out.setdefault(counter, name[len(prefix):].lstrip('_'))
        if stop and name == stop:
            break
        counter += 1
    return out


def parse_extras(main_dir, symbols):
    extras = {}
    cli_c = read(os.path.join(main_dir, 'cli', 'cli.c'))

    # Flight-mode boxes: BOXITEM(id, "NAME", permanentId). `aux` lines reference
    # the permanent id, which is stable across releases.
    box_c = read(os.path.join(main_dir, 'msp', 'msp_box.c'))
    boxes = {}
    for m in re.finditer(r'^\s*BOXITEM\s*\(\s*\w+\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*\)',
                         box_c, re.M):
        boxes[int(m.group(2))] = m.group(1)
    extras['boxes'] = boxes

    # Adjustment functions, referenced by `adjfunc` field 2.
    adj_h = read(os.path.join(main_dir, 'fc', 'rc_adjustments.h'))
    extras['adjfuncs'] = parse_enum_members(adj_h, 'ADJUSTMENT_',
                                            stop='ADJUSTMENT_FUNCTION_COUNT')
    extras['adjfuncs'].pop(len(extras['adjfuncs']) - 1, None)

    # `feature` bit names.
    extras['features'] = parse_indexed_array(strip_comments(cli_c), 'featureNames', symbols)

    # `serial <port> <functionMask> ...` bit names.
    ser_h = read(os.path.join(main_dir, 'io', 'serial.h'))
    extras['serialFunctions'] = {k: v for k, v in
                                 parse_enum_members(ser_h, 'FUNCTION_').items() if k}

    # `set telemetry_sensors = ...` slot ids.
    sens_h = os.path.join(main_dir, 'telemetry', 'sensors.h')
    if os.path.exists(sens_h):
        extras['telemSensors'] = parse_enum_members(read(sens_h), 'TELEM_')

    # Mixer vocabulary.
    text = strip_comments(cli_c)
    extras['mixerInputs'] = parse_indexed_array(text, 'mixerInputNames', symbols)
    extras['mixerOutputs'] = parse_indexed_array(text, 'mixerOutputNames', symbols)
    extras['mixerOps'] = parse_indexed_array(text, 'mixerOpNames', symbols)

    # `aux` and `adjfunc` address channels as an offset past the control
    # channels: rcInput[index + CONTROL_CHANNEL_COUNT] (src/main/fc/rc_modes.h).
    extras['controlChannelCount'] = symbols.values.get('CONTROL_CHANNEL_COUNT', 5)

    return extras


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    fw, version, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    main_dir = os.path.join(fw, 'src', 'main')
    if not os.path.isdir(main_dir):
        raise SystemExit('not a firmware tree: %s' % fw)

    print('reading symbols ...')
    symbols = Symbols()
    symbols.load_tree(main_dir)
    print('  %d constants' % len(symbols.values))

    with open(os.path.join(main_dir, 'cli', 'settings.c'), errors='replace') as fh:
        settings_c = fh.read()
    with open(os.path.join(main_dir, 'cli', 'settings.h'), errors='replace') as fh:
        settings_h = fh.read()
    with open(os.path.join(main_dir, 'fc', 'parameter_names.h'), errors='replace') as fh:
        param_h = fh.read()

    param_names = dict(re.findall(
        r'#\s*define\s+(PARAM_NAME_\w+)\s+"([^"]*)"', param_h))
    print('  %d PARAM_NAME_* macros' % len(param_names))

    table_index = parse_lookup_index(settings_c, settings_h)

    # Lookup arrays live mostly in settings.c, a few elsewhere (debug modes,
    # battery source names). Scan settings.c first, then the rest of the tree.
    arrays = parse_string_arrays(strip_comments(settings_c))
    wanted = set(table_index.values()) - set(arrays)
    if wanted:
        for path in walk_c_files(main_dir):
            if not wanted:
                break
            try:
                with open(path, errors='replace') as fh:
                    found = parse_string_arrays(strip_comments(fh.read()))
            except OSError:
                continue
            for k in list(wanted):
                if k in found:
                    arrays[k] = found[k]
                    wanted.discard(k)
    if wanted:
        print('  ! lookup arrays not found: %s' % ', '.join(sorted(wanted)), file=sys.stderr)
    print('  %d lookup tables' % len(table_index))

    entries = parse_value_table(settings_c, param_names, symbols, table_index)
    print('  %d CLI settings' % len(entries))

    print('reading defaults ...')
    defaults = parse_defaults(main_dir, symbols)
    print('  %d reset templates' % len(defaults))

    settings = {}
    resolved = 0
    implied = 0
    for e in entries:
        rec = {'t': e['type'], 's': e['scope'], 'm': e['mode'],
               'min': e['min'], 'max': e['max']}
        if e.get('pg'):
            rec['pg'] = e['pg']
        if e.get('table'):
            rec['lut'] = e['table']
        if e.get('count'):
            rec['n'] = e['count']
        if e.get('bitpos') is not None:
            rec['bp'] = e['bitpos']
        dv = resolve_default(e, defaults, symbols)
        if e['mode'] == 'bitset' and isinstance(dv, int) and e.get('bitpos') is not None:
            rec['d'] = 'ON' if (dv >> e['bitpos']) & 1 else 'OFF'
            resolved += 1
        elif isinstance(dv, Unresolved):
            rec['ds'] = str(dv)
        elif dv is not None and (not isinstance(dv, str) or dv != ''):
            rec['d'] = dv
            resolved += 1
        elif e.get('struct') in defaults and e['mode'] == 'string':
            rec['d'] = ''
            rec['di'] = 1
            implied += 1
        elif e.get('struct') in defaults:
            # pgResetInstance() memsets a parameter group to zero before applying
            # its reset template or reset function (src/main/pg/pg.c), and both
            # PG_RESET_TEMPLATE and RESET_CONFIG build a whole struct from a
            # designated initializer. So a field its own group's reset block
            # never mentions is genuinely zero at defaults.
            rec['d'] = [0] * e['count'] if e.get('count') else 0
            rec['di'] = 1
            implied += 1
        settings[e['name']] = rec
    print('  %d/%d defaults from reset blocks, %d implicit zeros, %d unknown'
          % (resolved, len(entries), implied, len(entries) - resolved - implied))

    luts = {name: arrays[name] for name in sorted(set(table_index.values()))
            if name in arrays}

    print('reading name tables ...')
    extras = parse_extras(main_dir, symbols)
    for k, v in extras.items():
        print('  %-16s %s' % (k, len(v) if hasattr(v, '__len__') else v))

    db = {'version': version, 'settings': settings, 'luts': luts, 'extras': extras}

    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w') as fh:
        fh.write('// Generated by tools/gen_settings.py from rotorflight-firmware %s.\n'
                 '// Do not edit by hand.\n' % version)
        fh.write('window.RF_DB = window.RF_DB || {};\n')
        fh.write('window.RF_DB[%s] = %s;\n'
                 % (json.dumps(version), json.dumps(db, separators=(',', ':'), sort_keys=True)))
    print('wrote %s (%d bytes)' % (out_path, os.path.getsize(out_path)))


if __name__ == '__main__':
    main()
