/* Spot exchange: markets list and trading screen. Also exports the order book + order form widgets used by cards. */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, route, every, needAuth } = App;

  function bookHtml(depth, { last, qtyDecimals = 6 } = {}) {
    const max = Math.max(1, ...depth.asks.map(([, q]) => Number(q)), ...depth.bids.map(([, q]) => Number(q)));
    const row = ([p, q], side) => `<div class="row2" data-price="${esc(p)}" style="cursor:pointer"><div class="bar" style="width:${(Number(q) / max) * 100}%;background:var(--${side === 'ask' ? 'down' : 'up'})"></div><span class="${side === 'ask' ? 'down' : 'up'}">${fmt.num(p, 4)}</span><span>${fmt.num(q, qtyDecimals)}</span></div>`;
    return `<div class="ob"><div class="row2 muted"><span>Price</span><span>Size</span></div>
      ${depth.asks.slice(0, 12).reverse().map((l) => row(l, 'ask')).join('') || '<div class="muted" style="padding:6px">No asks</div>'}
      <div class="mid">${last ? fmt.num(last, 4) : '—'}</div>
      ${depth.bids.slice(0, 12).map((l) => row(l, 'bid')).join('') || '<div class="muted" style="padding:6px">No bids</div>'}</div>`;
  }

  /**
   * Order form. opts: { base, quote, onSubmit(body), integerQty, feeLabel }
   * Returns html; call mountForm(root, opts) after inserting.
   */
  function formHtml({ base, quote, integerQty, feeLabel }) {
    return `<div class="side-toggle"><button class="buy on" data-side="buy">Buy</button><button class="sell" data-side="sell">Sell</button></div>
      <div class="tabs" style="margin-bottom:8px"><button class="on" data-type="limit">Limit</button><button data-type="market">Market</button></div>
      <label>Price (${esc(quote)})</label><input id="of-price" inputmode="decimal" placeholder="0.00" />
      <label>Quantity (${esc(base)})</label><input id="of-qty" inputmode="decimal" placeholder="${integerQty ? '1' : '0.00'}" />
      <p class="muted" id="of-total" style="margin:8px 0">Total —</p>
      ${S.user ? '<button class="btn primary" id="of-go" style="width:100%;justify-content:center">Buy</button>' : '<a class="btn primary" href="#/login" style="width:100%;justify-content:center">Log in to trade</a>'}
      <p class="muted" style="font-size:12px">${esc(feeLabel || '')}</p>`;
  }
  function mountForm(root, { onSubmit }) {
    let side = 'buy', type = 'limit';
    const price = $('#of-price', root), qty = $('#of-qty', root), go = $('#of-go', root), total = $('#of-total', root);
    const upd = () => {
      root.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
      root.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
      price.disabled = type === 'market'; if (type === 'market') price.value = '';
      const t = Number(price.value) * Number(qty.value);
      total.textContent = type === 'limit' && t ? `Total ≈ ${fmt.num(t, 4)}` : type === 'market' ? 'Executes at the best available prices' : 'Total —';
      if (go) { go.textContent = side === 'buy' ? 'Buy' : 'Sell'; go.className = `btn ${side === 'buy' ? 'primary' : 'sell'}`; go.style.width = '100%'; go.style.justifyContent = 'center'; }
    };
    root.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; upd(); }));
    root.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => { type = b.dataset.type; upd(); }));
    price.oninput = qty.oninput = upd;
    if (go) go.onclick = () => busy(go, async () => { await onSubmit({ side, type, price: price.value.trim(), qty: qty.value.trim() }); qty.value = ''; upd(); });
    upd();
    return { setPrice: (p) => { if (type === 'limit') { price.value = p; upd(); } } };
  }
  App.bookHtml = bookHtml; App.orderFormHtml = formHtml; App.mountOrderForm = mountForm;

  route(/^\/markets$/, async (view) => {
    const { markets, backend } = await api('GET', '/spot/markets');
    view.innerHTML = `<div class="section-head"><div><h1>Markets</h1><p class="muted">Spot trading against USDT${backend === 'opex' ? ' on the OPEX matching engine' : ''}.</p></div></div>
      <div class="card"><table class="t"><tr><th>Market</th><th class="num">Last</th><th class="num">24h</th><th class="num">Bid</th><th class="num">Ask</th><th class="num">24h volume</th><th></th></tr>
      ${markets.map((m) => `<tr class="click" onclick="location.hash='#/trade/${esc(m.market)}'"><td><b>${esc(m.base)}</b><span class="muted">/${esc(m.quote)}</span></td><td class="num mono">${fmt.num(m.last ?? S.prices[m.base], 4)}</td><td class="num">${fmt.pct(m.change_24h)}</td><td class="num mono up">${fmt.num(m.bid, 4)}</td><td class="num mono down">${fmt.num(m.ask, 4)}</td><td class="num">${fmt.num(m.volume_24h, 4)}</td><td class="num"><a class="btn small" href="#/trade/${esc(m.market)}">Trade</a></td></tr>`).join('')}
      </table></div>`;
  });

  route(/^\/trade\/([A-Z0-9]+_[A-Z0-9]+)$/, async (view, market) => {
    const [base, quote] = market.split('_');
    view.innerHTML = `<div class="section-head"><div><h1>${base}<span class="muted">/${quote}</span></h1><div class="stats" id="tstats"></div></div>
        <div class="row">${['BTC', 'ETH', 'SOL'].filter((b) => b !== base).map((b) => `<a class="btn small" href="#/trade/${b}_USDT">${b}/USDT</a>`).join('')}</div></div>
      <div class="trade-grid">
        <div class="card"><h3>Order book</h3><div id="book"></div></div>
        <div class="card"><h3>${base} price</h3><div id="chart"></div><h3 style="margin-top:12px">Recent trades</h3><div id="trades" style="max-height:260px;overflow:auto"></div></div>
        <div class="card" id="form">${formHtml({ base, quote, feeLabel: 'Maker 0% · Taker 0.10%' })}<div id="bal" class="muted" style="margin-top:8px"></div></div>
      </div>
      ${S.user ? '<div class="card" style="margin-top:14px"><h3>My open orders</h3><div id="orders"></div></div>' : ''}`;
    const form = mountForm($('#form'), { onSubmit: async (b) => { const r = await api('POST', `/spot/${market}/orders`, b); toast(`Order ${r.order.status} · filled ${r.order.filled} ${base}`); refresh(); App.refreshWalletChip(); } });
    async function refresh() {
      const [depth, { trades }, { markets }] = await Promise.all([api('GET', `/spot/${market}/depth`), api('GET', `/spot/${market}/trades`), api('GET', '/spot/markets')]);
      const t = markets.find((m) => m.market === market) || {};
      $('#tstats').innerHTML = `<div class="stat"><small>Last</small><b>${fmt.num(t.last, 4)}</b></div><div class="stat"><small>24h</small><b>${fmt.pct(t.change_24h)}</b></div><div class="stat"><small>Index</small><b>${fmt.usd(S.prices[base])}</b></div><div class="stat"><small>24h vol</small><b>${fmt.num(t.volume_24h, 4)}</b></div>`;
      $('#book').innerHTML = bookHtml(depth, { last: t.last });
      $('#book').querySelectorAll('[data-price]').forEach((r) => (r.onclick = () => form.setPrice(r.dataset.price)));
      $('#chart').innerHTML = App.sparkline(S.spark?.[base]);
      $('#trades').innerHTML = trades.length ? `<table class="t">${trades.slice(0, 30).map((x) => `<tr><td class="mono ${x.side === 'buy' ? 'up' : 'down'}">${fmt.num(x.price, 4)}</td><td class="num mono">${fmt.num(x.qty, 6)}</td><td class="num muted">${new Date(String(x.time).replace(' ', 'T') + (String(x.time).includes('Z') ? '' : 'Z')).toLocaleTimeString()}</td></tr>`).join('')}</table>` : '<p class="muted">No trades yet.</p>';
      if (S.user) {
        const [{ open }, w] = await Promise.all([api('GET', `/spot/orders?market=${market}`), api('GET', '/wallet')]);
        const b = (a) => w.balances.find((x) => x.asset === a)?.balance || '0';
        $('#bal').innerHTML = `Available: ${fmt.num(b(quote), 2)} ${quote} · ${fmt.num(b(base), 8)} ${base}`;
        $('#orders').innerHTML = open.length ? `<table class="t"><tr><th>Side</th><th>Type</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Filled</th><th></th></tr>${open.map((o) => `<tr><td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.type)}</td><td class="num mono">${fmt.num(o.price, 4)}</td><td class="num mono">${fmt.num(o.qty)}</td><td class="num mono">${fmt.num(o.filled)}</td><td class="num"><button class="btn small danger" data-cancel="${esc(o.id)}">Cancel</button></td></tr>`).join('')}</table>` : '<p class="muted">No open orders.</p>';
        $('#orders').querySelectorAll('[data-cancel]').forEach((btn) => (btn.onclick = () => busy(btn, async () => { await api('DELETE', `/spot/${market}/orders/${btn.dataset.cancel}`); toast('Cancelled'); refresh(); })));
      }
    }
    await refresh();
    every(3000, () => refresh().catch(() => {}));
  });
})();
