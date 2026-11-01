/* Derivatives: USDT-margined perpetual futures and European options. */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, modal, route, every, query } = App;
  const SYMS = ['BTC', 'ETH', 'SOL'];
  const symTabs = (base, cur) => `<div class="tabs">${SYMS.map((s) => `<button class="${s === cur ? 'on' : ''}" onclick="location.hash='#/${base}/${s}'">${s}</button>`).join('')}</div>`;

  route(/^\/futures\/([A-Z]+)$/, async (view, sym) => {
    const { markets } = await api('GET', '/perps/markets');
    const m = markets.find((x) => x.symbol === sym);
    if (!m) throw new Error('Unknown market');
    view.innerHTML = `<div class="section-head"><div><h1>${sym}-PERP</h1><div class="stats"><div class="stat"><small>Index</small><b id="idx">${fmt.usd(S.prices[sym])}</b></div><div class="stat"><small>Max leverage</small><b>${m.max_leverage}x</b></div><div class="stat"><small>Fee</small><b>${m.fee_bps / 100}%</b></div></div></div>${symTabs('futures', sym)}</div>
      <div class="trade-grid" style="grid-template-columns:2fr 1fr">
        <div class="card"><div id="chart"></div></div>
        <div class="card">
          <div class="side-toggle"><button class="buy on" data-side="long">Long</button><button class="sell" data-side="short">Short</button></div>
          <label>Margin (USDT)</label><input id="mg" inputmode="decimal" value="100" />
          <label>Leverage <b id="levv">10x</b></label><input id="lev" type="range" min="1" max="${m.max_leverage}" value="10" />
          <label>Take profit (optional)</label><input id="tp" inputmode="decimal" placeholder="price" />
          <label>Stop loss (optional)</label><input id="sl" inputmode="decimal" placeholder="price" />
          <p class="muted" id="est" style="margin:10px 0"></p>
          ${S.user ? '<button class="btn primary" id="open" style="width:100%;justify-content:center">Open long</button>' : '<a class="btn primary" href="#/login">Log in to trade</a>'}
          <p class="risk" style="margin-top:12px">Leverage magnifies losses. Positions are liquidated automatically when losses reach the margin.</p>
        </div>
      </div>
      ${S.user ? `<div class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between"><h3>Positions</h3><div class="tabs"><button class="${query().get('tab') !== 'history' ? 'on' : ''}" data-ptab="open">Open</button><button class="${query().get('tab') === 'history' ? 'on' : ''}" data-ptab="history">History</button></div></div><div id="pos"></div></div>` : ''}`;
    let side = 'long';
    let ptab = query().get('tab') === 'history' ? 'history' : 'open';
    const est = () => {
      const mg = Number($('#mg').value) || 0, lev = Number($('#lev').value), px = S.prices[sym] || 0;
      $('#levv').textContent = `${lev}x`;
      const liq = side === 'long' ? px * (1 - 1 / lev + m.maintenance) : px * (1 + 1 / lev - m.maintenance);
      $('#est').innerHTML = `Position size ${fmt.usd(mg * lev)} USDT (${fmt.num((mg * lev) / (px || 1), 6)} ${sym})<br>Est. liquidation ${fmt.usd(liq)} · Fee ${fmt.usd((mg * lev * m.fee_bps) / 10000)} USDT`;
      const o = $('#open'); if (o) { o.textContent = `Open ${side}`; o.className = `btn ${side === 'long' ? 'primary' : 'sell'}`; o.style.width = '100%'; o.style.justifyContent = 'center'; }
    };
    view.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; view.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('on', x === b)); est(); }));
    $('#mg').oninput = $('#lev').oninput = est; est();
    const o = $('#open');
    if (o) o.onclick = () => busy(o, async () => {
      const r = await api('POST', '/perps/positions', { symbol: sym, side, margin: $('#mg').value, leverage: Number($('#lev').value), tp: $('#tp').value || undefined, sl: $('#sl').value || undefined });
      toast(`Opened ${r.position.side} ${r.position.qty} ${sym} @ ${fmt.usd(r.position.entry)}`); App.refreshWalletChip(); loadPos();
    });
    view.querySelectorAll('[data-ptab]').forEach((b) => (b.onclick = () => { ptab = b.dataset.ptab; view.querySelectorAll('[data-ptab]').forEach((x) => x.classList.toggle('on', x === b)); loadPos(); }));
    async function loadPos() {
      if (!S.user) return;
      const { positions } = await api('GET', `/perps/positions${ptab === 'history' ? '?status=closed' : ''}`);
      $('#pos').innerHTML = positions.length ? `<table class="t"><tr><th>Market</th><th>Side</th><th class="num">Size</th><th class="num">Entry</th><th class="num">${ptab === 'open' ? 'Mark' : 'Exit'}</th><th class="num">Liq.</th><th class="num">Margin</th><th class="num">P&L</th><th></th></tr>
        ${positions.map((p) => `<tr><td>${esc(p.symbol)}-PERP <span class="muted">${p.leverage}x</span></td><td class="${p.side === 'long' ? 'up' : 'down'}">${esc(p.side)}</td><td class="num mono">${fmt.num(p.qty, 6)}</td><td class="num mono">${fmt.usd(p.entry)}</td><td class="num mono">${fmt.usd(ptab === 'open' ? p.mark : p.exit_price)}</td><td class="num mono">${fmt.usd(p.liq_price)}</td><td class="num">${fmt.usd(p.margin)}</td>
          <td class="num ${(ptab === 'open' ? p.unrealized_pnl : Number(p.realized_pnl)) >= 0 ? 'up' : 'down'}">${ptab === 'open' ? `${fmt.usd(p.unrealized_pnl)} (${fmt.usd(p.roe_pct)}%)` : fmt.usd(p.realized_pnl)}</td>
          <td class="num">${ptab === 'open' ? `<button class="btn small" data-close="${p.id}">Close</button>` : `<span class="badge ${p.status === 'liquidated' ? 'error' : ''}">${esc(p.status)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">No positions.</p>';
      $('#pos').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api('POST', `/perps/positions/${b.dataset.close}/close`); toast(`Closed: P&L ${fmt.usd(r.position.realized_pnl)} USDT`); App.refreshWalletChip(); loadPos(); })));
    }
    const tick = () => { $('#idx').textContent = fmt.usd(S.prices[sym]); $('#chart').innerHTML = App.sparkline(S.spark?.[sym]); };
    tick(); loadPos();
    every(3000, () => { tick(); est(); loadPos().catch(() => {}); });
  });

  route(/^\/options\/([A-Z]+)$/, async (view, sym) => {
    const chain = await api('GET', `/options/${sym}/chain`);
    let expIdx = 0;
    view.innerHTML = `<div class="section-head"><div><h1>${sym} options</h1><div class="stats"><div class="stat"><small>Spot</small><b>${fmt.usd(chain.spot)}</b></div><div class="stat"><small>Implied vol</small><b>${Math.round(chain.iv * 100)}%</b></div><div class="stat"><small>Settlement</small><b>Cash, USDT, 08:00 UTC</b></div></div></div>${symTabs('options', sym)}</div>
      <div class="card"><div class="tabs" id="exps" style="flex-wrap:wrap"></div><div id="chain" style="overflow-x:auto;margin-top:12px"></div><p class="muted" style="font-size:12px">Click a price to buy. You can sell back at the bid any time before expiry.</p></div>
      ${S.user ? '<div class="card" style="margin-top:14px"><h3>My options</h3><div id="pos"></div></div>' : ''}`;
    const draw = () => {
      $('#exps').innerHTML = chain.expiries.map((e, i) => `<button class="${i === expIdx ? 'on' : ''}" data-e="${i}">${new Date(e.expiry).toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}</button>`).join('');
      $('#exps').querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => { expIdx = Number(b.dataset.e); draw(); }));
      const ex = chain.expiries[expIdx];
      const atm = ex.rows.reduce((a, r) => (Math.abs(r.strike - chain.spot) < Math.abs(a.strike - chain.spot) ? r : a), ex.rows[0]);
      $('#chain').innerHTML = `<table class="t chain"><tr><th colspan="3" style="text-align:center">CALLS</th><th></th><th colspan="3" style="text-align:center">PUTS</th></tr>
        <tr><th>Delta</th><th class="num">Bid</th><th class="num">Ask</th><th style="text-align:center">Strike</th><th class="num">Bid</th><th class="num">Ask</th><th>Delta</th></tr>
        ${ex.rows.map((r) => `<tr class="${r === atm ? 'atm' : ''}"><td class="muted">${r.call.delta}</td><td class="num mono">${fmt.usd(r.call.bid)}</td><td class="num mono q up" data-buy="call" data-k="${r.strike}">${fmt.usd(r.call.ask)}</td>
          <td class="k">${fmt.usd(r.strike, 0)}</td><td class="num mono">${fmt.usd(r.put.bid)}</td><td class="num mono q down" data-buy="put" data-k="${r.strike}">${fmt.usd(r.put.ask)}</td><td class="muted">${r.put.delta}</td></tr>`).join('')}</table>`;
      $('#chain').querySelectorAll('[data-buy]').forEach((c) => (c.onclick = () => buyDialog(c.dataset.buy, Number(c.dataset.k), ex.expiry)));
    };
    function buyDialog(kind, strike, expiry) {
      if (!S.user) { location.hash = '#/login'; return; }
      const row = chain.expiries[expIdx].rows.find((r) => r.strike === strike)[kind];
      modal(`<h2>Buy ${sym} ${fmt.usd(strike, 0)} ${kind}</h2><p class="muted">Expires ${new Date(expiry).toUTCString()}</p>
        <label>Quantity (${sym})</label><input id="oq" inputmode="decimal" value="0.1" />
        <p id="ocost" class="muted"></p><p class="risk">Max loss is the premium paid. Pays max(0, ${kind === 'call' ? 'spot − strike' : 'strike − spot'}) × quantity at expiry.</p>
        <div class="row"><button class="btn primary" id="ogo">Buy</button><button class="btn" data-close>Cancel</button></div>`, (m, close) => {
        const upd = () => ($('#ocost', m).textContent = `Premium ≈ ${fmt.usd(row.ask * Number($('#oq', m).value || 0))} USDT + fee`);
        $('#oq', m).oninput = upd; upd();
        $('#ogo', m).onclick = (e) => busy(e.currentTarget, async () => { await api('POST', '/options/buy', { symbol: sym, kind, strike, expiry, qty: Number($('#oq', m).value) }); close(); toast('Option bought'); App.refreshWalletChip(); loadPos(); });
      });
    }
    async function loadPos() {
      if (!S.user) return;
      const [{ positions: open }, { positions: done }] = await Promise.all([api('GET', '/options/positions'), api('GET', '/options/positions?status=closed')]);
      const all = [...open, ...done.slice(0, 15)];
      $('#pos').innerHTML = all.length ? `<table class="t"><tr><th>Option</th><th>Expiry</th><th class="num">Qty</th><th class="num">Paid</th><th class="num">Value / payout</th><th class="num">P&L</th><th></th></tr>
        ${all.map((p) => `<tr><td>${esc(p.symbol)} ${fmt.usd(p.strike, 0)} <span class="${p.kind === 'call' ? 'up' : 'down'}">${esc(p.kind)}</span></td><td>${new Date(p.expiry).toLocaleString()}</td><td class="num">${p.qty}</td><td class="num">${fmt.usd(p.premium)}</td>
          <td class="num">${p.status === 'open' ? fmt.usd(p.value) : fmt.usd(p.payout)}</td><td class="num ${(p.status === 'open' ? p.pnl : Number(p.payout) - Number(p.premium)) >= 0 ? 'up' : 'down'}">${fmt.usd(p.status === 'open' ? p.pnl : Number(p.payout) - Number(p.premium))}</td>
          <td class="num">${p.status === 'open' ? `<button class="btn small" data-sell="${p.id}">Sell</button>` : `<span class="badge">${esc(p.status)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">No options yet.</p>';
      $('#pos').querySelectorAll('[data-sell]').forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api('POST', `/options/positions/${b.dataset.sell}/close`); toast(`Sold for ${fmt.usd(r.position.payout)} USDT`); App.refreshWalletChip(); loadPos(); })));
    }
    draw(); loadPos();
    every(5000, async () => { try { Object.assign(chain, await api('GET', `/options/${sym}/chain`)); if (!document.querySelector('#modal:not([hidden])')) draw(); loadPos(); } catch {} });
  });
})();
