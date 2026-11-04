(function () {
  'use strict';

  var C = window.CATALOG;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var app = $('#app');

  /* ---------- storage (safe) ---------- */
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

  var state = {
    cart: load('kh_cart', []),
    incVat: load('kh_incvat', false),
    discount: load('kh_discount', null)
  };

  var DISCOUNTS = { WELCOME10: 0.10, KESTREL20: 0.20 };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function vat(n) { return state.incVat ? n * (1 + C.vatRate) : n; }
  function money(n) { return '£' + n.toFixed(2); }
  function price(n) { return money(vat(n)); }
  function vatLabel() { return state.incVat ? 'inc. VAT' : 'ex. VAT'; }
  function termLabel(t) { return t === 'yr' ? '/yr' : '/mo'; }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function findProduct(id) {
    var all = [].concat(C.hosting, C.vps, C.dedicated, C.email, C.ssl, C.addons);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* ---------- cart ---------- */
  // Line: { key, kind:'domain'|'plan', id, name, detail, unit, term, period, renew? }
  function lineTotal(l) {
    if (l.kind === 'domain') return l.unit + (l.period - 1) * l.renew; // first year promo, then renewal
    return l.unit * l.period;
  }
  function periodOptions(l) {
    if (l.kind === 'domain') return [1, 2, 3, 5].map(function (y) { return { v: y, t: y + (y === 1 ? ' year' : ' years') }; });
    if (l.term === 'yr') return [1, 2, 3].map(function (y) { return { v: y, t: y + (y === 1 ? ' year' : ' years') }; });
    return [1, 12, 24].map(function (m) { return { v: m, t: m === 1 ? 'Monthly' : m + ' months' }; });
  }
  function persist() { save('kh_cart', state.cart); save('kh_discount', state.discount); renderCartCount(); }
  function addLine(line) {
    if (state.cart.some(function (l) { return l.key === line.key; })) { toast('Already in your basket'); openDrawer(); return; }
    state.cart.push(line); persist(); toast(line.name + ' added'); openDrawer();
  }
  function removeLine(key) { state.cart = state.cart.filter(function (l) { return l.key !== key; }); persist(); renderDrawer(); if (route().path === '/checkout') render(); }
  function setPeriod(key, p) { state.cart.forEach(function (l) { if (l.key === key) l.period = +p; }); persist(); renderDrawer(); if (route().path === '/checkout') renderSummary(); }
  function addPlan(id, extra) {
    var p = findProduct(id); if (!p) return;
    extra = extra || {};
    addLine({
      key: id + (extra.suffix || ''), kind: 'plan', id: id, name: p.name + (extra.label || ''),
      detail: extra.detail || '', unit: p.price + (extra.surcharge || 0), term: p.term,
      period: p.term === 'yr' ? 1 : 12
    });
  }
  function totals() {
    var sub = state.cart.reduce(function (s, l) { return s + lineTotal(l); }, 0);
    var disc = state.discount && DISCOUNTS[state.discount] ? sub * DISCOUNTS[state.discount] : 0;
    var net = sub - disc;
    var tax = net * C.vatRate;
    return { sub: sub, disc: disc, net: net, tax: tax, total: net + tax };
  }
  function renderCartCount() {
    var n = state.cart.length; var el = $('#cartCount');
    el.textContent = n; el.style.display = n ? '' : 'none';
  }

  /* ---------- drawer ---------- */
  function openDrawer() {
    renderDrawer();
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawerBackdrop').hidden = false;
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
    $('#drawerBackdrop').hidden = true;
  }
  function lineHtml(l, compact) {
    var opts = periodOptions(l).map(function (o) { return '<option value="' + o.v + '"' + (o.v === l.period ? ' selected' : '') + '>' + o.t + '</option>'; }).join('');
    return '<div class="line">' +
      '<div class="line-main"><div class="line-name">' + esc(l.name) + '</div>' +
      (l.detail ? '<div class="line-detail">' + esc(l.detail) + '</div>' : '') +
      '<select class="period" data-key="' + esc(l.key) + '" aria-label="Billing period">' + opts + '</select></div>' +
      '<div class="line-side"><div class="line-price">' + price(lineTotal(l)) + '</div>' +
      (compact ? '' : '<button class="link-btn remove" data-key="' + esc(l.key) + '">Remove</button>') + '</div></div>';
  }
  function upsell() {
    var hasDomain = state.cart.some(function (l) { return l.kind === 'domain'; });
    var hasHost = state.cart.some(function (l) { return /^(host|vps|ded)-/.test(l.id || ''); });
    var hasMail = state.cart.some(function (l) { return /^(mail|add-mail)/.test(l.id || ''); });
    if (hasDomain && !hasHost) return { id: 'host-starter', text: 'Put your domain to work. Starter hosting', p: 1 };
    if (hasDomain && !hasMail) return { id: 'mail-basic', text: 'Get a matching email address', p: 1 };
    return null;
  }
  function renderDrawer() {
    var body = $('#drawerBody'), foot = $('#drawerFoot');
    if (!state.cart.length) {
      body.innerHTML = '<div class="empty"><p>Your basket is empty.</p><a class="btn btn-primary" href="#/domains">Find a domain</a></div>';
      foot.innerHTML = ''; return;
    }
    var u = upsell();
    body.innerHTML = state.cart.map(function (l) { return lineHtml(l); }).join('') +
      (u ? '<div class="upsell"><div><strong>' + u.text + '</strong><div class="muted">from ' + price(u.p) + '/mo</div></div><button class="btn btn-sm btn-outline" data-upsell="' + u.id + '">Add</button></div>' : '');
    var t = totals();
    foot.innerHTML = '<div class="row"><span>Subtotal (' + vatLabel() + ')</span><strong>' + price(t.sub) + '</strong></div>' +
      '<a href="#/checkout" class="btn btn-primary btn-block" id="toCheckout">Checkout securely</a>' +
      '<button class="link-btn btn-block" id="keepShopping">Continue shopping</button>';
  }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('?');
    var q = {}; (parts[1] || '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
    return { path: parts[0], q: q };
  }

  var views = {};

  /* ---------- shared partials ---------- */
  function domainSearchForm(value, big) {
    return '<form class="domain-search' + (big ? ' big' : '') + '" data-domain-search>' +
      '<input name="q" type="text" autocomplete="off" spellcheck="false" placeholder="Search for your perfect domain, e.g. mybusiness" value="' + esc(value || '') + '" aria-label="Domain name">' +
      '<button class="btn btn-primary" type="submit">Search</button></form>';
  }
  function planCard(p, opts) {
    opts = opts || {};
    var list = p.features ? p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('')
      : Object.keys(p.specs).map(function (k) { return '<li><span class="muted">' + k + '</span> <strong>' + esc(p.specs[k]) + '</strong></li>'; }).join('');
    var cta = opts.configure ? '<a class="btn ' + (p.popular ? 'btn-primary' : 'btn-outline') + ' btn-block" href="#/vps/configure?id=' + p.id + '">Configure</a>'
      : '<button class="btn ' + (p.popular ? 'btn-primary' : 'btn-outline') + ' btn-block" data-add="' + p.id + '">Add to basket</button>';
    return '<article class="plan' + (p.popular ? ' popular' : '') + '">' +
      (p.popular ? '<div class="badge">Most popular</div>' : '') +
      '<h3>' + esc(p.name) + '</h3>' +
      '<div class="price"><span class="amount">' + price(p.price) + '</span><span class="per">' + termLabel(p.term) + '</span></div>' +
      (p.was ? '<div class="was">was ' + price(p.was) + termLabel(p.term) + ' · ' + vatLabel() + '</div>' : '<div class="was">' + vatLabel() + '</div>') +
      '<ul class="feat">' + list + '</ul>' + cta + '</article>';
  }
  function pageHead(title, sub) {
    return '<section class="page-head"><div class="wrap"><h1>' + title + '</h1><p>' + sub + '</p></div></section>';
  }
  function trustStrip() {
    return '<section class="trust"><div class="wrap trust-grid">' +
      '<div><strong>UK data centres</strong><span class="muted">Your data stays local</span></div>' +
      '<div><strong>24/7 expert support</strong><span class="muted">Phone, chat and email</span></div>' +
      '<div><strong>99.99% uptime</strong><span class="muted">Backed by SLA</span></div>' +
      '<div><strong>30-day money back</strong><span class="muted">On hosting plans</span></div>' +
      '</div></section>';
  }

  /* ---------- views ---------- */
  views['/'] = function () {
    var pop = C.tlds.slice(0, 6).map(function (t) {
      return '<div class="tld-chip"><span class="tld">' + t.tld + '</span><span>' + price(t.first) + '</span></div>';
    }).join('');
    return '<section class="hero"><div class="wrap">' +
      '<h1>Get your business online.</h1><p class="lead">Domains, hosting and servers with checkout in under a minute.</p>' +
      domainSearchForm('', true) +
      '<div class="tld-chips">' + pop + '</div><p class="muted small">First-year prices, ' + vatLabel() + '.</p>' +
      '</div></section>' +
      '<section class="section"><div class="wrap"><h2 class="center">Everything you need, in one basket</h2>' +
      '<div class="cat-grid">' +
      catCard('Domains', 'Register or transfer from ' + price(0.99), '#/domains', 'globe') +
      catCard('Web Hosting', 'Fast SSD hosting from ' + price(1) + '/mo', '#/hosting', 'site') +
      catCard('VPS', 'NVMe virtual servers from ' + price(2) + '/mo', '#/vps', 'server') +
      catCard('Dedicated Servers', 'Bare metal from ' + price(59) + '/mo', '#/dedicated', 'rack') +
      catCard('Business Email', 'Professional mail from ' + price(1) + '/mo', '#/email', 'mail') +
      catCard('SSL Certificates', 'Secure your site from ' + price(29) + '/yr', '#/ssl', 'lock') +
      '</div></div></section>' +
      '<section class="section alt"><div class="wrap"><h2 class="center">Popular VPS plans</h2><div class="plan-grid">' +
      C.vps.slice(0, 3).map(function (p) { return planCard(p, { configure: true }); }).join('') +
      '</div></div></section>' + trustStrip();
  };
  var ICONS = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    site: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>',
    rack: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 8h14M5 14h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  };
  function catCard(t, s, href, icon) {
    return '<a class="cat" href="' + href + '"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' + ICONS[icon] + '</svg><h3>' + t + '</h3><p>' + s + '</p><span class="arrow">Shop now →</span></a>';
  }

  views['/domains'] = function (q) {
    var term = (q.q || '').toLowerCase().trim();
    var results = term ? domainResults(term) : '';
    var table = C.tlds.map(function (t) {
      return '<tr><td><strong>' + t.tld + '</strong>' + (t.tag ? ' <span class="pill' + (t.tag === 'Sale' ? ' sale' : '') + '">' + t.tag + '</span>' : '') + '</td><td>' + price(t.first) + '</td><td class="muted">' + price(t.renew) + '</td></tr>';
    }).join('');
    return pageHead('Domain names', 'Search hundreds of extensions. Free privacy, DNS and email forwarding included.') +
      '<section class="section tight"><div class="wrap">' + domainSearchForm(term) + results + '</div></section>' +
      '<section class="section alt"><div class="wrap"><h2>Domain prices</h2><div class="table-wrap"><table class="tld-table"><thead><tr><th>Extension</th><th>First year</th><th>Renewal</th></tr></thead><tbody>' + table + '</tbody></table></div><p class="muted small">Prices ' + vatLabel() + ', per year.</p></div></section>';
  };
  function normaliseDomain(term) {
    var t = term.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\s+/g, '');
    var match = null;
    C.tlds.slice().sort(function (a, b) { return b.tld.length - a.tld.length; }).some(function (x) {
      if (t.slice(-x.tld.length) === x.tld) { match = x.tld; return true; } return false;
    });
    var sld = (match ? t.slice(0, -match.length) : t.split('.')[0]).replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
    return { sld: sld, tld: match };
  }
  function isAvailable(sld, tld) {
    var taken = ['google', 'amazon', 'facebook', 'shop', 'test', 'example', 'bbc', 'apple'];
    if (taken.indexOf(sld) !== -1) return false;
    if (sld.length <= 3) return hash(sld + tld) % 5 === 0;
    return hash(sld + tld) % 4 !== 0;
  }
  function domainResults(term) {
    var d = normaliseDomain(term);
    if (!d.sld) return '<p class="error">Please enter a valid domain name (letters, numbers and hyphens).</p>';
    var order = C.tlds.slice();
    if (d.tld) order.sort(function (a, b) { return (b.tld === d.tld) - (a.tld === d.tld); });
    var primary = order[0];
    var primaryAvail = isAvailable(d.sld, primary.tld);
    var top = '<div class="result-hero ' + (primaryAvail ? 'ok' : 'no') + '">' +
      '<div><div class="result-domain">' + esc(d.sld + primary.tld) + '</div><div class="muted">' + (primaryAvail ? 'Great news, it\'s available!' : 'Sorry, this domain is taken.') + '</div></div>' +
      (primaryAvail ? '<div class="result-buy"><div class="price"><span class="amount">' + price(primary.first) + '</span><span class="per">/1st yr</span></div>' + addDomainBtn(d.sld, primary, 'btn-primary') + '</div>' : '<a class="btn btn-outline" href="#/domains">Transfer it?</a>') +
      '</div>';
    var rows = order.slice(1).map(function (t) {
      var ok = isAvailable(d.sld, t.tld);
      return '<div class="result-row' + (ok ? '' : ' taken') + '"><div><strong>' + esc(d.sld) + '</strong>' + t.tld + (t.tag ? ' <span class="pill' + (t.tag === 'Sale' ? ' sale' : '') + '">' + t.tag + '</span>' : '') + '</div>' +
        (ok ? '<div class="result-buy"><div><strong>' + price(t.first) + '</strong> <span class="muted small">then ' + price(t.renew) + '/yr</span></div>' + addDomainBtn(d.sld, t, 'btn-outline btn-sm') + '</div>' : '<span class="muted">Taken</span>') + '</div>';
    }).join('');
    return '<div class="results">' + top + '<h3 class="results-h">More extensions</h3>' + rows + '</div>';
  }
  function addDomainBtn(sld, t, cls) {
    var name = sld + t.tld;
    var inCart = state.cart.some(function (l) { return l.key === 'dom:' + name; });
    return '<button class="btn ' + cls + '" data-domain="' + esc(name) + '" data-tld="' + t.tld + '"' + (inCart ? ' disabled' : '') + '>' + (inCart ? 'In basket ✓' : 'Add') + '</button>';
  }

  views['/hosting'] = function () {
    return pageHead('Web Hosting', 'Fast, secure hosting for WordPress and websites of every size.') +
      '<section class="section"><div class="wrap"><div class="plan-grid three">' + C.hosting.map(function (p) { return planCard(p); }).join('') + '</div>' +
      '<p class="muted small center">Intro prices apply to the first term on 12 or 24-month billing.</p></div></section>' + trustStrip();
  };

  views['/vps'] = function () {
    return pageHead('VPS Servers', 'Root access, NVMe storage and unlimited traffic. Deploy in 55 seconds.') +
      '<section class="section"><div class="wrap"><div class="plan-grid four">' + C.vps.map(function (p) { return planCard(p, { configure: true }); }).join('') + '</div></div></section>' +
      '<section class="section alt"><div class="wrap feature-row">' +
      '<div><h3>Full root access</h3><p class="muted">Install anything. Your server, your rules.</p></div>' +
      '<div><h3>Snapshots & backups</h3><p class="muted">Roll back in one click.</p></div>' +
      '<div><h3>Scale on demand</h3><p class="muted">Upgrade resources without migrating.</p></div>' +
      '</div></section>';
  };

  views['/vps/configure'] = function (q) {
    var p = findProduct(q.id) || C.vps[1];
    var os = C.vpsOs.map(function (o, i) { return '<label class="opt"><input type="radio" name="os" value="' + i + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>'; }).join('');
    var loc = C.vpsLocations.map(function (o, i) { return '<label class="opt"><input type="radio" name="loc" value="' + i + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>'; }).join('');
    var plans = C.vps.map(function (v) { return '<option value="' + v.id + '"' + (v.id === p.id ? ' selected' : '') + '>' + v.name + ' · ' + v.specs.vCPU + ' vCPU / ' + v.specs.RAM + ' · ' + price(v.price) + '/mo</option>'; }).join('');
    return pageHead('Configure your VPS', 'Choose a plan, image and location. You can change these later.') +
      '<section class="section"><div class="wrap config-grid"><form id="vpsForm" class="card">' +
      '<label class="field"><span>Plan</span><select name="plan">' + plans + '</select></label>' +
      '<fieldset><legend>Operating system</legend><div class="opts">' + os + '</div></fieldset>' +
      '<fieldset><legend>Data centre</legend><div class="opts">' + loc + '</div></fieldset>' +
      '<label class="check"><input type="checkbox" name="backup"> Automated daily backups <span class="muted">+' + price(2) + '/mo</span></label>' +
      '<button class="btn btn-primary btn-block" type="submit">Add to basket</button></form>' +
      '<aside class="card summary-mini" id="vpsSummary"></aside></div></section>';
  };
  function updateVpsSummary() {
    var f = $('#vpsForm'); if (!f) return;
    var p = findProduct(f.plan.value);
    var osI = +f.querySelector('[name=os]:checked').value;
    var win = /Windows/.test(C.vpsOs[osI]);
    var total = p.price + (win ? 15 : 0) + (f.backup.checked ? 2 : 0);
    $('#vpsSummary').innerHTML = '<h3>' + p.name + '</h3><ul class="feat">' +
      Object.keys(p.specs).map(function (k) { return '<li><span class="muted">' + k + '</span> <strong>' + p.specs[k] + '</strong></li>'; }).join('') +
      '</ul><div class="row"><span>Monthly</span><strong>' + price(total) + '</strong></div><p class="muted small">' + vatLabel() + '. No setup fee.</p>';
  }

  views['/dedicated'] = function () {
    return pageHead('Dedicated Servers', 'Single-tenant hardware in UK data centres with 1 Gbps unmetered.') +
      '<section class="section"><div class="wrap"><div class="plan-grid three">' + C.dedicated.map(function (p) { return planCard(p); }).join('') + '</div></div></section>' + trustStrip();
  };
  views['/email'] = function () {
    return pageHead('Business Email', 'Look professional with email at your own domain.') +
      '<section class="section"><div class="wrap"><div class="plan-grid three">' + C.email.map(function (p) { return planCard(p); }).join('') + '</div></div></section>';
  };
  views['/ssl'] = function () {
    return pageHead('SSL Certificates', 'Encrypt traffic, earn the padlock, and build customer trust.') +
      '<section class="section"><div class="wrap"><div class="plan-grid three">' + C.ssl.map(function (p) { return planCard(p); }).join('') + '</div></div></section>';
  };
  views['/login'] = function () {
    return pageHead('Log in', 'Manage your products, invoices and DNS.') +
      '<section class="section"><div class="wrap narrow"><div class="card"><p>The customer control panel isn\'t part of this storefront demo.</p><a class="btn btn-primary" href="#/">Back to shop</a></div></div></section>';
  };

  /* ---------- checkout (one page, Shopify-style) ---------- */
  var checkoutDraft = load('kh_checkout', {});
  views['/checkout'] = function () {
    if (!state.cart.length) {
      return '<section class="section"><div class="wrap narrow center"><h1>Your basket is empty</h1><p class="muted">Add a product to check out.</p><a class="btn btn-primary" href="#/domains">Find a domain</a></div></section>';
    }
    var d = checkoutDraft;
    function v(k) { return esc(d[k] || ''); }
    return '<div class="checkout"><div class="checkout-main"><div class="checkout-inner">' +
      '<nav class="crumbs"><a href="#/" id="crumbBasket">Basket</a> › <strong>Checkout</strong> › <span class="muted">Confirmation</span></nav>' +
      '<div class="express"><div class="express-label">Express checkout</div><div class="express-btns">' +
      '<button type="button" class="xbtn xbtn-dark" data-express="Apple Pay">Apple Pay</button>' +
      '<button type="button" class="xbtn xbtn-gpay" data-express="Google Pay">G Pay</button>' +
      '<button type="button" class="xbtn xbtn-pp" data-express="PayPal">PayPal</button>' +
      '</div><div class="or"><span>OR</span></div></div>' +
      '<form id="checkoutForm" novalidate>' +
      '<section class="co-sec"><div class="co-h"><h2>Contact</h2><a href="#/login" class="small">Have an account? Log in</a></div>' +
      field('email', 'Email address', 'email', v('email'), 'email') +
      '<label class="check"><input type="checkbox" name="news"' + (d.news ? ' checked' : '') + '> Email me offers and product news</label></section>' +
      '<section class="co-sec"><h2>Billing details</h2>' +
      '<div class="seg" role="radiogroup"><label><input type="radio" name="acct" value="personal"' + (d.acct !== 'business' ? ' checked' : '') + '> Personal</label><label><input type="radio" name="acct" value="business"' + (d.acct === 'business' ? ' checked' : '') + '> Business</label></div>' +
      '<div class="grid2">' + field('first', 'First name', 'text', v('first'), 'given-name') + field('last', 'Last name', 'text', v('last'), 'family-name') + '</div>' +
      '<div class="biz"' + (d.acct === 'business' ? '' : ' hidden') + '>' + field('company', 'Company name', 'text', v('company'), 'organization', true) + field('vatno', 'VAT number (optional)', 'text', v('vatno'), 'off', true) + '</div>' +
      field('addr1', 'Address', 'text', v('addr1'), 'address-line1') +
      field('addr2', 'Apartment, suite, etc. (optional)', 'text', v('addr2'), 'address-line2', true) +
      '<div class="grid3">' + field('city', 'Town / city', 'text', v('city'), 'address-level2') + field('postcode', 'Postcode', 'text', v('postcode'), 'postal-code') +
      '<label class="field"><span>Country</span><select name="country" autocomplete="country">' + ['United Kingdom', 'Ireland', 'Germany', 'France', 'United States'].map(function (c) { return '<option' + (d.country === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' +
      field('phone', 'Phone', 'tel', v('phone'), 'tel') +
      '<p class="muted small">Required by domain registries for WHOIS contact. Privacy protection hides it from public lookups.</p></section>' +
      '<section class="co-sec"><h2>Payment</h2><p class="muted small">All transactions are secure and encrypted.</p>' +
      '<div class="pay-methods">' +
      payMethod('card', 'Credit / debit card', 'Visa · Mastercard · Amex', true) +
      payMethod('paypal', 'PayPal', 'You\'ll be redirected to PayPal') +
      payMethod('dd', 'Direct Debit', 'UK bank accounts, for monthly plans') +
      '</div>' +
      '<div class="pay-panel" id="payPanel"><div class="demo-note"><strong>Demo mode:</strong> card details are never collected by this page. Wire up a hosted payment form (e.g. Stripe Payment Element) here so card data goes straight to the payment provider. See <code>README.md</code>.</div></div></section>' +
      '<section class="co-sec"><label class="check"><input type="checkbox" name="terms" required> I agree to the Terms &amp; Conditions and understand plans auto-renew at the renewal price unless cancelled.</label><div class="err" data-err="terms"></div></section>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit" id="payBtn">Pay now</button>' +
      '<p class="muted small center">30-day money-back guarantee on hosting · Cancel anytime</p>' +
      '</form></div></div>' +
      '<aside class="checkout-side"><div class="checkout-inner" id="summary"></div></aside></div>';
  };
  function field(name, label, type, val, ac, optional) {
    return '<label class="field"><span>' + label + '</span><input name="' + name + '" type="' + type + '" value="' + val + '" autocomplete="' + ac + '"' + (optional ? '' : ' required') + '><em class="err" data-err="' + name + '"></em></label>';
  }
  function payMethod(v, t, s, checked) {
    return '<label class="pm"><input type="radio" name="pay" value="' + v + '"' + (checked ? ' checked' : '') + '><span class="pm-t">' + t + '</span><span class="pm-s muted">' + s + '</span></label>';
  }
  function renderSummary() {
    var el = $('#summary'); if (!el) return;
    var t = totals();
    el.innerHTML = '<h2 class="sr-only">Order summary</h2>' +
      '<div class="sum-lines">' + state.cart.map(function (l) { return lineHtml(l); }).join('') + '</div>' +
      '<form class="discount" id="discountForm"><input name="code" placeholder="Discount code" value="' + esc(state.discount || '') + '" aria-label="Discount code"><button class="btn btn-outline" type="submit">Apply</button></form>' +
      '<div class="err" id="discountErr"></div>' +
      '<div class="sum-rows">' +
      '<div class="row"><span>Subtotal</span><span>' + money(t.sub) + '</span></div>' +
      (t.disc ? '<div class="row good"><span>Discount (' + esc(state.discount) + ') <button class="link-btn" id="rmDiscount">remove</button></span><span>−' + money(t.disc) + '</span></div>' : '') +
      '<div class="row"><span>VAT (20%)</span><span>' + money(t.tax) + '</span></div>' +
      '<div class="row total"><span>Total due today</span><span><small>GBP</small> ' + money(t.total) + '</span></div></div>' +
      '<p class="muted small">Hint: try code <code>WELCOME10</code>.</p>';
  }
  function validate(form) {
    var ok = true;
    function setErr(n, m) { var e = form.querySelector('[data-err="' + n + '"]'); if (e) e.textContent = m || ''; var i = form.elements[n]; if (i && i.classList) i.classList.toggle('invalid', !!m); if (m) ok = false; }
    var f = form.elements;
    setErr('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value) ? '' : 'Enter a valid email address');
    ['first', 'last', 'addr1', 'city'].forEach(function (n) { setErr(n, f[n].value.trim() ? '' : 'Required'); });
    var pc = f.postcode.value.trim();
    setErr('postcode', !pc ? 'Required' : (f.country.value === 'United Kingdom' && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(pc) ? 'Enter a valid UK postcode' : ''));
    setErr('phone', f.phone.value.replace(/\D/g, '').length >= 7 ? '' : 'Enter a valid phone number');
    if (f.acct.value === 'business') setErr('company', f.company.value.trim() ? '' : 'Required for business accounts');
    else setErr('company', '');
    setErr('terms', f.terms.checked ? '' : 'Please accept the terms to continue');
    if (!ok) { var first = form.querySelector('.invalid'); if (first) first.focus(); }
    return ok;
  }
  function placeOrder(method) {
    var t = totals();
    var order = { id: 'KH-' + (100000 + Math.floor(Math.random() * 900000)), total: t.total, items: state.cart.slice(), method: method, email: checkoutDraft.email || '' };
    save('kh_last_order', order);
    state.cart = []; state.discount = null; persist();
    try { localStorage.removeItem('kh_checkout'); } catch (e) { /* ignore */ }
    checkoutDraft = {};
    location.hash = '#/confirmation';
  }
  views['/confirmation'] = function () {
    var o = load('kh_last_order', null);
    if (!o) return '<section class="section"><div class="wrap narrow center"><h1>No recent order</h1><a class="btn btn-primary" href="#/">Back to shop</a></div></section>';
    return '<section class="section"><div class="wrap narrow"><div class="card confirm">' +
      '<div class="tick">✓</div><h1>Thanks, your order is confirmed</h1>' +
      '<p class="muted">Order <strong>' + esc(o.id) + '</strong>' + (o.email ? ' · receipt sent to ' + esc(o.email) : '') + '</p>' +
      '<div class="sum-lines">' + o.items.map(function (l) { return '<div class="line"><div class="line-main"><div class="line-name">' + esc(l.name) + '</div><div class="line-detail">' + esc(periodOptions(l).filter(function (x) { return x.v === l.period; })[0].t) + '</div></div><div class="line-price">' + money(lineTotal(l)) + '</div></div>'; }).join('') + '</div>' +
      '<div class="row total"><span>Paid (inc. VAT) via ' + esc(o.method) + '</span><span>' + money(o.total) + '</span></div>' +
      '<h3>What happens next</h3><ol class="next"><li>Domains register within a few minutes.</li><li>Servers are provisioned and login details emailed to you.</li><li>Manage everything from your control panel.</li></ol>' +
      '<a class="btn btn-primary" href="#/">Continue shopping</a></div></div></section>';
  };

  /* ---------- render ---------- */
  function render() {
    var r = route();
    var view = views[r.path] || views['/'];
    document.body.classList.toggle('is-checkout', r.path === '/checkout');
    app.innerHTML = view(r.q);
    $$('.nav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + r.path); });
    if (r.path === '/checkout') renderSummary();
    if (r.path === '/vps/configure') updateVpsSummary();
    $('#nav').classList.remove('open');
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-add],[data-domain],[data-upsell],.remove,[data-express],#drawerClose,#drawerBackdrop,#keepShopping,#toCheckout,#cartBtn,#rmDiscount,#crumbBasket,#navToggle');
    if (!t) return;
    if (t.dataset.add) { addPlan(t.dataset.add); }
    else if (t.dataset.upsell) { addPlan(t.dataset.upsell); }
    else if (t.dataset.domain) {
      var tl = C.tlds.filter(function (x) { return x.tld === t.dataset.tld; })[0];
      addLine({ key: 'dom:' + t.dataset.domain, kind: 'domain', id: 'domain', name: t.dataset.domain, detail: 'Domain registration · free privacy', unit: tl.first, renew: tl.renew, term: 'yr', period: 1 });
      t.disabled = true; t.textContent = 'In basket ✓';
    }
    else if (t.classList.contains('remove')) { removeLine(t.dataset.key); }
    else if (t.dataset.express) {
      if (!state.cart.length) return;
      toast('Demo: ' + t.dataset.express + ' sheet would open here');
      setTimeout(function () { placeOrder(t.dataset.express); }, 900);
    }
    else if (t.id === 'cartBtn' || t.id === 'crumbBasket') { e.preventDefault(); openDrawer(); }
    else if (t.id === 'navToggle') { var n = $('#nav'); n.classList.toggle('open'); t.setAttribute('aria-expanded', n.classList.contains('open')); }
    else if (t.id === 'rmDiscount') { e.preventDefault(); state.discount = null; persist(); renderSummary(); }
    else { closeDrawer(); }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList.contains('period')) { setPeriod(t.dataset.key, t.value); }
    if (t.id === 'vatToggle') { state.incVat = t.checked; save('kh_incvat', state.incVat); render(); if ($('#drawer').classList.contains('open')) renderDrawer(); }
    if (t.closest('#vpsForm')) updateVpsSummary();
    if (t.name === 'acct') { $('.biz').hidden = t.value !== 'business'; }
    if (t.name === 'pay') {
      var msgs = {
        card: '<div class="demo-note"><strong>Demo mode:</strong> card details are never collected by this page. Wire up a hosted payment form (e.g. Stripe Payment Element) here so card data goes straight to the payment provider. See <code>README.md</code>.</div>',
        paypal: '<div class="demo-note">After clicking <strong>Pay now</strong> you\'d be redirected to PayPal to complete your purchase.</div>',
        dd: '<div class="demo-note">Direct Debit mandate set-up would be handled by your provider (e.g. GoCardless) after you click <strong>Pay now</strong>.</div>'
      };
      $('#payPanel').innerHTML = msgs[t.value];
    }
  });

  document.addEventListener('input', function (e) {
    var f = e.target.form;
    if (f && f.id === 'checkoutForm' && e.target.name && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
      checkoutDraft[e.target.name] = e.target.value; save('kh_checkout', checkoutDraft);
    }
    if (f && f.id === 'checkoutForm' && e.target.classList.contains('invalid')) {
      e.target.classList.remove('invalid');
      var er = f.querySelector('[data-err="' + e.target.name + '"]'); if (er) er.textContent = '';
    }
    if (f && f.id === 'checkoutForm' && e.target.name === 'terms' && e.target.checked) {
      var te = f.querySelector('[data-err="terms"]'); if (te) te.textContent = '';
    }
  });
  document.addEventListener('change', function (e) {
    var f = e.target.form;
    if (f && f.id === 'checkoutForm' && e.target.name && e.target.name !== 'terms' && e.target.name !== 'pay') {
      checkoutDraft[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; save('kh_checkout', checkoutDraft);
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.hasAttribute('data-domain-search')) {
      e.preventDefault();
      var q = f.q.value.trim();
      location.hash = '#/domains' + (q ? '?q=' + encodeURIComponent(q) : '');
      if (route().path === '/domains') render();
    } else if (f.id === 'vpsForm') {
      e.preventDefault();
      var osI = +f.querySelector('[name=os]:checked').value, locI = +f.querySelector('[name=loc]:checked').value;
      var win = /Windows/.test(C.vpsOs[osI]);
      addPlan(f.plan.value, { suffix: ':' + osI + ':' + locI, detail: C.vpsOs[osI].replace(/ \(.*\)/, '') + ' · ' + C.vpsLocations[locI], surcharge: win ? 15 : 0 });
      if (f.backup.checked) addPlan('add-backup');
    } else if (f.id === 'discountForm') {
      e.preventDefault();
      var code = f.code.value.trim().toUpperCase();
      if (DISCOUNTS[code]) { state.discount = code; persist(); renderSummary(); toast('Discount applied'); }
      else { $('#discountErr').textContent = code ? 'That code isn\'t valid' : ''; }
    } else if (f.id === 'checkoutForm') {
      e.preventDefault();
      if (!validate(f)) return;
      var btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Processing…';
      var method = ({ card: 'card', paypal: 'PayPal', dd: 'Direct Debit' })[f.pay.value];
      setTimeout(function () { placeOrder(method); }, 1000);
    }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('hashchange', render);

  $('#vatToggle').checked = state.incVat;
  $('#year').textContent = new Date().getFullYear();
  renderCartCount();
  render();
})();
