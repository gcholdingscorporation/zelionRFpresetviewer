package com.zelion.rfpresetviewer;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The whole app: a WebView showing the viewer, which is bundled in the APK's
 * assets. Nothing is fetched, so the app needs no network permission - in fact
 * it declares no permissions at all.
 *
 * Files are always read here, never by the WebView. One that arrives from
 * another app ("Open with", or a share) is handed to the page as
 * window.RF_PRELOAD, which opens it as the page's file. One picked through the
 * viewer's own buttons goes to window.RFLoadPicked instead, because the page
 * has two pickers - "Open file" and "Compare with" - and only the page knows
 * which of them was tapped. Letting the WebView populate the
 * &lt;input type="file"&gt; itself would avoid the native read, but content://
 * URIs in a file input on a file:// page are handled inconsistently across
 * WebView versions; one path that always works is better than two that
 * sometimes do.
 */
public class MainActivity extends Activity {

    private static final String PAGE_URL = "file:///android_asset/viewer.html";
    private static final int REQUEST_PICK_FILE = 1;

    /** A CLI dump is tens of kilobytes; this is a generous ceiling. */
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;

    private WebView web;
    private boolean pageLoaded;

    /** Set when a file arrives from another app before the page has loaded. */
    private String pendingName;
    private String pendingText;

    /** Files from the picker, as alternating name and text, until the page can take them. */
    private final List<String> pendingPicked = new ArrayList<>();

    /** Held so the WebView's file input can be dismissed after we take over. */
    private ValueCallback<Uri[]> fileChooserCallback;

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);   // the light/dark choice is kept in localStorage
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                flushPending();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;

                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");       // file managers label CLI dumps inconsistently
                // "Open file" accepts two at once, which the page takes as a
                // comparison; "Compare with" takes one.
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                    params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(pick, REQUEST_PICK_FILE);
                } catch (Exception unavailable) {
                    clearFileChooser();
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        web.loadUrl(PAGE_URL);

        consumeIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        consumeIntent(intent);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQUEST_PICK_FILE) {
            return;
        }
        // The page's own file input stays empty either way: we load the file
        // ourselves rather than routing it back through the WebView.
        clearFileChooser();
        if (result != RESULT_OK || data == null) {
            return;
        }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        for (Uri uri : uris) {
            String text = readOrComplain(uri);
            if (text != null) {
                pendingPicked.add(displayName(uri));
                pendingPicked.add(text);
            }
        }
        flushPending();
    }

    private void clearFileChooser() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
    }

    /** Pull a file out of a VIEW or SEND intent, if there is one. */
    private void consumeIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri != null) {
            load(uri);
        }
    }

    private void load(Uri uri) {
        String text = readOrComplain(uri);
        if (text == null) {
            return;
        }
        pendingName = displayName(uri);
        pendingText = text;
        flushPending();
    }

    /** The file's text, or null after telling the user why it could not be had. */
    private String readOrComplain(Uri uri) {
        String text;
        try {
            text = readText(uri);
        } catch (Exception failed) {
            Toast.makeText(this, R.string.could_not_read, Toast.LENGTH_LONG).show();
            return null;
        }
        if (text == null) {
            Toast.makeText(this, R.string.too_large, Toast.LENGTH_LONG).show();
        }
        return text;
    }

    private String readText(Uri uri) throws Exception {
        InputStream in = getContentResolver().openInputStream(uri);
        if (in == null) {
            throw new IllegalStateException("no stream");
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0) {
                if (out.size() + n > MAX_FILE_BYTES) {
                    return null;
                }
                out.write(chunk, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    /** The file's own name, for the header. Falls back to the URI's last segment. */
    private String displayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && name.length() > 0) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // A provider that refuses to be queried still gives us a path.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "";
    }

    /** Hand waiting files to the page, once the page exists to receive them. */
    private void flushPending() {
        if (!pageLoaded) {
            return;
        }
        if (pendingText != null) {
            String script =
                "window.RF_PRELOAD = { name: " + jsString(pendingName) +
                ", text: " + jsString(pendingText) + " };" +
                "if (window.RFLoadPreload) { window.RFLoadPreload(); }";
            pendingName = null;
            pendingText = null;
            web.evaluateJavascript(script, null);
        }
        if (!pendingPicked.isEmpty()) {
            StringBuilder files = new StringBuilder("[");
            for (int i = 0; i < pendingPicked.size(); i += 2) {
                if (i > 0) {
                    files.append(',');
                }
                files.append("{ name: ").append(jsString(pendingPicked.get(i)))
                     .append(", text: ").append(jsString(pendingPicked.get(i + 1)))
                     .append(" }");
            }
            files.append(']');
            pendingPicked.clear();
            web.evaluateJavascript(
                "if (window.RFLoadPicked) { window.RFLoadPicked(" + files + "); }", null);
        }
    }

    /**
     * Quote a string as a JavaScript literal. Characters that could end the
     * script or escape the literal are encoded; everything else is passed
     * through, so a craft name in another script survives.
     */
    private static String jsString(String value) {
        if (value == null) {
            return "\"\"";
        }
        StringBuilder out = new StringBuilder(value.length() + 16);
        out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
            case '"':  out.append("\\\""); break;
            case '\\': out.append("\\\\"); break;
            case '\n': out.append("\\n"); break;
            case '\r': out.append("\\r"); break;
            case '\t': out.append("\\t"); break;
            case '<':  out.append("\\u003c"); break;
            case '>':  out.append("\\u003e"); break;
            case '&':  out.append("\\u0026"); break;
            case ' ': out.append("\\u2028"); break;
            case ' ': out.append("\\u2029"); break;
            default:
                if (c < 0x20 || c == 0x7f) {
                    out.append(String.format("\\u%04x", (int) c));
                } else {
                    out.append(c);
                }
            }
        }
        out.append('"');
        return out.toString();
    }
}
