// A small iCalendar (.ics) reader for the week view: timed and all-day events, multi-day events, repeats
// (DAILY / WEEKLY with BYDAY / MONTHLY / YEARLY, with INTERVAL, COUNT, UNTIL), EXDATE, moved single
// occurrences (RECURRENCE-ID) and cancelled events. Times with TZID are read as the TV's local time
// (the TV and the calendar are both in Maryland); times ending in Z are UTC.
(function () {
  function unfold(text) {
    return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  }
  function unescape(s) {
    return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  }
  function parseDate(v) {
    v = v.trim();
    var y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    if (v.length < 15) return { date: new Date(y, mo, d), allDay: true };
    var h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +v.slice(13, 15);
    var date = v.charAt(v.length - 1) === "Z" ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s);
    return { date: date, allDay: false };
  }
  function parse(text) {
    var events = [], ev = null, depth = 0;
    unfold(text).forEach(function (line) {
      if (line === "BEGIN:VEVENT") { ev = { exdates: [], title: "(No title)" }; depth = 0; return; }
      if (line === "END:VEVENT") { if (ev) events.push(ev); ev = null; return; }
      if (!ev) return;
      if (line.indexOf("BEGIN:") === 0) { depth++; return; }
      if (line.indexOf("END:") === 0) { depth--; return; }
      if (depth) return;   // inside an alarm
      var c = line.indexOf(":");
      if (c < 0) return;
      var name = line.slice(0, c).split(";")[0].toUpperCase(), value = line.slice(c + 1);
      if (name === "DTSTART") ev.start = parseDate(value);
      else if (name === "DTEND") ev.end = parseDate(value);
      else if (name === "SUMMARY") ev.title = unescape(value);
      else if (name === "RRULE") ev.rrule = value;
      else if (name === "UID") ev.uid = value;
      else if (name === "STATUS") ev.status = value.toUpperCase();
      else if (name === "RECURRENCE-ID") ev.recurId = parseDate(value).date.getTime();
      else if (name === "EXDATE") value.split(",").forEach(function (p) { ev.exdates.push(parseDate(p).date.getTime()); });
    });
    return events;
  }

  var CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function occurrences(ev, from, to) {
    var start = ev.start.date;
    if (!ev.rrule || ev.recurId) return [start];
    var r = {};
    ev.rrule.split(";").forEach(function (p) { var i = p.indexOf("="); if (i > 0) r[p.slice(0, i).toUpperCase()] = p.slice(i + 1); });
    var interval = Math.max(1, +(r.INTERVAL || 1));
    var until = r.UNTIL ? parseDate(r.UNTIL).date : null;
    if (until && r.UNTIL.length < 15) until = addDays(until, 1);
    var count = r.COUNT ? +r.COUNT : Infinity;
    var out = [], n = 0, guard = 0;
    function take(d) {
      if (d < start) return true;
      if (n >= count || (until && d > until) || d >= to) return false;
      n++;
      if (d >= addDays(from, -40)) out.push(d);
      return true;
    }
    if (r.FREQ === "DAILY") {
      for (var d = start; guard++ < 5000; d = addDays(d, interval)) if (!take(d)) break;
    } else if (r.FREQ === "WEEKLY") {
      var days = (r.BYDAY ? r.BYDAY.split(",") : []).map(function (c) { return CODES[c.slice(-2).toUpperCase()]; })
        .filter(function (x) { return x !== undefined; }).sort();
      if (!days.length) days = [start.getDay()];
      var weekStart = addDays(start, -start.getDay());
      outer: for (var w = 0; guard++ < 2000; w += interval) {
        for (var i = 0; i < days.length; i++) {
          var x = addDays(weekStart, w * 7 + days[i]);
          x.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (!take(x)) break outer;
        }
      }
    } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
      var step = r.FREQ === "YEARLY" ? 12 * interval : interval;
      for (var m = 0; guard++ < 1200; m += step) {
        var y = new Date(start.getFullYear(), start.getMonth() + m, start.getDate(), start.getHours(), start.getMinutes());
        if (y.getDate() !== start.getDate()) continue;   // no 31st in this month
        if (!take(y)) break;
      }
    } else {
      out.push(start);
    }
    return out;
  }

  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes(), s = h >= 12 ? " PM" : " AM";
    h = h % 12 || 12;
    return h + (m ? ":" + ("0" + m).slice(-2) : "") + s;
  }

  // The next `days` days from today: [{day, time, title}] sorted, day 0 = today.
  window.weekFromIcs = function (text, days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var to = addDays(today, days);
    var events = parse(text), moved = {}, out = [];
    events.forEach(function (e) { if (e.recurId && e.uid) moved[e.uid + "|" + e.recurId] = true; });
    events.forEach(function (e) {
      if (!e.start || e.status === "CANCELLED") return;
      var len = e.end ? e.end.date - e.start.date : 0;
      occurrences(e, today, to).forEach(function (s) {
        var t = s.getTime();
        if (e.exdates.indexOf(t) >= 0) return;
        if (!e.recurId && e.uid && moved[e.uid + "|" + t]) return;
        if (e.start.allDay) {
          var span = Math.max(1, Math.round(len / 86400000));
          for (var k = 0; k < span; k++) {
            var day = addDays(s, k);
            var off = Math.round((day - today) / 86400000);
            if (off >= 0 && off < days) out.push({ day: off, time: "All day", title: e.title, k: off * 1e7 });
          }
        } else {
          var off2 = Math.floor((new Date(s.getFullYear(), s.getMonth(), s.getDate()) - today) / 86400000);
          if (off2 >= 0 && off2 < days) out.push({ day: off2, time: fmtTime(s), title: e.title, k: off2 * 1e7 + s.getHours() * 60 + s.getMinutes() + 1 });
        }
      });
    });
    out.sort(function (a, b) { return a.k - b.k; });
    return out;
  };
})();
