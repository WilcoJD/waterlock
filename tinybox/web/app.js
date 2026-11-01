/* TinyBox website – tiny dependency-free SPA talking to /api */
(() => {
  'use strict';
  const ADSENSE_CLIENT = ''; // e.g. 'ca-pub-XXXXXXXXXXXXXXXX'
  const ADSENSE_SLOT = '';   // e.g. '1234567890'

  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(2)}`);
  const mb = (m) => (m >= 1024 ? `${m / 1024} GB` : `${m} MB`);
  const bytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`; };
  const left = (iso) => {
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3600e3), d = Math.floor(h / 24), m = Math.floor((ms % 3600e3) / 60e3);
    return d >= 2 ? `${d} days` : h ? `${h}h ${m}m` : `${m}m`;
  };
  const uptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

  // ---------- state & api ----------
  let token = localStorage.getItem('tb_token');
  let user = JSON.parse(localStorage.getItem('tb_user') || 'null');
  let plansCache = null;
  let pollTimer = null;

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { logout(false); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const plans = async () => (plansCache ||= await api('GET', '/shop/plans'));

  function setSession(t, u) {
    token = t; user = u;
    localStorage.setItem('tb_token', t); localStorage.setItem('tb_user', JSON.stringify(u));
  }
  function logout(redirect = true) {
    token = null; user = null;
    localStorage.removeItem('tb_token'); localStorage.removeItem('tb_user');
    if (redirect) location.hash = '#/';
    renderNav();
  }

  let toastTimer;
  function toast(msg, err = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3500);
  }

  // Wrap a button handler with a spinner + error toast.
  async function busy(btn, fn) {
    const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try { await fn(); } catch (e) { toast(e.message, true); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }

  function adSlot() {
    if (!ADSENSE_CLIENT) return '<div class="ad-slot">Advertisement · free tier is supported by ads</div>';
    setTimeout(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {} }, 0);
    return `<ins class="adsbygoogle" style="display:block;margin:24px 0" data-ad-client="${ADSENSE_CLIENT}" data-ad-slot="${ADSENSE_SLOT}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  }

  // ---------- nav ----------
  function renderNav() {
    const r = location.hash.split('?')[0] || '#/';
    const link = (h, t) => `<a href="${h}" class="${r === h ? 'active' : ''}">${t}</a>`;
    $('#nav').innerHTML = user
      ? link('#/dashboard', 'My servers') + link('#/pricing', 'Shop') + link('#/account', 'Account') + (user.is_admin ? link('#/admin', 'Admin') : '') + '<button id="logout">Log out</button>'
      : link('#/pricing', 'Pricing') + link('#/login', 'Log in') + '<a class="btn small primary" href="#/register">Get a free server</a>';
    const lo = $('#logout'); if (lo) lo.onclick = () => logout();
  }

  // ---------- pages ----------
  const pages = {};

  pages['/'] = async () => {
    const { plans: ps, free } = await plans();
    const f = ps.find((p) => p.is_free);
    view.innerHTML = `
      <section class="hero">
        <h1>Tiny Linux servers.<br><span class="grad">Free in seconds.</span></h1>
        <p>Get a real root shell on a lightweight Alpine container. Keep it alive for free by watching a quick ad in our app – or grab a faster box from the shop.</p>
        <div class="row" style="justify-content:center">
          <a class="btn primary" href="#/${user ? 'dashboard' : 'register'}">Launch a free server</a>
          <a class="btn" href="#/pricing">See plans</a>
        </div>
        <div class="terminal">
          <div><span class="p">$</span> ssh root@your-box -p 20017</div>
          <div>Welcome to Alpine Linux!</div>
          <div><span class="p">box-3fa9:~#</span> apk add python3 &amp;&amp; python3 -m http.server</div>
        </div>
      </section>
      <section class="features grid">
        <div class="card"><h3>⚡ Instant</h3><p>Containers boot in a few seconds on our Proxmox cluster.</p></div>
        <div class="card"><h3>🎁 Free tier</h3><p>${f.cores} vCPU share, ${mb(f.memory_mb)} RAM, ${f.disk_gb} GB disk. ${free.hoursInitial}h to start, +${free.hoursPerAd}h per rewarded ad.</p></div>
        <div class="card"><h3>🔑 Full root</h3><p>SSH in with a password or your own key. Install anything (within the fair-use rules).</p></div>
        <div class="card"><h3>📱 Mobile app</h3><p>Start, stop and extend your servers from your phone.</p></div>
      </section>`;
  };

  pages['/pricing'] = async () => {
    const { plans: ps, free } = await plans();
    view.innerHTML = `
      <h1>Plans</h1>
      <p class="muted">Paid plans run for 30 days, never expire early, and you can renew or upgrade any time.</p>
      <div class="grid" style="margin-top:24px">${ps.map((p) => `
        <div class="card ${p.id === 'micro' ? 'hl' : ''}">
          <h3>${esc(p.name)} ${p.is_free ? '<span class="badge free">ad-supported</span>' : ''}${p.id === 'micro' ? ' <span class="badge active">popular</span>' : ''}</h3>
          <div class="price">${money(p.price_cents)}${p.is_free ? '' : '<small> / 30 days</small>'}</div>
          <ul class="specs">
            <li><b>${p.cores}</b> vCPU ${p.cpulimit < p.cores ? `(${Math.round(p.cpulimit * 100)}% cap)` : ''}</li>
            <li><b>${mb(p.memory_mb)}</b> RAM + ${mb(p.swap_mb)} swap</li>
            <li><b>${p.disk_gb} GB</b> SSD</li>
            <li><b>${p.net_rate_mbps} Mbit/s</b> network</li>
            ${p.is_free ? `<li>${free.hoursInitial}h, +${free.hoursPerAd}h per ad (max ${free.maxHoursAhead}h)</li>` : '<li>No ads</li>'}
          </ul>
          ${p.is_free
            ? `<a class="btn primary" href="#/${user ? 'dashboard' : 'register'}">Get it free</a>`
            : `<button class="btn ${p.id === 'micro' ? 'blue' : ''}" data-buy="${esc(p.id)}">Buy ${esc(p.name)}</button>`}
        </div>`).join('')}
      </div>
      <div id="buyform"></div>`;
    view.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
      if (!user) { sessionStorage.setItem('tb_after_login', '#/pricing'); location.hash = '#/login'; return; }
      const p = ps.find((x) => x.id === b.dataset.buy);
      $('#buyform').innerHTML = `
        <div class="card" style="margin-top:24px;max-width:520px">
          <h2>New ${esc(p.name)} server – ${money(p.price_cents)}</h2>
          <label>Hostname (optional)</label><input id="hn" placeholder="my-server" maxlength="32" />
          <label>SSH public key (optional)</label><textarea id="key" placeholder="ssh-ed25519 AAAA... you@laptop"></textarea>
          <div class="row" style="margin-top:16px"><button class="btn primary" id="pay">Continue to payment</button></div>
        </div>`;
      $('#pay').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('POST', '/shop/checkout', { plan_id: p.id, kind: 'new', hostname: $('#hn').value.trim() || undefined, ssh_key: $('#key').value.trim() || undefined });
        location.href = r.url;
      });
      $('#buyform').scrollIntoView({ behavior: 'smooth' });
    }));
  };

  function authPage(mode) {
    return async () => {
      if (user) { location.hash = '#/dashboard'; return; }
      const reg = mode === 'register';
      view.innerHTML = `
        <form class="auth card">
          <h2>${reg ? 'Create your account' : 'Welcome back'}</h2>
          <label>Email</label><input name="email" type="email" autocomplete="email" required />
          <label>Password</label><input name="password" type="password" minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}" required />
          <div class="row" style="margin-top:18px"><button class="btn primary" type="submit">${reg ? 'Sign up' : 'Log in'}</button></div>
          <p class="muted">${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
        </form>`;
      const form = view.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        busy(form.querySelector('button'), async () => {
          const r = await api('POST', `/auth/${mode}`, { email: form.email.value, password: form.password.value });
          setSession(r.token, r.user);
          const next = sessionStorage.getItem('tb_after_login'); sessionStorage.removeItem('tb_after_login');
          location.hash = next || '#/dashboard';
        });
      };
    };
  }
  pages['/login'] = authPage('login');
  pages['/register'] = authPage('register');

  const needAuth = (fn) => async (...a) => { if (!user) { location.hash = '#/login'; return; } return fn(...a); };

  pages['/dashboard'] = needAuth(async () => {
    const [{ servers }, ads] = await Promise.all([api('GET', '/servers'), api('GET', '/ads/status')]);
    const hasFree = servers.some((s) => s.is_free);
    const hasPaid = servers.some((s) => !s.is_free);
    view.innerHTML = `
      <div class="row" style="justify-content:space-between"><h1 style="margin:0">My servers</h1>
        <div class="row">${hasFree ? '' : '<button class="btn primary" id="newfree">+ Free server</button>'}<a class="btn" href="#/pricing">Buy a server</a></div></div>
      <div id="newfreeform"></div>
      <div style="margin-top:20px;display:grid;gap:12px">
        ${servers.length ? servers.map(serverCard).join('') : '<div class="card muted">No servers yet. Launch a free one – it takes a few seconds.</div>'}
      </div>
      ${hasFree ? `<p class="muted" style="margin-top:16px">Rewarded ads today: ${ads.ads_today}/${ads.max_per_day}. Watch ads in the <b>mobile app</b> to add ${ads.hours_per_ad}h each (max ${ads.max_hours_ahead}h ahead).</p>` : ''}
      ${hasPaid ? '' : adSlot()}`;
    const nf = $('#newfree');
    if (nf) nf.onclick = () => {
      $('#newfreeform').innerHTML = `
        <div class="card" style="margin-top:16px;max-width:520px">
          <h3>Launch a free server</h3>
          <label>Hostname (optional)</label><input id="hn" placeholder="my-box" maxlength="32" />
          <label>SSH public key (optional)</label><textarea id="key" placeholder="ssh-ed25519 AAAA..."></textarea>
          <div class="row" style="margin-top:14px"><button class="btn primary" id="go">Launch</button></div>
        </div>`;
      $('#go').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('POST', '/servers/free', { hostname: $('#hn').value.trim() || undefined, ssh_key: $('#key').value.trim() || undefined });
        sessionStorage.setItem(`tb_pw_${r.server.id}`, r.root_password);
        location.hash = `#/server/${r.server.id}`;
      });
    };
    if (servers.some((s) => s.state === 'provisioning')) pollTimer = setTimeout(route, 2000);
  });

  function serverCard(s) {
    return `<div class="card server">
      <div>
        <h3><a href="#/server/${s.id}">${esc(s.hostname)}</a> <span class="badge ${esc(s.state)}">${esc(s.state)}</span> ${s.is_free ? '<span class="badge free">free</span>' : ''}</h3>
        <div class="muted">${esc(s.plan.name)} · ${s.plan.cores} vCPU · ${mb(s.plan.memory_mb)} · ${s.plan.disk_gb} GB</div>
        ${s.ssh ? `<div class="mono muted" style="margin-top:4px">${esc(s.ssh.command)}</div>` : ''}
      </div>
      <div style="text-align:right"><div class="muted">${s.state === 'suspended' ? 'suspended – renew to restore' : 'expires in'}</div><b>${left(s.expires_at)}</b></div>
    </div>`;
  }

  pages['/server'] = needAuth(async (id) => {
    const { server: s, live } = await api('GET', `/servers/${id}`);
    const ads = s.is_free ? await api('GET', '/ads/status') : null;
    const pw = sessionStorage.getItem(`tb_pw_${s.id}`);
    const { plans: ps } = await plans();
    const current = ps.find((p) => p.id === s.plan.id);
    const upgrades = ps.filter((p) => p.price_cents > current.price_cents);
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    view.innerHTML = `
      <p><a href="#/dashboard">← My servers</a></p>
      <div class="row" style="justify-content:space-between">
        <h1 style="margin:0">${esc(s.hostname)} <span class="badge ${esc(live?.status || s.state)}">${esc(live?.status || s.state)}</span></h1>
        <div class="row" id="power">
          ${s.state === 'active' ? `
            <button class="btn small" data-act="start" ${live?.status === 'running' ? 'disabled' : ''}>Start</button>
            <button class="btn small" data-act="reboot" ${live?.status !== 'running' ? 'disabled' : ''}>Reboot</button>
            <button class="btn small" data-act="stop" ${live?.status !== 'running' ? 'disabled' : ''}>Stop</button>` : ''}
          <button class="btn small danger" id="del">Delete</button>
        </div>
      </div>
      ${pw ? `<div class="notice warn" style="margin-top:16px"><b>Root password – save it now, it won't be shown again:</b><br><code class="secret">${esc(pw)}</code><br><button class="btn small" id="pwok">I saved it</button></div>` : ''}
      ${s.state === 'provisioning' ? '<div class="notice" style="margin-top:16px"><span class="spinner"></span> Creating your container… this usually takes under a minute.</div>' : ''}
      ${s.state === 'error' ? `<div class="notice warn" style="margin-top:16px">${esc(s.error)}</div>` : ''}
      ${s.state === 'suspended' ? '<div class="notice warn" style="margin-top:16px">This server expired and is stopped. Renew within 7 days to keep your data.</div>' : ''}
      <div class="grid" style="margin-top:20px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="card">
          <h3>Connect</h3>
          <dl class="kv">
            <dt>SSH</dt><dd><code class="copy" data-copy="${esc(s.ssh?.command || '')}">${esc(s.ssh?.command || '—')}</code></dd>
            <dt>User</dt><dd>root</dd>
            <dt>Private IP</dt><dd class="mono">${esc(s.private_ip || '—')}</dd>
            <dt>Plan</dt><dd>${esc(s.plan.name)} · ${s.plan.cores} vCPU · ${mb(s.plan.memory_mb)} · ${s.plan.disk_gb} GB</dd>
            <dt>Expires</dt><dd>${new Date(s.expires_at).toLocaleString()} (${left(s.expires_at)})</dd>
          </dl>
        </div>
        <div class="card">
          <h3>Usage</h3>
          ${live && live.maxmem ? `
            <label>CPU ${(live.cpu * 100).toFixed(1)}%</label><div class="meter"><div style="width:${pct(live.cpu, 1)}%"></div></div>
            <label>Memory ${bytes(live.mem)} / ${bytes(live.maxmem)}</label><div class="meter"><div style="width:${pct(live.mem, live.maxmem)}%"></div></div>
            <label>Disk ${bytes(live.disk)} / ${bytes(live.maxdisk)}</label><div class="meter"><div style="width:${pct(live.disk, live.maxdisk)}%"></div></div>
            <p class="muted">Uptime ${uptime(live.uptime || 0)} · ↓ ${bytes(live.netin)} ↑ ${bytes(live.netout)}</p>` : '<p class="muted">No live data while the server is not running.</p>'}
        </div>
        <div class="card">
          <h3>${s.is_free ? 'Keep it alive' : 'Renew & upgrade'}</h3>
          ${s.is_free ? `
            <p class="muted">Each rewarded ad adds ${ads.hours_per_ad}h (up to ${ads.max_hours_ahead}h ahead). ${ads.remaining} ads left today.</p>
            <p>📱 Open the mobile app and tap <b>Watch ad</b>.</p>
            ${ads.dev_rewards ? '<button class="btn small" id="devad">+1h (dev reward)</button>' : ''}` : `
            <button class="btn small primary" id="renew" ${['active', 'suspended'].includes(s.state) ? '' : 'disabled'}>Renew 30 days – ${money(current.price_cents)}</button>`}
          ${upgrades.length && ['active', 'suspended'].includes(s.state) ? `
            <label>Upgrade to</label>
            <div class="row"><select id="upg" style="flex:1">${upgrades.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} – ${p.cores} vCPU, ${mb(p.memory_mb)}, ${p.disk_gb} GB (${money(s.is_free ? p.price_cents : Math.max(50, p.price_cents - current.price_cents))})</option>`).join('')}</select>
            <button class="btn small blue" id="upgo">Upgrade</button></div>` : ''}
        </div>
      </div>
      ${s.is_free ? adSlot() : ''}`;

    view.querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => { navigator.clipboard?.writeText(el.dataset.copy); toast('Copied'); }));
    view.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('POST', `/servers/${s.id}/${b.dataset.act}`); toast(`${b.dataset.act} done`); route(); })));
    $('#del').onclick = (e) => { if (confirm(`Delete ${s.hostname}? All data is destroyed. This cannot be undone.`)) busy(e.currentTarget, async () => { await api('DELETE', `/servers/${s.id}`); toast('Server deleted'); location.hash = '#/dashboard'; }); };
    const pwok = $('#pwok'); if (pwok) pwok.onclick = () => { sessionStorage.removeItem(`tb_pw_${s.id}`); route(); };
    const devad = $('#devad'); if (devad) devad.onclick = () => busy(devad, async () => { const r = await api('POST', '/ads/dev-reward', { server_id: s.id }); toast(`Extended – now ${left(r.expires_at)} left`); route(); });
    const renew = $('#renew'); if (renew) renew.onclick = () => busy(renew, async () => { location.href = (await api('POST', '/shop/checkout', { kind: 'renew', server_id: s.id })).url; });
    const upgo = $('#upgo'); if (upgo) upgo.onclick = () => busy(upgo, async () => { location.href = (await api('POST', '/shop/checkout', { kind: 'upgrade', server_id: s.id, plan_id: $('#upg').value })).url; });
    if (s.state === 'provisioning') pollTimer = setTimeout(route, 2000);
  });

  pages['/order'] = needAuth(async () => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const id = q.get('order');
    if (q.get('cancelled')) { view.innerHTML = '<div class="card"><h2>Payment cancelled</h2><p class="muted">No charge was made.</p><a class="btn" href="#/pricing">Back to shop</a></div>'; return; }
    const r = await api('GET', `/shop/orders/${encodeURIComponent(id)}`);
    if (r.root_password && r.server) sessionStorage.setItem(`tb_pw_${r.server.id}`, r.root_password);
    if (r.order.status === 'pending') {
      view.innerHTML = '<div class="card"><h2><span class="spinner"></span> Confirming your payment…</h2><p class="muted">This page refreshes automatically.</p></div>';
      pollTimer = setTimeout(route, 2000); return;
    }
    if (r.order.status === 'failed') { view.innerHTML = '<div class="card"><h2>Something went wrong</h2><p class="muted">Your payment went through but we could not set up the server. Please contact support with order #' + esc(r.order.id) + '.</p></div>'; return; }
    view.innerHTML = `<div class="card"><h2>🎉 Thanks! Order #${esc(r.order.id)} complete.</h2>
      ${r.server ? `<a class="btn primary" href="#/server/${r.server.id}">Open ${esc(r.server.hostname)}</a>` : '<a class="btn" href="#/dashboard">My servers</a>'}</div>`;
  });

  pages['/account'] = needAuth(async () => {
    const { orders } = await api('GET', '/shop/orders');
    view.innerHTML = `
      <h1>Account</h1>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <form class="card" id="pwf"><h3>Change password</h3>
          <p class="muted">${esc(user.email)}</p>
          <label>Current password</label><input type="password" name="current" required />
          <label>New password</label><input type="password" name="password" minlength="8" required />
          <div style="margin-top:14px"><button class="btn">Update</button></div></form>
        <div class="card"><h3>Orders</h3>
          ${orders.length ? `<dl class="kv">${orders.map((o) => `<dt>#${o.id} · ${esc(o.created_at.slice(0, 10))}</dt><dd>${esc(o.kind)} ${esc(o.plan_id)} – ${money(o.amount_cents)} <span class="badge ${o.status === 'fulfilled' ? 'active' : o.status === 'failed' ? 'error' : ''}">${esc(o.status)}</span></dd>`).join('')}</dl>` : '<p class="muted">No orders yet.</p>'}
        </div>
      </div>`;
    const f = $('#pwf');
    f.onsubmit = (e) => { e.preventDefault(); busy(f.querySelector('button'), async () => { await api('POST', '/auth/change-password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Password updated'); }); };
  });

  pages['/admin'] = needAuth(async () => {
    const [st, { servers }, { users }] = await Promise.all([api('GET', '/admin/stats'), api('GET', '/admin/servers'), api('GET', '/admin/users')]);
    view.innerHTML = `
      <h1>Admin</h1>
      <div class="grid">
        <div class="card"><div class="muted">Users</div><div class="price">${st.users}</div></div>
        <div class="card"><div class="muted">Revenue (30d)</div><div class="price">${money(st.revenue_cents_30d)}</div></div>
        <div class="card"><div class="muted">Ad rewards (24h)</div><div class="price">${st.ad_rewards_24h}</div></div>
        <div class="card"><div class="muted">Live servers</div><div class="price">${servers.filter((s) => s.state === 'active').length}</div></div>
      </div>
      <h2 style="margin-top:28px">Servers</h2>
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse">
        <tr class="muted" style="text-align:left"><th>ID</th><th>Host</th><th>User</th><th>Plan</th><th>State</th><th>Node/VMID</th><th>Expires</th><th></th></tr>
        ${servers.map((s) => `<tr><td>${s.id}</td><td>${esc(s.hostname)}</td><td>${esc(s.email)}</td><td>${esc(s.plan.id)}</td><td><span class="badge ${esc(s.state)}">${esc(s.state)}</span></td><td class="mono">${esc(s.node || '')}/${esc(s.vmid ?? '')}</td><td>${left(s.expires_at)}</td><td><button class="btn small danger" data-kill="${s.id}">Delete</button></td></tr>`).join('')}
      </table></div>
      <h2 style="margin-top:28px">Users</h2>
      <div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse">
        <tr class="muted" style="text-align:left"><th>ID</th><th>Email</th><th>Servers</th><th>Joined</th><th></th></tr>
        ${users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.email)} ${u.is_admin ? '<span class="badge">admin</span>' : ''}${u.banned ? '<span class="badge error">banned</span>' : ''}</td><td>${u.servers}</td><td>${esc(u.created_at.slice(0, 10))}</td><td>${u.banned || u.is_admin ? '' : `<button class="btn small danger" data-ban="${u.id}">Ban</button>`}</td></tr>`).join('')}
      </table></div>`;
    view.querySelectorAll('[data-kill]').forEach((b) => (b.onclick = () => confirm('Delete this server?') && busy(b, async () => { await api('DELETE', `/admin/servers/${b.dataset.kill}`); route(); })));
    view.querySelectorAll('[data-ban]').forEach((b) => (b.onclick = () => confirm('Ban user and delete all their servers?') && busy(b, async () => { await api('POST', `/admin/users/${b.dataset.ban}/ban`); route(); })));
  });

  pages['/terms'] = async () => {
    view.innerHTML = `<div class="card" style="max-width:760px"><h1>Terms &amp; fair use</h1>
      <p>Servers are provided as-is with no uptime guarantee. Free servers are deleted when they expire, together with all data.</p>
      <p>Not allowed: crypto mining, spam, port scanning or attacking other systems, open proxies/VPN exits for abuse, illegal content, or anything that degrades service for others. We may suspend servers and accounts that break these rules without notice or refund.</p>
      <p>Paid servers that expire are stopped and deleted after 7 days unless renewed.</p></div>`;
  };

  // ---------- router ----------
  async function route() {
    clearTimeout(pollTimer);
    const [path] = (location.hash.slice(1) || '/').split('?');
    const parts = path.split('/').filter(Boolean);
    renderNav();
    let page = pages['/' + (parts[0] || '')];
    if (!page) page = pages['/'];
    try { await page(...parts.slice(1)); } catch (e) { view.innerHTML = `<div class="card"><h2>Oops</h2><p class="muted">${esc(e.message)}</p></div>`; }
  }

  // Stripe redirects back to "/#/order?order=ID"
  window.addEventListener('hashchange', route);
  $('#year').textContent = new Date().getFullYear();
  plans().then((p) => { document.querySelectorAll('#brand,.brand-name').forEach((el) => (el.textContent = p.brand)); document.title = `${p.brand} – free tiny Linux servers`; }).catch(() => {});
  route();
})();
