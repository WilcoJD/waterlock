'use strict';
/**
 * Transactional security mails (verify email, reset password, confirm new
 * email). Delivery goes through the notify plugin (`ctx.notify.mail`) when it
 * is loaded. Outside production the token is also returned to the caller so
 * development and tests can complete a flow without SMTP. Nothing here logs a
 * token. Security *alerts* (new device, password changed, 2FA on/off) are not
 * sent from here: the plugin emits `account.*` events and the notify plugin
 * turns them into in-app / email / push notifications per user preference.
 *
 *   OWASP Forgot Password Cheat Sheet  https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class Mailer {
  constructor({ ctx }) { this.ctx = ctx; }

  get brand() { return this.ctx.config.brand || 'Platform'; }
  link(path) { return `${this.ctx.config.publicUrl}/#/${path}`; }
  get available() { return typeof this.ctx.notify?.mail === 'function'; }

  /** Send through notify; returns { sent: boolean }. Never throws. */
  async send(to, { subject, text, html }) {
    if (!this.available) { this.ctx.log.warn?.(`[account] no mail transport (notify plugin not loaded): "${subject}" to ${to} was not sent`); return { sent: false }; }
    try { await this.ctx.notify.mail({ to, subject, text, html }); return { sent: true }; }
    catch (e) { this.ctx.log.error?.('[account] mail failed:', e.message); return { sent: false }; }
  }

  layout(title, lines, cta) {
    const body = lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('');
    const btn = cta ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="background:#4ade80;color:#052e14;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p><p style="color:#8b97b1;font-size:12px">Or paste this link into your browser: ${esc(cta.url)}</p>` : '';
    return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#111"><h2 style="margin:0 0 16px">${esc(title)}</h2>${body}${btn}<p style="color:#8b97b1;font-size:12px;margin-top:24px">${esc(this.brand)} account security</p></div>`;
  }

  verifyEmail(user, token, ttlHours) {
    const url = this.link(`verify?token=${encodeURIComponent(token)}`);
    const lines = [`Confirm ${user.email} to unlock withdrawals, derivatives and paid servers on ${this.brand}. The link is valid for ${ttlHours} hours.`, 'If you did not create this account, ignore this message.'];
    return this.send(user.email, { subject: `Verify your email for ${this.brand}`, text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: this.layout('Verify your email', lines, { url, label: 'Verify email' }) });
  }
  passwordReset(user, token, ttlMin) {
    const url = this.link(`reset?token=${encodeURIComponent(token)}`);
    const lines = [`Someone (hopefully you) asked to reset the password for ${user.email}.`, `The link works once and expires in ${ttlMin} minutes. If you did not ask for this you can ignore it: your password stays the same.`];
    return this.send(user.email, { subject: `Reset your ${this.brand} password`, text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: this.layout('Reset your password', lines, { url, label: 'Choose a new password' }) });
  }
  emailChange(newEmail, user, token) {
    const url = this.link(`email-change?token=${encodeURIComponent(token)}`);
    const lines = [`Confirm that ${newEmail} should become the email address for your ${this.brand} account (currently ${user.email}).`, 'If you did not request this, ignore this message.'];
    return this.send(newEmail, { subject: `Confirm your new ${this.brand} email`, text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: this.layout('Confirm your new email', lines, { url, label: 'Confirm new email' }) });
  }
}

module.exports = { Mailer };
