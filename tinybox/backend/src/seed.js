'use strict';
/**
 * Reference data: wallet assets, spot markets and an example trading-card
 * catalogue (fictional games – replace with your real inventory).
 * Uses INSERT OR IGNORE so admins' edits are never overwritten.
 */
const { toUnits } = require('./money');

const ASSETS = [
  { symbol: 'USDT', name: 'Tether USD', chains: ['TRC20', 'ERC20'], withdraw_fee: '1', min_withdraw: '10', sort: 0 },
  { symbol: 'BTC', name: 'Bitcoin', chains: ['BTC'], withdraw_fee: '0.0002', min_withdraw: '0.001', sort: 1 },
  { symbol: 'ETH', name: 'Ethereum', chains: ['ERC20'], withdraw_fee: '0.002', min_withdraw: '0.01', sort: 2 },
  { symbol: 'SOL', name: 'Solana', chains: ['SOL'], withdraw_fee: '0.01', min_withdraw: '0.1', sort: 3 },
];

const SPOT = [
  { base: 'BTC', tick: '0.1', min: '0.00001' },
  { base: 'ETH', tick: '0.01', min: '0.0001' },
  { base: 'SOL', tick: '0.001', min: '0.01' },
];

const CARDS = [
  { id: 'aether', name: 'Aetherbound', series: [
    { id: 'aether-gen', name: 'Genesis', code: 'AEG', released: '2025-03-01', singles: [
      ['001', 'Pyrewing Drake', 'Secret Rare'], ['014', 'Tidecaller Mira', 'Ultra Rare'], ['027', 'Ironbark Sentinel', 'Rare'],
      ['033', 'Voltfang Lynx', 'Rare'], ['058', 'Moss Whelp', 'Common'], ['072', 'Shardling', 'Uncommon'] ] },
    { id: 'aether-storm', name: 'Stormfront', code: 'AES', released: '2025-09-12', singles: [
      ['002', 'Tempest Sovereign', 'Secret Rare'], ['019', 'Gale Rider Ash', 'Ultra Rare'], ['040', 'Thunderhide Ox', 'Rare'], ['066', 'Static Sprite', 'Common'] ] },
  ] },
  { id: 'kaiju', name: 'Kaiju Clash', series: [
    { id: 'kaiju-w1', name: 'First Wave', code: 'KC1', released: '2024-11-20', singles: [
      ['001', 'Gorrath the Undying', 'Mythic'], ['007', 'Neon Leviathan', 'Legendary'], ['021', 'Harbor Crusher', 'Rare'], ['045', 'Scout Drone', 'Common'] ] },
    { id: 'kaiju-w2', name: 'Neon Tides', code: 'KC2', released: '2026-04-05', singles: [
      ['003', 'Abyssal Empress', 'Mythic'], ['012', 'Reef Titan', 'Legendary'], ['030', 'Coral Breaker', 'Rare'] ] },
  ] },
];

function seed(db) {
  const insAsset = db.prepare('INSERT OR IGNORE INTO assets (symbol,name,chains,withdraw_fee,min_withdraw,sort) VALUES (?,?,?,?,?,?)');
  for (const a of ASSETS) insAsset.run(a.symbol, a.name, JSON.stringify(a.chains), toUnits(a.withdraw_fee), toUnits(a.min_withdraw), a.sort);

  const insMarket = db.prepare('INSERT OR IGNORE INTO markets (id,kind,base,quote,base_scale,tick,min_qty,taker_fee_bps) VALUES (?,?,?,?,?,?,?,?)');
  for (const m of SPOT) insMarket.run(`${m.base}_USDT`, 'spot', m.base, 'USDT', 1e8, toUnits(m.tick), toUnits(m.min), 10);

  const insGame = db.prepare('INSERT OR IGNORE INTO card_games (id,name,sort) VALUES (?,?,?)');
  const insSeries = db.prepare('INSERT OR IGNORE INTO card_series (id,game_id,name,code,released,sort) VALUES (?,?,?,?,?,?)');
  const insProd = db.prepare('INSERT OR IGNORE INTO card_products (sku,series_id,kind,name,number,rarity,grade,cards_per_pack) VALUES (?,?,?,?,?,?,?,?)');
  CARDS.forEach((g, gi) => {
    insGame.run(g.id, g.name, gi);
    g.series.forEach((s, si) => {
      insSeries.run(s.id, g.id, s.name, s.code, s.released, si);
      const products = [
        [`${s.code}-BOX`, 'box', `${s.name} Booster Box`, null, null, 'SEALED', 36],
        [`${s.code}-PACK`, 'pack', `${s.name} Booster Pack`, null, null, 'SEALED', 10],
      ];
      for (const [num, name, rarity] of s.singles) {
        products.push([`${s.code}-${num}`, 'single', name, num, rarity, 'RAW', null]);
        if (/Secret|Mythic|Ultra|Legendary/.test(rarity)) products.push([`${s.code}-${num}-G10`, 'single', name, num, rarity, 'GRADE 10', null]);
      }
      for (const p of products) {
        insProd.run(p[0], s.id, p[1], p[2], p[3], p[4], p[5], p[6]);
        insMarket.run(`CARD:${p[0]}`, 'card', p[0], 'USDT', 1, toUnits('0.01'), 1, 300);
      }
    });
  });
}

module.exports = { seed, ASSETS };
