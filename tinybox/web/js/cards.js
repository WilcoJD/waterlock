/* Trading-card exchange: browse by game → series → box / pack / single, trade, vault. */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, modal, route, every, query, needAuth } = App;

  const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const art = (p, big) => {
    const h = hue(p.sku);
    const label = p.kind === 'box' ? 'BOX' : p.kind === 'pack' ? 'PACK' : (p.number || '').padStart(3, '0');
    return `<div class="art" style="${big ? 'height:220px;font-size:48px;' : ''}background:linear-gradient(135deg,hsl(${h} 60% 32%),hsl(${(h + 60) % 360} 70% 22%))">${esc(label)}</div>`;
  };
  const priceLine = (p) => `<div class="row" style="justify-content:space-between"><b>${p.last ? `$${fmt.usd(p.last)}` : p.ask ? `$${fmt.usd(p.ask)}` : '—'}</b>${p.change_24h ? fmt.pct(p.change_24h) : `<span class="muted" style="font-size:12px">${p.ask ? 'lowest ask' : 'no listings'}</span>`}</div>`;

  route(/^\/cards$/, async (view) => {
    const { games } = await api('GET', '/cards/catalog');
    view.innerHTML = `<div class="section-head"><div><h1>Trading cards</h1><p class="muted">Vaulted cards trade instantly from your wallet. Browse by game and series.</p></div>
        <div class="row"><input id="q" placeholder="Search cards, sets…" style="min-width:240px" /><a class="btn" href="#/cards/collection">My collection</a></div></div>
      <div id="results"></div>
      ${games.map((g) => `<h2 style="margin-top:22px">${esc(g.name)}</h2><div class="prod-grid">${g.series.map((s) => `
        <a class="card tile prod" href="#/cards/series/${esc(s.id)}"><div class="art" style="background:linear-gradient(135deg,hsl(${hue(s.id)} 55% 30%),#0b0f17)">${esc(s.code)}</div>
          <h3>${esc(s.name)}</h3><p class="muted">Released ${esc(s.released || '—')}</p></a>`).join('')}</div>`).join('')}`;
    let t;
    $('#q').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = e.target.value.trim();
        if (!q) { $('#results').innerHTML = ''; return; }
        const { results } = await api('GET', `/cards/search?q=${encodeURIComponent(q)}`);
        $('#results').innerHTML = `<h2>Results</h2><div class="prod-grid">${results.map(prodCard).join('') || '<p class="muted">Nothing found.</p>'}</div>`;
      }, 250);
    };
  });

  const prodCard = (p) => `<a class="card tile prod" href="#/cards/item/${esc(p.sku)}">${art(p)}<div class="rarity">${esc(p.kind === 'single' ? `${p.rarity} · ${p.grade}` : `Sealed ${p.kind}`)}</div><h3 style="margin:4px 0 8px;font-size:15px">${esc(p.name)}</h3>${priceLine(p)}</a>`;

  route(/^\/cards\/series\/([a-z0-9-]+)$/, async (view, id) => {
    const s = await api('GET', `/cards/series/${id}`);
    const f = query().get('f') || 'all';
    const groups = [['box', 'Booster boxes'], ['pack', 'Booster packs'], ['single', 'Singles']].filter(([k]) => f === 'all' || f === k);
    view.innerHTML = `<p><a href="#/cards">← ${esc(s.game_name)}</a></p>
      <div class="section-head"><div><h1>${esc(s.name)} <span class="muted">${esc(s.code)}</span></h1><p class="muted">${esc(s.game_name)} · released ${esc(s.released || '—')} · ${s.products.length} products</p></div>
        <div class="tabs">${[['all', 'All'], ['box', 'Boxes'], ['pack', 'Packs'], ['single', 'Singles']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="location.hash='#/cards/series/${esc(id)}?f=${k}'">${l}</button>`).join('')}</div></div>
      ${groups.map(([k, l]) => { const ps = s.products.filter((p) => p.kind === k); return ps.length ? `<h2 style="margin-top:20px">${l}</h2><div class="prod-grid">${ps.map(prodCard).join('')}</div>` : ''; }).join('')}`;
  });

  route(/^\/cards\/item\/([A-Z0-9-]+)$/, async (view, sku) => {
    let p = await api('GET', `/cards/products/${sku}`);
    view.innerHTML = `<p><a href="#/cards/series/${esc(p.series_id)}">← ${esc(p.game_name)} · ${esc(p.series_name)}</a></p>
      <div class="trade-grid">
        <div class="card">${art(p, true)}
          <h2>${esc(p.name)}</h2><div class="rarity">${esc(p.kind === 'single' ? `#${p.number} · ${p.rarity} · ${p.grade}` : `Sealed ${p.kind}${p.cards_per_pack ? ` · ${p.cards_per_pack} ${p.kind === 'box' ? 'packs' : 'cards'}` : ''}`)}</div>
          <div class="stats" id="cstats" style="margin-top:12px"></div>
          ${S.user ? `<div class="row" style="margin-top:14px"><button class="btn small" id="shipin">Ship one in</button></div>` : ''}</div>
        <div class="card"><h3>Order book</h3><div id="book"></div><h3 style="margin-top:12px">Sales</h3><div id="trades"></div></div>
        <div class="card" id="form">${App.orderFormHtml({ base: 'qty', quote: 'USDT', integerQty: true, feeLabel: 'Maker 0% · Taker 3% · paid from your wallet' })}<div id="own" class="muted" style="margin-top:8px"></div></div>
      </div>`;
    const form = App.mountOrderForm($('#form'), { onSubmit: async (b) => { const r = await api('POST', `/cards/products/${sku}/orders`, { ...b, qty: Number(b.qty) }); toast(`Order ${r.order.status}`); App.refreshWalletChip(); refresh(); } });
    const si = $('#shipin'); if (si) si.onclick = () => vaultDialog('ship_in', sku, p.name);
    async function refresh() {
      p = await api('GET', `/cards/products/${sku}`);
      $('#cstats').innerHTML = `<div class="stat"><small>Last sale</small><b>${p.last ? '$' + fmt.usd(p.last) : '—'}</b></div><div class="stat"><small>Best bid</small><b class="up">${p.bid ? '$' + fmt.usd(p.bid) : '—'}</b></div><div class="stat"><small>Lowest ask</small><b class="down">${p.ask ? '$' + fmt.usd(p.ask) : '—'}</b></div><div class="stat"><small>24h sold</small><b>${p.volume_24h}</b></div>`;
      $('#book').innerHTML = App.bookHtml(p.depth, { last: p.last, qtyDecimals: 0 });
      $('#book').querySelectorAll('[data-price]').forEach((r) => (r.onclick = () => form.setPrice(r.dataset.price)));
      $('#trades').innerHTML = p.trades.length ? `<table class="t">${p.trades.slice(0, 12).map((x) => `<tr><td class="mono">$${fmt.usd(x.price)}</td><td class="num">${x.qty}×</td><td class="num muted">${fmt.date(x.time)}</td></tr>`).join('')}</table>` : '<p class="muted">No sales yet.</p>';
      if (S.user) {
        const { holdings } = await api('GET', '/cards/holdings');
        const h = holdings.find((x) => x.sku === sku);
        $('#own').textContent = h ? `You own ${h.qty}${h.locked ? ` (+${h.locked} listed/locked)` : ''}` : "You don't own this yet";
      }
    }
    await refresh();
    every(4000, () => refresh().catch(() => {}));
  });

  function vaultDialog(kind, sku, name) {
    const titles = { ship_in: 'Ship cards in to the vault', ship_out: 'Ship cards out to you', break: 'Break (open) sealed product' };
    modal(`<h2>${titles[kind]}</h2><p class="muted">${esc(name)} <code>${esc(sku)}</code></p>
      <label>Quantity</label><input id="vq" type="number" min="1" value="1" />
      ${kind === 'ship_out' ? '<label>Shipping address</label><textarea id="va" placeholder="Name, street, city, postcode, country"></textarea>' : ''}
      ${kind === 'ship_in' ? '<p class="muted">After submitting you\'ll get a reference. Send the cards to our vault with it; they appear in your collection once checked.</p>' : ''}
      ${kind === 'break' ? '<p class="muted">Staff open the sealed product on camera and add every pulled card to your collection.</p>' : ''}
      <label>Note (optional)</label><input id="vn" />
      <div class="row" style="margin-top:12px"><button class="btn primary" id="vgo">Submit</button><button class="btn" data-close>Cancel</button></div>`, (m, close) => {
      $('#vgo', m).onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('POST', '/cards/requests', { kind, sku, qty: Number($('#vq', m).value), address: $('#va', m)?.value, note: $('#vn', m).value });
        close(); toast(`Request #${r.request.id} submitted`); App.render();
      });
    });
  }

  route(/^\/cards\/collection$/, needAuth(async (view) => {
    const tab = query().get('tab') || 'holdings';
    view.innerHTML = `<div class="section-head"><div><h1>My collection</h1><p class="muted">Cards held in the vault on your behalf.</p></div>
      <div class="tabs">${[['holdings', 'Holdings'], ['orders', 'Open orders'], ['vault', 'Vault requests']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/cards/collection?tab=${k}'">${l}</button>`).join('')}</div></div><div class="card" id="pane"></div>`;
    const pane = $('#pane');
    if (tab === 'holdings') {
      const { holdings } = await api('GET', '/cards/holdings');
      const total = holdings.reduce((a, h) => a + Number(h.last || 0) * (h.qty + h.locked), 0);
      pane.innerHTML = holdings.length ? `<p>Estimated value <b>$${fmt.usd(total)}</b></p><table class="t"><tr><th>Item</th><th>Series</th><th class="num">Qty</th><th class="num">Locked</th><th class="num">Last</th><th></th></tr>
        ${holdings.map((h) => `<tr><td><a href="#/cards/item/${esc(h.sku)}">${esc(h.name)}</a> <span class="muted">${esc(h.kind === 'single' ? h.grade : 'sealed ' + h.kind)}</span></td><td>${esc(h.series_name)}</td><td class="num">${h.qty}</td><td class="num muted">${h.locked}</td><td class="num">${h.last ? '$' + fmt.usd(h.last) : '—'}</td>
          <td class="num"><a class="btn small" href="#/cards/item/${esc(h.sku)}">Sell</a> ${h.qty ? `<button class="btn small" data-v="ship_out" data-sku="${esc(h.sku)}" data-name="${esc(h.name)}">Ship out</button>${h.kind !== 'single' ? ` <button class="btn small" data-v="break" data-sku="${esc(h.sku)}" data-name="${esc(h.name)}">Break</button>` : ''}` : ''}</td></tr>`).join('')}</table>`
        : '<p class="muted">Your collection is empty. Buy cards on the exchange, or ship some in from an item page.</p><a class="btn" href="#/cards">Browse cards</a>';
      pane.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => vaultDialog(b.dataset.v, b.dataset.sku, b.dataset.name)));
    }
    if (tab === 'orders') {
      const { orders } = await api('GET', '/cards/orders');
      pane.innerHTML = orders.length ? `<table class="t"><tr><th>Item</th><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Filled</th><th></th></tr>${orders.map((o) => `<tr><td><a href="#/cards/item/${esc(o.market.slice(5))}">${esc(o.market.slice(5))}</a></td><td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side)}</td><td class="num">$${fmt.usd(o.price)}</td><td class="num">${o.qty}</td><td class="num">${o.filled}</td><td class="num"><button class="btn small danger" data-c="${o.id}">Cancel</button></td></tr>`).join('')}</table>` : '<p class="muted">No open orders.</p>';
      pane.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => busy(b, async () => { await api('DELETE', `/cards/orders/${b.dataset.c}`); toast('Cancelled'); App.refreshWalletChip(); App.render(); })));
    }
    if (tab === 'vault') {
      const { requests } = await api('GET', '/cards/requests');
      pane.innerHTML = requests.length ? `<table class="t"><tr><th>#</th><th>Type</th><th>Item</th><th class="num">Qty</th><th>Status</th><th>Tracking / result</th></tr>${requests.map((r) => `<tr><td>${r.id}</td><td>${esc(r.kind.replace('_', ' '))}</td><td>${esc(r.sku)}</td><td class="num">${r.qty}</td><td><span class="badge ${r.status === 'completed' ? 'active' : r.status === 'rejected' ? 'error' : 'provisioning'}">${esc(r.status)}</span></td><td class="muted">${esc(r.tracking || '')}${r.result ? r.result.map((x) => `${x.qty}× ${esc(x.sku)}`).join(', ') : ''}</td></tr>`).join('')}</table>` : '<p class="muted">No vault requests.</p>';
    }
  }));
})();
