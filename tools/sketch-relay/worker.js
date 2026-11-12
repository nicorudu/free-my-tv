// Glass drawing relay - a tiny Cloudflare Worker.
// Your phone opens the drawing page, draws, taps Send; the TV checks for a new drawing every ~20 seconds.
//
// Needs two things set in the Cloudflare dashboard (Worker > Settings > Bindings / Variables):
//   DRAWINGS  - a KV namespace binding
//   TOKEN     - a secret: a long random string. Only links that include it work.
//
// Endpoints (all need ?t=TOKEN):
//   GET  /                 drawing page for the phone
//   POST /api/draw         body = PNG image (&from=Name), saves it as the latest drawing
//   GET  /api/meta         {"ts": "<ms>", "secs": <unix seconds>, "from": "Nico"} of the latest drawing
//   GET  /api/latest.png   the latest drawing
//   POST /api/clear        removes the latest drawing
//   POST /api/reminders    the shared reminders list, sent by an iPhone Shortcut: one reminder per line,
//                          "due|title" (due may be empty), as plain text or JSON {"list": "..."}
//   GET  /api/reminders    {"ts": "<ms>", "secs": <unix seconds>, "items": [{"t": "title", "due": "2026-11-12T17:00"}]}

const MAX_BYTES = 1_500_000;
const MAX_REMINDERS = 60;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    const authorized = typeof env.TOKEN === "string" && env.TOKEN.length >= 16 && token === env.TOKEN;

    // Anything without the right token looks like an empty site.
    if (!authorized) return new Response("Not found", { status: 404 });

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/api/draw" && req.method === "POST") {
      const buf = await req.arrayBuffer();
      if (buf.byteLength < 8 || buf.byteLength > MAX_BYTES) return json({ ok: false, error: "size" }, 400);
      const sig = new Uint8Array(buf, 0, 4);
      if (!(sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47)) {
        return json({ ok: false, error: "png only" }, 415);
      }
      const ms = Date.now();
      const from = (url.searchParams.get("from") || "").replace(/[^A-Za-z .'-]/g, "").slice(0, 24);
      await env.DRAWINGS.put("latest", buf);
      await env.DRAWINGS.put("latest_from", from);
      await env.DRAWINGS.put("latest_ts", String(ms));
      return json({ ok: true, ts: String(ms) });
    }

    if (url.pathname === "/api/meta" && req.method === "GET") {
      const ts = (await env.DRAWINGS.get("latest_ts")) || "0";
      const from = (await env.DRAWINGS.get("latest_from")) || "";
      return json({ ts, secs: Math.floor(Number(ts) / 1000), from });
    }

    if (url.pathname === "/api/latest.png" && req.method === "GET") {
      const img = await env.DRAWINGS.get("latest", { type: "arrayBuffer" });
      if (!img) return new Response("No drawing yet", { status: 404 });
      return new Response(img, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/clear" && req.method === "POST") {
      await env.DRAWINGS.delete("latest");
      await env.DRAWINGS.put("latest_ts", "0");
      return json({ ok: true });
    }

    if (url.pathname === "/api/reminders" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 50_000) return json({ ok: false, error: "size" }, 400);
      let text = raw;
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === "object") text = Array.isArray(j.items) ? j.items.map(i => (i.due || "") + "|" + (i.t || i.title || "")).join("\n") : String(j.list ?? "");
      } catch (e) { /* plain text */ }
      const items = [];
      for (const line of text.split(/\r?\n/)) {
        const bar = line.indexOf("|");
        const due = bar >= 0 ? normDue(line.slice(0, bar)) : "";
        const t = (bar >= 0 ? line.slice(bar + 1) : line).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120);
        if (t && items.length < MAX_REMINDERS) items.push({ t, due });
      }
      const ms = Date.now();
      await env.DRAWINGS.put("reminders", JSON.stringify({ ts: String(ms), items }));
      return json({ ok: true, count: items.length });
    }

    if (url.pathname === "/api/reminders" && req.method === "GET") {
      const saved = JSON.parse((await env.DRAWINGS.get("reminders")) || '{"ts":"0","items":[]}');
      return json({ ts: saved.ts, secs: Math.floor(Number(saved.ts) / 1000), items: saved.items });
    }

    return new Response("Not found", { status: 404 });
  },
};

// A due date as the TV reads it: "2026-11-12" or "2026-11-12T17:00" (the phone's own time, no zone).
// Takes ISO 8601 from the Shortcut, and also the phone's plain format ("Nov 12, 2026 at 5:00 PM").
function normDue(s) {
  s = String(s || "").trim();
  if (!s) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  if (iso) return iso[2] && iso[2] !== "00:00" ? iso[1] + "T" + iso[2] : iso[1];
  const d = new Date(Date.parse(s.replace(/ at /i, " ").replace(/\u202f/g, " ") + " UTC"));
  if (isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  const day = d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  return d.getUTCHours() || d.getUTCMinutes() ? day + "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) : day;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="TV Sketch">
<meta name="theme-color" content="#eef0f3">
<title>TV Sketch</title>
<style>
  :root { --bg:#eef0f3; --card:rgba(255,255,255,.72); --ink:#1d2127; --sub:#5b6470; --line:rgba(0,0,0,.08); --accent:#2f6feb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14171c; --card:rgba(255,255,255,.07); --ink:#f1f3f6; --sub:#9aa4b2; --line:rgba(255,255,255,.12); --accent:#7fb0ff; }
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--ink);
    font:16px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { display:flex; flex-direction:column; align-items:center; padding:16px 16px calc(16px + env(safe-area-inset-bottom)); gap:14px; }
  h1 { font-size:20px; margin:4px 0 0; font-weight:650; letter-spacing:-.01em; }
  .sub { color:var(--sub); font-size:14px; margin:0; text-align:center; }
  .card { width:100%; max-width:520px; background:var(--card); border:1px solid var(--line); border-radius:22px;
    padding:12px; backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
  canvas { width:100%; aspect-ratio:1/1; display:block; border-radius:14px; touch-action:none;
    background:#ffffff; border:1px solid var(--line); }
  .row { display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-top:12px; }
  .swatches { display:flex; gap:8px; flex-wrap:wrap; }
  .sw { width:34px; height:34px; border-radius:50%; border:2px solid var(--line); cursor:pointer; padding:0; }
  .sw.on { outline:3px solid var(--accent); outline-offset:2px; }
  .sizes { display:flex; gap:6px; }
  .sz { min-width:44px; height:36px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--ink); font-weight:600; }
  .sz.on { background:var(--accent); color:#fff; border-color:transparent; }
  .actions { display:flex; gap:8px; width:100%; max-width:520px; }
  button.act { flex:1; height:50px; border-radius:16px; border:1px solid var(--line); background:var(--card); color:var(--ink);
    font-size:16px; font-weight:600; }
  button.send { background:var(--accent); color:#fff; border-color:transparent; flex:1.4; }
  button:disabled { opacity:.5; }
  #status { min-height:20px; font-size:14px; color:var(--sub); }
  .who { display:flex; gap:8px; }
  .who button { height:36px; padding:0 16px; border-radius:18px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-weight:600; }
  .who button.on { background:var(--accent); color:#fff; border-color:transparent; }
  button.heart { flex:0.7; color:#e5484d; font-size:24px; }
</style>
</head>
<body>
  <h1>Sketch for the TV</h1>
  <p class="sub">Draw below and tap Send. It shows up on the TV within a minute.</p>
  <div class="card">
    <canvas id="c" width="720" height="720" aria-label="Drawing area"></canvas>
    <div class="row">
      <div class="swatches" id="swatches"></div>
      <div class="sizes" id="sizes"></div>
    </div>
  </div>
  <div class="who" id="who"></div>
  <div class="actions">
    <button class="act heart" id="heart" aria-label="Send a heart">&#9829;</button>
    <button class="act" id="undo">Undo</button>
    <button class="act" id="clear">Clear</button>
    <button class="act send" id="send">Send</button>
  </div>
  <div id="status" role="status"></div>
<script>
(() => {
  const token = new URLSearchParams(location.search).get("t") || "";
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  const colors = ["#1d2127", "#e5484d", "#f5a524", "#30a46c", "#2f6feb", "#8e4ec6", "#ffffff"];
  const sizes = [{ label: "S", w: 6 }, { label: "M", w: 14 }, { label: "L", w: 28 }];
  let color = colors[0], width = sizes[1].w;
  const strokes = [];
  let current = null;

  const sw = document.getElementById("swatches");
  colors.forEach((col, i) => {
    const b = document.createElement("button");
    b.className = "sw" + (i === 0 ? " on" : "");
    b.style.background = col;
    b.setAttribute("aria-label", "Color " + col);
    b.onclick = () => { color = col; [...sw.children].forEach(x => x.classList.remove("on")); b.classList.add("on"); };
    sw.appendChild(b);
  });
  const sz = document.getElementById("sizes");
  sizes.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "sz" + (i === 1 ? " on" : "");
    b.textContent = s.label;
    b.onclick = () => { width = s.w; [...sz.children].forEach(x => x.classList.remove("on")); b.classList.add("on"); };
    sz.appendChild(b);
  });

  function redraw() {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of strokes) drawStroke(s);
  }
  function drawStroke(s) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
    ctx.beginPath();
    s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    ctx.stroke();
  }
  function pos(e) {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height];
  }
  c.addEventListener("pointerdown", e => {
    c.setPointerCapture(e.pointerId);
    current = { color, width, pts: [pos(e)] };
    strokes.push(current); redraw();
  });
  c.addEventListener("pointermove", e => {
    if (!current) return;
    current.pts.push(pos(e)); redraw();
  });
  const end = () => { current = null; };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);

  document.getElementById("undo").onclick = () => { strokes.pop(); redraw(); };
  document.getElementById("clear").onclick = () => { strokes.length = 0; redraw(); };

  // Who's drawing: remembered on this phone, shown on the TV as "From ...".
  const names = ["Nico", "Natalie"];
  let me = "";
  try { me = localStorage.getItem("sketch_from") || ""; } catch (e) {}
  const who = document.getElementById("who");
  names.forEach(n => {
    const b = document.createElement("button");
    b.textContent = n;
    b.className = n === me ? "on" : "";
    b.onclick = () => { me = n; try { localStorage.setItem("sketch_from", n); } catch (e) {}
      [...who.children].forEach(x => x.classList.toggle("on", x === b)); };
    who.appendChild(b);
  });

  const status = document.getElementById("status");
  const sendBtn = document.getElementById("send");
  sendBtn.onclick = () => {
    if (!strokes.length) { status.textContent = "Draw something first."; return; }
    sendBtn.disabled = true; status.textContent = "Sending...";
    c.toBlob(async blob => {
      try {
        const r = await fetch("/api/draw?t=" + encodeURIComponent(token) + "&from=" + encodeURIComponent(me), { method: "POST", body: blob, headers: { "content-type": "image/png" } });
        status.textContent = r.ok ? "Sent. Watch the TV." : "Couldn't send (" + r.status + ").";
      } catch (err) {
        status.textContent = "Couldn't send. Check your connection.";
      }
      sendBtn.disabled = false;
    }, "image/png");
  };

  // One tap: a red heart, sent straight away.
  document.getElementById("heart").onclick = () => {
    strokes.length = 0;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120 * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([360 + x * 15, 340 - y * 15]);
    }
    strokes.push({ color: "#e5484d", width: 22, pts });
    redraw();
    sendBtn.click();
  };

  redraw();

  // Opened from the Rueda TV shortcut: &from=Nico picks the name, &heart=1 sends a heart straight away.
  const q = new URLSearchParams(location.search);
  if (names.includes(q.get("from"))) [...who.children].find(b => b.textContent === q.get("from")).click();
  if (q.get("heart") === "1") {
    q.delete("heart");
    history.replaceState(null, "", "?" + q.toString());   // so reopening the tab doesn't send it again
    document.getElementById("heart").click();
  }
})();
</script>
</body>
</html>`;
