/* Authentication pages and the Account page, plus everything the `account` plugin adds in the browser:
 * 2FA challenge on login (App.authChallenge), step-up prompts (App.withStepUp), captcha widgets
 * (App.authPageMounted), forgot/reset/verify pages, account tabs (security, sessions, API keys, privacy)
 * and the admin "Security" tab. Plugins add Account panels via App.registerAccountPanel().
 *
 * References:
 *   qrcode-generator 1.4.4 (MIT) for otpauth:// QR codes   https://github.com/kazuhikoarase/qrcode-generator  (cdnjs, pinned + SRI)
 *   Key Uri Format                                        https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *   Cloudflare Turnstile client API                       https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 *   hCaptcha client API                                   https://docs.hcaptcha.com/configuration
 *   WHATWG autocomplete="one-time-code"                   https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 */
(() => {
  'use strict';
  const { $, $$, esc, fmt, api, S, toast, busy, modal, route, query, needAuth, setSession, registries, registerAdminTab, registerHeaderWidget } = App;

  const QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  const QR_SRI = 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1';
  const acct = () => S.site?.account || null;                       // plugin settings from GET /api/site
  const hasPlugin = () => !!(S.site?.plugins || []).includes('account');
  const minLen = () => acct()?.password_min_length || 8;
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed', true); } };
  const when = (s) => (s ? fmt.date(s) : '—');
  const scripts = {};
  function loadScript(src, integrity) {
    return scripts[src] ||= new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = src; el.async = true; el.crossOrigin = 'anonymous';
      if (integrity) el.integrity = integrity;
      el.onload = () => resolve(); el.onerror = () => { delete scripts[src]; reject(new Error('Could not load ' + src)); };
      document.head.appendChild(el);
    });
  }

  // Small style additions (the shared stylesheet is owned elsewhere).
  const style = document.createElement('style');
  style.textContent = `
    .code-input { font: 600 26px/1 ui-monospace, Menlo, monospace; letter-spacing: .35em; text-align: center; }
    .codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; font-family: ui-monospace, Menlo, monospace; background: #05080d; padding: 12px 14px; border-radius: 10px; user-select: all; }
    .qr { background: #fff; padding: 10px; border-radius: 12px; display: inline-block; line-height: 0; }
    .qr svg { width: 180px; height: 180px; }
    .small { font-size: 12.5px; }
    .seclist { display: grid; gap: 10px; }
    .seclist .item { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid #1a2236; }
    .seclist .item:last-child { border-bottom: 0; }
    .wrap { overflow-x: auto; }
    .checks label { display: inline-flex; align-items: center; gap: 6px; margin: 6px 14px 0 0; color: var(--text); }
    .checks input { width: auto; }
    .acct-tabs { margin-bottom: 18px; }
    .mono-wrap { word-break: break-all; }
    .tile-sm { display: flex; flex-direction: column; gap: 4px; }
    .tile-sm b { font-size: 22px; }
    .badge.warn { background: #3a2e10; color: var(--warn); }
  `;
  document.head.appendChild(style);

  // ======================================================= captcha
  async function mountCaptcha(form, c) {
    if (!c || form.querySelector('[name=captcha_token]')) return;
    const host = $('#auth-extra', form) || form;
    const box = document.createElement('div'); box.innerHTML = '<input type="hidden" name="captcha_token" value="" /><div class="captcha" style="margin-top:12px"></div>';
    host.appendChild(box);
    const widget = $('.captcha', box), input = $('[name=captcha_token]', box);
    const cb = (t) => { input.value = t || ''; };
    try {
      if (c.provider === 'turnstile') { await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'); window.turnstile.render(widget, { sitekey: c.site_key, theme: 'dark', callback: cb, 'expired-callback': () => cb(''), 'error-callback': () => cb('') }); }
      else if (c.provider === 'hcaptcha') { await loadScript('https://js.hcaptcha.com/1/api.js?render=explicit'); window.hcaptcha.render(widget, { sitekey: c.site_key, theme: 'dark', callback: cb, 'expired-callback': () => cb('') }); }
    } catch (e) { widget.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }
  function resetCaptcha(form) {
    const input = form.querySelector('[name=captcha_token]'); if (input) input.value = '';
    try { window.turnstile?.reset(); } catch {}
    try { window.hcaptcha?.reset(); } catch {}
  }
  /** Core auth pages call this after rendering: add the captcha when the plugin says registration needs one. */
  App.authPageMounted = (mode, form) => { const c = acct()?.captcha; if (c && mode === 'register' && c.on_register) mountCaptcha(form, c); };

  // ======================================================= 2FA prompts
  /** Ask the user for a 6-digit / backup code. Resolves with the code or null (cancelled). */
  function promptCode({ title = 'Two-factor code', text = 'Enter the 6-digit code from your authenticator app, or one of your backup codes.', error = '' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const close = modal(`
        <h3 style="margin-top:0">${esc(title)}</h3><p class="muted">${esc(text)}</p>
        ${error ? `<p class="small" style="color:var(--danger)">${esc(error)}</p>` : ''}
        <form id="codef"><input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="12" autofocus required />
        <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Continue</button><button class="btn" type="button" data-close>Cancel</button></div></form>`,
      (root) => {
        const f = $('#codef', root);
        setTimeout(() => f.code.focus(), 30);
        f.onsubmit = (e) => { e.preventDefault(); done = true; const v = f.code.value.trim(); close(); resolve(v || null); };
        root.addEventListener('click', (e) => { if (!done && (e.target === root || e.target.closest('[data-close]'))) { done = true; resolve(null); } });
      });
    });
  }
  /**
   * Run `fn(headers)`; when the server answers 401 STEP_UP_REQUIRED, ask for a 2FA code and retry with
   * the `x-2fa-code` header. Up to three codes per call.
   */
  App.withStepUp = async function withStepUp(fn, { purpose } = {}) {
    let headers = {}, error = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await fn(headers); } catch (e) {
        if (e.code !== 'STEP_UP_REQUIRED' || attempt === 3) throw e;
        if (e.data?.reason === 'invalid') error = 'That code was not accepted. Codes work once; wait for the next one.';
        const code = await promptCode({ title: 'Confirm with two-factor', text: `This action${purpose ? ` (${purpose})` : ''} needs a two-factor code.`, error });
        if (!code) { const c = new Error('Cancelled'); c.code = 'CANCELLED'; throw c; }
        headers = { 'x-2fa-code': code };
      }
    }
  };
  /** Login returned { two_factor, challenge } instead of a token. */
  App.authChallenge = async function authChallenge(r, creds = {}) {
    let error = '';
    for (;;) {
      const code = await promptCode({ title: 'Two-factor authentication', text: 'Enter the code from your authenticator app, or a backup code.', error });
      if (!code) return;
      try {
        const out = await api('POST', '/auth/2fa/verify', { challenge: r.challenge, code });
        finishLogin(out);
        return out;
      } catch (e) {
        if (e.code === 'BAD_CODE') { error = `Wrong code${e.data?.attempts_left !== undefined ? ` – ${e.data.attempts_left} attempt(s) left` : ''}.`; continue; }
        toast(e.message, true);
        if (e.code === 'TOKEN_INVALID' || e.status === 429) return;
        error = e.message;
      }
    }
  };
  function finishLogin(r) {
    setSession(r.token, r.user);
    const next = sessionStorage.getItem('tb_after_login'); sessionStorage.removeItem('tb_after_login');
    if (r.email_verification && r.user && !r.user.email_verified) {
      // Development without a mail transport: keep the link so the Account page can offer it.
      if (r.email_verification.dev_token) sessionStorage.setItem('tb_dev_verify', r.email_verification.dev_token); else sessionStorage.removeItem('tb_dev_verify');
      toast(r.email_verification.sent ? 'Welcome! Check your inbox to verify your email.' : 'Welcome! Verify your email from the Account page.');
    }
    location.hash = next || '#/wallet';
  }
  /** Dev-mode verification link stored at registration (only when the server returns tokens). */
  const devVerifyLink = () => { const t = sessionStorage.getItem('tb_dev_verify'); return t ? ` <a href="#/verify?token=${encodeURIComponent(t)}" id="dev-verify">Open verification link (dev)</a>` : ''; };

  // ======================================================= auth pages
  function authPage(mode) {
    return async (view) => {
      if (S.user) { location.hash = '#/wallet'; return; }
      const reg = mode === 'register';
      view.innerHTML = `
        <form class="auth card">
          <h2>${reg ? 'Create your account' : 'Welcome back'}</h2>
          <label>Email</label><input name="email" type="email" autocomplete="email" required />
          <label>Password</label><input name="password" type="password" minlength="${reg ? minLen() : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}" required />
          ${reg && hasPlugin() ? `<p class="muted small" style="margin:6px 0 0">At least ${minLen()} characters. Long passphrases are best; common passwords are refused.</p>` : ''}
          <div id="auth-extra"></div>
          <div id="auth-notice"></div>
          <div class="row" style="margin-top:18px"><button class="btn primary" type="submit">${reg ? 'Sign up' : 'Log in'}</button></div>
          <p class="muted">${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}${!reg && hasPlugin() ? ' · <a href="#/forgot">Forgot password?</a>' : ''}</p>
          <p class="muted" id="auth-links"></p>
        </form>`;
      const form = $('form', view);
      form.onsubmit = (e) => {
        e.preventDefault();
        busy($('button[type=submit]', form), async () => {
          const extra = {};
          form.querySelectorAll('#auth-extra [name]').forEach((el) => { if (el.value) extra[el.name] = el.value; });
          const creds = { email: form.email.value.trim(), password: form.password.value };
          try {
            const r = await api('POST', `/auth/${mode}`, { ...creds, ...extra });
            if (!r.token && r.two_factor && App.authChallenge) return App.authChallenge(r, { ...creds, form });
            finishLogin(r);
          } catch (err) {
            resetCaptcha(form);
            const notice = $('#auth-notice', form);
            if (err.code === 'CAPTCHA_REQUIRED') { await mountCaptcha(form, acct()?.captcha || { provider: err.data?.provider, site_key: err.data?.site_key }); notice.innerHTML = '<p class="notice warn small">Please complete the captcha and try again.</p>'; return; }
            if (err.code === 'CAPTCHA_FAILED') { notice.innerHTML = '<p class="notice warn small">Captcha check failed, please try again.</p>'; return; }
            if (err.code === 'PASSWORD_RESET_REQUIRED') { notice.innerHTML = `<p class="notice warn small">${esc(err.message)}${err.data?.dev_token ? ` <a href="#/reset?token=${encodeURIComponent(err.data.dev_token)}">Open reset link (dev)</a>` : ''}</p>`; return; }
            if (err.code === 'LOCKED_OUT' || err.code === 'ACCOUNT_LOCKED') { notice.innerHTML = `<p class="notice warn small">${esc(err.message)}${hasPlugin() ? ' You can still <a href="#/forgot">reset your password</a>.' : ''}</p>`; return; }
            throw err;
          }
        });
      };
      App.authPageMounted?.(mode, form);
    };
  }
  route(/^\/login$/, authPage('login'));
  route(/^\/register$/, authPage('register'));

  route(/^\/forgot$/, async (view) => {
    view.innerHTML = `<form class="auth card" id="forgot"><h2>Reset your password</h2>
      <p class="muted">Enter your email and we will send a link that lets you choose a new password. Locked-out accounts can use this too.</p>
      <label>Email</label><input name="email" type="email" autocomplete="email" required /><div id="auth-extra"></div>
      <div class="row" style="margin-top:18px"><button class="btn primary" type="submit">Send reset link</button><a class="btn" href="#/login">Back</a></div><div id="out"></div></form>`;
    const f = $('#forgot', view);
    const c = acct()?.captcha; if (c?.on_register) mountCaptcha(f, c);
    f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => {
      const captcha_token = f.querySelector('[name=captcha_token]')?.value;
      const r = await api('POST', '/auth/password-reset/request', { email: f.email.value.trim(), ...(captcha_token ? { captcha_token } : {}) });
      $('#out', f).innerHTML = `<p class="notice" style="margin-top:16px">${esc(r.message || 'If that email belongs to an account, a reset link is on its way.')}${r.dev_token ? `<br><a href="#/reset?token=${encodeURIComponent(r.dev_token)}">Open the reset link (development mode: no mail transport)</a>` : ''}</p>`;
    }); };
  });

  route(/^\/reset$/, async (view) => {
    const token = query().get('token') || '';
    view.innerHTML = '<div class="auth card"><p class="muted">Checking link…</p></div>';
    try { await api('POST', '/auth/token-info', { token, purpose: 'reset' }); }
    catch (e) { view.innerHTML = `<div class="auth card"><h2>Link not valid</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/forgot">Request a new link</a></div>`; return; }
    view.innerHTML = `<form class="auth card" id="resetf"><h2>Choose a new password</h2>
      <label>New password</label><input name="password" type="password" minlength="${minLen()}" autocomplete="new-password" required />
      <label>Repeat</label><input name="again" type="password" minlength="${minLen()}" autocomplete="new-password" required />
      <p class="muted small">At least ${minLen()} characters. All your other sessions will be logged out.</p>
      <div class="row" style="margin-top:18px"><button class="btn primary" type="submit">Save password</button></div></form>`;
    const f = $('#resetf', view);
    f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => {
      if (f.password.value !== f.again.value) throw new Error('Passwords do not match');
      await api('POST', '/auth/password-reset/confirm', { token, password: f.password.value });
      toast('Password updated. Log in with your new password.'); location.hash = '#/login';
    }); };
  });

  route(/^\/verify$/, async (view) => {
    const token = query().get('token') || '';
    view.innerHTML = '<div class="auth card"><p class="muted">Verifying…</p></div>';
    try {
      const r = await api('POST', '/auth/verify-email', { token });
      sessionStorage.removeItem('tb_dev_verify');
      if (S.user && r.user && r.user.id === S.user.id) setSession(S.token, { ...S.user, ...r.user });
      view.innerHTML = `<div class="auth card"><h2>Email verified</h2><p class="muted">${esc(r.user.email)} is confirmed. Withdrawals, derivatives and paid servers are now available where required.</p><a class="btn primary" href="#/${S.user ? 'account' : 'login'}">${S.user ? 'Go to your account' : 'Log in'}</a></div>`;
    } catch (e) {
      view.innerHTML = `<div class="auth card"><h2>Link not valid</h2><p class="muted">${esc(e.message)}</p>${S.user ? '<button class="btn" id="resend">Send a new verification email</button>' : '<a class="btn" href="#/login">Log in</a>'}</div>`;
      const b = $('#resend', view); if (b) b.onclick = () => busy(b, async () => { const r = await api('POST', '/auth/verify-email/resend'); toast(r.sent ? 'Email sent' : 'Email queued'); if (r.dev_token) location.hash = `#/verify?token=${encodeURIComponent(r.dev_token)}`; });
    }
  });

  route(/^\/email-change$/, async (view) => {
    const token = query().get('token') || '';
    view.innerHTML = '<div class="auth card"><p class="muted">Confirming…</p></div>';
    try {
      const r = await api('POST', '/account/email/confirm', { token });
      if (S.user && r.user && r.user.id === S.user.id) setSession(S.token, { ...S.user, ...r.user });
      view.innerHTML = `<div class="auth card"><h2>Email updated</h2><p class="muted">Your account now uses ${esc(r.user.email)}.</p><a class="btn primary" href="#/account?tab=security">Back to account</a></div>`;
    } catch (e) { view.innerHTML = `<div class="auth card"><h2>Link not valid</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/account?tab=security">Account</a></div>`; }
  });

  // ======================================================= header widget: unverified email
  registerHeaderWidget({ id: 'verify-email', order: 5, render: () => (hasPlugin() && S.user && S.user.email_verified === false ? '<a href="#/account" class="badge warn" title="Your email is not verified yet">Verify email</a>' : '') });

  // ======================================================= account page
  const TABS = [['overview', 'Overview'], ['security', 'Security'], ['sessions', 'Sessions'], ['api', 'API keys'], ['privacy', 'Data & privacy']];
  route(/^\/account$/, needAuth(async (view) => {
    const plugin = hasPlugin();
    const tab = plugin ? (TABS.find(([k]) => k === query().get('tab'))?.[0] || 'overview') : 'overview';
    view.innerHTML = `<div class="section-head"><h1>Account</h1>${plugin ? `<div class="tabs acct-tabs" style="flex-wrap:wrap">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/account?tab=${k}'">${l}</button>`).join('')}</div>` : ''}</div><div id="acct"></div>`;
    const el = $('#acct', view);
    try { await ({ overview: renderOverview, security: renderSecurity, sessions: renderSessions, api: renderApiKeys, privacy: renderPrivacy })[tab](el); }
    catch (e) { el.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
  }));

  async function renderOverview(el) {
    const plugin = hasPlugin();
    const [{ orders }, sec] = await Promise.all([api('GET', '/shop/orders'), plugin ? api('GET', '/account/security').catch(() => null) : null]);
    const u = sec?.user || S.user;
    if (sec?.user) setSession(S.token, { ...S.user, ...sec.user });
    el.innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))" id="panels">
        <div class="card"><h3 style="margin-top:0">Profile</h3>
          <p class="mono-wrap"><b>${esc(u.email)}</b> ${plugin ? (u.email_verified ? '<span class="badge active">verified</span>' : '<span class="badge warn">unverified</span>') : ''}</p>
          ${plugin && !u.email_verified ? `<p class="muted small">Verify your email to unlock ${esc((sec?.verification_required_for || []).join(', ') || 'all features')}.</p><button class="btn small" id="resend">Resend verification email</button>${devVerifyLink()}` : ''}
          ${plugin && sec ? `<dl class="kv" style="margin-top:14px"><dt>Two-factor</dt><dd>${sec.two_factor.enabled ? '<span class="badge active">on</span>' : '<span class="badge">off</span>'} <a href="#/account?tab=security" class="small">manage</a></dd><dt>Sessions</dt><dd>${sec.sessions} active · <a href="#/account?tab=sessions" class="small">review</a></dd><dt>API keys</dt><dd>${sec.api_keys} active · <a href="#/account?tab=api" class="small">manage</a></dd><dt>Last login</dt><dd>${sec.last_login ? `${when(sec.last_login.created_at)} · ${esc(sec.last_login.device || '')}` : '—'}</dd></dl>` : ''}
          ${!plugin ? `<form id="pwf"><label>Current password</label><input type="password" name="current" required /><label>New password</label><input type="password" name="password" minlength="8" required /><div style="margin-top:14px"><button class="btn">Update password</button></div></form>` : ''}
        </div>
        <div class="card"><h3 style="margin-top:0">Cloud orders</h3>
          ${orders.length ? `<div class="wrap"><table class="t">${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.kind)} ${esc(o.plan_id)}</td><td>${fmt.money(o.amount_cents)}</td><td><span class="badge ${o.status === 'fulfilled' ? 'active' : o.status === 'failed' ? 'error' : ''}">${esc(o.status)}</span></td></tr>`).join('')}</table></div>` : '<p class="muted">No orders yet.</p>'}
        </div>
      </div>`;
    const rs = $('#resend', el); if (rs) rs.onclick = () => busy(rs, async () => { const r = await api('POST', '/auth/verify-email/resend'); toast(r.sent ? 'Verification email sent' : 'Verification email queued'); if (r.dev_token) { sessionStorage.setItem('tb_dev_verify', r.dev_token); location.hash = `#/verify?token=${encodeURIComponent(r.dev_token)}`; } });
    const f = $('#pwf', el); if (f) f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => { await api('POST', '/auth/change-password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Password updated'); }); };
    for (const p of registries.accountPanels) {
      const card = document.createElement('div'); card.className = 'card'; card.id = `panel-${p.id}`;
      if (p.wide) card.style.gridColumn = '1 / -1';
      $('#panels', el).appendChild(card);
      try { await p.render(card); } catch (e) { card.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    }
  }

  // ---------------- security tab
  async function renderSecurity(el) {
    const sec = await api('GET', '/account/security');
    const tf = sec.two_factor;
    el.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card"><h3 style="margin-top:0">Two-factor authentication ${tf.enabled ? '<span class="badge active">on</span>' : '<span class="badge">off</span>'}</h3>
        ${tf.enabled
          ? `<p class="muted">Enabled ${when(tf.enabled_at)}. Logins, withdrawals, VPN configs and API-key creation ask for a code. Backup codes left: <b>${tf.backup_codes_left}</b>${tf.backup_codes_left <= 2 ? ' <span class="badge warn">low</span>' : ''}.</p>
             <div class="row"><button class="btn" id="regen">New backup codes</button><button class="btn danger" id="disable">Disable 2FA</button></div>`
          : `<p class="muted">Protect your account with a time-based code from an authenticator app (Google Authenticator, Aegis, 1Password…). Strongly recommended before you hold funds.</p><button class="btn primary" id="enable">Enable 2FA</button>`}
      </div>
      <div class="card"><h3 style="margin-top:0">Password</h3><p class="muted">Last changed: ${sec.password_changed_at ? when(sec.password_changed_at) : 'never'}. Changing it logs out your other sessions.</p>
        <form id="pwf"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required /><label>New password</label><input type="password" name="password" minlength="${sec.password_policy?.min_length || minLen()}" autocomplete="new-password" required /><p class="muted small">At least ${sec.password_policy?.min_length || minLen()} characters.</p><div style="margin-top:10px"><button class="btn">Update password</button></div></form></div>
      <div class="card"><h3 style="margin-top:0">Email</h3><p class="mono-wrap"><b>${esc(sec.user.email)}</b> ${sec.email_verified ? '<span class="badge active">verified</span>' : '<span class="badge warn">unverified</span>'}</p>
        ${!sec.email_verified ? `<button class="btn small" id="resend">Resend verification email</button>${devVerifyLink()}` : ''}
        ${sec.pending_email ? `<p class="notice small">Waiting for confirmation of <b>${esc(sec.pending_email)}</b> – check that inbox.</p>` : ''}
        <form id="emf" style="margin-top:8px"><label>New email</label><input type="email" name="new_email" autocomplete="email" required /><label>Current password</label><input type="password" name="password" autocomplete="current-password" required /><div style="margin-top:10px"><button class="btn">Change email</button></div></form></div>
    </div>`;
    const pwf = $('#pwf', el);
    pwf.onsubmit = (e) => { e.preventDefault(); busy($('button', pwf), async () => { const r = await api('POST', '/auth/change-password', { current: pwf.current.value, password: pwf.password.value }); pwf.reset(); toast(`Password updated${r.sessions_revoked ? ` · ${r.sessions_revoked} other session(s) logged out` : ''}`); renderSecurity(el); }); };
    const emf = $('#emf', el);
    emf.onsubmit = (e) => { e.preventDefault(); busy($('button', emf), async () => {
      const r = await App.withStepUp((h) => api('POST', '/account/email/change', { new_email: emf.new_email.value.trim(), password: emf.password.value }, { headers: h }), { purpose: 'change email' });
      toast(r.sent ? `Confirmation sent to ${r.pending_email}` : `Confirm ${r.pending_email} from the link we generated`);
      if (r.dev_token) location.hash = `#/email-change?token=${encodeURIComponent(r.dev_token)}`; else renderSecurity(el);
    }); };
    const rs = $('#resend', el); if (rs) rs.onclick = () => busy(rs, async () => { const r = await api('POST', '/auth/verify-email/resend'); toast(r.sent ? 'Verification email sent' : 'Verification email queued'); if (r.dev_token) { sessionStorage.setItem('tb_dev_verify', r.dev_token); location.hash = `#/verify?token=${encodeURIComponent(r.dev_token)}`; } });
    const en = $('#enable', el); if (en) en.onclick = () => enrol2fa(() => renderSecurity(el));
    const rg = $('#regen', el); if (rg) rg.onclick = () => busy(rg, async () => { const r = await App.withStepUp((h) => api('POST', '/account/2fa/backup-codes', {}, { headers: h }), { purpose: 'new backup codes' }); showBackupCodes(r.backup_codes, 'Your new backup codes'); renderSecurity(el); });
    const ds = $('#disable', el); if (ds) ds.onclick = () => modal(`<h3 style="margin-top:0">Disable two-factor authentication</h3><p class="muted">Your account will be protected by the password alone. Enter your password and a current code.</p>
      <form id="disf"><label>Password</label><input type="password" name="password" autocomplete="current-password" required /><label>Authenticator or backup code</label><input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" required /><div class="row" style="margin-top:14px"><button class="btn danger" type="submit">Disable</button><button class="btn" type="button" data-close>Cancel</button></div></form>`, (root, close) => {
      const f = $('#disf', root); f.onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', f), async () => { await api('POST', '/account/2fa/disable', { password: f.password.value, code: f.code.value.trim() }); close(); toast('Two-factor authentication disabled'); setSession(S.token, { ...S.user, two_factor: false }); renderSecurity(el); }); };
    });
  }

  function showBackupCodes(codes, title = 'Save your backup codes') {
    modal(`<h3 style="margin-top:0">${esc(title)}</h3><p class="muted">Each code works once if you lose your phone. Store them somewhere safe – they are shown only now.</p>
      <div class="codes">${codes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn" id="cp">Copy</button><button class="btn" id="dl">Download .txt</button><button class="btn primary" data-close>Done</button></div>`, (root) => {
      $('#cp', root).onclick = () => copy(codes.join('\n'));
      $('#dl', root).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`${S.site?.brand || 'Platform'} backup codes for ${S.user.email}\n\n${codes.join('\n')}\n`], { type: 'text/plain' })); a.download = 'backup-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
    });
  }

  function enrol2fa(onDone) {
    modal(`<h3 style="margin-top:0">Enable two-factor authentication</h3>
      <div id="step1"><p class="muted">Confirm your password to start.</p><form id="pf"><label>Password</label><input type="password" name="password" autocomplete="current-password" required /><div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Continue</button><button class="btn" type="button" data-close>Cancel</button></div></form></div>
      <div id="step2" hidden></div>`, (root, close) => {
      const pf = $('#pf', root);
      pf.onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', pf), async () => {
        const st = await api('POST', '/account/2fa/setup', { password: pf.password.value });
        $('#step1', root).hidden = true;
        const s2 = $('#step2', root); s2.hidden = false;
        s2.innerHTML = `<p class="muted">1. Scan this QR code with your authenticator app, or enter the key by hand.</p>
          <div class="row" style="align-items:flex-start"><div class="qr" id="qr"><span class="muted small" style="color:#333">Loading…</span></div>
          <div style="flex:1;min-width:200px"><div class="muted small">Key</div><div class="secret mono-wrap" style="font-size:14px">${esc(st.secret)}</div><div class="muted small">Account ${esc(st.account)} · ${esc(st.issuer)} · SHA1 · 6 digits · 30s</div><button class="btn small" id="cpk" type="button">Copy key</button></div></div>
          <p class="muted" style="margin-top:14px">2. Enter the 6-digit code the app shows now.</p>
          <form id="cf"><input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /><div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Turn on 2FA</button><button class="btn" type="button" data-close>Cancel</button></div></form>`;
        $('#cpk', s2).onclick = () => copy(st.secret);
        loadScript(QR_SRC, QR_SRI).then(() => { const q = window.qrcode(0, 'M'); q.addData(st.otpauth_url); q.make(); $('#qr', s2).innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); })
          .catch(() => { $('#qr', s2).innerHTML = `<a class="small" style="color:#333" href="${esc(st.otpauth_url)}">Open in authenticator app</a>`; });
        const cf = $('#cf', s2);
        setTimeout(() => cf.code.focus(), 50);
        cf.onsubmit = (ev) => { ev.preventDefault(); busy($('button[type=submit]', cf), async () => {
          const r = await api('POST', '/account/2fa/confirm', { code: cf.code.value.trim() });
          close(); setSession(S.token, { ...S.user, two_factor: true }); toast('Two-factor authentication is on');
          showBackupCodes(r.backup_codes); onDone?.();
        }); };
      }); };
    });
  }

  // ---------------- sessions tab
  async function renderSessions(el) {
    const [{ sessions }, { history }] = await Promise.all([api('GET', '/account/sessions'), api('GET', '/account/login-history?limit=50')]);
    el.innerHTML = `<div class="card"><div class="section-head" style="margin-bottom:10px"><h3 style="margin:0">Active sessions (${sessions.length})</h3><button class="btn small danger" id="all">Log out everywhere else</button></div>
      <div class="wrap"><table class="t"><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last seen</th><th>Method</th><th></th></tr>
      ${sessions.map((s) => `<tr><td>${esc(s.device || 'Unknown')} ${s.current ? '<span class="badge active">this device</span>' : ''}</td><td class="mono">${esc(s.ip || '')}</td><td>${when(s.created_at)}</td><td>${when(s.last_seen_at)}</td><td>${esc(s.method)}</td><td class="num">${s.current ? '' : `<button class="btn small" data-rv="${esc(s.id)}">Revoke</button>`}</td></tr>`).join('')}</table></div></div>
      <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Login history</h3><div class="wrap"><table class="t"><tr><th>When</th><th>Result</th><th>Device</th><th>IP</th><th></th></tr>
      ${history.length ? history.map((h) => `<tr><td>${when(h.created_at)}</td><td>${h.ok ? '<span class="badge active">ok</span>' : `<span class="badge error">failed</span> <span class="muted small">${esc(h.reason || '')}</span>`} <span class="muted small">${esc(h.method || '')}</span></td><td>${esc(h.device || '')}</td><td class="mono">${esc(h.ip || '')}</td><td>${h.new_device ? '<span class="badge warn">new device</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</table></div>
      <p class="muted small">See a login you do not recognise? Revoke the session, change your password and enable two-factor authentication.</p></div>`;
    $$('[data-rv]', el).forEach((b) => (b.onclick = () => busy(b, async () => { await api('DELETE', `/account/sessions/${encodeURIComponent(b.dataset.rv)}`); toast('Session revoked'); renderSessions(el); })));
    $('#all', el).onclick = () => confirm('Log out every other device?') && busy($('#all', el), async () => { const r = await api('POST', '/account/sessions/revoke-all', {}); toast(`${r.revoked} session(s) logged out`); renderSessions(el); });
  }

  // ---------------- API keys tab
  async function renderApiKeys(el) {
    const { keys } = await api('GET', '/account/api-keys');
    const live = keys.filter((k) => !k.revoked_at);
    el.innerHTML = `<div class="card"><h3 style="margin-top:0">API keys</h3>
      <p class="muted">For trading bots. <b>read</b> = balances, orders, markets · <b>trade</b> = place/cancel orders, open/close positions · <b>withdraw</b> = request withdrawals (requires an IP allowlist). Keys never reach account, admin or cloud endpoints. Signed (HMAC) requests keep the secret off the wire; see the docs for the scheme.</p>
      <div class="wrap"><table class="t"><tr><th>Label</th><th>Key id</th><th>Mode</th><th>Scopes</th><th>IP allowlist</th><th>Expires</th><th>Last used</th><th></th></tr>
      ${live.length ? live.map((k) => `<tr><td>${esc(k.label)}</td><td class="mono">${esc(k.key_id)}</td><td>${esc(k.auth_mode)}</td><td>${k.scopes.map((s) => `<span class="badge">${esc(s)}</span>`).join(' ')}</td><td class="mono small">${k.ip_allowlist.length ? k.ip_allowlist.map(esc).join('<br>') : '<span class="muted">any</span>'}</td><td>${k.expires_at ? fmt.left(k.expires_at.replace(' ', 'T') + 'Z') : 'never'}</td><td>${k.last_used_at ? `${when(k.last_used_at)}<br><span class="mono small muted">${esc(k.last_used_ip || '')}</span>` : '—'}</td><td class="num"><button class="btn small danger" data-rk="${k.id}">Revoke</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted">No API keys yet.</td></tr>'}</table></div></div>
      <form class="card" id="kf" style="margin-top:14px"><h3 style="margin-top:0">Create a key</h3>
        <label>Label</label><input name="label" maxlength="60" placeholder="e.g. grid bot" required />
        <label>Scopes</label><div class="checks"><label><input type="checkbox" name="scopes" value="read" checked /> read</label><label><input type="checkbox" name="scopes" value="trade" /> trade</label><label><input type="checkbox" name="scopes" value="withdraw" /> withdraw</label></div>
        <label>Authentication</label><div class="checks"><label><input type="radio" name="auth_mode" value="hmac" checked /> Signed requests (HMAC) – also usable as bearer</label><label><input type="radio" name="auth_mode" value="bearer" /> Bearer only (secret stored hashed)</label></div>
        <label>IP allowlist (optional; one IP or CIDR per line – required for withdraw)</label><textarea name="ip_allowlist" placeholder="203.0.113.10&#10;198.51.100.0/24"></textarea>
        <label>Expires in days (optional, 1–365)</label><input name="expires_in_days" type="number" min="1" max="365" placeholder="never" />
        <div style="margin-top:14px"><button class="btn primary">Create key</button></div></form>`;
    $$('[data-rk]', el).forEach((b) => (b.onclick = () => confirm('Revoke this key? Bots using it will stop working immediately.') && busy(b, async () => { await api('DELETE', `/account/api-keys/${b.dataset.rk}`); toast('Key revoked'); renderApiKeys(el); })));
    const f = $('#kf', el);
    f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => {
      const scopes = $$('[name=scopes]:checked', f).map((c) => c.value);
      const body = { label: f.label.value.trim(), scopes, auth_mode: f.auth_mode.value, ip_allowlist: f.ip_allowlist.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean), ...(f.expires_in_days.value ? { expires_in_days: Number(f.expires_in_days.value) } : {}) };
      const r = await App.withStepUp((h) => api('POST', '/account/api-keys', body, { headers: h }), { purpose: 'create API key' });
      showNewKey(r); renderApiKeys(el);
    }); };
  }
  function showNewKey(r) {
    const origin = location.origin;
    const snippet = r.key.auth_mode === 'hmac'
      ? `const ts = String(Date.now()), method = 'GET', path = '/api/wallet', body = '';\nconst sig = crypto.createHmac('sha256', SECRET).update(ts + method + path + body).digest('hex');\nfetch('${origin}' + path, { headers: { 'X-API-Key': '${r.key.key_id}', 'X-API-Timestamp': ts, 'X-API-Signature': sig } });`
      : `fetch('${origin}/api/wallet', { headers: { Authorization: 'Bearer ${r.bearer}' } });`;
    modal(`<h3 style="margin-top:0">Your new API key</h3><p class="notice warn small">The secret is shown only once. Store it now.</p>
      <div class="muted small">Key id (public)</div><div class="secret mono-wrap" style="font-size:14px">${esc(r.key.key_id)}</div>
      <div class="muted small">Secret</div><div class="secret mono-wrap" style="font-size:14px">${esc(r.secret)}</div>
      <div class="muted small">Bearer token (Authorization: Bearer …)</div><div class="secret mono-wrap" style="font-size:13px">${esc(r.bearer)}</div>
      <div class="muted small" style="margin-top:8px">Example</div><pre class="terminal" style="margin:6px 0 0;white-space:pre-wrap">${esc(snippet)}</pre>
      <div class="row" style="margin-top:14px"><button class="btn" id="cps">Copy secret</button><button class="btn" id="cpb">Copy bearer</button><button class="btn primary" data-close>Done</button></div>`, (root) => {
      $('#cps', root).onclick = () => copy(r.secret); $('#cpb', root).onclick = () => copy(r.bearer);
    });
  }

  // ---------------- privacy tab
  async function renderPrivacy(el) {
    el.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card"><h3 style="margin-top:0">Export your data</h3><p class="muted">Download everything we hold about you as JSON: profile, wallet ledger, orders, positions, servers, sessions and login history (GDPR Art. 15/20).</p><button class="btn" id="exp">Download JSON</button></div>
      <div class="card"><h3 style="margin-top:0">Delete account</h3><p class="muted">Your email and password are erased and the account is closed for good. Balances must be withdrawn and servers deleted first; ledger entries stay for accounting.</p>
        <div id="blockers" class="muted small"></div>
        <form id="delf" style="margin-top:8px"><label>Password</label><input type="password" name="password" autocomplete="current-password" required /><label>Type DELETE to confirm</label><input name="confirm" autocomplete="off" required /><div style="margin-top:12px"><button class="btn danger">Delete my account</button></div></form></div></div>`;
    $('#exp', el).onclick = () => busy($('#exp', el), async () => {
      const res = await api('GET', '/account/export?download', null, { raw: true });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `account-${S.user.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    api('GET', '/account/delete/check').then(({ blockers }) => { $('#blockers', el).innerHTML = blockers.length ? `<div class="notice warn">Before deleting:<ul style="margin:6px 0 0 18px">${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''; }).catch(() => {});
    const f = $('#delf', el);
    f.onsubmit = (e) => { e.preventDefault(); if (!confirm('Delete your account permanently?')) return; busy($('button', f), async () => {
      await App.withStepUp((h) => api('POST', '/account/delete', { password: f.password.value, confirm: f.confirm.value.trim() }, { headers: h }), { purpose: 'delete account' });
      toast('Account deleted'); App.logout();
    }); };
  }

  // ======================================================= admin: Security tab
  const flag = (on, label, cls = 'active') => (on ? `<span class="badge ${cls}">${label}</span>` : '');
  registerAdminTab({ id: 'security', label: 'Security', order: 30, async render(pane) {
    if (!hasPlugin()) { pane.innerHTML = '<div class="card"><p class="muted">The account plugin is not loaded.</p></div>'; return; }
    const userId = query().get('user');
    if (userId) return adminUser(pane, Number(userId));
    const view = query().get('view') || 'users';
    const ov = await api('GET', '/admin/security/overview');
    const tile = (l, v) => `<div class="card tile-sm"><span class="muted small">${l}</span><b>${v}</b></div>`;
    pane.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">${tile('Users', ov.users)}${tile('Verified', ov.verified)}${tile('2FA on', ov.two_factor)}${tile('Locked', ov.locked)}${tile('Sessions', ov.active_sessions)}${tile('Logins 24h', ov.logins_24h)}${tile('Failed 24h', ov.failed_24h)}${tile('Lockouts', ov.lockouts_active)}${tile('API keys', ov.api_keys)}</div>
      <div class="tabs" style="margin-bottom:14px">${[['users', 'Users'], ['lockouts', 'Lockouts'], ['audit', 'Audit log']].map(([k, l]) => `<button class="${view === k ? 'on' : ''}" onclick="location.hash='#/admin?tab=security&view=${k}'">${l}</button>`).join('')}</div><div id="secv"></div>`;
    const v = $('#secv', pane);
    if (view === 'users') await adminUsers(v);
    else if (view === 'lockouts') await adminLockouts(v);
    else await adminAudit(v);
  } });

  async function adminUsers(v) {
    v.innerHTML = `<div class="card"><form id="sf" class="row"><input name="q" placeholder="Search by email or id" style="flex:1;min-width:200px" /><select name="filter" style="width:auto"><option value="">All</option><option value="locked">Locked</option><option value="unverified">Unverified</option><option value="2fa">2FA on</option><option value="admins">Admins</option><option value="deleted">Deleted</option></select><button class="btn primary">Search</button></form><div id="res" style="margin-top:14px"></div></div>`;
    const f = $('#sf', v);
    const load = () => busy($('button', f), async () => {
      const { users } = await api('GET', `/admin/security/users?q=${encodeURIComponent(f.q.value.trim())}&filter=${encodeURIComponent(f.filter.value)}`);
      $('#res', v).innerHTML = `<div class="wrap"><table class="t"><tr><th>ID</th><th>Email</th><th>Status</th><th>Sessions</th><th>Keys</th><th>Last login</th><th>Failed 24h</th><th></th></tr>
        ${users.map((u) => `<tr class="click" onclick="location.hash='#/admin?tab=security&user=${u.id}'"><td>${u.id}</td><td class="mono-wrap">${esc(u.email)}</td><td>${flag(u.is_admin, 'admin')} ${flag(u.locked, 'locked', 'error')} ${flag(u.banned, 'banned', 'error')} ${flag(u.deleted_at, 'deleted', 'error')} ${flag(u.two_factor, '2FA')} ${flag(!u.email_verified && !u.deleted_at, 'unverified', 'warn')} ${flag(u.must_reset_password, 'reset pending', 'warn')} ${flag(u.throttle?.locked_until, 'lockout', 'warn')}</td><td>${u.sessions}</td><td>${u.api_keys}</td><td>${when(u.last_login)}</td><td>${u.failed_24h}</td><td><a href="#/admin?tab=security&user=${u.id}">View</a></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No users match.</td></tr>'}</table></div>`;
    });
    f.onsubmit = (e) => { e.preventDefault(); load(); };
    load();
  }

  async function adminLockouts(v) {
    const { lockouts } = await api('GET', '/admin/security/lockouts');
    v.innerHTML = `<div class="card"><h3 style="margin-top:0">Active lockouts</h3><div class="wrap"><table class="t"><tr><th>Key</th><th>Lockouts</th><th>Locked until</th><th></th></tr>
      ${lockouts.length ? lockouts.map((l) => `<tr><td class="mono">${esc(l.key)}</td><td>${l.lockouts}</td><td>${when(l.locked_until)}</td><td class="num"><button class="btn small" data-clear="${esc(l.key)}">Clear</button></td></tr>`).join('') : '<tr><td colspan="4" class="muted">None.</td></tr>'}</table></div></div>`;
    $$('[data-clear]', v).forEach((b) => (b.onclick = () => busy(b, async () => { await api('POST', '/admin/security/lockouts/clear', { key: b.dataset.clear }); toast('Cleared'); adminLockouts(v); })));
  }

  function auditTable(rows) {
    return `<div class="wrap"><table class="t"><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th>IP</th></tr>
      ${rows.length ? rows.map((a) => `<tr><td style="white-space:nowrap">${when(a.created_at)}</td><td class="mono">${esc(a.action)}</td><td class="mono-wrap">${esc(a.actor_email || (a.actor_id === null ? 'system' : a.actor_id))}</td><td class="mono-wrap">${esc(a.target_email || a.target_id || '')}</td><td class="mono small" style="max-width:320px;word-break:break-all">${esc(typeof a.details === 'string' ? a.details : JSON.stringify(a.details || {}))}</td><td class="mono small">${esc(a.ip || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">No entries.</td></tr>'}</table></div>`;
  }
  async function adminAudit(v) {
    v.innerHTML = `<div class="card"><form id="af" class="row"><input name="action" placeholder="Action prefix, e.g. admin. or account.lockout" style="flex:1;min-width:200px" /><input name="user_id" type="number" placeholder="User id" style="width:120px" /><button class="btn primary">Filter</button></form><div id="ares" style="margin-top:14px"></div></div>`;
    const f = $('#af', v);
    const load = () => busy($('button', f), async () => { const { audit } = await api('GET', `/admin/security/audit?action=${encodeURIComponent(f.action.value.trim())}${f.user_id.value ? `&user_id=${Number(f.user_id.value)}` : ''}&limit=200`); $('#ares', v).innerHTML = auditTable(audit); });
    f.onsubmit = (e) => { e.preventDefault(); load(); };
    load();
  }

  async function adminUser(pane, id) {
    const d = await api('GET', `/admin/security/users/${id}`);
    const u = d.user;
    const act = (key, label, cls = '') => `<button class="btn small ${cls}" data-act="${key}">${label}</button>`;
    pane.innerHTML = `<p><a href="#/admin?tab=security">← All users</a></p>
      <div class="card"><div class="section-head" style="margin-bottom:8px"><h2 style="margin:0" class="mono-wrap">${esc(u.email)} <span class="muted">#${u.id}</span></h2>
        <div class="row">${flag(u.is_admin, 'admin')}${flag(u.locked, `locked${u.locked_reason ? `: ${esc(u.locked_reason)}` : ''}`, 'error')}${flag(u.banned, 'banned', 'error')}${flag(u.deleted_at, 'deleted', 'error')}${flag(u.two_factor, '2FA on')}${flag(!u.email_verified && !u.deleted_at, 'unverified', 'warn')}${flag(u.must_reset_password, 'password reset pending', 'warn')}${flag(u.throttle?.locked_until, `lockout until ${u.throttle?.locked_until ? fmt.date(u.throttle.locked_until) : ''}`, 'warn')}</div></div>
        <dl class="kv"><dt>Joined</dt><dd>${when(u.created_at)}</dd><dt>Last login</dt><dd>${when(u.last_login)}</dd><dt>Failed logins 24h</dt><dd>${u.failed_24h} · throttle failures ${u.throttle?.failures ?? 0}</dd><dt>Pending email</dt><dd>${esc(u.pending_email || '—')}</dd><dt>Backup codes</dt><dd>${d.two_factor.enabled ? d.two_factor.backup_codes_left : '—'}</dd></dl>
        <div class="row" style="margin-top:14px">
          ${u.deleted_at ? '' : u.locked ? act('unlock', 'Unlock') : act('lock', 'Lock account', 'danger')}
          ${u.deleted_at ? '' : act('force-reset', 'Force password reset', 'danger')}
          ${d.two_factor.enabled ? act('disable-2fa', 'Disable 2FA (support)', 'danger') : ''}
          ${!u.email_verified && !u.deleted_at ? act('verify-email', 'Mark email verified') : ''}
          ${act('sessions/revoke', 'Revoke all sessions')}
          ${u.throttle?.locked_until || u.throttle?.failures ? act('clear-lockout', 'Clear lockout') : ''}
        </div></div>
      <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Sessions (${d.sessions.length})</h3><div class="wrap"><table class="t"><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last seen</th><th>Method</th><th></th></tr>
        ${d.sessions.length ? d.sessions.map((s) => `<tr><td>${esc(s.device || '')}</td><td class="mono">${esc(s.ip || '')}</td><td>${when(s.created_at)}</td><td>${when(s.last_seen_at)}</td><td>${esc(s.method)}</td><td class="num"><button class="btn small" data-rs="${esc(s.id)}">Revoke</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">None.</td></tr>'}</table></div></div>
      <div class="card" style="margin-top:14px"><h3 style="margin-top:0">API keys</h3><div class="wrap"><table class="t"><tr><th>Label</th><th>Key id</th><th>Scopes</th><th>Allowlist</th><th>Last used</th><th>Status</th><th></th></tr>
        ${d.api_keys.length ? d.api_keys.map((k) => `<tr><td>${esc(k.label)}</td><td class="mono">${esc(k.key_id)}</td><td>${k.scopes.map((s) => `<span class="badge">${esc(s)}</span>`).join(' ')}</td><td class="mono small">${k.ip_allowlist.map(esc).join('<br>') || '<span class="muted">any</span>'}</td><td>${when(k.last_used_at)}</td><td>${k.revoked_at ? '<span class="badge error">revoked</span>' : '<span class="badge active">active</span>'}</td><td class="num">${k.revoked_at ? '' : `<button class="btn small danger" data-rk="${k.id}">Revoke</button>`}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">None.</td></tr>'}</table></div></div>
      <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Login history</h3><div class="wrap"><table class="t"><tr><th>When</th><th>Result</th><th>Device</th><th>IP</th><th></th></tr>
        ${d.login_history.length ? d.login_history.map((h) => `<tr><td>${when(h.created_at)}</td><td>${h.ok ? '<span class="badge active">ok</span>' : `<span class="badge error">failed</span> <span class="muted small">${esc(h.reason || '')}</span>`} <span class="muted small">${esc(h.method || '')}</span></td><td>${esc(h.device || '')}</td><td class="mono">${esc(h.ip || '')}</td><td>${h.new_device ? '<span class="badge warn">new device</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">None.</td></tr>'}</table></div></div>
      <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Audit log for this user</h3>${auditTable(d.audit)}</div>`;
    const reload = () => adminUser(pane, id);
    $$('[data-act]', pane).forEach((b) => (b.onclick = () => busy(b, async () => {
      const key = b.dataset.act;
      let body = {};
      if (key === 'lock') { const reason = prompt('Reason for locking (shown in the audit log):', 'fraud review'); if (reason === null) return; body = { reason }; }
      if (key === 'disable-2fa') { const reason = prompt('Ticket reference / reason (required):'); if (!reason) return; if (!confirm(`Disable 2FA for ${u.email}? Every session will be logged out.`)) return; body = { reason }; }
      if (key === 'force-reset') { const reason = prompt('Reason:', 'credential leak'); if (reason === null) return; if (!confirm(`Force ${u.email} to reset their password and log them out everywhere?`)) return; body = { reason }; }
      if (key === 'sessions/revoke' && !confirm('Revoke every session of this user?')) return;
      const r = await App.withStepUp((h) => api('POST', `/admin/security/users/${id}/${key}`, body, { headers: h }), { purpose: key });
      toast(r.dev_token ? 'Done. Dev reset link: ' + location.origin + '/#/reset?token=' + r.dev_token : 'Done');
      if (r.dev_token) console.info('Dev reset link', `${location.origin}/#/reset?token=${r.dev_token}`);
      reload();
    })));
    $$('[data-rs]', pane).forEach((b) => (b.onclick = () => busy(b, async () => { await api('DELETE', `/admin/security/users/${id}/sessions/${encodeURIComponent(b.dataset.rs)}`); toast('Session revoked'); reload(); })));
    $$('[data-rk]', pane).forEach((b) => (b.onclick = () => busy(b, async () => { await api('DELETE', `/admin/security/users/${id}/api-keys/${b.dataset.rk}`); toast('Key revoked'); reload(); })));
  }
})();
