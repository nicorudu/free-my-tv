package io.freemytv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A home screen drawn by a web page (app/assets/home/index.html) instead of HomeView: the look is HTML and CSS, and
 * this bridge (window.TV in the page) gives it what only the TV can do. Free My TV's mode switch, Original and the
 * watchdog are untouched: this is only what HomeActivity shows.
 *
 * window.TV:
 *   apps()            JSON: the shelf (Free My TV > Shelf) as [{pkg, name, color, icon}], icon a PNG data: URI
 *   launch(pkg)       opens an app from the shelf
 *   settings()        opens Free My TV's settings (Home Screen > Original lives there)
 *   secret(name)      calendar_url, sketch_url or sketch_token, sent to the TV with adb (never in the APK)
 *   get(url, id)      fetches a URL from the TV (no CORS); answers window.tvReply(id, status, text)
 */
final class WebHome extends FrameLayout {
    static final String PAGE = "file:///android_asset/home/index.html";

    /** True when this build carries a web home screen. */
    static boolean present(Activity a) {
        try (InputStream in = a.getAssets().open("home/index.html")) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newFixedThreadPool(2);

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    WebHome(Activity a) {
        super(a);
        activity = a;
        setBackgroundColor(Color.rgb(12, 14, 23));
        web = new WebView(a);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);   // the page scales itself to the screen (app.js fit())
        s.setTextZoom(100);                  // the TV's font size setting would break the fixed layout
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("file:///android_asset/");   // the home page never navigates away
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                // The page's errors and logs, readable with `adb logcat -s FreeMyTV`.
                if (m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR
                        || m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.WARNING) {
                    AppLog.w("web home: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "TV");
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        addView(web, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        web.loadUrl(PAGE);
        web.requestFocus();
    }

    void resume() {
        web.onResume();
        web.requestFocus();
        js("window.onTvResume && window.onTvResume()");
    }

    void pause() {
        web.onPause();
    }

    /** Home pressed while already home: back to the first app. */
    void reset() {
        js("window.onTvHome && window.onTvHome()");
    }

    void destroy() {
        net.shutdownNow();
        web.removeJavascriptInterface("TV");
        web.destroy();
    }

    /** Back on the home screen does nothing (there is nowhere to go back to); the page may use it. */
    boolean onKey(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) js("window.onTvBack && window.onTvBack()");
            return true;
        }
        return false;
    }

    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    private static String dataUri(Bitmap b) {
        if (b == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private final class Bridge {
        @JavascriptInterface public String apps() {
            JSONArray out = new JSONArray();
            try {
                List<HomeApps.Item> items = HomeApps.shelf(activity, true);
                for (HomeApps.Item it : items) {
                    JSONObject o = new JSONObject();
                    o.put("pkg", it.pkg);
                    o.put("name", it.label);
                    o.put("color", HomeApps.brandColor(it.pkg));
                    o.put("icon", dataUri(it.logo != null ? it.logo : it.tile));
                    o.put("logo", it.logo != null);
                    out.put(o);
                }
            } catch (Exception e) {
                AppLog.w("web home: apps: " + e);
            }
            return out.toString();
        }

        /** One of the web home screen's private links, sent with adb (Secrets.WEB_HOME), or "". */
        @JavascriptInterface public String secret(String name) {
            return Secrets.WEB_HOME.contains(name) ? Secrets.get(activity, name) : "";
        }

        @JavascriptInterface public void launch(String pkg) {
            main.post(() -> {
                Intent intent = HomeApps.launchIntent(activity.getPackageManager(), pkg);
                if (intent == null) return;
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(intent);
                } catch (Exception e) {
                    AppLog.w("web home: couldn't open " + pkg + ": " + e);
                }
            });
        }

        @JavascriptInterface public void settings() {
            main.post(() -> activity.startActivity(new Intent(activity, SettingsActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        }

        @JavascriptInterface public void get(String url, String id) {
            if (url == null) return;
            final String u = url.startsWith("webcal://") ? "https://" + url.substring(9) : url;
            if (!(u.startsWith("https://") || u.startsWith("http://"))) return;
            net.execute(() -> {
                int status = 0;
                String text = "";
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(25000);
                    c.setRequestProperty("User-Agent", "FreeMyTV-WebHome");
                    status = c.getResponseCode();
                    try (InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream()) {
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[16384];
                        int n;
                        while (in != null && (n = in.read(chunk)) > 0 && buf.size() < 4_000_000) buf.write(chunk, 0, n);
                        text = buf.toString("UTF-8");
                    }
                } catch (Exception e) {
                    AppLog.w("web home: get failed: " + e);
                } finally {
                    if (c != null) c.disconnect();
                }
                js("window.tvReply && window.tvReply(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")");
            });
        }
    }
}
