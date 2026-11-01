/* Admin console shell. Tabs come from App.registerAdminTab({ id, label, order, render(pane) }). */
(() => {
  'use strict';
  const { $, esc, fmt, api, busy, route, query, needAuth, registries, registerAdminTab } = App;

  route(/^\/admin$/, needAuth(async (view) => {
    if (!App.S.user.is_admin) { view.innerHTML = '<div class="card"><h2>Admins only</h2></div>'; return; }
    const tabs = registries.adminTabs;
    const tab = tabs.find((t) => t.id === (query().get('tab') || 'overview')) || tabs[0];
    view.innerHTML = `<div class="section-head"><h1>Admin</h1><div class="tabs" style="flex-wrap:wrap">${tabs.map((t) => `<button class="${tab.id === t.id ? 'on' : ''}" onclick="location.hash='#/admin?tab=${esc(t.id)}'">${esc(t.label)}</button>`).join('')}</div></div><div id="pane"></div>`;
    const pane = $('#pane');
    try { await tab.render(pane); } catch (e) { pane.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
  }));

  registerAdminTab({ id: 'overview', label: 'Overview', order: 0, async render(pane) {
    const st = await api('GET', '/admin/stats');
    const tile = (l, v) => `<div class="card"><div class="muted">${l}</div><div class="price">${v}</div></div>`;
    pane.innerHTML = `<div class="grid">${tile('Users', st.users)}${tile('Cloud revenue (30d)', fmt.money(st.revenue_cents_30d))}${tile('Trading fees', fmt.usd(st.fees_usdt) + ' USDT')}${tile('Open futures', st.open_perps)}${tile('Open options', st.open_options)}${tile('Spot trades 24h', st.spot_trades_24h)}${tile('Card trades 24h', st.card_trades_24h)}${tile('Pending vault requests', st.pending_card_requests)}${tile('Ad rewards 24h', st.ad_rewards_24h)}</div>`;
  } });

  registerAdminTab({ id: 'servers', label: 'Servers', order: 10, async render(pane) {
    const { servers } = await api('GET', '/admin/servers');
    pane.innerHTML = `<div class="card" style="overflow:auto"><table class="t"><tr><th>ID</th><th>Host</th><th>User</th><th>Plan</th><th>State</th><th>Node / ID</th><th>Expires</th><th></th></tr>
      ${servers.map((s) => `<tr><td>${s.id}</td><td>${esc(s.hostname)}</td><td>${esc(s.email)}</td><td>${esc(s.plan.id)}</td><td><span class="badge ${esc(s.state)}">${esc(s.state)}</span></td><td class="mono">${esc(s.node || '')}/${esc(s.vmid ?? '')}</td><td>${fmt.left(s.expires_at)}</td><td><button class="btn small danger" data-kill="${s.id}">Delete</button></td></tr>`).join('')}</table></div>`;
    pane.querySelectorAll('[data-kill]').forEach((b) => (b.onclick = () => confirm('Delete this server?') && busy(b, async () => { await api('DELETE', `/admin/servers/${b.dataset.kill}`); App.render(); })));
  } });

  registerAdminTab({ id: 'users', label: 'Users', order: 20, async render(pane) {
    const { users } = await api('GET', '/admin/users');
    pane.innerHTML = `<div class="card" style="overflow:auto"><table class="t"><tr><th>ID</th><th>Email</th><th>Servers</th><th>Joined</th><th></th></tr>
      ${users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.email)} ${u.is_admin ? '<span class="badge">admin</span>' : ''}${u.banned ? '<span class="badge error">banned</span>' : ''}</td><td>${u.servers}</td><td>${esc(u.created_at.slice(0, 10))}</td><td>${u.banned || u.is_admin ? '' : `<button class="btn small danger" data-ban="${u.id}">Ban</button>`}</td></tr>`).join('')}</table></div>`;
    pane.querySelectorAll('[data-ban]').forEach((b) => (b.onclick = () => confirm('Ban user and delete their servers?') && busy(b, async () => { await api('POST', `/admin/users/${b.dataset.ban}/ban`); App.render(); })));
  } });
})();
