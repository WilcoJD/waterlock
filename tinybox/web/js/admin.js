/* Admin console: overview, servers, users, wallet operations, card vault. */
(() => {
  'use strict';
  const { $, esc, fmt, api, toast, busy, modal, route, query, needAuth } = App;

  route(/^\/admin$/, needAuth(async (view) => {
    const tab = query().get('tab') || 'overview';
    view.innerHTML = `<div class="section-head"><h1>Admin</h1><div class="tabs">${[['overview', 'Overview'], ['servers', 'Servers'], ['users', 'Users'], ['wallet', 'Wallet'], ['vault', 'Card vault']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/admin?tab=${k}'">${l}</button>`).join('')}</div></div><div id="pane"></div>`;
    const pane = $('#pane');

    if (tab === 'overview') {
      const st = await api('GET', '/admin/stats');
      const tile = (l, v) => `<div class="card"><div class="muted">${l}</div><div class="price">${v}</div></div>`;
      pane.innerHTML = `<div class="grid">${tile('Users', st.users)}${tile('Cloud revenue (30d)', fmt.money(st.revenue_cents_30d))}${tile('Trading fees', fmt.usd(st.fees_usdt) + ' USDT')}${tile('Open futures', st.open_perps)}${tile('Open options', st.open_options)}${tile('Spot trades 24h', st.spot_trades_24h)}${tile('Card trades 24h', st.card_trades_24h)}${tile('Pending vault requests', st.pending_card_requests)}${tile('Ad rewards 24h', st.ad_rewards_24h)}</div>`;
    }
    if (tab === 'servers') {
      const { servers } = await api('GET', '/admin/servers');
      pane.innerHTML = `<div class="card" style="overflow:auto"><table class="t"><tr><th>ID</th><th>Host</th><th>User</th><th>Plan</th><th>State</th><th>Node / ID</th><th>Expires</th><th></th></tr>
        ${servers.map((s) => `<tr><td>${s.id}</td><td>${esc(s.hostname)}</td><td>${esc(s.email)}</td><td>${esc(s.plan.id)}</td><td><span class="badge ${esc(s.state)}">${esc(s.state)}</span></td><td class="mono">${esc(s.node || '')}/${esc(s.vmid ?? '')}</td><td>${fmt.left(s.expires_at)}</td><td><button class="btn small danger" data-kill="${s.id}">Delete</button></td></tr>`).join('')}</table></div>`;
      pane.querySelectorAll('[data-kill]').forEach((b) => (b.onclick = () => confirm('Delete this server?') && busy(b, async () => { await api('DELETE', `/admin/servers/${b.dataset.kill}`); App.render(); })));
    }
    if (tab === 'users') {
      const { users } = await api('GET', '/admin/users');
      pane.innerHTML = `<div class="card" style="overflow:auto"><table class="t"><tr><th>ID</th><th>Email</th><th>Servers</th><th>Joined</th><th></th></tr>
        ${users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.email)} ${u.is_admin ? '<span class="badge">admin</span>' : ''}${u.banned ? '<span class="badge error">banned</span>' : ''}</td><td>${u.servers}</td><td>${esc(u.created_at.slice(0, 10))}</td><td>${u.banned || u.is_admin ? '' : `<button class="btn small danger" data-ban="${u.id}">Ban</button>`}</td></tr>`).join('')}</table></div>`;
      pane.querySelectorAll('[data-ban]').forEach((b) => (b.onclick = () => confirm('Ban user and delete their servers?') && busy(b, async () => { await api('POST', `/admin/users/${b.dataset.ban}/ban`); App.render(); })));
    }
    if (tab === 'wallet') {
      const w = await api('GET', '/admin/wallet');
      pane.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
        <div class="card"><h3>Platform accounts</h3><p class="muted">Backend: ${esc(w.backend)}. Negative house balances = paid out more than collected.</p><table class="t">${w.house.map((h) => `<tr><td class="mono">${esc(h.owner)}</td><td>${esc(h.asset)}</td><td class="num mono ${Number(h.balance) < 0 ? 'down' : ''}">${fmt.num(h.balance)}</td></tr>`).join('')}</table></div>
        <div class="card"><h3>Manual deposit</h3><label>User ID</label><input id="cu" type="number" /><label>Asset</label><input id="ca" value="USDT" /><label>Amount</label><input id="cm" /><label>Reference</label><input id="cr" placeholder="tx hash / bank ref" /><div style="margin-top:12px"><button class="btn" id="cgo">Credit</button></div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Pending withdrawals</h3>${w.pending_withdrawals.length ? `<table class="t"><tr><th>#</th><th>User</th><th>Amount</th><th>Network</th><th>Address</th><th></th></tr>${w.pending_withdrawals.map((x) => `<tr><td>${x.id}</td><td>${esc(x.email)}</td><td>${fmt.num(x.amount)} ${esc(x.asset)}</td><td>${esc(x.chain)}</td><td class="mono">${esc(x.address)}</td><td class="num"><button class="btn small primary" data-ok="${x.id}">Mark sent</button> <button class="btn small danger" data-no="${x.id}">Reject</button></td></tr>`).join('')}</table>` : '<p class="muted">None.</p>'}</div>
      ${w.outbox.length ? `<div class="card" style="margin-top:14px"><h3>Payout retry queue</h3><table class="t">${w.outbox.map((o) => `<tr><td>${esc(o.src)} → ${esc(o.dst)}</td><td>${fmt.num(o.amount)} ${esc(o.asset)}</td><td>${o.attempts} tries</td><td class="muted">${esc(o.last_error)}</td></tr>`).join('')}</table></div>` : ''}`;
      $('#cgo').onclick = (e) => busy(e.currentTarget, async () => { await api('POST', '/admin/wallet/credit', { user_id: Number($('#cu').value), asset: $('#ca').value, amount: $('#cm').value, ref: $('#cr').value }); toast('Credited'); App.render(); });
      pane.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => { const txid = prompt('Transaction hash (optional)'); busy(b, async () => { await api('POST', `/admin/withdrawals/${b.dataset.ok}/approve`, { txid }); App.render(); }); }));
      pane.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => confirm('Reject and refund?') && busy(b, async () => { await api('POST', `/admin/withdrawals/${b.dataset.no}/reject`); App.render(); })));
    }
    if (tab === 'vault') {
      const { requests } = await api('GET', '/admin/cards/requests');
      pane.innerHTML = `<div class="card" style="overflow:auto"><table class="t"><tr><th>#</th><th>User</th><th>Type</th><th>Item</th><th class="num">Qty</th><th>Address / note</th><th>Status</th><th></th></tr>
        ${requests.map((r) => `<tr><td>${r.id}</td><td>${esc(r.email)}</td><td>${esc(r.kind.replace('_', ' '))}</td><td>${esc(r.sku)}</td><td class="num">${r.qty}</td><td class="muted">${esc(r.address || '')} ${esc(r.note || '')}</td><td><span class="badge ${r.status === 'completed' ? 'active' : r.status === 'rejected' ? 'error' : 'provisioning'}">${esc(r.status)}</span></td>
          <td>${r.status === 'pending' ? `<button class="btn small primary" data-done="${r.id}" data-kind="${esc(r.kind)}">Complete</button> <button class="btn small danger" data-rej="${r.id}">Reject</button>` : ''}</td></tr>`).join('')}</table></div>`;
      pane.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => {
        const kind = b.dataset.kind;
        modal(`<h2>Complete request #${b.dataset.done}</h2>${kind === 'ship_out' ? '<label>Tracking number</label><input id="tr" />' : ''}${kind === 'break' ? '<label>Pulled cards (one per line: SKU qty)</label><textarea id="pl" placeholder="AEG-001 1\nAEG-058 9"></textarea>' : ''}${kind === 'ship_in' ? '<p class="muted">Confirm the items arrived and passed inspection.</p>' : ''}
          <div class="row" style="margin-top:12px"><button class="btn primary" id="cgo">Complete</button><button class="btn" data-close>Cancel</button></div>`, (m, close) => {
          $('#cgo', m).onclick = (e) => busy(e.currentTarget, async () => {
            const body = {};
            if ($('#tr', m)) body.tracking = $('#tr', m).value;
            if ($('#pl', m)) body.pulls = $('#pl', m).value.split('\n').map((l) => l.trim().split(/\s+/)).filter((x) => x[0]).map(([sku, q]) => ({ sku, qty: Number(q || 1) }));
            await api('POST', `/admin/cards/requests/${b.dataset.done}/complete`, body); close(); App.render();
          });
        });
      }));
      pane.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => confirm('Reject this request?') && busy(b, async () => { await api('POST', `/admin/cards/requests/${b.dataset.rej}/complete`, { reject: true }); App.render(); })));
    }
  }));
})();
