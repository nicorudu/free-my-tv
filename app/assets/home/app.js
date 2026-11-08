// Home screen logic. window.TV is the Android shell's bridge (WebHome.java); in a plain browser the preview data is used.
(function () {
  var CONFIG = window.HOME_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var tv = window.TV || null;
  var apps = [];
  var focus = 0;          // which dock tile
  var row = "dock";       // "dock" or "top" (the settings button)
  var sun = null;         // today's sunrise and sunset
  var calLoaded = 0;
  // Private links live on the TV, sent with adb, never in this page or the APK.
  if (tv && tv.secret) {
    CONFIG.calendarUrl = tv.secret("calendar_url") || CONFIG.calendarUrl;
    CONFIG.sketchUrl = tv.secret("sketch_url") || CONFIG.sketchUrl;
    CONFIG.sketchToken = tv.secret("sketch_token") || CONFIG.sketchToken;
  }

  // ---------- theme: light from sunrise to sunset, dark otherwise ----------
  function setTheme() {
    var forced = params.get("theme"), night;
    if (forced) night = forced === "night";
    else if (sun) { var now = new Date(); night = now < sun.rise || now >= sun.set; }
    else { var h = new Date().getHours(); night = h < 7 || h >= 18; }
    document.body.classList.toggle("night", night);
    document.body.classList.toggle("day", !night);
  }

  // ---------- clock ----------
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var lastDay = -1;
  function tick() {
    var d = new Date();
    $("clock").textContent = (d.getHours() % 12 || 12) + ":" + ("0" + d.getMinutes()).slice(-2);
    $("date").textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
    if (lastDay !== -1 && lastDay !== d.getDate()) loadCalendar();   // a new day: Today/Tomorrow move on
    lastDay = d.getDate();
    setTheme();
  }

  // ---------- dock ----------
  function rgba(hex, a) {
    var n = parseInt((hex || "#8fc2ff").replace("#", ""), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }
  function renderDock() {
    var box = $("dock-tiles");
    box.innerHTML = "";
    apps.forEach(function (a, i) {
      var t = document.createElement("div");
      t.className = "tile" + (row === "dock" && i === focus ? " focus" : "");
      var c = a.color || "#8fc2ff";
      t.style.setProperty("--glow", rgba(c, 0.85));
      t.style.setProperty("--glow-soft", rgba(c, 0.35));
      if (a.icon) {
        var img = document.createElement("img");
        img.src = a.icon;
        if (!a.logo) img.className = "art";   // the app's full TV card (no lifted logo): fill the tile
        t.appendChild(img);
      } else {
        var s = document.createElement("span");
        s.className = "name";
        s.textContent = a.name;
        t.appendChild(s);
      }
      box.appendChild(t);
    });
    $("settings").className = "glass chip round" + (row === "top" ? " focus" : "");
    $("dock-label").textContent = row === "top" ? "Settings" : (apps[focus] ? apps[focus].name : "");
  }
  function open() {
    if (row === "top") { if (tv) tv.settings(); return; }
    var a = apps[focus];
    if (a && tv) tv.launch(a.pkg);
  }
  document.addEventListener("keydown", function (e) {
    if (introOn) { endIntro(); e.preventDefault(); return; }   // any button skips the intro
    var k = e.key;
    if (k === "ArrowLeft" && row === "dock" && apps.length) focus = (focus - 1 + apps.length) % apps.length;
    else if (k === "ArrowRight" && row === "dock" && apps.length) focus = (focus + 1) % apps.length;
    else if (k === "ArrowUp") row = "top";
    else if (k === "ArrowDown") row = "dock";
    else if (k === "Enter" || k === " ") { open(); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    renderDock();
  });
  window.onTvHome = function () { row = "dock"; focus = 0; renderDock(); };
  window.onTvBack = function () { if (row === "top") { row = "dock"; renderDock(); } };
  window.onTvResume = function () {
    tick();
    if (Date.now() - calLoaded > (CONFIG.calendarRefreshMinutes || 30) * 60000) loadCalendar();
  };

  // ---------- fetching through the TV (no CORS there) ----------
  var pending = {}, seq = 0;
  window.tvReply = function (id, status, text) {
    var cb = pending[id];
    delete pending[id];
    if (cb) cb(status, text);
  };
  function tvGet(url, cb) {
    var id = "r" + (++seq);
    pending[id] = cb;
    tv.get(url, id);
  }

  // ---------- weather (Open-Meteo, no key) ----------
  var ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 18.5h10.5a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.4 9.6 4.5 4.5 0 0 0 7 18.5z"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15.5h10.5a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.4 6.6 4.5 4.5 0 0 0 7 15.5z"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15.5h10.5a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.4 6.6 4.5 4.5 0 0 0 7 15.5z"/><path d="M9 19.5h.01M13 20.5h.01M17 19.5h.01"/></svg>'
  };
  function wmo(code, isDay) {
    if (code <= 1) return { icon: isDay ? "sun" : "moon", text: code === 0 ? "Clear" : "Mostly clear" };
    if (code === 2) return { icon: "cloud", text: "Partly cloudy" };
    if (code === 3 || code === 45 || code === 48) return { icon: "cloud", text: code === 3 ? "Cloudy" : "Fog" };
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return { icon: "rain", text: code >= 95 ? "Storms" : "Rain" };
    return { icon: "snow", text: "Snow" };
  }
  function showWeather(temp, code, isDay) {
    var w = wmo(code, isDay);
    $("wx-icon").innerHTML = ICONS[w.icon];
    $("wx-temp").textContent = Math.round(temp) + "°";
    $("wx-text").textContent = w.text;
  }
  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.lat + "&longitude=" + CONFIG.lon +
      "&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=1";
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      showWeather(j.current.temperature_2m, j.current.weather_code, j.current.is_day === 1);
      sun = { rise: new Date(j.daily.sunrise[0]), set: new Date(j.daily.sunset[0]) };
      setTheme();
    }).catch(function () {
      if (!tv) { var p = window.PREVIEW.weather; showWeather(p.temp, p.code, document.body.className !== "night"); }
    });
  }

  // ---------- calendar ----------
  var SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function dayLabel(offset) {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    var d = new Date(); d.setDate(d.getDate() + offset);
    return SHORT[d.getDay()] + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
  }
  function renderCalendar(events, status) {
    var box = $("cal-list");
    box.innerHTML = "";
    $("cal-status").textContent = status || "";
    if (!events.length) { box.innerHTML = '<div class="empty">Nothing scheduled this week</div>'; return; }
    var current = -1, group = null, shown = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.day !== current) {
        current = e.day;
        group = document.createElement("div");
        group.className = "day-group" + (e.day === 0 ? " today" : "");
        group.innerHTML = '<div class="day-name">' + dayLabel(e.day) + "</div>";
        box.appendChild(group);
      }
      var r = document.createElement("div");
      r.className = "ev";
      r.innerHTML = '<span class="ev-time"></span><span class="ev-title"></span>';
      r.firstChild.textContent = e.time;
      r.lastChild.textContent = e.title;
      group.appendChild(r);
      if (box.scrollHeight > box.clientHeight) {   // out of room: say how many are left instead of cutting off
        group.removeChild(r);
        if (group.children.length === 1) box.removeChild(group);
        var more = document.createElement("div");
        more.className = "empty";
        box.appendChild(more);
        var left = events.length - shown;
        if (box.scrollHeight > box.clientHeight && more.previousSibling) {
          var g = more.previousSibling;
          g.removeChild(g.lastChild);
          if (g.children.length === 1) box.removeChild(g);
          left++;
        }
        more.textContent = "+ " + left + " more this week";
        break;
      }
      shown++;
    }
  }
  function clockText(d) {
    return (d.getHours() % 12 || 12) + ":" + ("0" + d.getMinutes()).slice(-2) + (d.getHours() >= 12 ? " PM" : " AM");
  }
  function loadCalendar() {
    if (!tv || !CONFIG.calendarUrl) { renderCalendar(window.PREVIEW.events, tv ? "No calendar link" : "Preview"); return; }
    tvGet(CONFIG.calendarUrl, function (status, text) {
      if (status !== 200 || text.indexOf("BEGIN:VCALENDAR") < 0) {
        $("cal-status").textContent = calLoaded ? "Couldn't refresh" : "Calendar unavailable";
        return;
      }
      calLoaded = Date.now();
      renderCalendar(window.weekFromIcs(text, 7), "Updated " + clockText(new Date()));
    });
  }

  // ---------- Rueda TV intro: at a fresh start and whenever the TV wakes up ----------
  var introOn = false, introTimers = [];
  function greeting() {
    var h = new Date().getHours();
    var part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    var d = new Date();
    return part + "  \u00B7  " + DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }
  function endIntro() {
    introTimers.forEach(clearTimeout);
    introTimers = [];
    introOn = false;
    $("intro").className = "";
    document.body.classList.remove("arrive", "go");
  }
  function playIntro() {
    endIntro();
    introOn = true;
    $("intro-greet").textContent = greeting();
    var intro = $("intro");
    void intro.offsetWidth;   // restart the animations
    intro.className = "play";
    document.body.classList.add("arrive");
    introTimers.push(setTimeout(function () { document.body.classList.add("go"); }, 3000));
    introTimers.push(setTimeout(function () { introOn = false; intro.className = ""; }, 3500));
    introTimers.push(setTimeout(function () { document.body.classList.remove("arrive", "go"); }, 4400));
  }
  window.onTvWake = playIntro;

  // ---------- fit the 1920x1080 design to the screen ----------
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    var s = Math.min(w / 1920, h / 1080);
    var stage = $("stage");
    stage.style.transform = "translate(" + Math.round((w - 1920 * s) / 2) + "px," + Math.round((h - 1080 * s) / 2) + "px) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ---------- start ----------
  try { apps = tv ? JSON.parse(tv.apps()) : window.PREVIEW.apps; } catch (e) { apps = []; }
  if (!tv) apps = apps.map(function (a) { return { pkg: a.pkg, name: a.name, color: a.brand }; });
  if (params.get("focus")) focus = Math.max(0, apps.map(function (a) { return a.name.toLowerCase(); }).indexOf(params.get("focus").toLowerCase()));
  tick();
  renderDock();
  if (params.get("intro") !== "0") playIntro();
  loadWeather();
  loadCalendar();
  setInterval(tick, 10000);
  setInterval(loadWeather, 15 * 60 * 1000);
  setInterval(loadCalendar, (CONFIG.calendarRefreshMinutes || 30) * 60 * 1000);
})();
