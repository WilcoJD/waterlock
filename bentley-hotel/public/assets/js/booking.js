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
    rooms: [
      { id: "148837309972637", name: "Single Room", guests: 1 },
      { id: "148838930526405", name: "Twin Room", guests: 2 },
      { id: "148839795253447", name: "Double Room", guests: 2 },
      { id: "158032272887993", name: "Family Room", guests: 3 }
    ]
  };

  var ON_SITE = location.protocol === "https:" && CFG.onSiteHosts.indexOf(location.hostname) !== -1;
  var PARAMS = ["checkin", "checkout", "adults", "kids", "rid", "promo"];

  // ---------- date helpers (local calendar dates as YYYY-MM-DD) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return iso(d) === s ? d : null;
  }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function today() { return iso(new Date()); }
  function nightsBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // UK style without commas: "Wed 10 Feb" / "Wed 10 Feb 2027"
  function nice(s, withYear) {
    var d = parse(s);
    if (!d) return s;
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + (withYear ? " " + d.getFullYear() : "");
  }
  function money(n) { return "£" + (Math.round(n) === n ? String(n) : n.toFixed(2)); }
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

  function loadCloudbeds() {
    if (document.querySelector('script[data-entry="immersive"]')) return;
    var s = document.createElement("script");
    s.src = CFG.loaderUrl;
    s.setAttribute("data-entry", "immersive");
    s.async = true;
    document.head.appendChild(s);
  }

  // ---------- 1. booking search bars ----------
  function initSearchForm(form) {
    var inEl = form.querySelector('[name="checkin"]');
    var outEl = form.querySelector('[name="checkout"]');
    var adultsEl = form.querySelector('[name="adults"]');
    var roomEl = form.querySelector('[name="rid"]');
    if (!inEl || !outEl) return;
    var t = today();
    inEl.min = t;
    if (!parse(inEl.value) || inEl.value < t) inEl.value = t;
    function syncOut() {
      var minOut = addDays(inEl.value || t, 1);
      outEl.min = minOut;
      if (!parse(outEl.value) || outEl.value < minOut) outEl.value = minOut;
    }
    syncOut();
    inEl.addEventListener("change", function () {
      if (!parse(inEl.value) || inEl.value < t) inEl.value = t;
      syncOut();
    });
    outEl.addEventListener("change", syncOut);
    if (roomEl && adultsEl) {
      roomEl.addEventListener("change", function () {
        var room = roomById(roomEl.value);
        if (room && Number(adultsEl.value) > room.guests) adultsEl.value = String(room.guests);
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      syncOut();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      window.location.href = bookingUrl(data);
    });
  }

  // ---------- 2. on-site booking page ----------
  function initBookingPage(host) {
    var params = new URLSearchParams(location.search);
    var summary = document.querySelector("[data-booking-summary]");
    var checkin = params.get("checkin"), checkout = params.get("checkout");
    if (summary && parse(checkin) && parse(checkout) && checkout > checkin) {
      var n = nightsBetween(checkin, checkout);
      var room = roomById(params.get("rid") || "");
      var adults = Number(params.get("adults")) || 0, kids = Number(params.get("kids")) || 0;
      var bits = [nice(checkin, true) + " to " + nice(checkout, true), n + (n === 1 ? " night" : " nights")];
      if (adults) bits.push(adults + (adults === 1 ? " adult" : " adults") + (kids ? ", " + kids + (kids === 1 ? " child" : " children") : ""));
      if (room) bits.push(room.name);
      summary.textContent = "Your search: " + bits.join(" · ");
      summary.hidden = false;
    }
    var o = {};
    PARAMS.forEach(function (k) { if (params.get(k)) o[k] = params.get(k); });
    document.querySelectorAll("[data-hosted-link]").forEach(function (a) { a.href = hostedUrl(o); });

    var engine = host.querySelector("cb-immersive-experience");
    var fallback = host.querySelector("[data-booking-fallback]");
    function showFallback() {
      if (engine) engine.hidden = true;
      if (fallback) fallback.hidden = false;
      host.classList.remove("is-loading");
    }
    if (!ON_SITE || !engine || !window.customElements) { showFallback(); return; }
    loadCloudbeds();
    var waited = 0;
    var timer = setInterval(function () {
      waited += 500;
      if (window.customElements.get("cb-immersive-experience")) {
        clearInterval(timer);
        host.classList.remove("is-loading");
      } else if (waited >= 15000) {
        clearInterval(timer);
        showFallback();
      }
    }, 500);
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
    var start = t, data = null, sel = null, reqId = 0;

    function setStatus(msg) { if (status) status.textContent = msg || ""; }

    function showFallback() {
      root.hidden = true;
      if (!fallback) return;
      fallback.hidden = false;
      var picker = fallback.querySelector("[data-cloudbeds-picker]");
      if (picker && ON_SITE && window.customElements) {
        picker.innerHTML = '<cb-property-date-picker property-code="' + CFG.propertyCode +
          '" custom-url="book.html" lang="en" currency="' + CFG.currency +
          '" button-label="Check availability" layout="horizontal"></cb-property-date-picker>';
        picker.hidden = false;
        loadCloudbeds();
      }
    }

    function cellInfo(room, day) {
      var label = room.name + ", " + nice(day.date, true) + ": ";
      if (day.available <= 0) return { cls: "is-full", text: "Full", label: label + "fully booked" };
      var left = day.available === 1 ? "1 left" : day.available + " left";
      var price = day.rate !== null ? "from " + money(day.rate) : "";
      var notes = [];
      if (day.closedToArrival) notes.push("no arrivals");
      if (day.minStay) notes.push("minimum " + day.minStay + " nights");
      return {
        cls: day.available <= 1 ? "is-low" : "is-open",
        text: left, price: price, note: notes.join(", "),
        label: label + left + (price ? ", " + price + " per night" : "") + (notes.length ? ", " + notes.join(", ") : "")
      };
    }

    function render() {
      if (!data) return;
      var dates = data.rooms.length ? data.rooms[0].days.map(function (d) { return d.date; }) : [];
      var html = '<table class="diary-table"><caption class="visually-hidden">Rooms available per night from ' +
        esc(nice(data.start, true)) + '</caption><thead><tr><th scope="col" class="diary-room">Room</th>';
      dates.forEach(function (d) {
        var day = parse(d), wk = day.getDay() === 0 || day.getDay() === 6;
        html += '<th scope="col" class="' + (wk ? "is-weekend" : "") + '"><span class="diary-dow">' +
          DOW[day.getDay()] + '</span><span class="diary-dom">' + day.getDate() +
          '</span><span class="diary-mon">' + MON[day.getMonth()] + "</span></th>";
      });
      html += "</tr></thead><tbody>";
      data.rooms.forEach(function (room) {
        html += '<tr><th scope="row" class="diary-room">' + esc(room.name) + "</th>";
        room.days.forEach(function (day) {
          var info = cellInfo(room, day);
          var state = "";
          if (sel && sel.room === room.id) {
            if (day.date === sel.checkin) state = " is-checkin";
            else if (sel.checkout && day.date === sel.checkout) state = " is-checkout";
            else if (sel.checkout && day.date > sel.checkin && day.date < sel.checkout) state = " is-between";
          }
          var pressed = state ? "true" : "false";
          html += '<td><button type="button" class="diary-cell ' + info.cls + state + '" data-room="' + esc(room.id) +
            '" data-date="' + esc(day.date) + '" aria-pressed="' + pressed + '" aria-label="' + esc(info.label) + '">' +
            '<span class="diary-left">' + esc(info.text) + "</span>" +
            (info.price ? '<span class="diary-price">' + esc(info.price.replace("from ", "")) + "</span>" : "") +
            (info.note ? '<span class="diary-note" aria-hidden="true">' + (day.closedToArrival ? "No arrivals" : "Min " + esc(day.minStay)) + "</span>" : "") +
            "</button></td>";
        });
        html += "</tr>";
      });
      html += "</tbody></table>";
      grid.innerHTML = html;
      if (prevBtn) prevBtn.disabled = start <= t;
      renderSelection();
    }

    function nightsOK(room, checkin, checkout) {
      var days = {};
      room.days.forEach(function (d) { days[d.date] = d; });
      var first = days[checkin];
      if (!first || first.available <= 0) return "That night is fully booked for the " + room.name + ".";
      if (first.closedToArrival) return "Arrivals aren't available on " + nice(checkin) + " for the " + room.name + ".";
      var n = nightsBetween(checkin, checkout);
      if (first.minStay && n < first.minStay) return "Stays arriving on " + nice(checkin) + " need at least " + first.minStay + " nights.";
      for (var d = checkin; d < checkout; d = addDays(d, 1)) {
        if (!days[d]) return null; // beyond this view: let the booking engine check it
        if (days[d].available <= 0) return "The " + room.name + " is fully booked on " + nice(d) + ". Try different dates or another room.";
      }
      if (days[checkout] && days[checkout].closedToDeparture) return "Departures aren't available on " + nice(checkout) + ".";
      return null;
    }

    function renderSelection() {
      if (!selBox) return;
      if (!sel) { selBox.hidden = true; return; }
      var room = roomById(sel.room);
      selBox.hidden = false;
      if (!sel.checkout) {
        selText.textContent = room.name + ": arriving " + nice(sel.checkin, true) + ". Now choose your departure date.";
        selBook.hidden = true;
        return;
      }
      var n = nightsBetween(sel.checkin, sel.checkout);
      var total = 0, priced = true;
      var row = null;
      data.rooms.forEach(function (r) { if (r.id === sel.room) row = r; });
      row.days.forEach(function (d) {
        if (d.date >= sel.checkin && d.date < sel.checkout) { if (d.rate === null) priced = false; else total += d.rate; }
      });
      if (nightsBetween(sel.checkin, sel.checkout) > row.days.filter(function (d) { return d.date >= sel.checkin; }).length) priced = false;
      selText.textContent = room.name + ": " + nice(sel.checkin, true) + " to " + nice(sel.checkout, true) + ", " +
        n + (n === 1 ? " night" : " nights") + (priced ? ". From " + money(Math.round(total * 100) / 100) + " in total." : ".");
      selBook.hidden = false;
      selBook.href = bookingUrl({ checkin: sel.checkin, checkout: sel.checkout, rid: sel.room, adults: room.guests === 1 ? 1 : 2 });
    }

    function onCell(btn) {
      var roomId = btn.getAttribute("data-room"), date = btn.getAttribute("data-date");
      var room = null;
      data.rooms.forEach(function (r) { if (r.id === roomId) room = r; });
      if (!sel || sel.room !== roomId || sel.checkout || date <= sel.checkin) {
        var problem = nightsOK(room, date, addDays(date, 1));
        if (problem) { setStatus(problem); return; }
        sel = { room: roomId, checkin: date, checkout: null };
        setStatus(room.name + ": arriving " + nice(date, true) + ". Choose your departure date.");
      } else {
        var issue = nightsOK(room, sel.checkin, date);
        if (issue) { setStatus(issue); return; }
        sel.checkout = date;
        setStatus("Selected " + room.name + ", " + nice(sel.checkin) + " to " + nice(date) + ".");
      }
      render();
      var again = grid.querySelector('[data-room="' + roomId + '"][data-date="' + date + '"]');
      if (again) again.focus();
    }

    function load() {
      var id = ++reqId;
      root.classList.add("is-loading");
      setStatus("Loading live availability…");
      if (startEl) startEl.value = start;
      fetch("/api/availability?start=" + encodeURIComponent(start) + "&days=" + DAYS, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (json) {
          if (id !== reqId) return;
          if (!json || !Array.isArray(json.rooms)) throw new Error("Unexpected response");
          data = json;
          root.classList.remove("is-loading");
          var updated = json.generatedAt ? new Date(json.generatedAt) : null;
          setStatus("Showing " + nice(json.start, true) + " to " + nice(addDays(json.end, -1), true) +
            (updated ? ". Updated " + updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "") + ".");
          render();
        })
        .catch(function () {
          if (id !== reqId) return;
          root.classList.remove("is-loading");
          showFallback();
        });
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".diary-cell") : null;
      if (btn) onCell(btn);
    });
    if (prevBtn) prevBtn.addEventListener("click", function () {
      var s = addDays(start, -DAYS); start = s < t ? t : s; load();
    });
    if (nextBtn) nextBtn.addEventListener("click", function () { start = addDays(start, DAYS); load(); });
    if (startEl) {
      startEl.min = t;
      startEl.addEventListener("change", function () {
        if (parse(startEl.value)) { start = startEl.value < t ? t : startEl.value; load(); }
      });
    }
    if (selClear) selClear.addEventListener("click", function () { sel = null; setStatus(""); render(); });
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
    document.querySelectorAll('a[href^="book.html"]').forEach(function (a) {
      if (a.closest("[data-booking-engine]")) return;
      var q = a.getAttribute("href").split("?")[1] || "";
      var o = {};
      new URLSearchParams(q).forEach(function (v, k) { o[k] = v; });
      a.href = hostedUrl(o);
    });
  }
})();
