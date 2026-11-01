/* Platform website core: api, session, mega menu, router, helpers. No dependencies. */
(() => {
  'use strict';
  const ADSENSE_CLIENT = ''; // e.g. 'ca-pub-XXXXXXXXXXXXXXXX'
  const ADSENSE_SLOT = '';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = {
    money: (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(2)}`),
    usd: (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })),
    num: (v, d = 8) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d })),
    pct: (v) => (v === null || v === undefined ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%</span>`),
    mb: (m) => (m >= 1024 ? `${m / 1024} GB` : `${m} MB`),
    bytes: (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`; },
    left: (iso) => {
      const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'expired';
      const h = Math.floor(ms / 3600e3), d = Math.floor(h / 24), m = Math.floor((ms % 3600e3) / 60e3);
      return d >= 2 ? `${d} days` : h ? `${h}h ${m}m` : `${m}m`;
    },
    uptime: (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; },
    date: (s) => new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z').toLocaleString(),
  };

  // ---------- session & api ----------
  const S = {
    token: localStorage.getItem('tb_token'),
    user: JSON.parse(localStorage.getItem('tb_user') || 'null'),
    site: null,
    prices: {},
  };
  /** api(method, path, body, { headers, raw }) – throws Error with .status, .code and .data on failure. */
  async function api(method, path, body, opts = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch('/api' + path, {
      method,
      headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(S.token ? { authorization: `Bearer ${S.token}` } : {}), ...(opts.headers || {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    if (opts.raw) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && data.code !== 'STEP_UP_REQUIRED' && data.code !== 'TWO_FACTOR_REQUIRED') logout(false);
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.code = data.code; e.data = data.data; throw e; }
    return data;
  }
  function setSession(t, u) { S.token = t; S.user = u; localStorage.setItem('tb_token', t); localStorage.setItem('tb_user', JSON.stringify(u)); renderHeader(); }
  function logout(redirect = true) {
    S.token = null; S.user = null; localStorage.removeItem('tb_token'); localStorage.removeItem('tb_user');
    renderHeader(); if (redirect) location.hash = '#/';
  }

  let toastTimer;
  function toast(msg, err = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3500);
  }
  async function busy(btn, fn) {
    const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try { await fn(); } catch (e) { toast(e.message, true); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }
  function modal(html, onMount) {
    const m = $('#modal');
    m.innerHTML = `<div class="card">${html}</div>`; m.hidden = false;
    const close = () => { m.hidden = true; m.innerHTML = ''; };
    m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); };
    onMount?.(m, close);
    return close;
  }
  function adSlot() {
    if (!ADSENSE_CLIENT) return '<div class="ad-slot">Advertisement</div>';
    setTimeout(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {} }, 0);
    return `<ins class="adsbygoogle" style="display:block;margin:24px 0" data-ad-client="${ADSENSE_CLIENT}" data-ad-slot="${ADSENSE_SLOT}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  }
  function sparkline(values, { w = 600, h = 160 } = {}) {
    if (!values || values.length < 2) return '<p class="muted">Collecting price data…</p>';
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 8 - ((v - min) / span) * (h - 16)}`).join(' ');
    const up = values[values.length - 1] >= values[0];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="price chart"><polyline fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="2" points="${pts}"/></svg>`;
  }

  // ---------- mega menu ----------
  const SECTIONS = [
    { id: 'cloud', label: 'Cloud', order: 10, match: /^(cloud|dashboard|server|order|vpn)/, cols: [
      { h: 'Compute', links: [['#/cloud', 'Tiny containers', 'Free with ads, from $1.99'], ['#/cloud?tab=vm', 'Cloud VMs', 'Dedicated vCPU & RAM'], ['#/cloud?tab=all', 'All pricing', 'Compare every plan']] },
      { h: 'Manage', links: [['#/dashboard', 'My servers', 'Start, stop, renew, upgrade'], ['#/vpn', 'Private network', 'WireGuard VPN to your servers'], ['#/dashboard', 'Custom domains', 'Point your domain at a server']] },
      { h: 'White-label', links: [['#/cloud', 'Your brand only', 'SSH, web & IPs under our name'], ['#/terms', 'Fair use', 'What you can run']] },
    ], feature: () => '<h3>Free Linux server</h3><p class="muted">Root shell in seconds. Keep it alive by watching a short ad in our app.</p><a class="btn primary small" href="#/cloud">Launch free</a>' },
    { id: 'exchange', label: 'Exchange', order: 20, match: /^(markets|trade|wallet)/, cols: [
      { h: 'Spot markets', links: [['#/trade/BTC_USDT', 'BTC / USDT', 'Bitcoin'], ['#/trade/ETH_USDT', 'ETH / USDT', 'Ethereum'], ['#/markets', 'All markets', 'Prices & 24h volume']] },
      { h: 'Wallet', links: [['#/wallet', 'Balances', 'One wallet for everything'], ['#/wallet?tab=deposit', 'Deposit', 'Crypto deposit addresses'], ['#/wallet?tab=withdraw', 'Withdraw', 'Send to an external wallet']] },
      { h: 'Account', links: [['#/wallet?tab=history', 'History', 'Every movement, every product'], ['#/fees', 'Fees', 'Maker 0% · taker 0.1%']] },
    ], feature: () => `<h3>Live prices</h3>${['BTC', 'ETH', 'SOL'].map((s) => `<div class="row" style="justify-content:space-between"><b>${s}</b><span class="mono">$${fmt.usd(S.prices[s])}</span></div>`).join('')}` },
    { id: 'derivatives', label: 'Derivatives', order: 30, match: /^(futures|options)/, cols: [
      { h: 'Perpetual futures', links: [['#/futures/BTC', 'BTC-PERP', 'Up to 20x leverage'], ['#/futures/ETH', 'ETH-PERP', 'USDT-margined'], ['#/futures/SOL', 'SOL-PERP', 'Isolated margin']] },
      { h: 'Options', links: [['#/options/BTC', 'BTC options', 'Daily & weekly expiries'], ['#/options/ETH', 'ETH options', 'Calls and puts'], ['#/options/SOL', 'SOL options', 'Cash-settled in USDT']] },
      { h: 'Positions', links: [['#/futures/BTC?tab=positions', 'Futures positions', 'P&L and liquidation prices'], ['#/options/BTC?tab=positions', 'Options positions', 'Value and expiry']] },
    ], feature: () => '<h3>Risk warning</h3><p class="muted">Leveraged products can lose all of your margin quickly. Only trade what you can afford to lose.</p>' },
    { id: 'cards', label: 'Cards', order: 40, match: /^cards/, cols: [], feature: () => '<h3>Vaulted trading cards</h3><p class="muted">Ship cards to our vault, trade them instantly, ship out any time.</p><a class="btn small" href="#/cards/collection">My collection</a>' },
  ];
  // Registries that plugin modules extend (see docs/EXTENDING.md)
  const registries = {
    sections: SECTIONS,
    adminTabs: [],
    accountPanels: [],
    headerWidgets: [],
    homeTiles: [
      { href: '#/cloud', icon: '▣', title: 'Cloud', text: 'Tiny containers free with ads, full VMs from $9/mo. Private VPN and custom domains.', order: 10 },
      { href: '#/markets', icon: '⇄', title: 'Exchange', text: 'Spot BTC, ETH and SOL against USDT. Deposit and withdraw on-chain.', order: 20 },
      { href: '#/futures/BTC', icon: '↗', title: 'Derivatives', text: 'USDT-margined perpetuals up to 20x, and daily/weekly options.', order: 30 },
      { href: '#/cards', icon: '🂠', title: 'Cards', text: 'Sealed boxes, packs and graded singles, grouped by game and series.', order: 40 },
    ],
  };
  const byOrder = (a, b) => (a.order ?? 100) - (b.order ?? 100);
  function registerSection(sec) { const i = SECTIONS.findIndex((s) => s.id === sec.id); if (i >= 0) SECTIONS[i] = { ...SECTIONS[i], ...sec }; else SECTIONS.push(sec); SECTIONS.sort(byOrder); }
  function addMenuColumn(sectionId, col) { const sec = SECTIONS.find((s) => s.id === sectionId); if (!sec) return; (sec.cols ||= []).push(col); sec.cols.sort(byOrder); }
  function addMenuLink(sectionId, heading, link) {
    const sec = SECTIONS.find((s) => s.id === sectionId); if (!sec) return;
    let col = (sec.cols ||= []).find((c) => c.h === heading); if (!col) { col = { h: heading, links: [] }; sec.cols.push(col); }
    col.links.push(link);
  }
  function registerAdminTab(tab) { const i = registries.adminTabs.findIndex((t) => t.id === tab.id); if (i >= 0) registries.adminTabs[i] = tab; else registries.adminTabs.push(tab); registries.adminTabs.sort(byOrder); }
  function registerAccountPanel(p) { registries.accountPanels.push(p); registries.accountPanels.sort(byOrder); }
  function registerHeaderWidget(w) { registries.headerWidgets.push(w); registries.headerWidgets.sort(byOrder); }
  function registerHomeTile(t) { registries.homeTiles.push(t); registries.homeTiles.sort(byOrder); }

  let cardCatalog = null;
  async function cardsCols() {
    try { cardCatalog ||= (await api('GET', '/cards/catalog')).games; } catch { cardCatalog = []; }
    return [
      ...cardCatalog.slice(0, 2).map((g) => ({ h: g.name, links: g.series.map((s) => [`#/cards/series/${s.id}`, s.name, `${s.code} · packs, boxes & singles`]) })),
      { h: 'My cards', links: [['#/cards/collection', 'Collection', 'Holdings & value'], ['#/cards/collection?tab=orders', 'Open orders', 'Bids and asks'], ['#/cards/collection?tab=vault', 'Ship in / out', 'Vault & pack breaks']] },
    ];
  }

  let openSection = null, hoverTimer;
  async function showMega(id) {
    const sec = SECTIONS.find((s) => s.id === id);
    const panel = $('#megaPanel');
    if (!sec) { panel.classList.remove('open'); openSection = null; $$('#mega button').forEach((b) => b.setAttribute('aria-expanded', 'false')); return; }
    openSection = id;
    $$('#mega button').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.sec === id)));
    const cols = id === 'cards' ? [...(await cardsCols()), ...(sec.cols || [])] : (sec.cols || []);
    if (openSection !== id) return;
    panel.innerHTML = `<div class="mega-inner">${cols.map((c) => `<div class="mega-col"><h4>${esc(c.h)}</h4>${c.links.map(([h, t, d]) => `<a href="${h}">${esc(t)}<small>${esc(d)}</small></a>`).join('')}</div>`).join('')}${cols.length < 3 ? '<div></div>'.repeat(3 - cols.length) : ''}<div class="mega-feature">${sec.feature()}</div></div>`;
    panel.classList.add('open');
  }
  function renderHeader() {
    const route = (location.hash.slice(2) || '').split('?')[0];
    $('#mega').innerHTML = SECTIONS.map((s) => `<button data-sec="${s.id}" aria-expanded="false" aria-haspopup="true" class="${s.match.test(route) ? 'cur' : ''}">${s.label} ▾</button>`).join('');
    $$('#mega button').forEach((b) => {
      b.onclick = () => showMega(openSection === b.dataset.sec ? null : b.dataset.sec);
      b.onmouseenter = () => { clearTimeout(hoverTimer); if (matchMedia('(min-width: 901px)').matches) hoverTimer = setTimeout(() => showMega(b.dataset.sec), 120); };
    });
    const u = S.user;
    const widgets = u ? registries.headerWidgets.map((w) => `<span class="hw" data-hw="${esc(w.id)}">${w.render ? w.render() : ''}</span>`).join('') : '';
    $('#right').innerHTML = u
      ? `<a href="#/wallet" class="chip" id="walletChip">Wallet</a>${widgets}<a href="#/dashboard">Servers</a><a href="#/account">Account</a>${u.is_admin ? '<a href="#/admin">Admin</a>' : ''}<button id="logout">Log out</button>`
      : '<a href="#/login">Log in</a><a class="btn small primary" href="#/register">Sign up</a>';
    const lo = $('#logout'); if (lo) lo.onclick = () => logout();
    if (u) { refreshWalletChip(); for (const w of registries.headerWidgets) { try { w.mount?.($(`[data-hw="${w.id}"]`)); } catch (e) { console.error(e); } } }
  }
  async function refreshWalletChip() {
    try {
      const w = await api('GET', '/wallet');
      const usdt = w.balances.find((b) => b.asset === 'USDT');
      const chip = $('#walletChip'); if (chip) chip.textContent = `Wallet · ${fmt.usd(usdt?.balance || 0)} USDT`;
    } catch {}
  }

  async function refreshTicker() {
    try {
      const p = await api('GET', '/prices');
      const prev = { ...S.prices }; S.prices = p.prices; S.spark = p.spark;
      $('#ticker').innerHTML = Object.entries(p.prices).map(([k, v]) => {
        const sp = p.spark[k] || []; const ch = sp.length > 1 ? ((v - sp[0]) / sp[0]) * 100 : 0;
        return `<a href="#/futures/${k}" style="color:inherit">${k}/USD <b class="${prev[k] && v < prev[k] ? 'down' : prev[k] && v > prev[k] ? 'up' : ''}">${fmt.usd(v)}</b> ${fmt.pct(ch)}</a>`;
      }).join('') + (p.source === 'mock' ? '<span class="muted">· demo prices</span>' : '');
    } catch {}
  }

  // ---------- router ----------
  const routes = [];
  const timers = new Set();
  function route(pattern, fn) { routes.push([pattern, fn]); }
  function every(ms, fn) { const t = setInterval(fn, ms); timers.add(t); return t; }
  function query() { return new URLSearchParams(location.hash.split('?')[1] || ''); }
  const needAuth = (fn) => async (...a) => { if (!S.user) { sessionStorage.setItem('tb_after_login', location.hash); location.hash = '#/login'; return; } return fn(...a); };

  async function render() {
    for (const t of timers) clearInterval(t); timers.clear();
    showMega(null);
    $('#top').classList.remove('open');
    const path = (location.hash.slice(1) || '/').split('?')[0];
    renderHeader();
    const view = $('#view');
    for (const [re, fn] of routes) {
      const m = re.exec(path);
      if (m) {
        try { await fn(view, ...m.slice(1).map(decodeURIComponent)); } catch (e) { view.innerHTML = `<div class="card"><h2>Oops</h2><p class="muted">${esc(e.message)}</p></div>`; }
        window.scrollTo(0, 0);
        return;
      }
    }
    view.innerHTML = '<div class="card"><h2>Page not found</h2><a href="#/">Home</a></div>';
  }

  // ---------- shared pages ----------
  route(/^\/$/, async (view) => {
    view.innerHTML = `
      <section class="hero">
        <h1>Cloud, crypto &amp; collectibles.<br><span class="grad">One account. One wallet.</span></h1>
        <p>Launch Linux servers, trade spot crypto, futures and options, and buy and sell vaulted trading cards – all paid from the same balance.</p>
        <div class="row" style="justify-content:center"><a class="btn primary" href="#/${S.user ? 'wallet' : 'register'}">${S.user ? 'Open wallet' : 'Create free account'}</a><a class="btn" href="#/markets">View markets</a></div>
      </section>
      <section class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
        ${registries.homeTiles.map((t) => `<a class="card tile" href="${esc(t.href)}"><div class="ic">${t.icon || ''}</div><h3>${esc(t.title)}</h3><p class="muted">${esc(t.text)}</p></a>`).join('')}
      </section>`;
  });

  route(/^\/terms$/, async (view) => {
    view.innerHTML = `<div class="card" style="max-width:820px"><h1>Terms, fair use &amp; risk</h1>
      <h3>Cloud</h3><p>Servers are provided as-is. Free servers are deleted at expiry with their data; paid servers are stopped at expiry and deleted 7 days later unless renewed. No mining, spam, scanning, attacks, abuse proxies or illegal content.</p>
      <h3>Exchange &amp; derivatives</h3><p>Crypto prices are volatile. Futures use leverage and positions are liquidated automatically when losses reach the margin. Options can expire worthless. Derivatives may not be available in your country; you are responsible for complying with local law.</p>
      <h3>Cards</h3><p>Items are held in our vault on your behalf. Condition and authenticity are checked on arrival; items that fail checks are returned. Shipping and break requests are handled by staff.</p></div>`;
  });
  route(/^\/fees$/, async (view) => {
    view.innerHTML = `<div class="card" style="max-width:720px"><h1>Fees</h1><table class="t">
      <tr><td>Spot</td><td>Maker 0% · Taker 0.10%</td></tr>
      <tr><td>Perpetual futures</td><td>0.05% of notional on open and close</td></tr>
      <tr><td>Options</td><td>0.03% of underlying notional (max 12.5% of premium)</td></tr>
      <tr><td>Card exchange</td><td>Maker 0% · Taker 3%</td></tr>
      <tr><td>Withdrawals</td><td>Network fee shown in the withdraw form</td></tr>
      <tr><td>Cloud</td><td>Plan price only – pay by card or from your wallet</td></tr></table></div>`;
  });

  function loadScript(src) {
    return new Promise((resolve) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => { console.error('failed to load module', src); resolve(); }; document.head.appendChild(el); });
  }
  function applyBranding(site) {
    if (!site) return;
    $$('.brand-name').forEach((el) => (el.textContent = site.brand));
    document.title = site.brand;
    if (site.branding) {
      const b = site.branding;
      for (const [k, v] of Object.entries(b.colors || {})) document.documentElement.style.setProperty(`--${k}`, v);
      if (b.logo_url) $('.logo .cube').outerHTML = `<img src="${esc(b.logo_url)}" alt="" style="height:22px;vertical-align:middle">`;
    }
  }

  async function start() {
    $('#year').textContent = new Date().getFullYear();
    $('#burger').onclick = () => { const t = $('#top'); t.classList.toggle('open'); $('#burger').setAttribute('aria-expanded', t.classList.contains('open')); };
    $('#megaPanel').onmouseleave = () => { if (matchMedia('(min-width: 901px)').matches) showMega(null); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { showMega(null); $('#modal').hidden = true; } });
    document.addEventListener('click', (e) => { if (openSection && !e.target.closest('#megaPanel') && !e.target.closest('#mega')) showMega(null); });
    window.addEventListener('hashchange', render);
    try { S.site = await api('GET', '/site'); applyBranding(S.site); } catch {}
    // Plugin front-end modules (declared by backend plugins) load before the first render.
    for (const m of S.site?.modules || []) await loadScript(m.startsWith('/') ? m : '/' + m);
    refreshTicker(); setInterval(refreshTicker, 3000);
    render();
  }

  window.App = {
    $, $$, esc, fmt, api, S, toast, busy, modal, adSlot, sparkline, route, every, query, needAuth, setSession, logout, refreshWalletChip, render, start,
    registries, registerSection, addMenuColumn, addMenuLink, registerAdminTab, registerAccountPanel, registerHeaderWidget, registerHomeTile, applyBranding,
  };
})();
