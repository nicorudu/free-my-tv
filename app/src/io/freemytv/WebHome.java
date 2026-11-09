package io.freemytv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Display;
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
        // The TV coming on: the page plays its intro (window.onTvWake). Three signs, whichever this TV gives:
        // the stick itself waking (SCREEN_ON); the TV's HDMI coming back while the stick stayed awake (HDMI audio
        // plug, which most TVs drop in standby); and the display turning on again (DisplayManager).
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(AudioManager.ACTION_HDMI_AUDIO_PLUG);
        f.addAction(TV_ON);
        a.registerReceiver(wake, f);
        displays = a.getSystemService(DisplayManager.class);
        if (displays != null) {
            Display d = displays.getDisplay(Display.DEFAULT_DISPLAY);
            displayOn = d == null || d.getState() == Display.STATE_ON;
            displays.registerDisplayListener(displayWatch, main);
        }
        startCecWatch();
    }

    /**
     * With the stick kept awake (so the TV never shows its own "waiting for HDMI" card), nothing on the stick changes
     * when the TV turns on: no screen-on, no HDMI plug event. The TV does broadcast HDMI-CEC <Report Power Status> "on"
     * to every device (a Hisense Roku TV: "RCV [Report Power Status][opcode:90][vaule:00] from <0> to <15>" in the
     * system log), but apps can't read CEC. This loop runs in adb's shell through the TV's own ADB (uid 2000 may read
     * the log), as HomeMode's wake watch does, and broadcasts TV_ON to us on each. A restart ends it; the home screen
     * starts it again when it can reach ADB (port 5555 open). Its name is in its command line, so pgrep finds only it.
     */
    static final String TV_ON = "io.freemytv.TV_ON";
    private static final String CEC_WATCH = "freemytv-cec";
    private static final String CEC_MATCH = "'freemytv-ce[c]'";
    private static final String CEC_LOOP = "trap \"\" HUP; logcat -T 1 -e \"Power Status.*vaule:00.*from <0> to <15>\""
            + " | while read -r line; do am broadcast -a " + TV_ON + " -p io.freemytv >/dev/null 2>&1; done";
    private long lastCecTry;
    private volatile boolean cecOn;

    /** Starts the CEC loop once (left alone when it runs already). Never throws: :home's watchdog counts escapes. */
    private void startCecWatch() {
        long now = SystemClock.elapsedRealtime();
        if (cecOn || (lastCecTry != 0 && now - lastCecTry < 10 * 60_000)) return;
        lastCecTry = now;
        net.execute(() -> {
            try (Adb adb = Adb.connect(activity, 0, null)) {
                if (!cecRunning(adb)) {
                    adb.shell("trap \"\" HUP; setsid sh -c '" + CEC_LOOP + "' " + CEC_WATCH + " </dev/null >/dev/null 2>&1 &");
                }
                cecOn = cecRunning(adb);
                AppLog.w(cecOn ? "web home: CEC watch on (the intro plays when the TV turns on)" : "web home: CEC watch didn't start");
            } catch (Throwable e) {
                AppLog.w("web home: CEC watch: " + e.getMessage());
            }
        });
    }

    private static boolean cecRunning(Adb adb) throws java.io.IOException {
        return adb.shell("pgrep -f " + CEC_MATCH).trim().matches("\\d+(\\s+\\d+)*");
    }

    /** Original and the watchdog's revert: the loop goes with the home screen. */
    static void stopCecWatch(Adb adb) {
        try {
            if (cecRunning(adb)) {
                adb.shell("pkill -f " + CEC_MATCH);
                AppLog.w("web home: CEC watch off");
            }
        } catch (java.io.IOException e) {
            AppLog.w("web home: CEC watch: " + e.getMessage());
        }
    }

    private DisplayManager displays;
    private boolean displayOn = true;
    private int hdmiState = -1;          // -1 until the sticky broadcast tells us where it stands
    private long lastWake;

    /**
     * Plays the intro once per TV start. The TV's own CEC "power on" comes when its picture is up, so it wins: a sign
     * from the stick itself (its screen waking, HDMI, the display) waits a few seconds and plays only if the TV hasn't
     * reported in by then. Without that, a stick put to sleep with the TV (the onn remote's power button) played the
     * intro on its own wake, while the TV was still starting and showed nothing, and then ignored the TV's report.
     */
    private void tvCameOn(String why) {
        tvCameOn(why, false);
    }

    private void tvCameOn(String why, boolean fromTv) {
        long now = SystemClock.elapsedRealtime();
        boolean recent = now - lastWake < 20_000;
        AppLog.w("web home: TV on (" + why + ")" + (recent ? ", intro already played" : fromTv ? "" : ", waiting for the TV"));
        if (recent) return;
        if (fromTv) {
            main.removeCallbacks(introIfTvSilent);
            playIntro(now);
        } else {
            main.removeCallbacks(introIfTvSilent);
            main.postDelayed(introIfTvSilent, 6_000);
        }
    }

    /** The stick woke but the TV said nothing (a TV without CEC, or one that was on already). */
    private final Runnable introIfTvSilent = () -> {
        long now = SystemClock.elapsedRealtime();
        if (now - lastWake >= 20_000) playIntro(now);
    };

    private void playIntro(long now) {
        lastWake = now;
        js("window.onTvWake && window.onTvWake()");
    }

    private final BroadcastReceiver wake = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_ON.equals(i.getAction())) {
                tvCameOn("screen on");
                return;
            }
            if (TV_ON.equals(i.getAction())) {
                tvCameOn("HDMI-CEC: the TV reported power on", true);
                return;
            }
            int state = i.getIntExtra(AudioManager.EXTRA_AUDIO_PLUG_STATE, -1);
            int before = hdmiState;
            hdmiState = state;
            AppLog.w("web home: HDMI " + (state == 1 ? "connected" : state == 0 ? "disconnected" : "unknown")
                    + (isInitialStickyBroadcast() ? " (at start)" : ""));
            if (!isInitialStickyBroadcast() && before == 0 && state == 1) tvCameOn("HDMI back");
        }
    };

    private final DisplayManager.DisplayListener displayWatch = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int id) { }
        @Override public void onDisplayRemoved(int id) { }
        @Override public void onDisplayChanged(int id) {
            if (id != Display.DEFAULT_DISPLAY || displays == null) return;
            Display d = displays.getDisplay(id);
            boolean on = d != null && d.getState() == Display.STATE_ON;
            if (on == displayOn) return;
            displayOn = on;
            AppLog.w("web home: display " + (on ? "on" : "off"));
            if (on) tvCameOn("display on");
        }
    };

    void resume() {
        startCecWatch();   // again after a restart, which ends it (at most every 10 minutes while it can't start)
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
        main.removeCallbacks(introIfTvSilent);
        try {
            activity.unregisterReceiver(wake);
        } catch (IllegalArgumentException ignored) {
        }
        if (displays != null) displays.unregisterDisplayListener(displayWatch);
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
