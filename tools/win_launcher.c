/*
 * Portable Windows launcher for the Rotorflight Preset Viewer.
 *
 * The whole viewer - markup, styles, scripts and the generated firmware
 * metadata - is embedded in this executable at compile time. Running it unpacks
 * the page into the user's temp folder and opens it in whatever browser Windows
 * already uses, so there is nothing to install alongside the .exe: no runtime,
 * no framework, no bundled browser engine.
 *
 * It is built freestanding, with no C runtime at all, so the only DLLs it
 * imports are kernel32, shell32 and user32 - parts of Windows itself. That is
 * why the code below calls Win32 directly (lstrlenA, WriteFile) instead of the
 * usual strlen/fwrite: linking the CRT would add a dependency on the Universal
 * CRT, which older Windows versions do not ship.
 *
 * Given a file - on the command line, dropped onto the .exe, or via "Open
 * with" - the launcher embeds that file's text in the page it writes, so the
 * viewer opens with the dump already loaded.
 *
 * Built by tools/build_windows.py; see that script for the compiler flags.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

/* The single-file page produced by tools/build_single.py. */
static const unsigned char VIEWER_HTML[] = {
#embed "../dist/rotorflight-preset-viewer.html"
};

#define VIEWER_HTML_LEN ((DWORD) sizeof(VIEWER_HTML))

/*
 * Freestanding builds still need these: the compiler is allowed to turn an
 * ordinary copy loop into a call to memcpy. -ffreestanding stops it from
 * turning the definitions below into calls to themselves.
 */
void *memcpy(void *dst, const void *src, size_t n)
{
    unsigned char *d = (unsigned char *) dst;
    const unsigned char *s = (const unsigned char *) src;
    while (n--) { *d++ = *s++; }
    return dst;
}

void *memset(void *dst, int value, size_t n)
{
    unsigned char *d = (unsigned char *) dst;
    while (n--) { *d++ = (unsigned char) value; }
    return dst;
}

static void fail(const char *message)
{
    MessageBoxA(NULL, message, "Rotorflight Preset Viewer", MB_ICONERROR | MB_OK);
    ExitProcess(1);
}

/* ------------------------------------------------------------------ output */

static HANDLE out_file = INVALID_HANDLE_VALUE;
static unsigned char out_buf[32768];
static DWORD out_used;

static void out_flush(void)
{
    if (!out_used) {
        return;
    }
    DWORD written = 0;
    if (!WriteFile(out_file, out_buf, out_used, &written, NULL) || written != out_used) {
        fail("Could not write the viewer to your temp folder.\n\n"
             "The folder may be full or read-only.");
    }
    out_used = 0;
}

static void out_bytes(const void *data, DWORD n)
{
    const unsigned char *p = (const unsigned char *) data;
    while (n) {
        DWORD room = (DWORD) sizeof(out_buf) - out_used;
        if (!room) {
            out_flush();
            room = (DWORD) sizeof(out_buf);
        }
        DWORD take = n < room ? n : room;
        memcpy(out_buf + out_used, p, take);
        out_used += take;
        p += take;
        n -= take;
    }
}

static void out_text(const char *s)
{
    out_bytes(s, (DWORD) lstrlenA(s));
}

/* Write one byte as a JavaScript \uXXXX escape. */
static void out_escape_hex(unsigned char c)
{
    static const char digits[] = "0123456789abcdef";
    char esc[6];
    esc[0] = '\\';
    esc[1] = 'u';
    esc[2] = '0';
    esc[3] = '0';
    esc[4] = digits[(c >> 4) & 0xf];
    esc[5] = digits[c & 0xf];
    out_bytes(esc, 6);
}

/*
 * Append text as the body of a JavaScript string literal.
 *
 * Bytes above 0x7f pass through unchanged: the page is UTF-8, so a craft name
 * in another script survives. Everything that could end the enclosing <script>
 * element or escape the literal is encoded.
 */
static void out_js_string(const unsigned char *text, DWORD len)
{
    for (DWORD i = 0; i < len; i++) {
        unsigned char c = text[i];
        switch (c) {
        case '"':  out_text("\\\""); break;
        case '\\': out_text("\\\\"); break;
        case '\n': out_text("\\n"); break;
        case '\r': out_text("\\r"); break;
        case '\t': out_text("\\t"); break;
        case '<':  out_text("\\u003c"); break;
        case '>':  out_text("\\u003e"); break;
        case '&':  out_text("\\u0026"); break;
        default:
            if (c < 0x20 || c == 0x7f) {
                out_escape_hex(c);
            } else {
                out_bytes(&c, 1);
            }
        }
    }
}

/* ------------------------------------------------------------------- input */

/* Read a whole file into heap memory. Returns NULL if it cannot be read. */
static unsigned char *read_file(const char *path, DWORD *len)
{
    HANDLE h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        return NULL;
    }

    LARGE_INTEGER size;
    if (!GetFileSizeEx(h, &size) || size.QuadPart > 32 * 1024 * 1024) {
        CloseHandle(h);
        return NULL;
    }

    unsigned char *buf = (unsigned char *) HeapAlloc(GetProcessHeap(), 0,
                                                     (SIZE_T) size.QuadPart + 1);
    if (!buf) {
        CloseHandle(h);
        return NULL;
    }

    DWORD got = 0;
    BOOL ok = ReadFile(h, buf, (DWORD) size.QuadPart, &got, NULL);
    CloseHandle(h);
    if (!ok) {
        HeapFree(GetProcessHeap(), 0, buf);
        return NULL;
    }

    buf[got] = 0;
    *len = got;
    return buf;
}

/*
 * Where the page is unpacked: %TEMP%\RotorflightPresetViewer\viewer.html.
 * Returns 0 if the path will not fit or the temp folder is unknown.
 */
static int build_output_path(char *out, DWORD out_size)
{
    char temp[MAX_PATH];
    DWORD n = GetTempPathA(MAX_PATH, temp);
    if (n == 0 || n >= MAX_PATH) {
        return 0;
    }

    static const char folder[] = "RotorflightPresetViewer";
    static const char leaf[] = "\\viewer.html";
    if (n + sizeof(folder) + sizeof(leaf) > out_size) {
        return 0;
    }

    lstrcpyA(out, temp);
    lstrcatA(out, folder);
    CreateDirectoryA(out, NULL);   /* harmless if it already exists */
    lstrcatA(out, leaf);
    return 1;
}

/* ------------------------------------------------------------------- entry */

void __stdcall launcher_entry(void)
{
    char page_path[MAX_PATH];
    if (!build_output_path(page_path, sizeof(page_path))) {
        fail("Could not work out where to unpack the viewer.");
    }

    out_file = CreateFileA(page_path, GENERIC_WRITE, 0, NULL,
                           CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (out_file == INVALID_HANDLE_VALUE) {
        fail("Could not create the viewer in your temp folder.\n\n"
             "The folder may be read-only, or antivirus may have blocked it.");
    }

    out_bytes(VIEWER_HTML, VIEWER_HTML_LEN);

    /*
     * A file argument becomes a preload block appended after the page. app.js
     * publishes window.RFLoadPreload once it has wired itself up, and also
     * checks window.RF_PRELOAD at that point, so this works whichever of the
     * two runs first.
     */
    int argc = 0;
    LPWSTR *argw = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argw && argc > 1) {
        char path[MAX_PATH * 2];
        int converted = WideCharToMultiByte(CP_ACP, 0, argw[1], -1, path,
                                            (int) sizeof(path), NULL, NULL);
        DWORD len = 0;
        unsigned char *text = converted > 0 ? read_file(path, &len) : NULL;
        if (text) {
            const char *base = path;          /* show the name, not the path */
            for (const char *p = path; *p; p++) {
                if (*p == '\\' || *p == '/') {
                    base = p + 1;
                }
            }

            out_text("\n<script>\n(function () {\n  window.RF_PRELOAD = { name: \"");
            out_js_string((const unsigned char *) base, (DWORD) lstrlenA(base));
            out_text("\", text: \"");
            out_js_string(text, len);
            out_text("\" };\n  if (window.RFLoadPreload) { window.RFLoadPreload(); }\n"
                     "}());\n</script>\n");

            HeapFree(GetProcessHeap(), 0, text);
        }
    }
    if (argw) {
        LocalFree(argw);
    }

    out_flush();
    CloseHandle(out_file);

    HINSTANCE rc = ShellExecuteA(NULL, "open", page_path, NULL, NULL, SW_SHOWNORMAL);
    if ((INT_PTR) rc <= 32) {
        fail("Windows could not open the viewer in a browser.\n\n"
             "The page was unpacked, so you can still open it yourself from\n"
             "%TEMP%\\RotorflightPresetViewer\\viewer.html");
    }

    ExitProcess(0);
}
