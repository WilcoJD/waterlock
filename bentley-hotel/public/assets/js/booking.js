/* The Bentley Hotel — online booking via Cloudbeds.
 *
 *  1. Booking search bars  (form[data-booking-form])  → book.html with dates, guests and room
 *  2. On-site booking page (book.html, [data-booking-engine]) → Cloudbeds Immersive Experience
 *  3. Availability diary   (availability.html, [data-diary]) → /api/availability (Cloudflare Pages Function)
 *
 * Everything degrades to Cloudbeds' own hosted booking page, which takes the same
 * search parameters, when the page isn't on the hotel's own domain or the embed fails.
 */
(function () {
  "use strict";

  var CFG = {
    propertyCode: "7ELXfI",
    hostedUrl: "https://us2.cloudbeds.com/en/reservation/7ELXfI",
    loaderUrl: "https://static1.cloudbeds.com/booking-engine/latest/loader.js",
    // The Immersive Experience only works on domains whitelisted in Cloudbeds
    // (Settings → Booking Engine → Embeds → Premium → Whitelisted domains).
    onSiteHosts: ["www.thebentleyhotel.co.uk", "thebentleyhotel.co.uk"],
    currency: "gbp",
    timeZone: "Europe/London",
    maxDaysAhead: 539, // the availability function accepts up to 540 days ahead
    rooms: [
      { id: "148837309972637", name: "Single Room", guests: 1 },
      { id: "148838930526405", name: "Twin Room", guests: 2 },
      { id: "148839795253447", name: "Double Room", guests: 2 },
      { id: "158032272887993", name: "Family Room", guests: 3 }
    ]
  };

  var ON_SITE = location.protocol === "https:" && CFG.onSiteHosts.indexOf(location.hostname) !== -1;
  var PARAMS = ["checkin", "checkout", "adults", "kids", "rid", "promo"];

  // ---------- helpers ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return iso(d) === s ? d : null;
  }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function nightsBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  // The hotel's calendar date (Europe/London), whatever the visitor's time zone.
  function today() {
    try {
      var p = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: CFG.timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + "-" + p.month + "-" + p.day;
    } catch (e) { /* older browsers: fall back to the device date */ }
    return iso(new Date());
  }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // UK style without commas: "Wed 10 Feb" / "Wed 10 Feb 2027"
  function nice(s, withYear) {
    var d = parse(s);
    if (!d) return s;
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + (withYear ? " " + d.getFullYear() : "");
  }
  function money(n) { return "£" + (Math.round(n) === n ? String(n) : n.toFixed(2)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function roomById(id) { for (var i = 0; i < CFG.rooms.length; i++) if (CFG.rooms[i].id === id) return CFG.rooms[i]; return null; }

  // ---------- booking URLs ----------
  function query(o) {
    var p = new URLSearchParams();
    PARAMS.forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== "") p.set(k, String(o[k])); });
    p.set("currency", CFG.currency);
    return p.toString();
  }
  function bookingUrl(o) { return (ON_SITE ? "book.html" : CFG.hostedUrl) + "?" + query(o); }
  function hostedUrl(o) { return CFG.hostedUrl + "?" + query(o); }
  window.BentleyBooking = { url: bookingUrl, hostedUrl: hostedUrl, onSite: ON_SITE, config: CFG };

  function loadCloudbeds(onError) {
    var existing = document.querySelector('script[data-entry="immersive"]');
    if (existing) { if (onError) existing.addEventListener("error", onError); return; }
    var s = document.createElement("script");
    s.src = CFG.loaderUrl;
    s.setAttribute("data-entry", "immersive");
    s.async = true;
    if (onError) s.addEventListener("error", onError);
    document.head.appendChild(s);
  }

  // ---------- 1. booking search bars ----------
  function initSearchForm(form) {
    var inEl = form.querySelector('[name="checkin"]');
    var outEl = form.querySelector('[name="checkout"]');
    var adultsEl = form.querySelector('[name="adults"]');
    var roomEl = form.querySelector('[name="rid"]');
    if (!inEl || !outEl) return;
    var now = today();
    inEl.min = now;
    if (!parse(inEl.value) || inEl.value < now) inEl.value = now;
    function fixIn() {
      now = today();
      inEl.min = now;
      if (!parse(inEl.value) || inEl.value < now) inEl.value = now;
    }
    function syncOut() {
      var minOut = addDays(parse(inEl.value) && inEl.value >= now ? inEl.value : now, 1);
      outEl.min = minOut;
      if (!parse(outEl.value) || outEl.value < minOut) outEl.value = minOut;
    }
    syncOut();
    // Browsers fire "change" while a date is still being typed, so only correct values once focus leaves.
    inEl.addEventListener("change", function () { if (parse(inEl.value) && inEl.value >= now) syncOut(); });
    inEl.addEventListener("blur", function () { fixIn(); syncOut(); });
    outEl.addEventListener("blur", syncOut);
    if (roomEl && adultsEl) {
      var fit = document.createElement("p");
      fit.className = "hint";
      fit.setAttribute("aria-live", "polite");
      roomEl.parentNode.appendChild(fit);
      roomEl.addEventListener("change", function () {
        var room = roomById(roomEl.value);
        fit.textContent = "";
        if (room && Number(adultsEl.value) > room.guests) {
          adultsEl.value = String(room.guests);
          fit.textContent = "The " + room.name + " sleeps " + room.guests + ", so adults is now " + room.guests + ".";
        }
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      fixIn();
      syncOut();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      window.location.href = bookingUrl(data);
    });
  }

  // ---------- 2. on-site booking page ----------
  function initBookingPage(host) {
    var params = new URLSearchParams(location.search);
    var checkin = params.get("checkin"), checkout = params.get("checkout");
    // Old bookmarks or shared links can carry past dates: drop them so Cloudbeds offers fresh ones.
    if (parse(checkin) && checkin < today()) {
      params.delete("checkin"); params.delete("checkout"); checkin = checkout = null;
      try { history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash); } catch (e) {}
    }
    var summary = document.querySelector("[data-booking-summary]");
    if (summary && parse(checkin) && parse(checkout) && checkout > checkin) {
      var count = function (v, lo, hi) { return /^\d{1,2}$/.test(v || "") && +v >= lo && +v <= hi ? +v : 0; };
      var adults = count(params.get("adults"), 1, 6), kids = count(params.get("kids"), 0, 4);
      var room = roomById(params.get("rid") || "");
      var bits = [nice(checkin, true) + " to " + nice(checkout, true), plural(nightsBetween(checkin, checkout), "night", "nights")];
      if (adults) bits.push(plural(adults, "adult", "adults") + (kids ? ", " + plural(kids, "child", "children") : ""));
      if (room) bits.push(room.name);
      summary.textContent = "Your search: " + bits.join(" · ");
      summary.hidden = false;
    }
    var o = {};
    PARAMS.forEach(function (k) { if (params.get(k)) o[k] = params.get(k); });
    document.querySelectorAll("[data-hosted-link]").forEach(function (a) { a.href = hostedUrl(o); });

    var engine = host.querySelector("cb-immersive-experience");
    var fallback = host.querySelector("[data-booking-fallback]");
    var timer = null, done = false;
    function finish() { done = true; clearInterval(timer); host.classList.remove("is-loading"); host.removeAttribute("aria-busy"); }
    function showFallback() {
      if (done) return;
      finish();
      if (engine) engine.hidden = true;
      if (fallback) fallback.hidden = false;
    }
    if (!ON_SITE || !engine || !window.customElements) { showFallback(); return; }
    host.setAttribute("aria-busy", "true");
    var t0 = Date.now();
    timer = setInterval(function () {
      if (window.customElements.get("cb-immersive-experience")) finish();
      else if (Date.now() - t0 >= 15000) showFallback();
    }, 500);
    loadCloudbeds(showFallback);
  }

  // ---------- 3. availability diary ----------
  function initDiary(root) {
    var grid = root.querySelector("[data-diary-grid]");
    var status = root.querySelector("[data-diary-status]");
    var startEl = root.querySelector("[data-diary-start]");
    var prevBtn = root.querySelector("[data-diary-prev]");
    var nextBtn = root.querySelector("[data-diary-next]");
    var selBox = root.querySelector("[data-diary-selection]");
    var selText = root.querySelector("[data-diary-selection-text]");
    var selBook = root.querySelector("[data-diary-book]");
    var selClear = root.querySelector("[data-diary-clear]");
    var fallback = document.querySelector("[data-diary-fallback]");
    var DAYS = window.matchMedia && window.matchMedia("(min-width: 900px)").matches ? 21 : 14;
    var t = today();
    var MAX_START = addDays(t, CFG.maxDaysAhead - DAYS);
    var start = t, data = null, sel = null, reqId = 0;
    var known = {}; // roomId -> { date -> day } for every night loaded so far
    function dayOf(roomId, date) { return (known[roomId] || {})[date] || null; }

    function setStatus(msg, isError) {
      if (!status) return;
      status.classList.toggle("is-error", Boolean(isError));
      // Clear first so a repeated message is announced again.
      status.textContent = "";
      if (msg) setTimeout(function () { status.textContent = msg; }, 60);
    }

    function showFallback() {
      root.hidden = true;
      if (!fallback) return;
      fallback.hidden = false;
      var picker = fallback.querySelector("[data-cloudbeds-picker]");
      if (picker && ON_SITE && window.customElements) {
        picker.innerHTML = '<cb-property-date-picker property-code="' + esc(CFG.propertyCode) +
          '" custom-url="book.html" lang="en" currency="' + esc(CFG.currency) +
          '" button-label="Check availability" layout="horizontal"></cb-property-date-picker>';
        picker.hidden = false;
        loadCloudbeds();
      }
    }

    function cellInfo(room, day) {
      var label = room.name + ", " + nice(day.date, true) + ": ";
      if (day.available <= 0) return { cls: "is-full", text: "Full", label: label + "fully booked" };
      var left = day.available === 1 ? "1 left" : day.available + " left";
      var price = day.rate !== null ? money(day.rate) : "";
      var notes = [];
      if (day.closedToArrival) notes.push("no arrivals");
      if (day.minStay) notes.push("minimum " + day.minStay + " nights");
      if (day.closedToDeparture) notes.push("no departures");
      var tag = day.closedToArrival ? "No arrivals" : day.minStay ? "Min " + day.minStay : day.closedToDeparture ? "No departures" : "";
      return {
        cls: day.available <= 1 ? "is-low" : "is-open", text: left, price: price, tag: tag,
        label: label + left + (price ? ", from " + price + " per night" : "") + (notes.length ? ", " + notes.join(", ") : "")
      };
    }

    function render() {
      if (!data) return;
      var dates = data.rooms.length ? data.rooms[0].days.map(function (d) { return d.date; }) : [];
      var html = '<table class="diary-table"><caption class="visually-hidden">Rooms available per night from ' +
        esc(nice(data.start, true)) + '. Use the arrow keys to move between nights and rooms.</caption><thead><tr><th scope="col" class="diary-room">Room</th>';
      dates.forEach(function (d) {
        var day = parse(d), wk = day.getDay() === 0 || day.getDay() === 6;
        html += '<th scope="col" class="' + (wk ? "is-weekend" : "") + '" aria-label="' + esc(nice(d, true)) + '"><span class="diary-dow">' +
          DOW[day.getDay()] + '</span><span class="diary-dom">' + day.getDate() + '</span><span class="diary-mon">' + MON[day.getMonth()] + "</span></th>";
      });
      html += "</tr></thead><tbody>";
      data.rooms.forEach(function (room) {
        html += '<tr><th scope="row" class="diary-room">' + esc(room.name) + "</th>";
        room.days.forEach(function (day) {
          var info = cellInfo(room, day);
          var state = "", role = "";
          if (sel && sel.room === room.id) {
            if (day.date === sel.checkin) { state = " is-checkin"; role = ", your arrival"; }
            else if (sel.checkout && day.date === sel.checkout) { state = " is-checkout"; role = ", your departure"; }
            else if (sel.checkout && day.date > sel.checkin && day.date < sel.checkout) { state = " is-between"; role = ", in your stay"; }
          }
          html += '<td><button type="button" tabindex="-1" class="diary-cell ' + info.cls + state + '" data-room="' + esc(room.id) +
            '" data-date="' + esc(day.date) + '" aria-label="' + esc(info.label + role) + '">' +
            '<span class="diary-left">' + esc(info.text) + "</span>" +
            (info.price ? '<span class="diary-price">' + esc(info.price) + "</span>" : "") +
            (info.tag ? '<span class="diary-note" aria-hidden="true">' + esc(info.tag) + "</span>" : "") +
            "</button></td>";
        });
        html += "</tr>";
      });
      html += "</tbody></table>";
      grid.innerHTML = html;
      // One Tab stop for the whole grid (roving tabindex); arrow keys move between cells.
      var active = (sel && grid.querySelector('[data-room="' + sel.room + '"][data-date="' + (sel.checkout || sel.checkin) + '"]')) ||
        grid.querySelector(".diary-cell");
      if (active) active.tabIndex = 0;
      if (prevBtn) {
        var prevHadFocus = document.activeElement === prevBtn;
        prevBtn.disabled = start <= t;
        if (prevHadFocus && prevBtn.disabled && nextBtn) nextBtn.focus();
      }
      if (nextBtn) {
        var nextHadFocus = document.activeElement === nextBtn;
        nextBtn.disabled = start >= MAX_START;
        if (nextHadFocus && nextBtn.disabled && prevBtn) prevBtn.focus();
      }
      renderSelection();
    }

    function arrivalProblem(room, date) {
      var d = dayOf(room.id, date);
      if (!d || d.available <= 0) return "That night is fully booked for the " + room.name + ".";
      if (d.closedToArrival) return "Arrivals aren't available on " + nice(date) + " for the " + room.name + ".";
      return null;
    }

    function stayProblem(room, checkin, checkout) {
      var first = dayOf(room.id, checkin);
      var n = nightsBetween(checkin, checkout);
      if (first) {
        if (first.available <= 0) return "That night is fully booked for the " + room.name + ".";
        if (first.closedToArrival) return "Arrivals aren't available on " + nice(checkin) + " for the " + room.name + ".";
        if (first.minStay && n < first.minStay) return "Stays arriving on " + nice(checkin) + " need at least " + first.minStay + " nights.";
      }
      for (var d = checkin; d < checkout; d = addDays(d, 1)) {
        var night = dayOf(room.id, d);
        if (!night) continue; // not loaded: the booking engine checks it
        if (night.available <= 0) return "The " + room.name + " is fully booked on " + nice(d) + ". Try different dates or another room.";
      }
      var dep = dayOf(room.id, checkout);
      if (dep && dep.closedToDeparture) return "Departures aren't available on " + nice(checkout) + ".";
      return null;
    }

    function renderSelection() {
      if (!selBox) return;
      if (!sel) { selBox.hidden = true; return; }
      var room = roomById(sel.room);
      selBox.hidden = false;
      if (!sel.checkout) {
        var a = dayOf(sel.room, sel.checkin);
        selText.textContent = room.name + ": arriving " + nice(sel.checkin, true) + ". Now choose your departure date" +
          (a && a.minStay ? " (minimum " + a.minStay + " nights)" : "") + ".";
        selBook.hidden = true;
        return;
      }
      var n = nightsBetween(sel.checkin, sel.checkout);
      var total = 0, priced = true;
      for (var d = sel.checkin; d < sel.checkout; d = addDays(d, 1)) {
        var night = dayOf(sel.room, d);
        if (!night || night.rate === null) { priced = false; break; }
        total += night.rate;
      }
      selText.textContent = room.name + ": " + nice(sel.checkin, true) + " to " + nice(sel.checkout, true) + ", " +
        plural(n, "night", "nights") + (priced ? ". From " + money(Math.round(total * 100) / 100) + " in total." : ".");
      selBook.hidden = false;
      selBook.href = bookingUrl({ checkin: sel.checkin, checkout: sel.checkout, rid: sel.room, adults: room.guests === 1 ? 1 : 2 });
    }

    function onCell(btn) {
      var roomId = btn.getAttribute("data-room"), date = btn.getAttribute("data-date");
      var room = roomById(roomId);
      if (!room) return;
      if (!sel || sel.room !== roomId || sel.checkout || date <= sel.checkin) {
        var problem = arrivalProblem(room, date);
        if (problem) { setStatus(problem, true); return; }
        sel = { room: roomId, checkin: date, checkout: null };
        var a = dayOf(roomId, date);
        setStatus(room.name + ": arriving " + nice(date, true) + ". Choose your departure date" +
          (a && a.minStay ? " (minimum " + a.minStay + " nights)" : "") + ".");
      } else {
        var issue = stayProblem(room, sel.checkin, date);
        if (issue) { setStatus(issue, true); return; }
        sel.checkout = date;
        setStatus("Selected " + room.name + ", " + nice(sel.checkin) + " to " + nice(date) + ". Use Book these dates to continue.");
      }
      render();
      var again = grid.querySelector('[data-room="' + roomId + '"][data-date="' + date + '"]');
      if (again) again.focus();
    }

    function load() {
      var id = ++reqId;
      root.classList.add("is-loading");
      grid.setAttribute("aria-busy", "true");
      setStatus("Loading live availability…");
      if (startEl && document.activeElement !== startEl) startEl.value = start;
      fetch("/api/availability?start=" + encodeURIComponent(start) + "&days=" + DAYS, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (json) {
          if (id !== reqId) return;
          if (!json || !Array.isArray(json.rooms)) throw new Error("Unexpected response");
          data = json;
          json.rooms.forEach(function (r) {
            var k = known[r.id] = known[r.id] || {};
            r.days.forEach(function (d) { k[d.date] = d; });
          });
          root.classList.remove("is-loading");
          grid.removeAttribute("aria-busy");
          var updated = json.generatedAt ? new Date(json.generatedAt) : null;
          setStatus("Showing " + nice(json.start, true) + " to " + nice(addDays(json.end, -1), true) +
            (updated && !isNaN(updated) ? ". Updated " + pad(updated.getHours()) + ":" + pad(updated.getMinutes()) : "") + ".");
          render();
        })
        .catch(function () {
          if (id !== reqId) return;
          root.classList.remove("is-loading");
          grid.removeAttribute("aria-busy");
          if (!data) { showFallback(); return; }
          // A later failure (e.g. Cloudbeds busy): keep the diary and the guest's selection.
          start = data.start;
          if (startEl && document.activeElement !== startEl) startEl.value = start;
          render();
          setStatus("Sorry, we couldn't load those dates just now. Please try again in a moment.", true);
        });
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".diary-cell") : null;
      if (btn && !root.classList.contains("is-loading")) onCell(btn);
    });
    grid.addEventListener("focusin", function (e) {
      var c = e.target.closest ? e.target.closest(".diary-cell") : null;
      if (!c) return;
      var old = grid.querySelector('.diary-cell[tabindex="0"]');
      if (old && old !== c) old.tabIndex = -1;
      c.tabIndex = 0;
    });
    grid.addEventListener("keydown", function (e) {
      var btn = e.target.closest ? e.target.closest(".diary-cell") : null;
      if (!btn) return;
      var td = btn.parentNode, tr = td.parentNode, rows = tr.parentNode.rows, r = tr.sectionRowIndex, c = td.cellIndex;
      var to;
      if (e.key === "ArrowRight") to = tr.cells[c + 1] || null;
      else if (e.key === "ArrowLeft") to = c > 1 ? tr.cells[c - 1] : null;
      else if (e.key === "ArrowDown") to = rows[r + 1] ? rows[r + 1].cells[c] : null;
      else if (e.key === "ArrowUp") to = rows[r - 1] ? rows[r - 1].cells[c] : null;
      else if (e.key === "Home") to = tr.cells[1];
      else if (e.key === "End") to = tr.cells[tr.cells.length - 1];
      else return;
      e.preventDefault();
      var next = to && to.querySelector(".diary-cell");
      if (next) next.focus();
    });
    if (prevBtn) prevBtn.addEventListener("click", function () {
      var s = addDays(start, -DAYS); start = s < t ? t : s; load();
    });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      var s = addDays(start, DAYS); start = s > MAX_START ? MAX_START : s; load();
    });
    if (startEl) {
      startEl.min = t;
      startEl.max = MAX_START;
      startEl.addEventListener("change", function () {
        var v = startEl.value;
        if (parse(v) && v >= t && v <= MAX_START && v !== start) { start = v; load(); }
      });
      startEl.addEventListener("blur", function () {
        if (!parse(startEl.value) || startEl.value < t || startEl.value > MAX_START) startEl.value = start;
      });
    }
    if (selClear) selClear.addEventListener("click", function () {
      var was = sel;
      sel = null;
      render();
      setStatus("Selection cleared. Choose an arrival date.");
      var cell = was && grid.querySelector('[data-room="' + was.room + '"][data-date="' + was.checkin + '"]');
      (cell || root.querySelector(".diary-scroll")).focus();
    });
    load();
  }

  // ---------- boot ----------
  document.querySelectorAll("form[data-booking-form]").forEach(initSearchForm);
  var engineHost = document.querySelector("[data-booking-engine]");
  if (engineHost) initBookingPage(engineHost);
  var diary = document.querySelector("[data-diary]");
  if (diary) initDiary(diary);

  // Off the hotel's own domain, send "Book" links straight to the hosted booking page.
  if (!ON_SITE) {
    document.querySelectorAll('a[href^="book.html"], a[href^="/book.html"]').forEach(function (a) {
      if (a.closest("[data-booking-engine]")) return;
      var q = a.getAttribute("href").split("?")[1] || "";
      var o = {};
      new URLSearchParams(q).forEach(function (v, k) { o[k] = v; });
      a.href = hostedUrl(o);
    });
  }
})();
