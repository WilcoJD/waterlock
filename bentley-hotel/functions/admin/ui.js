/**
 * Admin front-end for the Bentley Hotel website: one HTML document with an inline <style> and a single
 * inline <script> (no frameworks, no CDNs, no build step). functions/admin/[[path]].js serves
 * adminHtml({ loggedIn }) at /admin and /admin/*; the page talks to the JSON API under /admin/api/*
 * described in docs/architecture.md (same-origin fetch, "X-Requested-With: fetch", 401 = show login).
 *
 * The browser code is an ordinary function (clientApp) embedded with Function.prototype.toString(), so
 * Node checks its syntax when this module loads and nothing needs escaping inside the HTML template.
 * clientApp must stay self-contained: it cannot see anything else in this module.
 */

export function adminHtml({ loggedIn = false } = {}) {
  const boot = JSON.stringify({ loggedIn: Boolean(loggedIn) });
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Bentley Hotel admin</title>
<link rel="icon" href="/favicon.svg">
<style>${CSS}</style>
</head>
<body>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>

<div id="login" class="login" hidden>
  <form id="login-form" class="login__card" novalidate>
    <div class="brand brand--login">${MARK}<span>Bentley Hotel<small>Website admin</small></span></div>
    <h1>Sign in</h1>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    <p id="login-error" class="error" role="alert"></p>
    <button class="btn btn--primary btn--block" type="submit">Sign in</button>
  </form>
</div>

<div id="app" class="shell" hidden>
  <aside class="side">
    <a class="brand" href="#/dashboard">${MARK}<span>Bentley Hotel<small>Admin</small></span></a>
    <nav id="nav" class="nav" aria-label="Admin sections">
      <a href="#/dashboard" data-nav="dashboard">Dashboard</a>
      <a href="#/pages" data-nav="pages">Pages</a>
      <a href="#/landing" data-nav="landing">Landing pages</a>
      <a href="#/events" data-nav="events">Events</a>
      <a href="#/posts" data-nav="posts">Blog</a>
      <a href="#/media" data-nav="media">Media</a>
      <a href="#/backlinks" data-nav="backlinks">Backlinks</a>
      <a href="#/redirects" data-nav="redirects">Redirects</a>
      <a href="#/seo" data-nav="seo">SEO</a>
      <a href="#/themes" data-nav="themes">Themes</a>
      <a href="#/settings" data-nav="settings">Settings</a>
    </nav>
    <div class="side__foot">
      <a class="btn btn--side" href="/" target="_blank" rel="noopener">Open site</a>
      <button class="btn btn--side" type="button" data-action="logout">Sign out</button>
    </div>
  </aside>
  <main id="main"><div id="view"></div></main>
</div>

<dialog id="dlg" class="dlg"></dialog>
<script>(${clientApp.toString()})(${boot});</script>
</body>
</html>`;
}

const MARK = '<svg class="brand__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M6 46V20C6 10 14 3 24 3s18 7 18 17v26Z" fill="#17302a"/><path d="M9.5 43V20.5C9.5 12.4 16 6.5 24 6.5s14.5 5.9 14.5 14V43Z" fill="none" stroke="#b8925a" stroke-width="1.2"/><text x="24" y="35" text-anchor="middle" font-family="Georgia, serif" font-size="25" font-weight="600" fill="#f1dcb4">B</text></svg>';

const CSS = `
:root{--green:#17302a;--green-700:#285046;--green-100:#e3ece8;--brass:#8a6838;--brass-500:#b8925a;--bg:#f4f2ec;--paper:#fff;--ink:#1d2320;--muted:#5d6661;--line:#dcd6c8;--danger:#a23b2a;--ok:#2d6a4f;--warn:#8a5a12;--r:8px;--font:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}html{font:15px/1.45 var(--font);color:var(--ink);background:var(--bg);-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh}
[hidden]{display:none!important}a{color:var(--green-700)}code{font:.9em var(--mono);background:#efece4;padding:1px 4px;border-radius:3px}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px}h1:focus{outline:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
h1{font-size:1.5rem;margin:0 0 16px;font-weight:650}h2{font-size:1.05rem;margin:0 0 10px}h3{font-size:.95rem;margin:14px 0 8px;color:var(--muted)}p{margin:0 0 10px}
.shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
.side{background:var(--green);color:#f3eee2;padding:14px 12px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:10px;padding:4px 6px 14px;color:#fff;text-decoration:none;font-weight:600;line-height:1.15}.brand small{display:block;font-weight:400;font-size:.78rem;opacity:.75}.brand__mark{width:34px;height:34px;flex:none}
.brand--login{color:var(--ink);padding:0 0 14px}.brand--login small{color:var(--muted)}
.nav a{display:block;padding:8px 10px;border-radius:6px;color:#dfe8e2;text-decoration:none}.nav a:hover{background:rgba(255,255,255,.08)}.nav a[aria-current=page]{background:var(--brass);color:#fff}.nav a:focus-visible{outline-color:#f1dcb4}
.side__foot{margin-top:auto;display:flex;gap:8px;flex-wrap:wrap}.btn--side{background:transparent;color:#f3eee2;border-color:rgba(255,255,255,.3);flex:1;justify-content:center}.btn--side:hover{background:rgba(255,255,255,.1)}
main{padding:22px clamp(16px,3vw,40px) 60px;min-width:0}
.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.head h1,.head h2{margin:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row .field{margin:0}
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:16px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.grid--wide{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid2{display:grid;gap:4px 14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.span2{grid-column:1/-1}
.stat{display:block;background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;text-decoration:none;color:inherit}.stat:hover{border-color:var(--brass)}.stat strong{display:block;font-size:1.9rem;line-height:1.1;color:var(--green)}.stat small{font-size:.8rem;color:var(--muted);font-weight:400}
.notice{background:var(--green-100);border:1px solid #c6d8cf;border-radius:var(--r);padding:10px 14px;margin-bottom:14px}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}.field>label,legend,.field__row label{font-weight:600;font-size:.88rem}.field__row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
input,select,textarea{font:inherit;color:inherit;background:#fff;border:1px solid var(--line);border-radius:6px;padding:7px 9px;width:100%;min-width:0}input[readonly]{background:#f1efe9;color:var(--muted)}input[type=checkbox]{width:18px;height:18px;padding:0;margin:0;accent-color:var(--green)}
textarea{min-height:84px;resize:vertical;line-height:1.4}textarea.code{font:13px/1.45 var(--mono);min-height:160px;tab-size:2;white-space:pre-wrap}
.check{display:flex;align-items:center;gap:8px;margin:4px 0 10px;font-weight:500;cursor:pointer}
.hint{margin:0;font-size:.8rem;color:var(--muted)}.count{font-size:.78rem;color:var(--muted);font-weight:400}.count.over{color:var(--danger);font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-weight:600;padding:8px 14px;border-radius:6px;border:1px solid var(--green);background:#fff;color:var(--green);cursor:pointer;text-decoration:none;line-height:1.2;white-space:nowrap}
.btn:hover{background:var(--green-100)}.btn--primary{background:var(--green);color:#fff}.btn--primary:hover{background:var(--green-700)}.btn--brass{background:var(--brass);border-color:var(--brass);color:#fff}.btn--brass:hover{background:#755730}
.btn--danger{border-color:#d9b3ab;color:var(--danger)}.btn--danger:hover{background:#f8e7e3}.btn--ghost{border-color:var(--line)}.btn--small{padding:5px 10px;font-size:.85rem}.btn--block{width:100%}.btn[disabled]{opacity:.55;cursor:default}
.iconbtn{font:inherit;font-size:1rem;line-height:1;background:none;border:1px solid transparent;border-radius:6px;padding:5px 8px;cursor:pointer;color:var(--muted)}.iconbtn:hover{background:var(--green-100);color:var(--green)}.iconbtn--danger:hover{background:#f8e7e3;color:var(--danger)}.iconbtn[disabled]{opacity:.35;cursor:default}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.74rem;font-weight:600;background:#ebe8e0;color:#4b4f4a;text-transform:capitalize;white-space:nowrap}
.badge--published,.badge--live,.badge--ok{background:#dcefe3;color:var(--ok)}.badge--draft,.badge--unchecked,.badge--warn{background:#f3ead3;color:var(--warn)}.badge--missing,.badge--error{background:#f6dcd6;color:var(--danger)}.badge--system,.badge--dark{background:#e4e1ea;color:#4a3f6b}
.tag{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;background:var(--green-100);color:var(--green);padding:2px 7px;border-radius:4px;font-weight:700;white-space:nowrap}
.table-wrap{overflow-x:auto;background:var(--paper);border:1px solid var(--line);border-radius:var(--r)}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:9px 12px;text-align:left;border-top:1px solid var(--line);vertical-align:middle}.table th{background:#f7f5ef;border-top:0;font-size:.84rem}.table td a.title{font-weight:600;text-decoration:none}.actions{display:flex;gap:6px;flex-wrap:wrap}.table .row{flex-wrap:nowrap}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.toolbar .field{margin:0;flex:1;min-width:160px}.toolbar select{width:auto}
.editor__bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0 12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);margin-bottom:16px}.editor__bar h1{margin:0;font-size:1.25rem}
.dirty{font-size:.85rem;color:var(--warn);font-weight:600}
.editor__cols{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:20px;align-items:start}
.sec{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);margin-bottom:10px}.sec__bar{display:flex;align-items:center;gap:6px;padding:4px 6px}
.sec__toggle{flex:1;display:flex;align-items:center;gap:10px;text-align:left;font:inherit;background:none;border:0;padding:7px 6px;cursor:pointer;color:inherit;min-width:0;border-radius:6px}.sec__toggle:hover{background:#f7f5ef}
.sec__toggle::before{content:"\\25B8";color:var(--muted);flex:none}.sec.is-open .sec__toggle::before{content:"\\25BE"}
.sec__sum{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem}.sec__tools{display:flex;gap:2px;flex:none}
.sec__body{padding:6px 14px 14px;border-top:1px solid var(--line)}
.rep__item{border:1px solid var(--line);border-radius:6px;padding:8px 10px 2px;margin-bottom:8px;background:#fbfaf7}.rep__bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.rep__n{font-size:.8rem;font-weight:700;color:var(--muted)}
.imgfield{display:flex;gap:8px;align-items:center}.imgfield input{flex:1}.thumb{width:46px;height:36px;object-fit:cover;border-radius:4px;background:#eee;flex:none}
.addsec{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.addsec .field{flex:1;min-width:200px;margin:0}
.md-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.md-split textarea{min-height:460px}
.md-preview{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:16px 20px;min-height:460px;overflow:auto;line-height:1.6}.md-preview img{max-width:100%}.md-preview pre{background:#f1efe9;padding:10px;overflow:auto;border-radius:6px}
.media{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}.media__card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:10px;display:flex;flex-direction:column;gap:8px}.media__img{aspect-ratio:4/3;object-fit:cover;width:100%;background:#eee;border-radius:6px}.media__file{aspect-ratio:4/3;display:grid;place-items:center;background:#efece4;border-radius:6px;color:var(--muted);font-weight:600}.media__name{font-weight:600;word-break:break-all;font-size:.9rem}
.upload{position:relative;display:inline-block}.upload:focus-within .btn{outline:2px solid var(--brass);outline-offset:2px}
.themes{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.theme{text-align:left;font:inherit;color:inherit;background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px}.theme:hover{border-color:var(--brass)}.theme[aria-pressed=true]{border-color:var(--brass);box-shadow:0 0 0 2px var(--brass)}
.swatches{display:flex;gap:5px}.swatch{width:30px;height:30px;border-radius:50%;border:1px solid rgba(0,0,0,.12)}.tags{display:flex;gap:4px;flex-wrap:wrap}
.dlg{border:0;border-radius:10px;padding:0;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 32px);box-shadow:0 20px 60px rgba(0,0,0,.35);color:var(--ink);background:var(--paper)}.dlg--wide{width:min(1240px,calc(100vw - 32px));height:calc(100vh - 32px)}
.dlg[open]{display:flex;flex-direction:column}.dlg::backdrop{background:rgba(16,36,32,.55)}
.dlg__head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.dlg__head h2{margin:0;font-size:1.05rem}.dlg__body{padding:16px;overflow:auto;flex:1;display:flex;flex-direction:column;min-height:0}.dlg__foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
.pv-bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}.pv{flex:1;width:100%;min-height:300px;border:1px solid var(--line);background:#fff;border-radius:6px;transition:width .15s}.pv--phone{width:390px;max-width:100%;margin:0 auto}.btn[aria-pressed=true]{background:var(--green);color:#fff}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:8px}.tile{font:inherit;font-size:.8rem;color:inherit;background:#fff;border:1px solid var(--line);border-radius:6px;padding:6px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:4px}.tile:hover{border-color:var(--brass)}.tile img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;background:#eee}.tile span{word-break:break-all}
.toasts{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 32px))}.toast{background:var(--green);color:#fff;padding:10px 14px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.2)}.toast--error{background:var(--danger)}
.login{min-height:100vh;display:grid;place-items:center;padding:16px}.login__card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:28px;width:min(380px,100%)}
.error{color:var(--danger);font-weight:600;min-height:1.4em}.empty{color:var(--muted);padding:22px;text-align:center;background:var(--paper);border:1px dashed var(--line);border-radius:var(--r)}.loading{color:var(--muted)}
.issues{margin:0;padding-left:0;list-style:none}.issues li{display:flex;gap:8px;align-items:baseline;margin:2px 0}
@media (max-width:820px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;padding:8px 12px;gap:2px}.brand{padding:4px 6px 8px}.nav{display:flex;gap:2px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}.nav a{white-space:nowrap;padding:6px 10px}.side__foot{margin-top:4px}
main{padding:16px 16px 60px}.editor__cols,.md-split{grid-template-columns:1fr}.editor__bar{position:static}
.table thead{display:none}.table tr{display:block;border-top:1px solid var(--line);padding:6px 0}.table tr:first-child{border-top:0}.table td{display:flex;gap:10px;border:0;padding:4px 12px;align-items:center}.table td::before{content:attr(data-l);font-weight:600;min-width:84px;color:var(--muted);font-size:.82rem;flex:none}}
`;

function clientApp(BOOT) {
  'use strict';

  /* ------------------------------------------------------------------ helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let idSeq = 0;
  const uid = () => 'f' + (++idSeq);
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };
  const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');
  const encSlug = (s) => String(s).split('/').map(encodeURIComponent).join('/');
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const list = (r, key) => (Array.isArray(r) ? r : r && Array.isArray(r[key]) ? r[key] : r && Array.isArray(r.items) ? r.items : []);
  const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const BUILTIN = { exterior: '700', 'room-single-1': '800', 'room-single-2': '800', 'room-twin-1': '800', 'room-twin-2': '800', 'room-double-1': '800', 'room-double-2': '800', 'room-double-3': '800', 'room-family-1': '800' };
  function imgUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (BUILTIN[v]) return '/assets/img/' + v + '-' + BUILTIN[v] + '.jpg';
    if (/^(https?:)?\/\//i.test(v) || v.startsWith('/') || v.startsWith('data:')) return v;
    return '/' + v;
  }
  const liveUrl = (slug) => (slug === 'index' ? '/' : '/' + slug);
  const postUrl = (slug) => '/blog/' + slug;
  const LOADING = '<p class="loading" role="status">Loading…</p>';
  const KIND_LABEL = { page: 'page', landing: 'landing page', event: 'event', system: 'system page' };

  /* ------------------------------------------------------------------- state */
  const state = { loggedIn: Boolean(BOOT.loggedIn), model: null, editor: null, rerender: null, onField: null, list: null, media: null, settings: null, themes: null, backlinks: [] };

  /* --------------------------------------------------------------------- API */
  class ApiError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }
  async function api(method, path, body, opts = {}) {
    const headers = { 'X-Requested-With': 'fetch', Accept: opts.raw ? 'text/html, application/json' : 'application/json' };
    const init = { method, headers, credentials: 'same-origin' };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, init); } catch (e) { throw new ApiError('Network error: ' + e.message, 0); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    if (res.status === 401) {
      if (!/\/login$/.test(path)) showLogin();
      throw new ApiError((data && data.error) || 'Please sign in again', 401, data);
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || (typeof data === 'string' && data.slice(0, 200)) || res.statusText || 'Request failed';
      throw new ApiError(msg, res.status, data);
    }
    return data;
  }
  async function loadSettings(force) {
    if (!state.settings || force) { const r = await api('GET', '/admin/api/settings'); state.settings = r && r.site ? r : { site: r || {}, version: null }; }
    if (!state.settings.site) state.settings.site = {};
    return state.settings;
  }
  async function saveSettings(site) {
    const r = await api('PUT', '/admin/api/settings', { site });
    state.settings = state.settings || {};
    state.settings.site = (r && r.site) || site;
    return state.settings;
  }
  async function loadThemes() { if (!state.themes) state.themes = list(await api('GET', '/admin/api/themes'), 'themes'); return state.themes; }
  async function loadMedia(force) { if (!state.media || force) state.media = list(await api('GET', '/admin/api/media'), 'media'); return state.media; }

  /* ------------------------------------------------------------ toasts, dialogs */
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), type === 'error' ? 8000 : 3500);
  }
  function fail(e) { if (e && e.status === 401) return; console.warn(e); toast((e && e.message) || String(e), 'error'); }

  const dlg = $('#dlg');
  async function openDialog({ title, body, buttons = [], wide = false, onOpen }) {
    if (dlg.open) { dlg.close(); await new Promise((r) => setTimeout(r, 0)); }
    return new Promise((resolve) => {
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue || null); };
      dlg.addEventListener('close', onClose);
      dlg.className = 'dlg' + (wide ? ' dlg--wide' : '');
      dlg.setAttribute('aria-labelledby', 'dlg-title');
      dlg.innerHTML = `<div class="dlg__head"><h2 id="dlg-title">${esc(title)}</h2><button class="iconbtn" type="button" data-action="dlg-close" aria-label="Close">✕</button></div><div class="dlg__body">${body}</div>` +
        (buttons.length ? `<div class="dlg__foot">${buttons.map((b) => `<button type="button" class="btn ${b.cls || ''}" data-action="dlg-close" data-value="${esc(b.value)}">${esc(b.label)}</button>`).join('')}</div>` : '');
      dlg.returnValue = '';
      dlg.showModal();
      if (onOpen) onOpen(dlg);
      const first = $('.dlg__body input, .dlg__body select, .dlg__body textarea, .dlg__body button', dlg) || $('.dlg__foot .btn--primary, .dlg__foot .btn--danger', dlg);
      if (first) first.focus();
    });
  }
  function closeDialog(value) { if (dlg.open) dlg.close(value || ''); }
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'dlg-input') { e.preventDefault(); closeDialog('ok'); } });
  async function confirmDialog(message, { ok = 'OK', danger = false, title = 'Please confirm', extra = '' } = {}) {
    const r = await openDialog({ title, body: `<p>${esc(message)}</p>${extra}`, buttons: [{ label: 'Cancel', value: 'cancel', cls: 'btn--ghost' }, { label: ok, value: 'ok', cls: danger ? 'btn--danger' : 'btn--primary' }] });
    return r === 'ok';
  }
  async function promptDialog(title, label, value) {
    const r = await openDialog({ title, body: `<div class="field"><label for="dlg-input">${esc(label)}</label><input id="dlg-input" type="text" value="${esc(value || '')}"></div>`, buttons: [{ label: 'Cancel', value: 'cancel', cls: 'btn--ghost' }, { label: 'OK', value: 'ok', cls: 'btn--primary' }] });
    return r === 'ok' ? $('#dlg-input', dlg).value.trim() : null;
  }
  async function pickImage(current) {
    const media = await loadMedia().catch(() => []);
    const tile = (value, src, label) => `<button type="button" class="tile" data-action="dlg-pick" data-value="${esc(value)}"><img src="${esc(src)}" alt="" loading="lazy"><span>${esc(label)}</span></button>`;
    const builtin = Object.keys(BUILTIN).map((n) => tile(n, imgUrl(n), n)).join('');
    const uploads = media.filter((m) => /^image\//.test(m.content_type || '')).map((m) => tile('media/' + m.key, '/media/' + m.key, m.alt || m.filename || m.key)).join('');
    const r = await openDialog({ title: 'Choose an image', wide: true, body:
      `<div class="field"><label for="dlg-input">Image name, path or URL</label><div class="imgfield"><input id="dlg-input" type="text" value="${esc(current || '')}" placeholder="exterior, media/abc.jpg, /assets/img/… or https://…"><button type="button" class="btn" data-action="dlg-pick">Use this</button></div></div>` +
      `<h3>Built-in photos</h3><div class="tiles">${builtin}</div><h3>Uploads</h3>${uploads ? `<div class="tiles">${uploads}</div>` : '<p class="empty">No uploaded images yet. Add some under Media.</p>'}` });
    return r === 'ok' ? $('#dlg-input', dlg).value.trim() : r;
  }

  /* -------------------------------------------------------------- form fields */
  const hintHtml = (h) => (h ? `<p class="hint">${h}</p>` : '');
  const dtypeAttr = (o) => (o.dtype ? ` data-type="${o.dtype}"` : '');
  const counterText = (n, max) => `${n}/${max}${n > max ? ' – too long, search results may cut it off' : ''}`;
  function labelFor(id, label, value, o) {
    if (!o.counter) return [`<label for="${id}">${esc(label)}</label>`, ''];
    const n = String(value == null ? '' : value).length;
    return [`<div class="field__row"><label for="${id}">${esc(label)}</label><span class="count${n > o.counter ? ' over' : ''}" id="cnt-${id}">${counterText(n, o.counter)}</span></div>`, ` data-counter="cnt-${id}" data-max="${o.counter}"`];
  }
  function fInput(label, path, value, o = {}) {
    const id = uid();
    const [lab, extra] = labelFor(id, label, value, o);
    return `<div class="field${o.cls ? ' ' + o.cls : ''}">${lab}<input id="${id}" type="${o.type || 'text'}" data-path="${esc(path)}"${dtypeAttr(o)}${extra} value="${esc(value == null ? '' : value)}" ${o.attrs || ''}>${hintHtml(o.hint)}</div>`;
  }
  function fText(label, path, value, o = {}) {
    const id = uid();
    const [lab, extra] = labelFor(id, label, value, o);
    return `<div class="field${o.cls ? ' ' + o.cls : ''}">${lab}<textarea id="${id}" data-path="${esc(path)}"${dtypeAttr(o)}${extra} rows="${o.rows || 4}"${o.code ? ' class="code" spellcheck="false"' : ''}>${esc(value == null ? '' : value)}</textarea>${hintHtml(o.hint)}</div>`;
  }
  function fSelect(label, path, value, options, o = {}) {
    const id = uid();
    const opts = options.map((op) => { const [v, l] = Array.isArray(op) ? op : [op, op]; return `<option value="${esc(v)}"${String(v) === String(value == null ? '' : value) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
    return `<div class="field${o.cls ? ' ' + o.cls : ''}"><label for="${id}">${esc(label)}</label><select id="${id}" data-path="${esc(path)}"${dtypeAttr(o)}>${opts}</select>${hintHtml(o.hint)}</div>`;
  }
  function fCheck(label, path, checked, o = {}) {
    const id = uid();
    return `<label class="check${o.cls ? ' ' + o.cls : ''}" for="${id}"><input id="${id}" type="checkbox" data-path="${esc(path)}" data-type="${o.dtype || 'checkbox'}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  }
  function fImage(label, path, value, o = {}) {
    const id = uid();
    const src = imgUrl(value);
    return `<div class="field${o.cls ? ' ' + o.cls : ''}"><label for="${id}">${esc(label)}</label><div class="imgfield"><img class="thumb" alt="" src="${esc(src)}"${src ? '' : ' hidden'}><input id="${id}" type="text" data-path="${esc(path)}" data-image value="${esc(value == null ? '' : value)}" placeholder="exterior, media/… or a URL"><button type="button" class="btn btn--small" data-action="pick-image" data-target="${id}">Choose</button></div>${hintHtml(o.hint)}</div>`;
  }
  function updateCounter(el) {
    const c = document.getElementById(el.dataset.counter);
    if (!c) return;
    const n = el.value.length, max = Number(el.dataset.max);
    c.textContent = counterText(n, max);
    c.classList.toggle('over', n > max);
  }
  function updateThumb(el) {
    const img = $('.thumb', el.closest('.imgfield') || el.parentNode);
    if (!img) return;
    const src = imgUrl(el.value);
    img.hidden = !src;
    if (src) img.src = src;
  }
  function readField(el) {
    const t = el.dataset.type || el.type;
    if (t === 'checkbox') return el.checked;
    if (t === 'int01') return el.checked ? 1 : 0;
    if (t === 'number') return el.value === '' ? null : Number(el.value);
    if (t === 'lines') return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (t === 'csv') return el.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (t === 'datetime') return el.value ? new Date(el.value).toISOString() : null;
    return el.value;
  }
  function repeaterHtml(path, items, renderItem, { addLabel = 'Add item', tpl = 'string' } = {}) {
    const rows = items.map((it, j) => `<div class="rep__item"><div class="rep__bar"><span class="rep__n">${j + 1}</span><span class="sec__tools">` +
      `<button type="button" class="iconbtn" data-action="arr-move" data-path="${esc(path)}" data-index="${j}" data-dir="-1" aria-label="Move item ${j + 1} up"${j === 0 ? ' disabled' : ''}>↑</button>` +
      `<button type="button" class="iconbtn" data-action="arr-move" data-path="${esc(path)}" data-index="${j}" data-dir="1" aria-label="Move item ${j + 1} down"${j === items.length - 1 ? ' disabled' : ''}>↓</button>` +
      `<button type="button" class="iconbtn iconbtn--danger" data-action="arr-del" data-path="${esc(path)}" data-index="${j}" aria-label="Remove item ${j + 1}">✕</button></span></div><div class="grid2">${renderItem(it, `${path}.${j}`)}</div></div>`).join('');
    return `<div class="rep">${rows || '<p class="hint">No items yet.</p>'}<button type="button" class="btn btn--small" data-action="arr-add" data-path="${esc(path)}" data-tpl="${esc(tpl)}">${esc(addLabel)}</button></div>`;
  }
  const BUTTON_STYLES = [['primary', 'Primary'], ['dark', 'Dark'], ['outline', 'Outline'], ['light', 'Light']];
  const buttonsHtml = (path, arr) => repeaterHtml(path, arr || [], (b, p) => fInput('Label', p + '.label', b.label) + fInput('Link', p + '.href', b.href, { hint: 'book.html, a slug, #anchor, tel:, mailto: or a URL' }) + fSelect('Style', p + '.style', b.style || 'primary', BUTTON_STYLES), { addLabel: 'Add button', tpl: 'button' });
  function seoFieldsHtml(meta, base = 'meta') {
    return fInput('Meta title', base + '.title', meta.title, { counter: 60, hint: 'Shown in search results and the browser tab. Aim for 50–60 characters.' }) +
      fText('Meta description', base + '.description', meta.description, { counter: 160, rows: 3, hint: 'Aim for 120–160 characters.' }) +
      fInput('Canonical URL', base + '.canonical', meta.canonical, { hint: 'Leave empty to use this page’s own address.' }) +
      fImage('Social (OG) image', base + '.og_image', meta.og_image) +
      fInput('Social image alt text', base + '.og_alt', meta.og_alt) +
      fCheck('Hide from search engines (noindex)', base + '.noindex', Boolean(meta.noindex));
  }

  /* ---------------------------------------------------------- section schema */
  const F = {
    eyebrow: { k: 'eyebrow', label: 'Eyebrow' }, title: { k: 'title', label: 'Heading' }, intro: { k: 'intro', label: 'Intro', t: 'textarea', rows: 2 },
    background: { k: 'background', label: 'Background', t: 'select', options: [['paper', 'Paper'], ['cream', 'Cream'], ['sand', 'Sand'], ['green', 'Green']] },
  };
  const SECTIONS = {
    html: { label: 'HTML', fields: [{ k: 'html', label: 'HTML (a complete <section>…</section>)', t: 'code', rows: 18, full: true }] },
    text: { label: 'Text', fields: [F.eyebrow, F.title, { k: 'html', label: 'Body (HTML)', t: 'code', rows: 8, full: true }, { k: 'aside_html', label: 'Aside (HTML, optional)', t: 'code', rows: 4, full: true }, { k: 'layout', label: 'Layout', t: 'select', options: [['split', 'Split'], ['narrow', 'Narrow'], ['wide', 'Wide']] }, F.background] },
    features: { label: 'Features', fields: [F.eyebrow, F.title, F.intro, { k: 'columns', label: 'Columns', t: 'select', options: [['3', '3'], ['4', '4']], dtype: 'number' }, F.background],
      items: [{ k: 'icon', label: 'Icon', hint: 'e.g. bed, wifi, car, coffee, utensils, wine, heart, calendar, star, users, train' }, { k: 'title', label: 'Title' }, { k: 'text', label: 'Text', t: 'textarea', rows: 2 }, { k: 'link_label', label: 'Link label' }, { k: 'link_href', label: 'Link URL' }] },
    cards: { label: 'Cards', fields: [F.eyebrow, F.title, F.intro, F.background],
      items: [{ k: 'image', label: 'Image', t: 'image' }, { k: 'image_alt', label: 'Image alt text' }, { k: 'meta', label: 'Small text above the title' }, { k: 'title', label: 'Title' }, { k: 'text', label: 'Text', t: 'textarea', rows: 2 }, { k: 'href', label: 'Link URL' }] },
    booking_strip: { label: 'Booking strip', fields: [F.title, { k: 'note', label: 'Note' }] },
    faq: { label: 'FAQ', fields: [F.eyebrow, F.title, F.intro], items: [{ k: 'q', label: 'Question', full: true }, { k: 'a', label: 'Answer (HTML)', t: 'code', rows: 3, full: true }] },
    gallery: { label: 'Gallery', fields: [F.eyebrow, F.title, F.intro], items: [{ k: 'image', label: 'Image', t: 'image' }, { k: 'image_alt', label: 'Alt text' }, { k: 'caption', label: 'Caption' }] },
    stats: { label: 'Stats', fields: [], items: [{ k: 'value', label: 'Value' }, { k: 'label', label: 'Label' }] },
    checklist: { label: 'Checklist', fields: [F.eyebrow, F.title, F.intro, { k: 'columns', label: 'Columns', t: 'select', options: [['1', '1'], ['2', '2']], dtype: 'number' }, F.background], items: 'string' },
    timeline: { label: 'Timeline', fields: [F.eyebrow, F.title, F.intro], items: [{ k: 'when', label: 'When' }, { k: 'title', label: 'Title' }, { k: 'text', label: 'Text', t: 'textarea', rows: 2 }] },
    event_details: { label: 'Event details', fields: [F.title, { k: 'dates_text', label: 'Dates' }, { k: 'price_text', label: 'Price' }, { k: 'includes', label: 'Included (one per line)', t: 'textarea', dtype: 'lines', rows: 4 }, { k: 'note', label: 'Note' }], buttons: true, note: 'Empty fields fall back to the page’s own event details (left column).' },
    events_list: { label: 'Events list', fields: [F.eyebrow, F.title, F.intro, { k: 'category', label: 'Only this category', hint: 'Leave empty to list every published event.' }] },
    posts_list: { label: 'Blog posts', fields: [F.eyebrow, F.title, F.intro, { k: 'count', label: 'How many posts', t: 'number', dtype: 'number' }] },
    quote: { label: 'Quote', fields: [{ k: 'text', label: 'Quote', t: 'textarea', rows: 3, full: true }, { k: 'cite', label: 'Attribution' }] },
    cta: { label: 'Call to action', fields: [F.title, { k: 'text', label: 'Text', t: 'textarea', rows: 2 }], buttons: true },
    contact: { label: 'Contact', fields: [], note: 'Shows the contact cards and the enquiry form, using the details under Settings.' },
  };
  function blankSection(type) {
    const def = SECTIONS[type];
    const s = { type };
    for (const d of def.fields) s[d.k] = d.dtype === 'lines' ? [] : d.t === 'select' ? (d.dtype === 'number' ? Number(d.options[0][0]) : d.options[0][0]) : d.t === 'number' ? 3 : '';
    if (def.items) s.items = [];
    if (def.buttons) s.buttons = [];
    return s;
  }
  function blankItem(tpl) {
    if (tpl === 'string') return '';
    if (tpl === 'button') return { label: '', href: '', style: 'primary' };
    if (tpl === 'social') return { label: '', url: '' };
    if (tpl === 'redirect') return { from_path: '', to_url: '', code: 301 };
    if (tpl.startsWith('item:')) { const def = SECTIONS[tpl.slice(5)]; const o = {}; for (const d of def.items) o[d.k] = ''; return o; }
    return {};
  }
  function fieldHtml(d, base, obj) {
    const path = base ? base + '.' + d.k : d.k;
    const v = obj ? obj[d.k] : undefined;
    const o = { hint: d.hint, dtype: d.dtype, cls: d.full ? 'span2' : '' };
    if (d.t === 'textarea' || d.t === 'code') return fText(d.label, path, d.dtype === 'lines' ? (Array.isArray(v) ? v : []).join('\n') : v, { ...o, code: d.t === 'code', rows: d.rows });
    if (d.t === 'select') return fSelect(d.label, path, v == null ? d.options[0][0] : v, d.options, o);
    if (d.t === 'image') return fImage(d.label, path, v, o);
    if (d.t === 'number') return fInput(d.label, path, v, { ...o, type: 'number', dtype: 'number' });
    return fInput(d.label, path, v, o);
  }
  function sectionSummary(s) {
    const t = s.title || s.text || s.dates_text || (s.items && s.items.length ? `${s.items.length} item${s.items.length === 1 ? '' : 's'}` : '') || stripTags(s.html).slice(0, 90);
    return t || (SECTIONS[s.type] && SECTIONS[s.type].note ? '' : 'Empty');
  }

  /* ----------------------------------------------------------------- shell */
  function setNavActive(key) { $$('#nav a').forEach((a) => { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
  function setView(html, title) {
    const v = $('#view');
    v.innerHTML = html;
    document.title = (title ? title + ' – ' : '') + 'Bentley Hotel admin';
    const h1 = $('h1', v);
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }
  function showLogin() {
    state.loggedIn = false;
    $('#app').hidden = true;
    $('#login').hidden = false;
    document.title = 'Sign in – Bentley Hotel admin';
    $('#password').focus();
  }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; }
  function setDirty(v) {
    if (!state.editor) return;
    state.editor.dirty = v;
    const el = $('[data-dirty]');
    if (el) el.hidden = !v;
  }
  const isDirty = () => Boolean(state.editor && state.editor.dirty);

  let currentHash = location.hash || '#/dashboard';
  let suppressHash = false;
  window.addEventListener('hashchange', async () => {
    if (suppressHash) { suppressHash = false; return; }
    const target = location.hash;
    if (isDirty()) {
      suppressHash = true;
      location.hash = currentHash;
      const ok = await confirmDialog('You have unsaved changes. Leave this page and lose them?', { ok: 'Leave without saving', danger: true, title: 'Unsaved changes' });
      if (!ok) return;
      state.editor.dirty = false;
      suppressHash = true;
      location.hash = target;
    }
    currentHash = target;
    route();
  });
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  async function route() {
    if (!state.loggedIn) { showLogin(); return; }
    showApp();
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, qs] = hash.split('?');
    const query = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);
    const root = parts[0] || 'dashboard';
    state.editor = null; state.model = null; state.rerender = null; state.onField = null; state.list = null;
    setNavActive(root);
    try {
      if (root === 'pages' && parts.length > 1) { const rest = parts.slice(1).join('/'); await pageEditor(rest === 'new' ? null : decodeURIComponent(rest), query); }
      else if (root === 'posts' && parts.length > 1) { const rest = parts.slice(1).join('/'); await postEditor(rest === 'new' ? null : decodeURIComponent(rest)); }
      else if (screens[root]) await screens[root](query);
      else setView('<h1>Page not found</h1><p><a href="#/dashboard">Back to the dashboard</a></p>', 'Not found');
    } catch (e) {
      fail(e);
      if (!e || e.status !== 401) setView(`<h1>Something went wrong</h1><p class="error">${esc((e && e.message) || e)}</p><p><a href="#/dashboard">Back to the dashboard</a></p>`, 'Error');
    }
  }

  /* -------------------------------------------------------------- dashboard */
  function normalizeAudit(r) {
    const raw = Array.isArray(r) ? r : (r && (r.pages || r.issues || r.results || r.audit)) || [];
    const bySlug = new Map();
    for (const e of raw) {
      if (!e) continue;
      const slug = e.slug || e.page || '';
      const entry = bySlug.get(slug) || { slug, title: e.title || slug, kind: e.kind || '', issues: [] };
      const items = Array.isArray(e.issues) ? e.issues : Array.isArray(e.problems) ? e.problems : (e.message || e.issue) ? [e] : [];
      for (const i of items) entry.issues.push(typeof i === 'string' ? { message: i, level: 'warn' } : { message: i.message || i.issue || i.text || JSON.stringify(i), level: i.level || i.severity || 'warn' });
      bySlug.set(slug, entry);
    }
    return Array.from(bySlug.values()).filter((e) => e.issues.length);
  }
  async function dashboard() {
    setView(LOADING, 'Dashboard');
    const safe = (p) => p.catch((e) => { if (e.status === 401) throw e; return null; });
    const count = async (path, key) => { const r = await safe(api('GET', path)); return r == null ? '?' : list(r, key).length; };
    let stats = await safe(api('GET', '/admin/api/stats'));
    if (!stats || typeof stats !== 'object' || !('pages' in stats)) {
      const [pages, landing, events, posts, media, backlinks] = await Promise.all([count('/admin/api/pages?kind=page', 'pages'), count('/admin/api/pages?kind=landing', 'pages'), count('/admin/api/pages?kind=event', 'pages'), count('/admin/api/posts', 'posts'), count('/admin/api/media', 'media'), count('/admin/api/backlinks', 'backlinks')]);
      stats = { pages, landing, events, posts, media, backlinks };
    }
    const seo = await safe(api('GET', '/admin/api/seo'));
    const audit = normalizeAudit(seo);
    const issues = audit.reduce((a, e) => a + e.issues.length, 0);
    const n = (v) => (v == null ? '?' : v);
    const stat = (href, count, label, sub) => `<a class="stat" href="${href}"><strong>${count}</strong><span>${label}</span>${sub ? `<small> · ${sub}</small>` : ''}</a>`;
    setView(`<h1>Dashboard</h1>
      <div class="grid">${stat('#/pages', n(stats.pages), 'Pages', stats.drafts ? `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} in all` : '')}${stat('#/landing', n(stats.landing), 'Landing pages')}${stat('#/events', n(stats.events), 'Events')}${stat('#/posts', n(stats.posts), 'Blog posts')}${stat('#/media', n(stats.media), 'Media files')}${stat('#/backlinks', n(stats.backlinks), 'Backlinks')}</div>
      <div class="grid grid--wide">
        <section class="card"><h2>SEO audit</h2>${seo == null ? '<p class="hint">The audit could not be loaded.</p>' : issues ? `<p><strong>${issues}</strong> issue${issues === 1 ? '' : 's'} on <strong>${audit.length}</strong> page${audit.length === 1 ? '' : 's'}.</p><ul class="issues">${audit.slice(0, 5).map((e) => `<li><a href="#/pages/${esc(e.slug)}">${esc(e.title)}</a><span class="hint">${e.issues.length} issue${e.issues.length === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : '<p>No issues found.</p>'}<p><a href="#/seo">Open the SEO report</a></p></section>
        <section class="card"><h2>Quick links</h2><div class="actions"><a class="btn btn--small" href="#/pages/new">New page</a><a class="btn btn--small" href="#/pages/new?kind=landing">New landing page</a><a class="btn btn--small" href="#/pages/new?kind=event">New event</a><a class="btn btn--small" href="#/posts/new">New blog post</a><a class="btn btn--small" href="#/media">Upload media</a><a class="btn btn--small" href="#/themes">Change theme</a><a class="btn btn--small btn--ghost" href="/" target="_blank" rel="noopener">Open site</a></div></section>
        <section class="card"><h2>Content tools</h2>
          <p class="hint">Load the built-in content (the pages, landing pages, events, backlinks and redirects the site shipped with), or back up and restore everything as JSON.</p>
          <div class="actions"><button type="button" class="btn btn--brass" data-action="seed">Load built-in content</button><button type="button" class="btn" data-action="export">Export JSON</button><span class="upload"><label class="btn" for="import-file">Import JSON</label><input id="import-file" class="sr" type="file" accept="application/json,.json" data-change="import"></span></div>
        </section>
      </div>`, 'Dashboard');
  }

  /* -------------------------------------------------------------- page lists */
  const KINDS = { page: ['Pages', 'page', 'pages'], landing: ['Landing pages', 'landing page', 'landing pages'], event: ['Events', 'event', 'events'] };
  async function listScreen(kind) {
    const [title, one, many] = KINDS[kind];
    setView(LOADING, title);
    let rows = list(await api('GET', '/admin/api/pages?kind=' + kind), 'pages');
    if (kind === 'page') rows = rows.concat(list(await api('GET', '/admin/api/pages?kind=system').catch(() => []), 'pages'));
    state.list = { kind, rows, q: '', status: '', one, many };
    setView(`<div class="head"><h1>${title}</h1><a class="btn btn--primary" href="#/pages/new?kind=${kind}">New ${one}</a></div>
      <div class="toolbar"><div class="field"><label class="sr" for="list-q">Search</label><input id="list-q" type="search" placeholder="Search by title or slug" data-filter="q"></div><label class="sr" for="list-status">Status</label><select id="list-status" data-filter="status"><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option></select><span class="hint" id="list-count"></span></div>
      <div id="list-body"></div>`, title);
    renderList();
  }
  function renderList() {
    const { rows, q, status, kind, many } = state.list;
    const ql = q.trim().toLowerCase();
    const filtered = rows.filter((r) => (!status || r.status === status) && (!ql || String(r.title || '').toLowerCase().includes(ql) || String(r.slug || '').toLowerCase().includes(ql)));
    const row = (r) => `<tr><td data-l="Title"><a class="title" href="#/pages/${esc(r.slug)}">${esc(r.title || r.slug)}</a>${r.kind === 'system' ? ' <span class="badge badge--system">system</span>' : ''}</td><td data-l="Slug"><code>${esc(r.slug)}</code></td><td data-l="Status"><span class="badge badge--${esc(r.status)}">${esc(r.status)}</span></td><td data-l="Navigation">${r.in_nav ? 'Menu (' + esc(r.nav_order) + ')' : r.in_footer ? 'Footer' : '—'}</td><td data-l="Updated">${esc(fmtDate(r.updated_at))}</td><td data-l="Actions"><div class="actions"><a class="btn btn--small" href="#/pages/${esc(r.slug)}">Edit</a><button type="button" class="btn btn--small btn--ghost" data-action="page-dup" data-slug="${esc(r.slug)}">Duplicate</button><button type="button" class="btn btn--small btn--danger" data-action="page-del" data-slug="${esc(r.slug)}">Delete</button><a class="btn btn--small btn--ghost" href="${esc(liveUrl(r.slug))}" target="_blank" rel="noopener">View</a></div></td></tr>`;
    $('#list-body').innerHTML = filtered.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Slug</th><th>Status</th><th>Navigation</th><th>Updated</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${filtered.map(row).join('')}</tbody></table></div>`
      : `<p class="empty">${rows.length ? 'Nothing matches your search.' : `No ${many} yet. <a href="#/pages/new?kind=${kind}">Create the first one</a>.`}</p>`;
    $('#list-count').textContent = `${filtered.length} of ${rows.length}`;
  }

  /* ------------------------------------------------------------- page editor */
  const blankEvent = () => ({ dates_text: '', price_text: '', includes: [], note: '', category: '', month: null });
  const blankHero = () => ({ style: 'plain', eyebrow: '', title: '', lede: '', image: '', image_alt: '', buttons: [], badge: { value: '', label: '' } });
  const blankMeta = () => ({ title: '', description: '', canonical: '', og_image: '', og_alt: '', noindex: false, jsonld: null });
  function blankPage(kind) {
    const sections = kind === 'event' ? [blankSection('event_details'), blankSection('cta')] : kind === 'landing' ? [blankSection('features'), blankSection('booking_strip')] : [];
    return { slug: '', kind, status: 'draft', title: '', nav_label: '', in_nav: 0, nav_order: 100, in_footer: 0, meta: blankMeta(), hero: kind === 'page' || kind === 'system' ? null : blankHero(), sections, event: blankEvent() };
  }
  const autoSlug = (title, kind) => (kind === 'event' ? 'events/' : '') + slugify(title);
  function validSlug(s) { return /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(s); }
  function cleanPage(p) {
    return {
      slug: String(p.slug || '').trim(), kind: p.kind || 'page', status: p.status || 'draft', title: String(p.title || '').trim(),
      nav_label: p.nav_label || null, in_nav: p.in_nav ? 1 : 0, nav_order: Number(p.nav_order) || 100, in_footer: p.in_footer ? 1 : 0,
      meta: { ...blankMeta(), ...(p.meta || {}) }, hero: p.hero || null, sections: p.sections || [], event: p.kind === 'event' ? { ...blankEvent(), ...(p.event || {}) } : null,
    };
  }
  async function pageEditor(slug, query) {
    setView(LOADING, slug ? 'Edit page' : 'New page');
    let page;
    if (slug == null) { const k = query.get('kind'); page = blankPage(KINDS[k] || k === 'system' ? k : 'page'); }
    else { const r = await api('GET', '/admin/api/pages/' + encSlug(slug)); page = r && r.page ? r.page : r; }
    page.meta = { ...blankMeta(), ...(page.meta || {}) };
    page.sections = Array.isArray(page.sections) ? page.sections : [];
    page.event = { ...blankEvent(), ...(page.event || {}) };
    if (page.hero && !page.hero.badge) page.hero.badge = { value: '', label: '' };
    const ed = { kind: 'page', page, isNew: slug == null, dirty: false, slugAuto: slug == null, open: new WeakSet() };
    state.editor = ed; state.model = page;
    setNavActive(page.kind === 'landing' ? 'landing' : page.kind === 'event' ? 'events' : 'pages');
    const kindLabel = KIND_LABEL[page.kind] || 'page';
    const ev = page.event;
    setView(`<form class="editor" data-submit="page-save" novalidate>
      <div class="editor__bar"><h1>${ed.isNew ? 'New ' + kindLabel : 'Edit ' + kindLabel + ': ' + esc(page.title || page.slug)}</h1>
        <div class="row"><span class="dirty" data-dirty hidden>Unsaved changes</span>${ed.isNew ? '' : `<a class="btn btn--ghost" href="${esc(liveUrl(page.slug))}" target="_blank" rel="noopener">View live</a>`}<button type="button" class="btn" data-action="page-preview">Preview</button><button type="submit" class="btn btn--primary">Save</button></div></div>
      <div class="editor__cols">
        <div class="col">
          <section class="card"><h2>Basics</h2>
            ${fInput('Title', 'title', page.title, { attrs: 'required' })}
            ${fInput('Slug', 'slug', page.slug, { attrs: ed.isNew ? 'required spellcheck="false" autocapitalize="off"' : 'readonly', hint: ed.isNew ? 'The page’s address, e.g. <code>christmas-parties</code> or <code>events/burns-night</code>. It cannot be changed once created.' : 'Served at <code>' + esc(liveUrl(page.slug)) + '</code>' })}
            ${fSelect('Kind', 'kind', page.kind, [['page', 'Page'], ['landing', 'Landing page'], ['event', 'Event'], ['system', 'System page']])}
            ${fSelect('Status', 'status', page.status, [['published', 'Published'], ['draft', 'Draft']])}
          </section>
          <section class="card"><h2>Navigation</h2>
            ${fInput('Navigation label', 'nav_label', page.nav_label, { hint: 'Defaults to the title.' })}
            ${fCheck('Show in the main menu', 'in_nav', Boolean(page.in_nav), { dtype: 'int01' })}
            ${fInput('Menu order', 'nav_order', page.nav_order == null ? 100 : page.nav_order, { type: 'number', dtype: 'number', hint: 'Lower numbers come first.' })}
            ${fCheck('Show in the footer', 'in_footer', Boolean(page.in_footer), { dtype: 'int01' })}
          </section>
          <section class="card"><h2>SEO</h2>${seoFieldsHtml(page.meta)}</section>
          <section class="card" data-event-fields${page.kind === 'event' ? '' : ' hidden'}><h2>Event details</h2>
            ${fInput('Dates', 'event.dates_text', ev.dates_text, { hint: 'e.g. Saturday 24 January 2026, 7pm' })}
            ${fInput('Price', 'event.price_text', ev.price_text, { hint: 'e.g. £45 per person' })}
            ${fText('What is included (one per line)', 'event.includes', (ev.includes || []).join('\n'), { dtype: 'lines', rows: 4 })}
            ${fText('Note', 'event.note', ev.note, { rows: 2 })}
            ${fInput('Category', 'event.category', ev.category, { hint: 'e.g. festive, dining, music, seasonal' })}
            ${fSelect('Month', 'event.month', ev.month == null ? '' : ev.month, [['', 'Any']].concat(MONTHS.map((m, i) => [String(i + 1), m])), { dtype: 'number' })}
          </section>
        </div>
        <div class="col" id="right"></div>
      </div></form>`, (ed.isNew ? 'New ' : '') + (page.title || kindLabel));
    state.rerender = renderRight;
    state.onField = (el, path, value) => {
      if (path === 'title' && ed.isNew && ed.slugAuto) { const s = $('[data-path="slug"]'); if (s) { s.value = autoSlug(value, page.kind); page.slug = s.value; } }
      if (path === 'slug') ed.slugAuto = value.trim() === '';
      if (path === 'kind') { $('[data-event-fields]').hidden = value !== 'event'; if (ed.isNew && ed.slugAuto) { const s = $('[data-path="slug"]'); if (s) { s.value = autoSlug(page.title, value); page.slug = s.value; } } }
    };
    renderRight();
  }
  function renderRight() {
    const ui = state.editor, p = ui.page, hz = p.hero;
    const heroBody = hz
      ? `<div class="grid2">${fSelect('Style', 'hero.style', hz.style || 'plain', [['plain', 'Plain'], ['split', 'Split with image'], ['image', 'Full-width image']])}${fInput('Eyebrow', 'hero.eyebrow', hz.eyebrow)}${fInput('Heading', 'hero.title', hz.title, { cls: 'span2' })}${fText('Lede', 'hero.lede', hz.lede, { rows: 2, cls: 'span2' })}${fImage('Image', 'hero.image', hz.image)}${fInput('Image alt text', 'hero.image_alt', hz.image_alt)}${fInput('Badge value', 'hero.badge.value', hz.badge && hz.badge.value, { hint: 'e.g. 1874' })}${fInput('Badge label', 'hero.badge.label', hz.badge && hz.badge.label)}</div><h3>Buttons</h3>${buttonsHtml('hero.buttons', hz.buttons)}`
      : '<p class="hint">No structured hero: the first section provides the top of the page. Turn the hero on to add one.</p>';
    const heroId = uid();
    const opts = Object.entries(SECTIONS).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
    const secs = p.sections.map((s, i) => {
      const def = SECTIONS[s.type];
      const open = ui.open.has(s);
      const bid = 'secbody' + i;
      const base = 'sections.' + i;
      let body = def && def.note ? `<p class="hint">${esc(def.note)}</p>` : '';
      if (!def) body += `<p class="hint">Unknown section type “${esc(s.type)}”. Its JSON is kept as it is:</p><textarea class="code" rows="8" readonly aria-label="Section JSON">${esc(JSON.stringify(s, null, 1))}</textarea>`;
      else {
        if (def.fields.length) body += `<div class="grid2">${def.fields.map((d) => fieldHtml(d, base, s)).join('')}</div>`;
        if (def.items) body += '<h3>Items</h3>' + repeaterHtml(base + '.items', s.items || [], (it, pth) => (def.items === 'string' ? fInput('Text', pth, it, { cls: 'span2' }) : def.items.map((d) => fieldHtml(d, pth, it)).join('')), { tpl: def.items === 'string' ? 'string' : 'item:' + s.type });
        if (def.buttons) body += '<h3>Buttons</h3>' + buttonsHtml(base + '.buttons', s.buttons);
      }
      return `<article class="sec${open ? ' is-open' : ''}"><div class="sec__bar"><button type="button" class="sec__toggle" data-action="sec-toggle" data-i="${i}" aria-expanded="${open}" aria-controls="${bid}"><span class="tag">${esc(def ? def.label : s.type)}</span><span class="sec__sum">${esc(sectionSummary(s))}</span></button><span class="sec__tools"><button type="button" class="iconbtn" data-action="arr-move" data-path="sections" data-index="${i}" data-dir="-1" aria-label="Move section ${i + 1} up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="iconbtn" data-action="arr-move" data-path="sections" data-index="${i}" data-dir="1" aria-label="Move section ${i + 1} down"${i === p.sections.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="iconbtn iconbtn--danger" data-action="sec-del" data-i="${i}" aria-label="Delete section ${i + 1}">✕</button></span></div><div class="sec__body" id="${bid}"${open ? '' : ' hidden'}>${body}</div></article>`;
    }).join('');
    $('#right').innerHTML = `<section class="card"><div class="head"><h2>Hero</h2><label class="check" for="${heroId}"><input id="${heroId}" type="checkbox" data-change="hero-toggle"${hz ? ' checked' : ''}><span>Use a hero</span></label></div>${heroBody}</section>
      <section class="card"><div class="head"><h2>Sections</h2><span class="hint">${p.sections.length} section${p.sections.length === 1 ? '' : 's'}</span></div><div id="sections">${secs || '<p class="empty">No sections yet. Add one below.</p>'}</div>
      <div class="addsec"><div class="field"><label for="add-type">Add a section</label><select id="add-type">${opts}</select></div><button type="button" class="btn" data-action="sec-add">Add section</button></div></section>`;
  }
  async function savePage() {
    const ed = state.editor, p = ed.page;
    const body = cleanPage(p);
    if (!body.title) { toast('Please give the page a title.', 'error'); $('[data-path="title"]').focus(); return; }
    if (!body.slug || !validSlug(body.slug)) { toast('The slug may only contain lower-case letters, numbers and hyphens, with / between parts.', 'error'); $('[data-path="slug"]').focus(); return; }
    if (ed.isNew) {
      await api('POST', '/admin/api/pages', body);
      ed.dirty = false;
      toast('Page created');
      location.hash = '#/pages/' + body.slug;
    } else {
      await api('PUT', '/admin/api/pages/' + encSlug(body.slug), body);
      setDirty(false);
      $('.editor__bar h1').textContent = `Edit ${KIND_LABEL[body.kind] || 'page'}: ${body.title}`;
      toast('Saved');
    }
  }
  async function previewPage() {
    const body = cleanPage(state.editor.page);
    const r = await api('POST', '/admin/api/preview', { page: body }, { raw: true });
    let html = typeof r === 'string' ? r : (r && r.html) || '';
    if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${location.origin}/">`);
    openDialog({ title: 'Preview: ' + (body.title || body.slug), wide: true, onOpen: (d) => { $('iframe', d).srcdoc = html; },
      body: '<div class="pv-bar"><button type="button" class="btn btn--small" data-action="pv-size" data-w="desktop" aria-pressed="true">Desktop</button><button type="button" class="btn btn--small" data-action="pv-size" data-w="phone" aria-pressed="false">Phone</button><span class="hint">Shows the page as it is in the editor, including unsaved changes.</span></div><iframe class="pv" title="Page preview"></iframe>' });
  }

  /* -------------------------------------------------------------------- blog */
  async function postsScreen() {
    setView(LOADING, 'Blog');
    const rows = list(await api('GET', '/admin/api/posts'), 'posts');
    state.list = { rows, q: '', status: '' };
    const render = () => {
      const { q, status } = state.list;
      const ql = q.trim().toLowerCase();
      const filtered = rows.filter((r) => (!status || r.status === status) && (!ql || String(r.title || '').toLowerCase().includes(ql) || String(r.slug || '').toLowerCase().includes(ql)));
      $('#list-body').innerHTML = filtered.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Published</th><th>Tags</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${filtered.map((r) => `<tr><td data-l="Title"><a class="title" href="#/posts/${esc(r.slug)}">${esc(r.title || r.slug)}</a><br><code>${esc(r.slug)}</code></td><td data-l="Status"><span class="badge badge--${esc(r.status)}">${esc(r.status)}</span></td><td data-l="Published">${esc(fmtDate(r.published_at))}</td><td data-l="Tags">${esc((Array.isArray(r.tags) ? r.tags : []).join(', ') || '—')}</td><td data-l="Actions"><div class="actions"><a class="btn btn--small" href="#/posts/${esc(r.slug)}">Edit</a><button type="button" class="btn btn--small btn--danger" data-action="post-del" data-slug="${esc(r.slug)}">Delete</button><a class="btn btn--small btn--ghost" href="${esc(postUrl(r.slug))}" target="_blank" rel="noopener">View</a></div></td></tr>`).join('')}</tbody></table></div>`
        : `<p class="empty">${rows.length ? 'Nothing matches your search.' : 'No blog posts yet. <a href="#/posts/new">Write the first one</a>.'}</p>`;
      $('#list-count').textContent = `${filtered.length} of ${rows.length}`;
    };
    state.list.render = render;
    setView(`<div class="head"><h1>Blog</h1><a class="btn btn--primary" href="#/posts/new">New post</a></div>
      <div class="toolbar"><div class="field"><label class="sr" for="list-q">Search</label><input id="list-q" type="search" placeholder="Search by title or slug" data-filter="q"></div><label class="sr" for="list-status">Status</label><select id="list-status" data-filter="status"><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option></select><span class="hint" id="list-count"></span></div><div id="list-body"></div>`, 'Blog');
    render();
  }
  async function postEditor(slug) {
    setView(LOADING, slug ? 'Edit post' : 'New post');
    let post;
    if (slug == null) post = { slug: '', status: 'draft', title: '', excerpt: '', body_md: '', cover_image: '', cover_alt: '', tags: [], published_at: null, meta: blankMeta() };
    else { const r = await api('GET', '/admin/api/posts/' + encSlug(slug)); post = r && r.post ? r.post : r; }
    post.meta = { ...blankMeta(), ...(post.meta || {}) };
    post.tags = Array.isArray(post.tags) ? post.tags : typeof post.tags === 'string' ? post.tags.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const ed = { kind: 'post', post, isNew: slug == null, dirty: false, slugAuto: slug == null };
    state.editor = ed; state.model = post;
    setView(`<form class="editor" data-submit="post-save" novalidate>
      <div class="editor__bar"><h1>${ed.isNew ? 'New blog post' : 'Edit post: ' + esc(post.title || post.slug)}</h1><div class="row"><span class="dirty" data-dirty hidden>Unsaved changes</span>${ed.isNew ? '' : `<a class="btn btn--ghost" href="${esc(postUrl(post.slug))}" target="_blank" rel="noopener">View live</a>`}<button type="submit" class="btn btn--primary">Save</button></div></div>
      <div class="editor__cols"><div class="col">
        <section class="card"><h2>Post</h2>
          ${fInput('Title', 'title', post.title, { attrs: 'required' })}
          ${fInput('Slug', 'slug', post.slug, { attrs: ed.isNew ? 'required spellcheck="false" autocapitalize="off"' : 'readonly', hint: ed.isNew ? 'Published at <code>/blog/&lt;slug&gt;</code>. Cannot be changed later.' : 'Published at <code>' + esc(postUrl(post.slug)) + '</code>' })}
          ${fSelect('Status', 'status', post.status, [['draft', 'Draft'], ['published', 'Published']])}
          ${fInput('Published date', 'published_at', toLocalInput(post.published_at), { type: 'datetime-local', dtype: 'datetime', hint: 'Leave empty to use the time of first publishing.' })}
          ${fText('Excerpt', 'excerpt', post.excerpt, { rows: 3, hint: 'A sentence or two for listings and link previews.' })}
          ${fInput('Tags', 'tags', post.tags.join(', '), { dtype: 'csv', hint: 'Comma separated, e.g. events, christmas' })}
          ${fImage('Cover image', 'cover_image', post.cover_image)}
          ${fInput('Cover image alt text', 'cover_alt', post.cover_alt)}
        </section>
        <section class="card"><h2>SEO</h2>${seoFieldsHtml(post.meta)}</section>
      </div><div class="col"><section class="card"><h2>Content</h2><div class="md-split">${fText('Body (Markdown)', 'body_md', post.body_md, { code: true, rows: 24, hint: 'Headings with #, **bold**, *italic*, lists, links [text](url) and images ![alt](url).' })}<div><p class="field__row"><span class="hint">Preview</span></p><div id="md-preview" class="md-preview" aria-live="polite"></div></div></div></section></div></div></form>`, (ed.isNew ? 'New post' : post.title));
    const preview = debounce(async () => { try { const r = await api('POST', '/admin/api/markdown', { md: post.body_md || '' }); const pv = $('#md-preview'); if (pv) pv.innerHTML = (r && r.html) || ''; } catch (e) { fail(e); } }, 350);
    state.onField = (el, path, value) => {
      if (path === 'title' && ed.isNew && ed.slugAuto) { const s = $('[data-path="slug"]'); if (s) { s.value = slugify(value).replace(/\//g, '-'); post.slug = s.value; } }
      if (path === 'slug') ed.slugAuto = value.trim() === '';
      if (path === 'body_md') preview();
    };
    preview();
  }
  async function savePost() {
    const ed = state.editor, p = ed.post;
    const body = { slug: String(p.slug || '').trim(), status: p.status || 'draft', title: String(p.title || '').trim(), excerpt: p.excerpt || '', body_md: p.body_md || '', cover_image: p.cover_image || null, cover_alt: p.cover_alt || null, tags: p.tags || [], published_at: p.published_at || null, meta: { ...blankMeta(), ...(p.meta || {}) } };
    if (!body.title) { toast('Please give the post a title.', 'error'); $('[data-path="title"]').focus(); return; }
    if (!body.slug || !/^[a-z0-9][a-z0-9-]*$/.test(body.slug)) { toast('The slug may only contain lower-case letters, numbers and hyphens.', 'error'); $('[data-path="slug"]').focus(); return; }
    if (ed.isNew) { await api('POST', '/admin/api/posts', body); ed.dirty = false; toast('Post created'); location.hash = '#/posts/' + body.slug; }
    else { await api('PUT', '/admin/api/posts/' + encSlug(body.slug), body); setDirty(false); $('.editor__bar h1').textContent = 'Edit post: ' + body.title; toast('Saved'); }
  }

  /* ------------------------------------------------------------------- media */
  async function mediaScreen() {
    setView(LOADING, 'Media');
    const items = await loadMedia(true);
    setView(`<div class="head"><h1>Media</h1><span class="upload"><label class="btn btn--primary" for="upload">Upload files</label><input id="upload" class="sr" type="file" accept="image/*,application/pdf" multiple data-change="upload"></span></div>
      <p class="hint">Uploads are served at <code>/media/&lt;key&gt;</code>. In page sections use the image value <code>media/&lt;key&gt;</code>, or pick it from the image chooser.</p><div id="media-grid"></div>`, 'Media');
    renderMedia(items);
  }
  function renderMedia(items) {
    const grid = $('#media-grid');
    if (!grid) return;
    if (!items.length) { grid.innerHTML = '<p class="empty">No uploads yet. Use the Upload button to add photos (JPEG, PNG, WebP or GIF) or PDFs.</p>'; return; }
    grid.innerHTML = `<div class="media">${items.map((m) => { const id = uid(); const isImg = /^image\//.test(m.content_type || ''); return `<article class="media__card">${isImg ? `<img class="media__img" src="/media/${esc(m.key)}" alt="${esc(m.alt || '')}" loading="lazy">` : `<div class="media__file">${esc((m.content_type || 'file').split('/').pop().toUpperCase())}</div>`}<div><div class="media__name">${esc(m.filename || m.key)}</div><div class="hint">${esc(fmtBytes(m.size))}${m.width ? ` · ${esc(m.width)}×${esc(m.height)}` : ''} · ${esc(fmtDate(m.created_at))}</div></div><div class="field"><label for="${id}">Alt text</label><div class="row"><input id="${id}" type="text" value="${esc(m.alt || '')}" data-alt="${esc(m.key)}"><button type="button" class="btn btn--small" data-action="media-alt" data-key="${esc(m.key)}">Save</button></div></div><div class="actions"><button type="button" class="btn btn--small btn--ghost" data-action="copy" data-text="/media/${esc(m.key)}">Copy URL</button><button type="button" class="btn btn--small btn--danger" data-action="media-del" data-key="${esc(m.key)}">Delete</button></div></article>`; }).join('')}</div>`;
  }

  /* --------------------------------------------------------------- backlinks */
  async function backlinksScreen() {
    setView(LOADING, 'Backlinks');
    state.backlinks = list(await api('GET', '/admin/api/backlinks'), 'backlinks');
    setView(`<div class="head"><h1>Backlinks</h1><button type="button" class="btn" data-action="bl-check-all">Check all</button></div>
      <form class="card" data-submit="bl-add"><h2>Add a backlink</h2><div class="grid2"><div class="field"><label for="bl-source">Source URL (the page that links to us)</label><input id="bl-source" name="source_url" type="url" required placeholder="https://example.com/listing"></div><div class="field"><label for="bl-target">Target URL (our page)</label><input id="bl-target" name="target_url" type="url" required placeholder="https://www.thebentleyhotel.co.uk/"></div><div class="field"><label for="bl-anchor">Anchor text</label><input id="bl-anchor" name="anchor_text" type="text"></div><div class="field"><label for="bl-notes">Notes</label><input id="bl-notes" name="notes" type="text"></div></div><button type="submit" class="btn btn--primary">Add backlink</button></form>
      <div id="bl-body"></div>`, 'Backlinks');
    renderBacklinks();
  }
  function renderBacklinks() {
    const rows = state.backlinks;
    const host = (u) => { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, '') : ''); } catch { return u; } };
    $('#bl-body').innerHTML = rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Source</th><th>Target</th><th>Anchor</th><th>Status</th><th>HTTP</th><th>Last checked</th><th>Notes</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${rows.map((b) => { const id = uid(); return `<tr data-id="${esc(b.id)}"><td data-l="Source"><a href="${esc(b.source_url)}" target="_blank" rel="noopener">${esc(host(b.source_url))}</a></td><td data-l="Target"><span class="hint">${esc(host(b.target_url))}</span></td><td data-l="Anchor">${esc(b.anchor_text || '—')}</td><td data-l="Status"><span class="badge badge--${esc(b.status || 'unchecked')}">${esc(b.status || 'unchecked')}</span></td><td data-l="HTTP">${esc(b.http_status == null ? '—' : b.http_status)}</td><td data-l="Checked">${esc(fmtDate(b.last_checked))}</td><td data-l="Notes"><div class="row"><label class="sr" for="${id}">Notes</label><input id="${id}" type="text" value="${esc(b.notes || '')}" data-notes="${esc(b.id)}"><button type="button" class="btn btn--small btn--ghost" data-action="bl-notes" data-id="${esc(b.id)}">Save</button></div></td><td data-l="Actions"><div class="actions"><button type="button" class="btn btn--small" data-action="bl-check" data-id="${esc(b.id)}">Check</button><button type="button" class="btn btn--small btn--danger" data-action="bl-del" data-id="${esc(b.id)}">Delete</button></div></td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="empty">No backlinks recorded yet. Add the directories and partner sites that link to the hotel, then use Check to confirm each link is still live.</p>';
  }

  /* --------------------------------------------------------------- redirects */
  async function redirectsScreen() {
    setView(LOADING, 'Redirects');
    const rows = list(await api('GET', '/admin/api/redirects'), 'redirects');
    state.model = { list: rows.map((r) => ({ from_path: r.from_path || '', to_url: r.to_url || '', code: Number(r.code) || 301 })) };
    state.editor = { kind: 'redirects', dirty: false };
    state.rerender = renderRedirects;
    setView(`<div class="head"><h1>Redirects</h1><div class="row"><span class="dirty" data-dirty hidden>Unsaved changes</span><button type="button" class="btn btn--primary" data-action="rd-save">Save redirects</button></div></div>
      <p class="hint">Send old addresses (for example from the previous website) to the right page. Paths start with <code>/</code>; the destination can be a path or a full URL.</p><div id="rd-body"></div>`, 'Redirects');
    renderRedirects();
  }
  function renderRedirects() {
    const rows = state.model.list;
    $('#rd-body').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>From path</th><th>To</th><th>Code</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${rows.map((r, i) => { const a = uid(), b = uid(), c = uid(); return `<tr><td data-l="From"><label class="sr" for="${a}">From path</label><input id="${a}" type="text" data-path="list.${i}.from_path" value="${esc(r.from_path)}" placeholder="/old-page.htm"></td><td data-l="To"><label class="sr" for="${b}">To</label><input id="${b}" type="text" data-path="list.${i}.to_url" value="${esc(r.to_url)}" placeholder="/rooms"></td><td data-l="Code"><label class="sr" for="${c}">Code</label><select id="${c}" data-path="list.${i}.code" data-type="number">${[301, 302, 307, 308].map((cd) => `<option value="${cd}"${cd === Number(r.code) ? ' selected' : ''}>${cd}</option>`).join('')}</select></td><td data-l="Actions"><button type="button" class="iconbtn iconbtn--danger" data-action="arr-del" data-path="list" data-index="${i}" aria-label="Remove redirect ${i + 1}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="hint">No redirects yet.</td></tr>'}</tbody></table></div><p><button type="button" class="btn btn--small" data-action="arr-add" data-path="list" data-tpl="redirect">Add redirect</button></p>`;
  }

  /* --------------------------------------------------------------------- SEO */
  async function seoScreen() {
    setView(LOADING, 'SEO');
    const [audit, settings] = await Promise.all([api('GET', '/admin/api/seo'), loadSettings(true)]);
    const rows = normalizeAudit(audit);
    const site = settings.site;
    state.model = site; state.editor = { kind: 'settings', dirty: false };
    const issues = rows.reduce((a, e) => a + e.issues.length, 0);
    setView(`<h1>SEO</h1>
      <section class="card"><div class="head"><h2>Audit</h2><span class="hint">${issues ? `${issues} issue${issues === 1 ? '' : 's'} on ${rows.length} page${rows.length === 1 ? '' : 's'}` : 'Checked titles, descriptions, social images, noindex flags and internal links'}</span></div>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Page</th><th>Kind</th><th>Issues</th></tr></thead><tbody>${rows.map((e) => `<tr><td data-l="Page"><a class="title" href="#/pages/${esc(e.slug)}">${esc(e.title)}</a><br><code>${esc(e.slug)}</code></td><td data-l="Kind">${esc(e.kind || '—')}</td><td data-l="Issues"><ul class="issues">${e.issues.map((i) => `<li><span class="badge badge--${/err/i.test(i.level) ? 'error' : 'warn'}">${/err/i.test(i.level) ? 'error' : 'warning'}</span><span>${esc(i.message)}</span></li>`).join('')}</ul></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No issues found. Every page has a title, a description and a social image.</p>'}</section>
      <form class="card" data-submit="settings-save"><div class="head"><h2>Site-wide SEO</h2><span class="dirty" data-dirty hidden>Unsaved changes</span></div><div class="grid2">
        ${fInput('Site name', 'name', site.name)}${fInput('Tagline', 'tagline', site.tagline, { cls: 'span2' })}${fInput('Site URL', 'site_url', site.site_url, { hint: 'Used for canonical links and the sitemap, e.g. https://www.thebentleyhotel.co.uk' })}
        ${fImage('Default social (OG) image', 'default_og_image', site.default_og_image)}${fInput('Default social image alt text', 'default_og_alt', site.default_og_alt, { cls: 'span2' })}
        ${fText('Extra <head> HTML', 'head_html', site.head_html, { code: true, rows: 4, cls: 'span2', hint: 'Verification tags and the like, added to every page.' })}${fText('Analytics HTML', 'analytics_html', site.analytics_html, { code: true, rows: 4, cls: 'span2', hint: 'Your analytics snippet, added before the closing body tag.' })}
      </div><button type="submit" class="btn btn--primary">Save</button></form>`, 'SEO');
  }

  /* ------------------------------------------------------------------ themes */
  async function themesScreen() {
    setView(LOADING, 'Themes');
    const [themes, settings] = await Promise.all([loadThemes(), loadSettings(true)]);
    state.themeSel = settings.site.theme || (themes[0] && themes[0].id);
    setView(`<div class="head"><h1>Themes</h1><div class="row"><div class="field"><label class="sr" for="theme-select">Theme</label><select id="theme-select" data-change="theme-select">${themes.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></div><button type="button" class="btn btn--primary" data-action="theme-apply">Apply theme</button></div></div>
      <p class="hint">A theme changes the colours, typefaces and layout of the whole site: header style, hero shape, button corners and whether sections sit in coloured bands. Pick one below, then Apply.</p>
      <p id="theme-applied" class="notice" hidden></p><div class="themes" id="theme-grid"></div>`, 'Themes');
    renderThemes();
  }
  function renderThemes() {
    const themes = state.themes, sel = state.themeSel, current = state.settings.site.theme;
    const grid = $('#theme-grid');
    if (!grid) return;
    grid.innerHTML = themes.map((t) => `<button type="button" class="theme" data-action="theme-pick" data-id="${esc(t.id)}" aria-pressed="${t.id === sel}"><span class="swatches">${(t.swatch || []).map((c) => `<span class="swatch" data-color="${esc(c)}" title="${esc(c)}"></span>`).join('')}</span><span class="row"><strong>${esc(t.name)}</strong>${t.dark ? '<span class="badge badge--dark">dark</span>' : ''}${t.id === current ? '<span class="badge badge--live">current</span>' : ''}</span><span class="hint">${esc(t.description)}</span><span class="hint">Headings: ${esc(t.fonts && t.fonts.display)} · Body: ${esc(t.fonts && t.fonts.body)}</span><span class="tags">${Object.entries(t.layout || {}).map(([k, v]) => `<span class="tag">${esc(k)}: ${esc(v)}</span>`).join('')}</span></button>`).join('');
    $$('.swatch', grid).forEach((s) => { s.style.background = s.dataset.color; });
    const select = $('#theme-select');
    if (select) select.value = sel;
  }

  /* ---------------------------------------------------------------- settings */
  async function settingsScreen() {
    setView(LOADING, 'Settings');
    const [settings, landing] = await Promise.all([loadSettings(true), api('GET', '/admin/api/pages?kind=landing').then((r) => list(r, 'pages')).catch(() => [])]);
    const site = settings.site;
    site.address = site.address || {}; site.social = Array.isArray(site.social) ? site.social : [];
    state.model = site; state.editor = { kind: 'settings', dirty: false };
    state.homeOptions = [['index', 'index (the standard homepage)']].concat(landing.map((p) => [p.slug, `${p.title} (${p.slug})`]));
    if (site.homepage_slug && !state.homeOptions.some(([v]) => v === site.homepage_slug)) state.homeOptions.push([site.homepage_slug, site.homepage_slug]);
    state.rerender = renderSettings;
    setView(`<div class="head"><h1>Settings</h1><div class="row"><span class="dirty" data-dirty hidden>Unsaved changes</span><button type="button" class="btn btn--primary" data-action="settings-save">Save settings</button></div></div><form data-submit="settings-save" novalidate id="settings-form"></form>`, 'Settings');
    renderSettings();
  }
  function renderSettings() {
    const s = state.model, a = s.address || {};
    $('#settings-form').innerHTML = `
      <section class="card"><h2>Hotel</h2><div class="grid2">${fInput('Name', 'name', s.name)}${fInput('Short name', 'short_name', s.short_name, { hint: 'Used where space is tight.' })}${fInput('Tagline', 'tagline', s.tagline, { cls: 'span2' })}${fText('Footer blurb', 'footer_blurb', s.footer_blurb, { rows: 2, cls: 'span2' })}</div></section>
      <section class="card"><h2>Contact</h2><div class="grid2">${fInput('Phone (as shown)', 'phone', s.phone)}${fInput('Phone (for tel: links)', 'phone_tel', s.phone_tel, { hint: 'International format, e.g. +441698265588' })}${fInput('Email', 'email', s.email, { type: 'email', cls: 'span2' })}</div></section>
      <section class="card"><h2>Address</h2><div class="grid2">${fInput('Street', 'address.street', a.street)}${fInput('Town', 'address.town', a.town)}${fInput('Region', 'address.region', a.region)}${fInput('Postcode', 'address.postcode', a.postcode)}${fInput('Country code', 'address.country', a.country, { hint: 'Two letters, e.g. GB' })}</div></section>
      <section class="card"><h2>Booking</h2><div class="grid2">${fInput('Booking page URL', 'booking_url', s.booking_url, { hint: 'Where "Book" buttons go, e.g. book.html' })}${fInput('Hosted booking engine URL', 'hosted_booking_url', s.hosted_booking_url)}${fInput('Cloudbeds property code', 'cloudbeds_property_code', s.cloudbeds_property_code)}${fInput('Check-in', 'checkin', s.checkin, { hint: 'e.g. 2pm' })}${fInput('Check-out', 'checkout', s.checkout, { hint: 'e.g. 11am' })}</div></section>
      <section class="card"><h2>Website</h2><div class="grid2">${fInput('Site URL', 'site_url', s.site_url)}${fSelect('Homepage', 'homepage_slug', s.homepage_slug || 'index', state.homeOptions, { hint: 'Any landing page can be the homepage.' })}</div><p class="hint">The theme is chosen under <a href="#/themes">Themes</a> (currently <strong>${esc(s.theme || 'heritage-green')}</strong>). Analytics and extra head HTML live under <a href="#/seo">SEO</a>.</p></section>
      <section class="card"><h2>Social links</h2>${repeaterHtml('social', s.social || [], (it, p) => fInput('Label', p + '.label', it.label, { hint: 'e.g. Facebook, Instagram, TripAdvisor' }) + fInput('URL', p + '.url', it.url, { type: 'url' }), { addLabel: 'Add social link', tpl: 'social' })}</section>
      <button type="submit" class="btn btn--primary">Save settings</button>`;
  }

  /* ----------------------------------------------------------------- actions */
  const screens = { dashboard, pages: () => listScreen('page'), landing: () => listScreen('landing'), events: () => listScreen('event'), posts: postsScreen, media: mediaScreen, backlinks: backlinksScreen, redirects: redirectsScreen, seo: seoScreen, themes: themesScreen, settings: settingsScreen };
  const focusFirst = (sel) => { const el = $(sel); if (el) el.focus(); return Boolean(el); };

  const actions = {
    async logout() { try { await api('POST', '/admin/api/logout'); } catch (e) { if (e.status !== 401) throw e; } state.editor = null; showLogin(); },
    'dlg-close': (el) => closeDialog(el.dataset.value),
    'dlg-pick': (el) => closeDialog(el.dataset.value !== undefined ? el.dataset.value : ($('#dlg-input', dlg) || { value: '' }).value.trim()),
    'pv-size': (el) => { const f = $('iframe.pv', dlg); if (f) f.classList.toggle('pv--phone', el.dataset.w === 'phone'); $$('[data-action="pv-size"]', dlg).forEach((b) => b.setAttribute('aria-pressed', String(b === el))); },
    async 'pick-image'(el) {
      const input = document.getElementById(el.dataset.target);
      const v = await pickImage(input.value);
      if (v == null) { input.focus(); return; }
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    },
    async copy(el) {
      const text = el.dataset.text;
      try { await navigator.clipboard.writeText(text); toast('Copied ' + text); }
      catch { await promptDialog('Copy URL', 'Select and copy this address', text); }
    },
    'sec-toggle': (el) => { const ed = state.editor, s = ed.page.sections[Number(el.dataset.i)]; const body = document.getElementById(el.getAttribute('aria-controls')); body.hidden = !body.hidden; if (body.hidden) ed.open.delete(s); else ed.open.add(s); el.setAttribute('aria-expanded', String(!body.hidden)); el.closest('.sec').classList.toggle('is-open', !body.hidden); },
    'sec-add': () => { const ed = state.editor, s = blankSection($('#add-type').value); ed.page.sections.push(s); ed.open.add(s); setDirty(true); renderRight(); const card = $$('#sections .sec').pop(); if (card) { const first = $('input, textarea, select', card); (first || $('.sec__toggle', card)).focus(); card.scrollIntoView({ block: 'nearest' }); } },
    async 'sec-del'(el) { const ed = state.editor, i = Number(el.dataset.i), s = ed.page.sections[i]; if (!(await confirmDialog(`Delete section ${i + 1} (${(SECTIONS[s.type] || {}).label || s.type})?`, { ok: 'Delete section', danger: true }))) return; ed.page.sections.splice(i, 1); setDirty(true); renderRight(); const next = $$('#sections .sec__toggle')[Math.min(i, ed.page.sections.length - 1)]; (next || $('#add-type')).focus(); },
    'arr-add': (el) => { const path = el.dataset.path; let arr = getPath(state.model, path); if (!Array.isArray(arr)) { arr = []; setPath(state.model, path, arr); } arr.push(blankItem(el.dataset.tpl)); setDirty(true); state.rerender(); focusFirst(`[data-path^="${path}.${arr.length - 1}"]`) || focusFirst(`[data-action="arr-add"][data-path="${path}"]`); },
    'arr-del': (el) => { getPath(state.model, el.dataset.path).splice(Number(el.dataset.index), 1); setDirty(true); state.rerender(); focusFirst(`[data-action="arr-add"][data-path="${el.dataset.path}"]`) || focusFirst('#add-type'); },
    'arr-move': (el) => { const arr = getPath(state.model, el.dataset.path), i = Number(el.dataset.index), j = i + Number(el.dataset.dir); if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; setDirty(true); state.rerender(); const same = $(`[data-action="arr-move"][data-path="${el.dataset.path}"][data-index="${j}"][data-dir="${el.dataset.dir}"]`); if (same && !same.disabled) same.focus(); else focusFirst(`[data-action="arr-move"][data-path="${el.dataset.path}"][data-index="${j}"]`); },
    'page-save': savePage,
    'page-preview': previewPage,
    async 'page-dup'(el) {
      const slug = el.dataset.slug;
      if (!(await confirmDialog(`Duplicate "${slug}"? A draft copy is created with a new slug, which you can then edit.`, { ok: 'Duplicate' }))) return;
      const r = await api('POST', '/admin/api/pages/' + encSlug(slug) + '/duplicate', {});
      const created = (r && (r.page || r)) || {};
      toast('Page duplicated');
      location.hash = '#/pages/' + (created.slug || slug + '-copy');
    },
    async 'page-del'(el) {
      const slug = el.dataset.slug;
      if (!(await confirmDialog(`Delete the page "${slug}"? This cannot be undone.`, { ok: 'Delete page', danger: true }))) return;
      await api('DELETE', '/admin/api/pages/' + encSlug(slug));
      state.list.rows = state.list.rows.filter((r) => r.slug !== slug);
      renderList();
      toast('Page deleted');
    },
    'post-save': savePost,
    async 'post-del'(el) {
      const slug = el.dataset.slug;
      if (!(await confirmDialog(`Delete the post "${slug}"? This cannot be undone.`, { ok: 'Delete post', danger: true }))) return;
      await api('DELETE', '/admin/api/posts/' + encSlug(slug));
      const i = state.list.rows.findIndex((r) => r.slug === slug);
      if (i >= 0) state.list.rows.splice(i, 1);
      state.list.render();
      toast('Post deleted');
    },
    async 'media-alt'(el) { const key = el.dataset.key; const input = $(`[data-alt="${key}"]`); await api('PUT', '/admin/api/media/' + encodeURIComponent(key), { alt: input.value }); const m = (state.media || []).find((x) => x.key === key); if (m) m.alt = input.value; toast('Alt text saved'); },
    async 'media-del'(el) { const key = el.dataset.key; if (!(await confirmDialog('Delete this file? Pages that use it will show a broken image.', { ok: 'Delete file', danger: true }))) return; await api('DELETE', '/admin/api/media/' + encodeURIComponent(key)); state.media = (state.media || []).filter((x) => x.key !== key); renderMedia(state.media); toast('File deleted'); },
    async 'bl-add'(form) {
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.source_url || !data.target_url) { toast('Source and target URLs are required.', 'error'); return; }
      const r = await api('POST', '/admin/api/backlinks', data);
      const created = r && r.backlink ? r.backlink : r && r.id != null ? r : { ...data, id: r && r.id, status: 'unchecked' };
      state.backlinks.unshift(created);
      renderBacklinks();
      form.reset();
      $('#bl-source').focus();
      toast('Backlink added');
    },
    async 'bl-check'(el) {
      const id = el.dataset.id;
      el.disabled = true; el.textContent = 'Checking…';
      try {
        const r = await api('POST', `/admin/api/backlinks/${encodeURIComponent(id)}/check`);
        const upd = r && r.backlink ? r.backlink : r;
        const row = state.backlinks.find((b) => String(b.id) === String(id));
        if (row && upd && typeof upd === 'object') Object.assign(row, upd);
        renderBacklinks();
        toast(row ? `Link is ${row.status}` : 'Checked');
      } finally { el.disabled = false; el.textContent = 'Check'; }
    },
    async 'bl-check-all'(el) {
      el.disabled = true; el.textContent = 'Checking…';
      try { await api('POST', '/admin/api/backlinks/check-all'); state.backlinks = list(await api('GET', '/admin/api/backlinks'), 'backlinks'); renderBacklinks(); toast('All backlinks checked'); }
      finally { el.disabled = false; el.textContent = 'Check all'; }
    },
    async 'bl-notes'(el) { const id = el.dataset.id; const row = state.backlinks.find((b) => String(b.id) === String(id)) || {}; const notes = $(`[data-notes="${id}"]`).value; await api('PUT', `/admin/api/backlinks/${encodeURIComponent(id)}`, { source_url: row.source_url, target_url: row.target_url, anchor_text: row.anchor_text, notes }); row.notes = notes; toast('Notes saved'); },
    async 'bl-del'(el) { const id = el.dataset.id; if (!(await confirmDialog('Delete this backlink record?', { ok: 'Delete', danger: true }))) return; await api('DELETE', `/admin/api/backlinks/${encodeURIComponent(id)}`); state.backlinks = state.backlinks.filter((b) => String(b.id) !== String(id)); renderBacklinks(); toast('Backlink deleted'); },
    async 'rd-save'() {
      const rows = state.model.list.map((r) => ({ from_path: String(r.from_path || '').trim(), to_url: String(r.to_url || '').trim(), code: Number(r.code) || 301 })).filter((r) => r.from_path || r.to_url);
      if (rows.some((r) => !r.from_path.startsWith('/') || !r.to_url)) { toast('Every redirect needs a from path starting with / and a destination.', 'error'); return; }
      const r = await api('PUT', '/admin/api/redirects', { redirects: rows });
      state.model.list = list(r, 'redirects').length ? list(r, 'redirects') : rows;
      setDirty(false); renderRedirects(); toast('Redirects saved');
    },
    async 'settings-save'() { await saveSettings(state.model); setDirty(false); toast('Settings saved'); },
    'theme-pick': (el) => { state.themeSel = el.dataset.id; renderThemes(); },
    async 'theme-apply'() {
      const id = state.themeSel, t = (state.themes || []).find((x) => x.id === id);
      await saveSettings({ ...state.settings.site, theme: id });
      renderThemes();
      const n = $('#theme-applied');
      n.innerHTML = `Theme <strong>${esc(t ? t.name : id)}</strong> is now live. <a href="/" target="_blank" rel="noopener">Open site</a> to see it (changes appear within a few seconds).`;
      n.hidden = false;
      toast('Theme applied');
    },
    async seed() {
      const ok = await confirmDialog('Load the built-in content? Pages, posts, backlinks and redirects that are missing from the database are added.', { ok: 'Load built-in content', extra: '<label class="check" for="dlg-replace"><input id="dlg-replace" type="checkbox"><span>Also replace existing content with the built-in versions (your edits are lost)</span></label>' });
      if (!ok) return;
      const replace = Boolean($('#dlg-replace', dlg) && $('#dlg-replace', dlg).checked);
      await api('POST', '/admin/api/seed', { replace });
      toast('Built-in content loaded');
      route();
    },
    async export() {
      const data = await api('GET', '/admin/api/export');
      const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bentley-hotel-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };
  const changes = {
    async upload(el) {
      const files = Array.from(el.files || []);
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('file', f, f.name));
      toast(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
      try { await api('POST', '/admin/api/media', fd); renderMedia(await loadMedia(true)); toast('Upload complete'); } finally { el.value = ''; }
    },
    async import(el) {
      const file = el.files && el.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.', 'error'); el.value = ''; return; }
      if (!(await confirmDialog(`Import "${file.name}"? Content in the file replaces what is in the database.`, { ok: 'Import', danger: true }))) { el.value = ''; return; }
      await api('POST', '/admin/api/import', data);
      el.value = '';
      toast('Import complete');
      route();
    },
    'hero-toggle': (el) => { const ed = state.editor, p = ed.page; if (el.checked) p.hero = ed.lastHero || blankHero(); else { ed.lastHero = p.hero; p.hero = null; } setDirty(true); renderRight(); },
    'theme-select': (el) => { state.themeSel = el.value; renderThemes(); },
  };

  function onField(el, type) {
    if (el.dataset.filter !== undefined && state.list) { state.list[el.dataset.filter] = el.value; (state.list.render || renderList)(); return; }
    if (el.dataset.change) { if (type === 'change') Promise.resolve(changes[el.dataset.change](el)).catch(fail); return; }
    const path = el.dataset.path;
    if (!path || !state.model) return;
    const value = readField(el);
    setPath(state.model, path, value);
    setDirty(true);
    if (el.dataset.counter) updateCounter(el);
    if (el.dataset.image !== undefined) updateThumb(el);
    if (state.onField) state.onField(el, path, value);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch(fail);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.id === 'login-form') return;
    e.preventDefault();
    const fn = actions[form.dataset.submit];
    if (fn) Promise.resolve(fn(form, e)).catch(fail);
  });
  $('#view').addEventListener('input', (e) => onField(e.target, 'input'));
  $('#view').addEventListener('change', (e) => onField(e.target, 'change'));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#password').value;
    const err = $('#login-error');
    const btn = $('#login-form button');
    if (!pw) { err.textContent = 'Please enter the password.'; return; }
    btn.disabled = true; err.textContent = '';
    try {
      await api('POST', '/admin/api/login', { password: pw });
      state.loggedIn = true;
      $('#password').value = '';
      currentHash = location.hash || '#/dashboard';
      route();
    } catch (ex) {
      err.textContent = ex.status === 401 ? 'Wrong password. Please try again.' : ex.message;
      $('#password').select();
    } finally { btn.disabled = false; }
  });

  route();
}
