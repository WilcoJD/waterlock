/* Authentication pages and the Account page. Plugins add panels via App.registerAccountPanel(). */
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, route, needAuth, setSession, registries } = App;

  function authPage(mode) {
    return async (view) => {
      if (S.user) { location.hash = '#/wallet'; return; }
      const reg = mode === 'register';
      view.innerHTML = `
        <form class="auth card">
          <h2>${reg ? 'Create your account' : 'Welcome back'}</h2>
          <label>Email</label><input name="email" type="email" autocomplete="email" required />
          <label>Password</label><input name="password" type="password" minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}" required />
          <div id="auth-extra"></div>
          <div class="row" style="margin-top:18px"><button class="btn primary" type="submit">${reg ? 'Sign up' : 'Log in'}</button></div>
          <p class="muted">${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
          <p class="muted" id="auth-links"></p>
        </form>`;
      const form = $('form', view);
      form.onsubmit = (e) => {
        e.preventDefault();
        busy($('button[type=submit]', form), async () => {
          const extra = {};
          form.querySelectorAll('#auth-extra [name]').forEach((el) => (extra[el.name] = el.value));
          const r = await api('POST', `/auth/${mode}`, { email: form.email.value, password: form.password.value, ...extra });
          // Plugins (e.g. 2FA) may return a challenge instead of a token.
          if (!r.token && App.authChallenge) return App.authChallenge(r, { email: form.email.value, password: form.password.value, form });
          setSession(r.token, r.user);
          const next = sessionStorage.getItem('tb_after_login'); sessionStorage.removeItem('tb_after_login');
          location.hash = next || '#/wallet';
        });
      };
      App.authPageMounted?.(mode, form);
    };
  }
  route(/^\/login$/, authPage('login'));
  route(/^\/register$/, authPage('register'));

  route(/^\/account$/, needAuth(async (view) => {
    const { orders } = await api('GET', '/shop/orders');
    view.innerHTML = `
      <div class="section-head"><h1>Account</h1></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))" id="panels">
        <form class="card" id="pwf"><h3>Change password</h3><p class="muted">${esc(S.user.email)}</p>
          <label>Current password</label><input type="password" name="current" required />
          <label>New password</label><input type="password" name="password" minlength="8" required />
          <div style="margin-top:14px"><button class="btn">Update</button></div></form>
        <div class="card"><h3>Cloud orders</h3>
          ${orders.length ? `<table class="t">${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.kind)} ${esc(o.plan_id)}</td><td>${fmt.money(o.amount_cents)}</td><td><span class="badge ${o.status === 'fulfilled' ? 'active' : o.status === 'failed' ? 'error' : ''}">${esc(o.status)}</span></td></tr>`).join('')}</table>` : '<p class="muted">No orders yet.</p>'}
        </div>
      </div>`;
    const f = $('#pwf');
    f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => { await api('POST', '/auth/change-password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Password updated'); }); };
    for (const p of registries.accountPanels) {
      const el = document.createElement('div'); el.className = 'card'; el.id = `panel-${p.id}`;
      if (p.wide) el.style.gridColumn = '1 / -1';
      $('#panels').appendChild(el);
      try { await p.render(el); } catch (e) { el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    }
  }));
})();
