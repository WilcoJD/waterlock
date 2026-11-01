/* Unified wallet: balances across every product, deposit, withdraw, history. */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, route, query, needAuth } = App;

  route(/^\/wallet$/, needAuth(async (view) => {
    const tab = query().get('tab') || 'balances';
    const w = await api('GET', '/wallet');
    const usd = (a, amt) => (a === 'USDT' ? Number(amt) : Number(amt) * (S.prices[a] || 0));
    const total = w.balances.reduce((t, b) => t + usd(b.asset, b.balance), 0);
    const committed = Number(w.committed.perps_margin_usdt) + Number(w.committed.options_value_usdt) + Number(w.committed.cards_value_usdt) + w.committed.open_buy_orders.reduce((t, o) => t + usd(o.asset, o.amount), 0);
    view.innerHTML = `
      <div class="section-head"><div><h1>Wallet</h1><p class="muted">One balance for cloud, spot, futures, options and cards${w.backend === 'opex' ? ' · secured by the OPEX wallet' : ''}.</p></div>
        <div class="tabs">${[['balances', 'Balances'], ['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['history', 'History']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/wallet?tab=${k}'">${l}</button>`).join('')}</div></div>
      <div class="stats card" style="margin-bottom:16px">
        <div class="stat"><small>Available (est.)</small><b style="font-size:24px">$${fmt.usd(total)}</b></div>
        <div class="stat"><small>In positions & orders</small><b style="font-size:24px">$${fmt.usd(committed)}</b></div>
        <div class="stat"><small>Futures margin</small><b>${fmt.usd(w.committed.perps_margin_usdt)} USDT</b></div>
        <div class="stat"><small>Options value</small><b>${fmt.usd(w.committed.options_value_usdt)} USDT</b></div>
        <div class="stat"><small>Cards (last price)</small><b>${fmt.usd(w.committed.cards_value_usdt)} USDT</b></div>
        ${w.faucet ? '<div style="margin-left:auto"><button class="btn small" id="faucet">Get test funds</button></div>' : ''}
      </div>
      <div id="pane" class="card"></div>`;
    const f = $('#faucet');
    if (f) f.onclick = () => busy(f, async () => { await api('POST', '/wallet/faucet'); toast('Test funds added'); App.refreshWalletChip(); App.render(); });
    const pane = $('#pane');
    const assetOpts = w.assets.map((a) => `<option value="${a.symbol}">${a.symbol} – ${esc(a.name)}</option>`).join('');

    if (tab === 'balances') {
      pane.innerHTML = `<table class="t"><tr><th>Asset</th><th class="num">Balance</th><th class="num">≈ USD</th><th></th></tr>
        ${w.balances.map((b) => `<tr><td><b>${b.asset}</b> <span class="muted">${esc(w.assets.find((a) => a.symbol === b.asset)?.name)}</span></td><td class="num mono">${fmt.num(b.balance)}</td><td class="num">$${fmt.usd(usd(b.asset, b.balance))}</td>
          <td class="num"><a href="#/wallet?tab=deposit&asset=${b.asset}">Deposit</a> · <a href="#/wallet?tab=withdraw&asset=${b.asset}">Withdraw</a>${b.asset !== 'USDT' ? ` · <a href="#/trade/${b.asset}_USDT">Trade</a>` : ''}</td></tr>`).join('')}</table>`;
    }
    if (tab === 'deposit' || tab === 'withdraw') {
      const sel = query().get('asset') || 'USDT';
      pane.innerHTML = `<div style="max-width:520px"><h3>${tab === 'deposit' ? 'Deposit' : 'Withdraw'}</h3>
        <label>Asset</label><select id="as">${assetOpts}</select>
        <label>Network</label><select id="ch"></select>
        ${tab === 'deposit' ? '<div style="margin-top:14px"><button class="btn primary" id="go">Show deposit address</button></div><div id="out"></div>'
          : `<label>Destination address</label><input id="addr" placeholder="Paste the address" autocomplete="off" />
             <label>Amount</label><input id="amt" inputmode="decimal" placeholder="0.00" />
             <p class="muted" id="feeinfo"></p><button class="btn primary" id="go">Withdraw</button>
             <h3 style="margin-top:24px">Recent withdrawals</h3><div id="wds"></div>`}</div>`;
      const as = $('#as'); as.value = sel;
      const fill = () => {
        const a = w.assets.find((x) => x.symbol === as.value);
        $('#ch').innerHTML = a.chains.map((c) => `<option>${c}</option>`).join('');
        const fi = $('#feeinfo'); if (fi) fi.textContent = `Network fee ${a.withdraw_fee} ${a.symbol} · minimum ${a.min_withdraw} ${a.symbol}`;
      };
      as.onchange = fill; fill();
      if (tab === 'deposit') {
        $('#go').onclick = (e) => busy(e.currentTarget, async () => {
          const r = await api('POST', '/wallet/deposit-address', { asset: as.value, chain: $('#ch').value });
          $('#out').innerHTML = r.address
            ? `<p>Send only <b>${esc(r.asset)}</b> on <b>${esc(r.chain)}</b> to:</p><code class="secret copy" data-copy="${esc(r.address)}">${esc(r.address)}</code>${r.memo ? `<p>Memo/tag: <code>${esc(r.memo)}</code></p>` : ''}<p class="risk">Sending another asset or network may result in permanent loss.</p>`
            : `<p class="notice">${esc(r.note)}</p>`;
          const c = $('[data-copy]', $('#out')); if (c) c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast('Address copied'); };
        });
      } else {
        const loadW = async () => {
          const { withdrawals } = await api('GET', '/wallet/withdrawals');
          $('#wds').innerHTML = withdrawals.length ? `<table class="t">${withdrawals.map((x) => `<tr><td>${fmt.date(x.created_at)}</td><td>${fmt.num(x.amount)} ${esc(x.asset)}</td><td class="mono" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(x.address)}</td><td><span class="badge ${x.status === 'sent' ? 'active' : x.status === 'rejected' ? 'error' : 'provisioning'}">${esc(x.status)}</span></td></tr>`).join('')}</table>` : '<p class="muted">None yet.</p>';
        };
        loadW();
        $('#go').onclick = (e) => {
          if (!confirm(`Withdraw ${$('#amt').value} ${as.value} to ${$('#addr').value}? This cannot be reversed.`)) return;
          busy(e.currentTarget, async () => { await api('POST', '/wallet/withdraw', { asset: as.value, chain: $('#ch').value, address: $('#addr').value.trim(), amount: $('#amt').value.trim() }); toast('Withdrawal requested'); App.refreshWalletChip(); loadW(); });
        };
      }
    }
    if (tab === 'history') {
      const { entries } = await api('GET', '/wallet/history');
      pane.innerHTML = entries.length ? `<table class="t"><tr><th>Time</th><th>Type</th><th>Details</th><th class="num">Amount</th></tr>${entries.map((e) => `<tr><td>${fmt.date(e.created_at)}</td><td><span class="badge">${esc(e.kind)}</span></td><td class="muted">${esc(e.ref || '')}</td><td class="num mono ${e.delta >= 0 ? 'up' : 'down'}">${e.delta >= 0 ? '+' : ''}${fmt.num(e.amount)} ${esc(e.asset)}</td></tr>`).join('')}</table>` : '<p class="muted">No activity yet.</p>';
    }
  }));
})();

/* Admin: wallet operations tab */
(() => {
  'use strict';
  const { $, esc, fmt, api, toast, busy, registerAdminTab } = App;
  registerAdminTab({ id: 'wallet', label: 'Wallet', order: 30, async render(pane) {
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
  } });
})();
