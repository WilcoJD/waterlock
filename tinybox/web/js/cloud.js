/* Cloud section: plans, servers, white-label endpoints, VPN. */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, modal, adSlot, route, every, query, needAuth } = App;
  let plansCache = null;
  const plans = async () => (plansCache ||= await api('GET', '/shop/plans'));

  /** Ask how to pay (card via Stripe, or from the wallet), then run checkout. */
  function payDialog(title, price, body) {
    modal(`<h2>${esc(title)}</h2><p class="muted">Total ${fmt.money(price)} (${(price / 100).toFixed(2)} USDT from your wallet)</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="payWallet">Pay from wallet</button><button class="btn" id="payCard">Pay by card</button><button class="btn" data-close>Cancel</button></div>`,
    (m, close) => {
      const go = (pay_with) => async () => {
        const r = await api('POST', '/shop/checkout', { ...body, pay_with });
        close();
        if (pay_with === 'wallet') { toast(r.status === 'fulfilled' ? 'Paid from wallet' : 'Order failed – refunded'); App.refreshWalletChip(); location.hash = `#/order?order=${r.order_id}`; }
        else location.href = r.url;
      };
      $('#payWallet', m).onclick = (e) => busy(e.currentTarget, go('wallet'));
      $('#payCard', m).onclick = (e) => busy(e.currentTarget, go('card'));
    });
  }

  route(/^\/cloud$/, async (view) => {
    const { plans: ps, free, white_label: wl } = await plans();
    const tab = query().get('tab') || 'container';
    const shown = ps.filter((p) => tab === 'all' || p.kind === (tab === 'vm' ? 'vm' : 'container'));
    view.innerHTML = `
      <div class="section-head"><div><h1>Cloud servers</h1><p class="muted">Everything runs under our brand: ${wl.gateway ? `SSH via <b>${esc(wl.ssh_host)}</b>, websites on <b>*.${esc(wl.apps_domain)}</b> or your own domain, and a private VPN.` : 'SSH access, root, any distro.'}</p></div>
        <div class="tabs">${[['container', 'Tiny containers'], ['vm', 'Cloud VMs'], ['all', 'All']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/cloud?tab=${k}'">${l}</button>`).join('')}</div></div>
      <div class="grid">${shown.map((p) => `
        <div class="card ${p.id === 'micro' || p.id === 'vm-2' ? 'hl' : ''}">
          <h3>${esc(p.name)} ${p.is_free ? '<span class="badge free">ad-supported</span>' : ''}</h3>
          <div class="price">${fmt.money(p.price_cents)}${p.is_free ? '' : '<small> / 30 days</small>'}</div>
          <ul class="specs">
            <li><b>${p.cores}</b> vCPU ${p.cpulimit < p.cores ? `(${Math.round(p.cpulimit * 100)}% cap)` : ''}</li>
            <li><b>${fmt.mb(p.memory_mb)}</b> RAM</li><li><b>${p.disk_gb} GB</b> SSD</li>
            <li><b>${p.net_rate_mbps >= 1000 ? p.net_rate_mbps / 1000 + ' Gbit/s' : p.net_rate_mbps + ' Mbit/s'}</b> network</li>
            <li>${p.kind === 'vm' ? 'Full virtual machine' : 'Linux container'}</li>
            ${p.is_free ? `<li>${free.hoursInitial}h, +${free.hoursPerAd}h per ad</li>` : ''}
          </ul>
          ${p.is_free ? `<a class="btn primary" href="#/dashboard?new=free">Get it free</a>` : `<button class="btn" data-buy="${esc(p.id)}">Buy</button>`}
        </div>`).join('')}</div>
      <div id="buyform"></div>`;
    view.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
      if (!S.user) { sessionStorage.setItem('tb_after_login', location.hash); location.hash = '#/login'; return; }
      const p = ps.find((x) => x.id === b.dataset.buy);
      $('#buyform').innerHTML = `<div class="card" style="margin-top:24px;max-width:540px"><h2>New ${esc(p.name)} – ${fmt.money(p.price_cents)}</h2>
        <label>Hostname (optional)</label><input id="hn" placeholder="my-server" maxlength="32" />
        <label>SSH public key (optional)</label><textarea id="key" placeholder="ssh-ed25519 AAAA... you@laptop"></textarea>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="pay">Continue</button></div></div>`;
      $('#pay').onclick = () => payDialog(`New ${p.name} server`, p.price_cents, { plan_id: p.id, kind: 'new', hostname: $('#hn').value.trim() || undefined, ssh_key: $('#key').value.trim() || undefined });
      $('#buyform').scrollIntoView({ behavior: 'smooth' });
    }));
  });

  route(/^\/dashboard$/, needAuth(async (view) => {
    const [{ servers }, ads] = await Promise.all([api('GET', '/servers'), api('GET', '/ads/status')]);
    const hasFree = servers.some((s) => s.is_free);
    view.innerHTML = `
      <div class="section-head"><h1>My servers</h1><div class="row">${hasFree ? '' : '<button class="btn primary" id="newfree">+ Free container</button>'}<a class="btn" href="#/cloud">Buy a server</a><a class="btn" href="#/vpn">Private network</a></div></div>
      <div id="newfreeform"></div>
      <div style="display:grid;gap:12px">${servers.length ? servers.map(card).join('') : '<div class="card muted">No servers yet.</div>'}</div>
      ${hasFree ? `<p class="muted" style="margin-top:16px">Rewarded ads today: ${ads.ads_today}/${ads.max_per_day}. Watch ads in the mobile app to add ${ads.hours_per_ad}h each.</p>` : ''}
      ${servers.some((s) => !s.is_free) ? '' : adSlot()}`;
    const nf = $('#newfree');
    const open = () => {
      $('#newfreeform').innerHTML = `<div class="card" style="margin-bottom:16px;max-width:540px"><h3>Launch a free container</h3>
        <label>Hostname (optional)</label><input id="hn" placeholder="my-box" maxlength="32" />
        <label>SSH public key (optional)</label><textarea id="key" placeholder="ssh-ed25519 AAAA..."></textarea>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="go">Launch</button></div></div>`;
      $('#go').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('POST', '/servers/free', { hostname: $('#hn').value.trim() || undefined, ssh_key: $('#key').value.trim() || undefined });
        sessionStorage.setItem(`tb_pw_${r.server.id}`, r.root_password);
        location.hash = `#/server/${r.server.id}`;
      });
    };
    if (nf) { nf.onclick = open; if (query().get('new') === 'free') open(); }
    if (servers.some((s) => s.state === 'provisioning')) every(2500, App.render);
  }));

  function card(s) {
    return `<a class="card server tile" href="#/server/${s.id}">
      <div><h3>${esc(s.hostname)} <span class="badge ${esc(s.state)}">${esc(s.state)}</span> ${s.is_free ? '<span class="badge free">free</span>' : ''} <span class="badge">${s.provider_kind === 'vm' ? 'VM' : 'container'}</span></h3>
        <div class="muted">${esc(s.plan.name)} · ${s.plan.cores} vCPU · ${fmt.mb(s.plan.memory_mb)} · ${s.plan.disk_gb} GB</div>
        ${s.ssh ? `<div class="mono muted" style="margin-top:4px">${esc(s.ssh.command)}</div>` : ''}</div>
      <div style="text-align:right"><div class="muted">${s.state === 'suspended' ? 'renew to restore' : 'expires in'}</div><b>${fmt.left(s.expires_at)}</b></div></a>`;
  }

  route(/^\/server\/(\d+)$/, needAuth(async (view, id) => {
    const { server: s, live } = await api('GET', `/servers/${id}`);
    const ads = s.is_free ? await api('GET', '/ads/status') : null;
    const pw = sessionStorage.getItem(`tb_pw_${s.id}`);
    const { plans: ps, white_label: wl } = await plans();
    const current = ps.find((p) => p.id === s.plan.id);
    const upgrades = ps.filter((p) => p.price_cents > current.price_cents && p.kind === current.kind);
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const canPay = ['active', 'suspended'].includes(s.state);
    view.innerHTML = `
      <p><a href="#/dashboard">← My servers</a></p>
      <div class="section-head"><h1>${esc(s.hostname)} <span class="badge ${esc(live?.status || s.state)}">${esc(live?.status || s.state)}</span></h1>
        <div class="row">${s.state === 'active' ? ['start', 'reboot', 'stop'].map((a) => `<button class="btn small" data-act="${a}" ${(a === 'start') === (live?.status === 'running') ? 'disabled' : ''}>${a[0].toUpperCase() + a.slice(1)}</button>`).join('') : ''}<button class="btn small danger" id="del">Delete</button></div></div>
      ${pw ? `<div class="notice warn"><b>Root password – save it now, it won't be shown again:</b><br><code class="secret">${esc(pw)}</code><br><button class="btn small" id="pwok">I saved it</button></div>` : ''}
      ${s.state === 'provisioning' ? '<div class="notice"><span class="spinner"></span> Creating your server… usually under a minute (VMs up to 3).</div>' : ''}
      ${s.state === 'error' ? `<div class="notice warn">${esc(s.error)}</div>` : ''}
      ${s.state === 'suspended' ? '<div class="notice warn">Expired and stopped. Renew within 7 days to keep your data.</div>' : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="card"><h3>Connect</h3><dl class="kv">
          <dt>SSH</dt><dd><code class="copy" data-copy="${esc(s.ssh?.command || '')}">${esc(s.ssh?.command || '—')}</code></dd>
          <dt>Website</dt><dd>${s.web_url ? `<a href="${esc(s.web_url)}" target="_blank" rel="noopener">${esc(s.web_url.replace('https://', ''))}</a><br><small class="muted">Serves whatever listens on port 80</small>` : '—'}</dd>
          <dt>Private IP</dt><dd class="mono">${esc(s.private_ip || '—')} <a href="#/vpn" class="muted">(VPN)</a></dd>
          <dt>Plan</dt><dd>${esc(s.plan.name)} · ${s.plan.cores} vCPU · ${fmt.mb(s.plan.memory_mb)} · ${s.plan.disk_gb} GB</dd>
          <dt>Expires</dt><dd>${new Date(s.expires_at).toLocaleString()} (${fmt.left(s.expires_at)})</dd></dl></div>
        <div class="card"><h3>Usage</h3>${live && live.maxmem ? `
          <label>CPU ${((live.cpu || 0) * 100).toFixed(1)}%</label><div class="meter"><div style="width:${pct(live.cpu || 0, 1)}%"></div></div>
          <label>Memory ${fmt.bytes(live.mem)} / ${fmt.bytes(live.maxmem)}</label><div class="meter"><div style="width:${pct(live.mem, live.maxmem)}%"></div></div>
          ${live.maxdisk ? `<label>Disk ${fmt.bytes(live.disk)} / ${fmt.bytes(live.maxdisk)}</label><div class="meter"><div style="width:${pct(live.disk, live.maxdisk)}%"></div></div>` : ''}
          <p class="muted">Uptime ${fmt.uptime(live.uptime || 0)}</p>` : '<p class="muted">No live data while the server is not running.</p>'}</div>
        <div class="card"><h3>${s.is_free ? 'Keep it alive' : 'Renew & upgrade'}</h3>
          ${s.is_free ? `<p class="muted">Each rewarded ad adds ${ads.hours_per_ad}h. ${ads.remaining} left today. Open the mobile app and tap <b>Watch ad</b>.</p>${ads.dev_rewards ? '<button class="btn small" id="devad">+1h (dev reward)</button>' : ''}`
            : `<button class="btn small primary" id="renew" ${canPay ? '' : 'disabled'}>Renew 30 days – ${fmt.money(current.price_cents)}</button>`}
          ${upgrades.length && canPay ? `<label>Upgrade to</label><div class="row"><select id="upg" style="flex:1">${upgrades.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} – ${p.cores} vCPU, ${fmt.mb(p.memory_mb)}, ${p.disk_gb} GB</option>`).join('')}</select><button class="btn small blue" id="upgo">Upgrade</button></div>` : ''}
        </div>
        ${wl.gateway && s.state === 'active' ? `<div class="card"><h3>Custom domain</h3><p class="muted">Add a CNAME from your domain to <code>${esc(s.web_url ? s.web_url.replace('https://', '') : wl.apps_domain)}</code>. HTTPS is automatic.</p>
          <div class="row"><input id="dom" placeholder="www.example.com" value="${esc(s.custom_domain || '')}" style="flex:1" /><button class="btn small" id="domgo">Save</button></div></div>` : ''}
      </div>
      ${s.is_free ? adSlot() : ''}`;

    view.querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => { navigator.clipboard?.writeText(el.dataset.copy); toast('Copied'); }));
    view.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('POST', `/servers/${s.id}/${b.dataset.act}`); toast(`${b.dataset.act} done`); App.render(); })));
    $('#del').onclick = (e) => { if (confirm(`Delete ${s.hostname}? All data is destroyed.`)) busy(e.currentTarget, async () => { await api('DELETE', `/servers/${s.id}`); toast('Server deleted'); location.hash = '#/dashboard'; }); };
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    on('#pwok', () => { sessionStorage.removeItem(`tb_pw_${s.id}`); App.render(); });
    on('#devad', (e) => busy(e.currentTarget, async () => { const r = await api('POST', '/ads/dev-reward', { server_id: s.id }); toast(`Extended – ${fmt.left(r.expires_at)} left`); App.render(); }));
    on('#renew', () => payDialog(`Renew ${s.hostname}`, current.price_cents, { kind: 'renew', server_id: s.id }));
    on('#upgo', () => { const p = ps.find((x) => x.id === $('#upg').value); payDialog(`Upgrade to ${p.name}`, s.is_free ? p.price_cents : Math.max(50, p.price_cents - current.price_cents), { kind: 'upgrade', server_id: s.id, plan_id: p.id }); });
    on('#domgo', (e) => busy(e.currentTarget, async () => { await api('PUT', `/servers/${s.id}/domain`, { domain: $('#dom').value.trim() || null }); toast('Domain saved'); App.render(); }));
    if (s.state === 'provisioning') every(2500, App.render);
  }));

  route(/^\/order$/, needAuth(async (view) => {
    const q = query();
    if (q.get('cancelled')) { view.innerHTML = '<div class="card"><h2>Payment cancelled</h2><p class="muted">No charge was made.</p><a class="btn" href="#/cloud">Back</a></div>'; return; }
    const r = await api('GET', `/shop/orders/${encodeURIComponent(q.get('order'))}`);
    if (r.root_password && r.server) sessionStorage.setItem(`tb_pw_${r.server.id}`, r.root_password);
    if (r.order.status === 'pending') { view.innerHTML = '<div class="card"><h2><span class="spinner"></span> Confirming your payment…</h2></div>'; every(2000, App.render); return; }
    if (r.order.status === 'failed') { view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">Order #${esc(r.order.id)} could not be completed. Wallet payments are refunded automatically.</p></div>`; return; }
    view.innerHTML = `<div class="card"><h2>🎉 Order #${esc(r.order.id)} complete.</h2>${r.server ? `<a class="btn primary" href="#/server/${r.server.id}">Open ${esc(r.server.hostname)}</a>` : '<a class="btn" href="#/dashboard">My servers</a>'}</div>`;
  }));

  route(/^\/vpn$/, needAuth(async (view) => {
    const v = await api('GET', '/vpn');
    view.innerHTML = `<div class="section-head"><div><h1>Private network</h1><p class="muted">A WireGuard VPN into your servers' private IPs – reach every port without exposing it to the internet.</p></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="card"><h3>Your VPN</h3>${v.enabled ? `
          <dl class="kv"><dt>Status</dt><dd>${v.configured ? `<span class="badge active">configured</span> ${esc(v.vpn_ip)}` : '<span class="badge">not set up</span>'}</dd>
          <dt>Reachable servers</dt><dd class="mono">${v.servers.map(esc).join('<br>') || '—'}</dd></dl>
          <p class="muted">Generating a config creates new keys; any older config stops working.</p>
          <button class="btn primary" id="gen">${v.configured ? 'Regenerate config' : 'Create VPN config'}</button><div id="conf"></div>` : '<p class="muted">The VPN gateway is not configured on this platform.</p>'}</div>
        <div class="card"><h3>How to connect</h3><ol class="muted"><li>Install WireGuard (Windows, macOS, Linux, iOS, Android).</li><li>Import the downloaded <code>.conf</code> file.</li><li>Activate the tunnel, then <code>ssh root@&lt;private IP&gt;</code>.</li></ol></div>
      </div>`;
    const g = $('#gen');
    if (g) g.onclick = () => busy(g, async () => {
      const r = await api('POST', '/vpn/config');
      const blob = URL.createObjectURL(new Blob([r.config], { type: 'text/plain' }));
      $('#conf').innerHTML = `<pre class="terminal" style="white-space:pre-wrap;margin-top:12px">${esc(r.config)}</pre><a class="btn small" download="${esc(r.filename)}" href="${blob}">Download .conf</a>`;
    });
  }));
})();
