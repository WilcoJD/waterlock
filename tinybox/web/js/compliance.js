/* Compliance: identity verification wizard (#/verify-identity), tier & limits panel,
   terms / travel-rule / limit modals, and the admin "Compliance" tab (KYC queue, flags,
   countries & sanctions, travel rule, audit log).

   References:
   - FATF Recommendation 16 (travel rule) fields: https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
   - EU Transfer of Funds Regulation (Reg. (EU) 2023/1113): https://eur-lex.europa.eu/eli/reg/2023/1113/oj
   - Fetch API (used to add a response interceptor for ACCEPT_TERMS / TRAVEL_RULE_INFO_REQUIRED): https://developer.mozilla.org/docs/Web/API/Fetch_API
   - URL.createObjectURL for private document previews: https://developer.mozilla.org/docs/Web/API/URL/createObjectURL_static
   - iOS Safari converts HEIC to JPEG when <input accept> excludes HEIC: https://developer.apple.com/documentation/safari-release-notes
*/
(() => {
  'use strict';
  const { $, esc, fmt, api, S, toast, busy, modal, route, query, needAuth, addMenuLink, registerAdminTab, registerAccountPanel } = App;
  const C = '/compliance';

  // ---------- styles (plugin-owned) ----------
  const style = document.createElement('style');
  style.textContent = `
    .cm-steps{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
    .cm-step{flex:1 1 180px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}
    .cm-step.on{border-color:var(--accent2)} .cm-step.done{border-color:#1f5c35} .cm-step h4{margin:0 0 4px;font-size:14px}
    .cm-usage{display:grid;gap:12px} .cm-usage .lbl{display:flex;justify-content:space-between;gap:8px;font-size:13px} .cm-usage .lbl b{font-weight:600}
    .meter.warn>div{background:var(--warn)} .meter.over>div{background:var(--danger)}
    .cm-docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:10px 0}
    .cm-doc{border:1px dashed var(--line);border-radius:12px;padding:10px;text-align:center;min-height:150px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;font-size:13px}
    .cm-doc.ok{border-style:solid;border-color:#1f5c35} .cm-doc img{max-width:100%;max-height:110px;border-radius:8px;object-fit:contain}
    .cm-doc input[type=file]{display:none}
    .cm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px} @media (max-width:640px){.cm-grid2{grid-template-columns:1fr}}
    .modal>.card.cm-wide{width:min(1000px,100%)}
    .cm-view{display:grid;gap:12px} .cm-view img{max-width:100%;max-height:70vh;border-radius:10px;background:#000;display:block;margin:auto}
    .cm-view iframe{width:100%;height:70vh;border:0;border-radius:10px;background:#fff}
    .cm-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px} .cm-filters>div{flex:1 1 150px;min-width:120px} .cm-filters label{margin:0 0 4px}
    .cm-pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;color:var(--muted);font-size:13px}
    details.cm-det summary{cursor:pointer;color:var(--accent2);font-size:12px} details.cm-det pre{white-space:pre-wrap;word-break:break-all;font-size:11px;background:#05080d;padding:8px;border-radius:8px;max-width:100%}
    .badge.critical{background:#3a1414;color:var(--danger)} .badge.high{background:#3a2e10;color:var(--warn)} .badge.medium{background:#10293a;color:var(--accent2)} .badge.low{background:var(--panel2)}
    .badge.approved{background:#12341f;color:var(--accent)} .badge.submitted{background:#10293a;color:var(--accent2)} .badge.rejected,.badge.frozen{background:#3a1414;color:var(--danger)} .badge.expired,.badge.escalated{background:#3a2e10;color:var(--warn)} .badge.draft,.badge.dismissed{background:var(--panel2)}
    .cm-kv{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:14px} .cm-kv dt{color:var(--muted)} .cm-kv dd{margin:0;word-break:break-word} @media (max-width:600px){.cm-kv{grid-template-columns:1fr}}
    .cm-row-actions{white-space:nowrap}
    .cm-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;font-size:14px} .cm-check input{width:auto;margin-top:4px}
    table.t td.wrap{white-space:normal;word-break:break-word;max-width:320px}
  `;
  document.head.appendChild(style);

  // ---------- helpers ----------
  const money0 = (v) => (v === null || v === undefined ? 'Unlimited' : `$${fmt.usd(v, 0)}`);
  const badge = (s) => `<span class="badge ${esc(s)}">${esc(String(s || '').replace(/_/g, ' '))}</span>`;
  const tierLabel = (t, tiers) => `Level ${t}${tiers?.find((x) => x.tier === t)?.label ? ` · ${esc(tiers.find((x) => x.tier === t).label)}` : ''}`;
  const LIMIT_LABELS = { withdraw_daily_usd: 'Withdrawals · 24h', withdraw_monthly_usd: 'Withdrawals · 30d', perps_notional_usd: 'Open futures notional', options_premium_usd: 'Open options premium', cloud_monthly_usd: 'Cloud spend · 30d', card_order_usd: 'Max card order' };
  function usageBars(rows) {
    return `<div class="cm-usage">${rows.map((r) => {
      const pct = r.limit === null ? 0 : r.limit === 0 ? 100 : Math.min(100, (r.used / r.limit) * 100);
      const cls = r.limit !== null && r.used >= r.limit ? 'over' : pct >= 80 ? 'warn' : '';
      return `<div><div class="lbl"><span>${esc(LIMIT_LABELS[r.key] || r.key)}</span><b>${r.key === 'card_order_usd' ? '' : `$${fmt.usd(r.used, 0)} / `}${money0(r.limit)}</b></div>${r.key === 'card_order_usd' ? '' : `<div class="meter ${cls}"><div style="width:${pct}%"></div></div>`}</div>`;
    }).join('')}</div>`;
  }
  let countriesCache = null;
  async function countries() {
    if (!countriesCache) { try { countriesCache = (await api('GET', `${C}/countries`)).countries; } catch { countriesCache = []; } }
    return countriesCache;
  }
  const countryOptions = (list, sel) => `<option value="">— choose —</option>${list.map((c) => `<option value="${c.code}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)} (${c.code})</option>`).join('')}`;
  const field = (label, inner) => `<div><label>${label}</label>${inner}</div>`;
  /** Modal that resolves when closed (value set via resolve(), otherwise null on dismiss). */
  function askModal(html, cls, onMount) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const close = modal(html, (root, closeFn) => { root.querySelector('.card').classList.add(cls || 'cm-normal'); onMount(root, (v) => { finish(v); closeFn(); }); });
      const m = $('#modal');
      const obs = new MutationObserver(() => { if (m.hidden) { obs.disconnect(); finish(null); } });
      obs.observe(m, { attributes: true, attributeFilter: ['hidden'] });
      return close;
    });
  }

  // ---------- modals used by the fetch interceptor ----------
  let termsPending = null;
  function termsModal(data) {
    if (termsPending) return termsPending;
    termsPending = askModal(`<h2>Updated terms &amp; risk disclosure</h2>
      <p class="muted">Before you continue trading or withdrawing, please review and accept the current versions.</p>
      <ul><li><a href="#/terms" target="_blank" rel="noopener">Terms of service</a> – version <b>${esc(data?.terms_version)}</b></li><li><a href="#/terms" target="_blank" rel="noopener">Risk disclosure</a> – version <b>${esc(data?.risk_version)}</b></li></ul>
      <label class="cm-check"><input type="checkbox" id="cm-t1"><span>I have read and accept the terms of service.</span></label>
      <label class="cm-check"><input type="checkbox" id="cm-t2"><span>I understand that crypto assets and leveraged derivatives are high-risk and that I can lose my entire balance.</span></label>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="cm-accept" disabled>Accept and continue</button><button class="btn" data-close>Not now</button></div>`,
    'cm-normal', (root, done) => {
      const b = $('#cm-accept', root), t1 = $('#cm-t1', root), t2 = $('#cm-t2', root);
      const upd = () => (b.disabled = !(t1.checked && t2.checked));
      t1.onchange = t2.onchange = upd;
      b.onclick = () => busy(b, async () => { await api('POST', `${C}/terms/accept`, { terms_version: data?.terms_version, risk_version: data?.risk_version }); toast('Thank you – terms accepted'); done(true); });
    }).finally(() => { termsPending = null; });
    return termsPending;
  }

  async function travelRuleModal(data) {
    const list = await countries();
    return askModal(`<h2>Beneficiary information</h2>
      <p class="muted">Withdrawals of ≈ $${fmt.usd(data?.amount_usd || 0, 0)} (over $${fmt.usd(data?.threshold_usd || 0, 0)}) must carry originator and beneficiary details under the FATF “travel rule”. Your verified identity is sent as originator; please tell us who receives the funds.</p>
      <label>Beneficiary (recipient) full name</label><input id="tr-name" maxlength="140" autocomplete="off" placeholder="Name of the account holder receiving the funds">
      <div class="cm-grid2">${field('Who is the recipient?', `<select id="tr-type"><option value="self">Myself</option><option value="third_party">Someone else</option></select>`)}
      ${field('Receiving wallet', `<select id="tr-wallet"><option value="self_hosted">Self-hosted (hardware / software wallet)</option><option value="vasp">Exchange or custodian (VASP)</option></select>`)}</div>
      <div id="tr-vasp" hidden class="cm-grid2">${field('Exchange / custodian name', '<input id="tr-vasp-name" maxlength="140" placeholder="e.g. Kraken">')}${field('Its country (optional)', `<select id="tr-vasp-country">${countryOptions(list, '')}</select>`)}</div>
      <label class="cm-check" id="tr-self-row"><input type="checkbox" id="tr-self"><span>I confirm that I control this self-hosted wallet.</span></label>
      <p class="risk">Providing false information may lead to your account being frozen and reported.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="tr-go">Continue withdrawal</button><button class="btn" data-close>Cancel</button></div>`,
    'cm-normal', (root, done) => {
      const w = $('#tr-wallet', root), t = $('#tr-type', root);
      const upd = () => { $('#tr-vasp', root).hidden = w.value !== 'vasp'; $('#tr-self-row', root).hidden = w.value !== 'self_hosted' || t.value !== 'self'; };
      w.onchange = t.onchange = upd; upd();
      $('#tr-go', root).onclick = () => {
        const info = { beneficiary_name: $('#tr-name', root).value.trim(), beneficiary_type: t.value, wallet_type: w.value, vasp_name: $('#tr-vasp-name', root).value.trim() || undefined, vasp_country: $('#tr-vasp-country', root).value || undefined, self_hosted_confirmed: $('#tr-self', root).checked };
        if (info.beneficiary_name.length < 2) return toast('Enter the beneficiary name', true);
        if (w.value === 'vasp' && !info.vasp_name) return toast('Enter the exchange / custodian name', true);
        if (w.value === 'self_hosted' && t.value === 'self' && !info.self_hosted_confirmed) return toast('Please confirm you control the wallet', true);
        done(info);
      };
    });
  }

  function limitModal(data, message) {
    return askModal(`<h2>Verification level too low</h2><p>${esc(message)}</p>
      <div class="kv"><dt>Limit</dt><dd>$${fmt.usd(data.limit, 0)} (${esc(String(data.window))})</dd><dt>Used</dt><dd>$${fmt.usd(data.used, 0)}</dd><dt>Requested</dt><dd>$${fmt.usd(data.requested, 0)}</dd></div>
      <div class="row" style="margin-top:14px">${data.tier_required !== null ? '<a class="btn primary" href="#/verify-identity" data-close>Verify identity</a>' : ''}<button class="btn" data-close>Close</button></div>`, 'cm-normal', () => {});
  }

  // ---------- fetch interceptor: retry API calls after the user completes a compliance step ----------
  const origFetch = window.fetch.bind(window);
  window.fetch = async function complianceFetch(input, init) {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!url.startsWith('/api/') || res.ok || init?.__cmRetried) return res;
      if (!(res.headers.get('content-type') || '').includes('application/json')) return res;
      const data = await res.clone().json().catch(() => null);
      if (!data?.code) return res;
      if (data.code === 'ACCEPT_TERMS') {
        if (await termsModal(data.data)) return origFetch(input, { ...init, __cmRetried: true });
      } else if (data.code === 'TRAVEL_RULE_INFO_REQUIRED' && typeof init?.body === 'string') {
        const info = await travelRuleModal(data.data);
        if (info) { const body = JSON.parse(init.body); return origFetch(input, { ...init, __cmRetried: true, body: JSON.stringify({ ...body, travel_rule: info }) }); }
      } else if (data.code === 'LIMIT_EXCEEDED' && data.data && S.user) {
        limitModal(data.data, data.error);
      }
    } catch (e) { console.error('[compliance]', e); }
    return res;
  };

  // ---------- register page: terms notice ----------
  const prevMounted = App.authPageMounted;
  App.authPageMounted = (mode, form) => {
    try { prevMounted?.(mode, form); } catch (e) { console.error(e); }
    if (mode !== 'register') return;
    const extra = form.querySelector('#auth-extra');
    const v = S.site?.compliance;
    if (extra && v) extra.insertAdjacentHTML('beforeend', `<p class="muted" style="font-size:12px;margin-top:10px">By creating an account you accept the <a href="#/terms">terms of service (v${esc(v.terms_version)}) and risk disclosure (v${esc(v.risk_version)})</a>. Some products are not available in every country.</p>`);
  };

  // ---------- menu + account panel ----------
  addMenuLink('exchange', 'Account', ['#/verify-identity', 'Verification', 'KYC level & limits']);
  registerAccountPanel({ id: 'compliance', order: 15, async render(card) {
    const me = await api('GET', `${C}/me`);
    card.innerHTML = `<div class="row" style="justify-content:space-between"><h3>Verification &amp; limits</h3><span class="badge ${me.tier > 0 ? 'active' : ''}">${tierLabel(me.tier, me.tiers)}</span></div>
      ${me.frozen ? '<div class="notice warn">Your account is temporarily restricted. Please contact support.</div>' : ''}
      ${!me.terms.accepted ? '<div class="notice warn">Please accept the updated terms &amp; risk disclosure. <button class="btn small" id="cm-acc">Review</button></div>' : ''}
      ${usageBars(me.rows)}
      <div class="row" style="margin-top:14px"><a class="btn small primary" href="#/verify-identity">${me.kyc.next_tier ? 'Raise my limits' : 'View verification'}</a>${me.country.code ? `<span class="muted" style="font-size:12px">Country: ${esc(me.country.name)} (${esc(me.country.source)})</span>` : ''}</div>`;
    const acc = $('#cm-acc', card); if (acc) acc.onclick = () => termsModal(me.terms.current).then((ok) => ok && App.render());
  } });

  // ---------- #/verify-identity wizard ----------
  const UI = {
    full_name: { label: 'Full legal name (as on your ID)', autocomplete: 'name' }, dob: { label: 'Date of birth', type: 'date' }, nationality: { label: 'Nationality (optional)', type: 'country' }, country: { label: 'Country of residence', type: 'country' },
    address_line1: { label: 'Street address', autocomplete: 'address-line1' }, address_line2: { label: 'Address line 2 (optional)', autocomplete: 'address-line2' }, city: { label: 'City', autocomplete: 'address-level2' }, postal_code: { label: 'Postal code', autocomplete: 'postal-code' }, region: { label: 'State / region (optional)', autocomplete: 'address-level1' }, phone: { label: 'Phone (optional)', autocomplete: 'tel', type: 'tel' },
    id_type: { label: 'Document type', options: { passport: 'Passport', id_card: 'National ID card', drivers_license: "Driver's licence", residence_permit: 'Residence permit' } }, id_number: { label: 'Document number' }, id_country: { label: 'Issuing country', type: 'country' }, id_expiry: { label: 'Expiry date', type: 'date' },
    occupation: { label: 'Occupation' }, employer: { label: 'Employer (optional)' },
    source_of_funds: { label: 'Main source of funds', options: { salary: 'Salary / employment', business_income: 'Business income', investments: 'Investments', savings: 'Savings', inheritance: 'Inheritance / gift', crypto_trading: 'Crypto trading', loan: 'Loan', other: 'Other' } },
    source_details: { label: 'Details (required if “Other”)', textarea: true }, expected_monthly_volume: { label: 'Expected monthly volume', options: { lt_10k: 'Under $10,000', '10k_50k': '$10,000 – $50,000', '50k_250k': '$50,000 – $250,000', gt_250k: 'Over $250,000' } },
    pep: { label: 'Are you (or a close family member / associate) a politically exposed person?', options: { false: 'No', true: 'Yes' }, bool: true }, pep_details: { label: 'PEP details (position, country)' },
  };
  const STEP_TEXT = { 1: ['Basic details', 'Name, date of birth and address'], 2: ['Identity document', 'Photo ID and a selfie'], 3: ['Enhanced', 'Proof of address and source of funds'] };

  function fieldHtml(name, def, value, list) {
    const ui = UI[name] || { label: name };
    const v = value === undefined || value === null ? '' : value;
    if (ui.type === 'country') return field(ui.label, `<select name="${name}">${countryOptions(list, v)}</select>`);
    if (ui.options) return field(ui.label, `<select name="${name}"><option value="">— choose —</option>${Object.entries(ui.options).map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    if (ui.textarea) return field(ui.label, `<textarea name="${name}" maxlength="${def.max || 1000}" style="font-family:inherit;font-size:14px">${esc(v)}</textarea>`);
    return field(ui.label, `<input name="${name}" type="${ui.type || 'text'}" value="${esc(v)}" maxlength="${def.max || 120}" autocomplete="${ui.autocomplete || 'off'}" ${ui.type === 'date' ? 'placeholder="YYYY-MM-DD"' : ''}>`);
  }
  function readForm(form, schemaFields) {
    const out = {};
    for (const k of Object.keys(schemaFields)) {
      const el = form.elements[k]; if (!el) continue;
      let v = el.value.trim();
      if (UI[k]?.bool) v = v === '' ? null : v === 'true';
      out[k] = v === '' ? null : v;
    }
    return out;
  }

  route(/^\/verify-identity$/, needAuth(async (view) => {
    const [me, schema, list] = await Promise.all([api('GET', `${C}/me`), api('GET', `${C}/kyc/schema`), countries()]);
    const next = me.kyc.next_tier;
    const stepStatus = (t) => {
      if (me.tier >= t) return 'approved';
      const c = me.kyc.cases.filter((x) => x.tier === t).sort((a, b) => b.id - a.id)[0];
      if (c) return c.status;
      return t === next ? 'todo' : 'locked';
    };
    view.innerHTML = `<div class="section-head"><div><h1>Verify your identity</h1><p class="muted">Higher verification levels unlock higher withdrawal, trading and cloud limits.</p></div><span class="badge ${me.tier > 0 ? 'active' : ''}" style="font-size:14px">${tierLabel(me.tier, me.tiers)}</span></div>
      ${me.frozen ? '<div class="notice warn">Your account is temporarily restricted. Verification is still possible, but withdrawals and trading are paused until our compliance team finishes its review.</div>' : ''}
      ${!me.terms.accepted ? '<div class="notice warn">Please accept the updated terms &amp; risk disclosure before trading or withdrawing. <button class="btn small" id="cm-acc">Review and accept</button></div>' : ''}
      <div class="cm-steps">${[1, 2, 3].map((t) => { const s = stepStatus(t); return `<div class="cm-step ${s === 'approved' ? 'done' : t === next ? 'on' : ''}"><h4>${t}. ${STEP_TEXT[t][0]}</h4><div class="muted" style="font-size:12px">${STEP_TEXT[t][1]}</div><div style="margin-top:6px">${badge(s === 'todo' ? 'not started' : s)}</div></div>`; }).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="card" id="cm-step" style="grid-column:1/-1"></div>
        <div class="card"><h3>Your limits</h3>${usageBars(me.rows)}</div>
        <div class="card"><h3>Levels</h3><table class="t"><tr><th>Level</th><th class="num">Withdraw / day</th><th class="num">Futures</th><th class="num">Cloud / mo</th></tr>${me.tiers.map((t) => `<tr class="${t.tier === me.tier ? 'hl' : ''}"><td><b>${t.tier}</b> ${esc(t.label)}</td><td class="num">${money0(t.withdraw_daily_usd)}</td><td class="num">${money0(t.perps_notional_usd)}</td><td class="num">${money0(t.cloud_monthly_usd)}</td></tr>`).join('')}</table>
          <p class="muted" style="font-size:12px;margin-top:10px">Country: ${me.country.code ? `${esc(me.country.name)} (${esc(me.country.source)})` : 'unknown'}${me.derivatives_allowed ? '' : ' · leveraged derivatives are not available in your country'}.</p></div>
      </div>`;
    const acc = $('#cm-acc'); if (acc) acc.onclick = () => termsModal(me.terms.current).then((ok) => ok && App.render());
    const step = $('#cm-step');

    if (!next) { step.innerHTML = '<h3>You are fully verified</h3><p class="muted">Thank you. Your limits are at the highest level.</p>'; return; }
    const pending = me.kyc.pending_case;
    if (pending) {
      step.innerHTML = `<h3>Level ${pending.tier} – under review</h3><p class="muted">Submitted ${fmt.date(pending.submitted_at)}. Reviews usually take less than one business day; we will notify you.</p>
        ${pending.documents.length ? `<p class="muted">Documents received: ${pending.documents.map((d) => esc(d.kind.replace(/_/g, ' '))).join(', ')}</p>` : ''}`;
      return;
    }
    const current = me.kyc.current_case;
    if (!current || current.status === 'rejected' || current.status === 'expired') {
      step.innerHTML = `<h3>Level ${next}: ${STEP_TEXT[next][0]}</h3><p class="muted">${STEP_TEXT[next][1]}.</p>
        ${current?.status === 'rejected' ? `<div class="notice warn"><b>Your previous submission was not accepted.</b><br>${esc(current.reason || 'No reason given')}<br><span class="muted">You can correct the details and submit again.</span></div>` : ''}
        ${current?.status === 'expired' ? '<div class="notice warn">Your previous verification has expired. Please verify again.</div>' : ''}
        <button class="btn primary" id="cm-start">${current ? 'Start again' : 'Start'}</button>`;
      $('#cm-start').onclick = (e) => busy(e.currentTarget, async () => { await api('POST', `${C}/kyc/cases`, { tier: next }); App.render(); });
      return;
    }
    // Draft: render the form for this tier.
    const tierSchema = schema.tiers[String(current.tier)];
    const localPreviews = {};
    const renderDraft = (c) => {
      const docs = c.required_documents || [];
      step.innerHTML = `<h3>Level ${c.tier}: ${STEP_TEXT[c.tier][0]}</h3>
        <form id="cm-form"><div class="cm-grid2">${Object.entries(tierSchema.fields).map(([k, d]) => fieldHtml(k, d, c.fields[k], list)).join('')}</div>
        ${docs.length ? `<h4 style="margin:16px 0 4px">Documents</h4><p class="muted" style="font-size:12px;margin:0">JPEG, PNG or PDF, up to ${S.site?.compliance?.max_file_mb || 8} MB each. Make sure all four corners are visible and the text is readable.</p>
          <div class="cm-docs">${docs.map((d) => { const have = c.documents.find((x) => x.kind === d.kind); const prev = localPreviews[d.kind]; return `<label class="cm-doc ${have ? 'ok' : ''}" data-kind="${d.kind}">
            ${prev ? `<img src="${prev}" alt="">` : `<div style="font-size:26px">${have ? '✓' : '⇧'}</div>`}
            <b>${esc(d.label)}${d.required ? '' : ' <span class="muted">(optional)</span>'}</b>
            ${have ? `<span class="muted">${esc(have.original_name || have.mime)} · ${fmt.bytes(have.size)}</span><button type="button" class="btn small danger" data-rm="${have.id}">Remove</button>` : '<span class="muted">Tap to upload</span>'}
            <input type="file" accept="image/jpeg,image/png,application/pdf"></label>`; }).join('')}</div>` : ''}
        <div class="row" style="margin-top:16px"><button class="btn" id="cm-save" type="button">Save draft</button><button class="btn primary" id="cm-submit" type="submit">Submit for review</button></div>
        <p class="muted" style="font-size:12px">Your data is used only to comply with anti-money-laundering law and is visible to our compliance team only.</p></form>`;
      const form = $('#cm-form');
      const save = async () => { const r = await api('PUT', `${C}/kyc/cases/${c.id}`, { fields: readForm(form, tierSchema.fields) }); return r.case; };
      $('#cm-save').onclick = (e) => busy(e.currentTarget, async () => { const nc = await save(); toast('Draft saved'); renderDraft(nc); });
      form.onsubmit = (e) => { e.preventDefault(); busy($('#cm-submit'), async () => { await save(); await api('POST', `${C}/kyc/cases/${c.id}/submit`); toast('Submitted – thank you!'); App.render(); }); };
      // id_type decides whether the back side is needed: refresh the document list when it changes.
      const idt = form.elements.id_type; if (idt) idt.onchange = () => save().then(renderDraft).catch((err) => toast(err.message, true));
      form.querySelectorAll('.cm-doc input[type=file]').forEach((inp) => (inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const kind = inp.closest('.cm-doc').dataset.kind;
        const max = (S.site?.compliance?.max_file_mb || 8) * 1048576;
        if (f.size > max) return toast(`File is too large (max ${S.site?.compliance?.max_file_mb || 8} MB)`, true);
        const fd = new FormData(); fd.append('kind', kind); fd.append('file', f, f.name);
        try {
          await save();
          await api('POST', `${C}/kyc/cases/${c.id}/documents`, fd);
          if (f.type.startsWith('image/')) localPreviews[kind] = URL.createObjectURL(f); else delete localPreviews[kind];
          toast('Uploaded'); renderDraft((await api('GET', `${C}/kyc/cases/${c.id}`)).case);
        } catch (err) { toast(err.message, true); }
      }));
      form.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); busy(b, async () => { await api('DELETE', `${C}/kyc/cases/${c.id}/documents/${b.dataset.rm}`); delete localPreviews[b.closest('.cm-doc').dataset.kind]; renderDraft((await api('GET', `${C}/kyc/cases/${c.id}`)).case); }); }));
    };
    renderDraft(current);
  }));

  // ---------- admin tab ----------
  const SUBS = [['kyc', 'KYC queue'], ['flags', 'Flags'], ['countries', 'Countries & sanctions'], ['travel', 'Travel rule'], ['audit', 'Audit log']];
  const pager = (p, onPage) => { const pages = Math.max(1, Math.ceil(p.total / p.limit)); return { html: `<div class="cm-pager"><span>${p.total} total · page ${p.page}/${pages}</span><button class="btn small" data-pg="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>‹</button><button class="btn small" data-pg="${p.page + 1}" ${p.page >= pages ? 'disabled' : ''}>›</button></div>`, mount: (root) => root.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => onPage(Number(b.dataset.pg)))) }; };
  const details = (obj) => (obj && Object.keys(obj).length ? `<details class="cm-det"><summary>details</summary><pre>${esc(JSON.stringify(obj, null, 1))}</pre></details>` : '');

  registerAdminTab({ id: 'compliance', label: 'Compliance', order: 60, async render(pane) {
    const sub = SUBS.find(([k]) => k === query().get('sub'))?.[0] || 'kyc';
    const ov = await api('GET', `${C}/admin/overview`);
    const openFlags = Object.values(ov.flags).reduce((a, b) => a + b, 0);
    pane.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="tabs cm-subtabs" style="flex-wrap:wrap">${SUBS.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" onclick="location.hash='#/admin?tab=compliance&sub=${k}'">${l}${k === 'kyc' && ov.kyc.submitted ? ` <span class="badge provisioning">${ov.kyc.submitted}</span>` : ''}${k === 'flags' && openFlags ? ` <span class="badge error">${openFlags}</span>` : ''}</button>`).join('')}</div>
      <span class="muted" style="font-size:12px">Terms v${esc(ov.terms.terms_version)} · risk v${esc(ov.terms.risk_version)} · travel rule ≥ $${fmt.usd(ov.config.travel_rule_usd, 0)} · docs ${ov.config.documents_encrypted ? 'encrypted' : '<b class="down">not encrypted</b>'} · ${ov.frozen_users} frozen</span></div><div id="cm-pane"></div>`;
    const root = $('#cm-pane');
    await ({ kyc: kycQueue, flags: flagsPane, countries: countriesPane, travel: travelPane, audit: auditPane })[sub](root, ov);
  } });

  // --- KYC queue ---
  async function kycQueue(root, ov) {
    let status = 'submitted', q = '', page = 1;
    const load = async () => {
      const r = await api('GET', `${C}/admin/kyc/queue?status=${status}&q=${encodeURIComponent(q)}&page=${page}`);
      const pg = pager(r, (p) => { page = p; load(); });
      root.innerHTML = `<div class="card"><div class="cm-filters"><div><label>Status</label><select id="q-st">${['submitted', 'approved', 'rejected', 'expired', 'draft', 'all'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div><label>Search user / id</label><input id="q-q" value="${esc(q)}" placeholder="email or #id"></div>
        <div style="flex:0"><label>&nbsp;</label><button class="btn small" id="q-go">Filter</button></div><div class="muted" style="flex:2;font-size:12px">${Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div></div>
        <table class="t"><tr><th>#</th><th>User</th><th>Level</th><th>Status</th><th>Submitted</th><th>Docs</th><th>Screening</th><th></th></tr>
        ${r.items.map((c) => `<tr class="click" data-case="${c.id}"><td>${c.id}</td><td>${esc(c.email)} <span class="muted">#${c.user_id}</span></td><td>${c.tier}</td><td>${badge(c.status)}</td><td>${c.submitted_at ? fmt.date(c.submitted_at) : '—'}</td><td>${c.document_count}</td><td>${c.screening_matches ? `<span class="badge critical">${c.screening_matches} match</span>` : '<span class="muted">clear</span>'}</td><td class="num"><button class="btn small" data-case="${c.id}">Review</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table>${pg.html}</div>`;
      pg.mount(root);
      $('#q-go', root).onclick = () => { status = $('#q-st', root).value; q = $('#q-q', root).value.trim(); page = 1; load(); };
      $('#q-q', root).onkeydown = (e) => { if (e.key === 'Enter') $('#q-go', root).click(); };
      root.querySelectorAll('[data-case]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); caseModal(Number(el.dataset.case), load); }));
    };
    await load();
  }

  async function caseModal(id, after) {
    const { case: c } = await api('GET', `${C}/admin/kyc/cases/${id}`);
    const user = await api('GET', `${C}/admin/users/${c.user_id}`);
    const fieldsHtml = Object.entries(c.fields).map(([k, v]) => `<dt>${esc(UI[k]?.label?.split(' (')[0] || k.replace(/_/g, ' '))}</dt><dd>${esc(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))}</dd>`).join('');
    const close = modal(`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Case #${c.id} · level ${c.tier} ${badge(c.status)}</h2><button class="btn small" data-close>✕</button></div>
      <p class="muted">${esc(c.email)} (user #${c.user_id}) · current level ${user.user.kyc_tier}${user.user.frozen ? ' · <b class="down">FROZEN</b>' : ''} · country ${esc(user.profile.country || '—')} · submitted ${c.submitted_at ? fmt.date(c.submitted_at) : '—'}${c.reviewer_id ? ` · reviewed by #${c.reviewer_id}` : ''}</p>
      ${c.reason ? `<div class="notice">${esc(c.reason)}</div>` : ''}
      ${c.screening ? (c.screening.matches.length ? `<div class="notice warn"><b>Sanctions screening: ${c.screening.matches.length} possible match(es) for “${esc(c.screening.name)}”</b><table class="t">${c.screening.matches.map((m) => `<tr><td>${esc(m.name)}${m.matched !== m.name ? ` <span class="muted">(alias ${esc(m.matched)})</span>` : ''}</td><td>${esc(m.source)} ${esc(m.program || '')}</td><td>${esc(m.country || '')} ${esc(m.dob || '')}</td><td class="num">${Math.round(m.score * 100)}%</td></tr>`).join('')}</table></div>` : `<p class="muted" style="font-size:12px">Sanctions screening of “${esc(c.screening.name)}”: no matches (${fmt.date(c.screening.checked_at)}).</p>`) : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div><h3>Declared information</h3><dl class="cm-kv">${fieldsHtml || '<dd class="muted">No fields</dd>'}</dl>
          <h3 style="margin-top:14px">Other cases</h3>${user.cases.filter((x) => x.id !== c.id).map((x) => `<div>#${x.id} level ${x.tier} ${badge(x.status)} <span class="muted">${fmt.date(x.created_at)}</span></div>`).join('') || '<p class="muted">None</p>'}
          <h3 style="margin-top:14px">Open flags</h3>${user.flags.filter((f) => f.status === 'open' || f.status === 'escalated').map((f) => `<div>${badge(f.severity)} ${esc(f.title)}</div>`).join('') || '<p class="muted">None</p>'}</div>
        <div><h3>Documents</h3><div class="cm-view" id="cm-docs">${c.documents.map((d) => `<div data-doc="${d.id}"><b>${esc(d.kind.replace(/_/g, ' '))}</b> <span class="muted">${esc(d.mime)} · ${fmt.bytes(d.size)} · sha256 ${esc(d.sha256 || '').slice(0, 12)}</span><div class="muted">loading…</div></div>`).join('') || '<p class="muted">No documents for this level.</p>'}</div></div>
      </div>
      <div class="row" style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px">
        ${c.status === 'submitted' ? '<button class="btn primary" id="cm-ok">Approve</button><button class="btn danger" id="cm-no">Reject…</button>' : ''}
        ${c.status === 'approved' ? '<button class="btn danger" id="cm-exp">Expire</button>' : ''}
        <span class="row" style="gap:6px"><span class="muted" style="font-size:13px">Set level</span><select id="cm-tier" style="width:auto;padding:6px 10px">${[0, 1, 2, 3].map((t) => `<option value="${t}" ${t === user.user.kyc_tier ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn small" id="cm-set">Set</button></span>
        ${user.user.frozen ? '<button class="btn small" id="cm-unfreeze">Unfreeze account</button>' : '<button class="btn small danger" id="cm-freeze">Freeze account…</button>'}
      </div>`, (m) => m.querySelector('.card').classList.add('cm-wide'));
    const root = $('#modal');
    // Documents are private: fetch with the JWT and show them from an object URL.
    for (const d of c.documents) {
      const box = root.querySelector(`[data-doc="${d.id}"] div`);
      try {
        const res = await api('GET', `${C}/admin/kyc/documents/${d.id}`, null, { raw: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        box.outerHTML = d.mime === 'application/pdf' ? `<iframe src="${url}" title="${esc(d.kind)}"></iframe>` : `<img src="${url}" alt="${esc(d.kind)}">`;
      } catch (e) { box.textContent = `Could not load: ${e.message}`; }
    }
    const act = async (fn) => { await fn(); close(); after?.(); };
    const on = (sel, fn) => { const b = root.querySelector(sel); if (b) b.onclick = () => busy(b, () => act(fn)); };
    on('#cm-ok', async () => { await api('POST', `${C}/admin/kyc/cases/${c.id}/approve`, { note: '' }); toast('Approved'); });
    on('#cm-no', async () => { const reason = prompt('Reason shown to the user:'); if (!reason) throw new Error('A reason is required'); await api('POST', `${C}/admin/kyc/cases/${c.id}/reject`, { reason }); toast('Rejected'); });
    on('#cm-exp', async () => { if (!confirm('Expire this verification? The user may lose their level.')) throw new Error('Cancelled'); await api('POST', `${C}/admin/kyc/cases/${c.id}/expire`, {}); toast('Expired'); });
    on('#cm-set', async () => { const tier = Number(root.querySelector('#cm-tier').value); const reason = prompt(`Set level ${tier} manually – reason:`); if (reason === null) throw new Error('Cancelled'); await api('POST', `${C}/admin/users/${c.user_id}/tier`, { tier, reason }); toast(`Level set to ${tier}`); });
    on('#cm-freeze', async () => { const reason = prompt('Freeze reason:'); if (!reason) throw new Error('A reason is required'); await api('POST', `${C}/admin/users/${c.user_id}/freeze`, { reason }); toast('Account frozen'); });
    on('#cm-unfreeze', async () => { await api('POST', `${C}/admin/users/${c.user_id}/unfreeze`, { note: prompt('Note (optional):') || '' }); toast('Account unfrozen'); });
  }

  // --- Flags ---
  async function flagsPane(root) {
    let status = 'open', severity = '', page = 1;
    const load = async () => {
      const r = await api('GET', `${C}/admin/flags?status=${status}&severity=${severity}&page=${page}`);
      const pg = pager(r, (p) => { page = p; load(); });
      root.innerHTML = `<div class="card"><div class="cm-filters"><div><label>Status</label><select id="f-st">${['open', 'escalated', 'dismissed', 'frozen', 'all'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div><label>Severity</label><select id="f-sev"><option value="">any</option>${['critical', 'high', 'medium', 'low'].map((s) => `<option ${s === severity ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div class="muted" style="flex:2;font-size:12px">${Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}<br>Rules: withdrawals/hour, deposit→withdraw, large withdrawal, round-trip volume, counterparty concentration, sanctions match, sanctioned-country login.</div></div>
        <table class="t"><tr><th>Sev.</th><th>Rule</th><th>User</th><th>What</th><th>Hits</th><th>When</th><th></th></tr>
        ${r.items.map((f) => `<tr><td>${badge(f.severity)}</td><td class="mono">${esc(f.rule)}</td><td><a href="#" data-user="${f.user_id}">${esc(f.email)}</a> <span class="muted">#${f.user_id}</span></td><td class="wrap">${esc(f.title)}${details(f.details)}${f.note ? `<div class="muted" style="font-size:12px">Note: ${esc(f.note)}</div>` : ''}</td><td>${f.hits}</td><td>${fmt.date(f.created_at)}<br>${badge(f.status)}</td>
          <td class="num cm-row-actions">${f.status === 'open' || f.status === 'escalated' ? `<button class="btn small" data-act="dismiss" data-id="${f.id}">Dismiss</button> ${f.status === 'open' ? `<button class="btn small" data-act="escalate" data-id="${f.id}">Escalate</button>` : ''} <button class="btn small danger" data-act="freeze" data-id="${f.id}">Freeze</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No flags.</td></tr>'}</table>${pg.html}</div>`;
      pg.mount(root);
      $('#f-st', root).onchange = $('#f-sev', root).onchange = () => { status = $('#f-st', root).value; severity = $('#f-sev', root).value; page = 1; load(); };
      root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => { const note = prompt(`${b.dataset.act} – note:`); if (note === null) return; busy(b, async () => { await api('POST', `${C}/admin/flags/${b.dataset.id}/${b.dataset.act}`, { note }); toast(`Flag ${b.dataset.act}ed`.replace('eed', 'ed')); load(); }); }));
      root.querySelectorAll('[data-user]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); userModal(Number(a.dataset.user), load); }));
    };
    await load();
  }

  async function userModal(userId, after) {
    const u = await api('GET', `${C}/admin/users/${userId}`);
    const close = modal(`<div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(u.user.email)} <span class="muted">#${u.user.id}</span></h2><button class="btn small" data-close>✕</button></div>
      <p>Level <b>${u.user.kyc_tier}</b> · ${u.user.frozen ? '<b class="down">FROZEN</b> ' + esc(u.profile.frozen_reason || '') : 'active'} · country ${esc(u.profile.country || '—')} · terms ${u.terms.accepted ? 'accepted' : '<b class="down">not accepted</b>'}</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div><h3>Limits</h3>${usageBars(u.limits.rows)}</div>
        <div><h3>Recent withdrawals</h3><table class="t">${u.withdrawals.map((w) => `<tr><td>${fmt.date(w.created_at)}</td><td>${fmt.num(w.amount)} ${esc(w.asset)}</td><td>${badge(w.status)}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
          <h3 style="margin-top:12px">Travel-rule declarations</h3>${u.travel_rule.map((t) => `<div style="font-size:13px">#${t.withdrawal_id ?? '?'} ${fmt.num(t.amount)} ${esc(t.asset)} → <b>${esc(t.beneficiary_name)}</b> (${esc(t.beneficiary_type)}, ${esc(t.wallet_type)}${t.vasp_name ? ` · ${esc(t.vasp_name)}` : ''})</div>`).join('') || '<p class="muted">None</p>'}</div>
      </div>
      <h3 style="margin-top:14px">Flags</h3><table class="t">${u.flags.map((f) => `<tr><td>${badge(f.severity)}</td><td>${esc(f.rule)}</td><td class="wrap">${esc(f.title)}</td><td>${badge(f.status)}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
      <h3 style="margin-top:14px">Audit trail</h3><div style="max-height:220px;overflow:auto"><table class="t">${u.audit.map((a) => `<tr><td>${fmt.date(a.created_at)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.actor_email || (a.actor_id === null ? 'system' : '#' + a.actor_id))}</td><td class="wrap">${details(a.details)}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
      <div class="row" style="margin-top:14px">${u.user.frozen ? '<button class="btn" id="um-unfreeze">Unfreeze</button>' : '<button class="btn danger" id="um-freeze">Freeze…</button>'}<button class="btn" data-close>Close</button></div>`, (m) => m.querySelector('.card').classList.add('cm-wide'));
    const root = $('#modal');
    const b1 = root.querySelector('#um-freeze'); if (b1) b1.onclick = () => { const reason = prompt('Freeze reason:'); if (!reason) return; busy(b1, async () => { await api('POST', `${C}/admin/users/${userId}/freeze`, { reason }); toast('Frozen'); close(); after?.(); }); };
    const b2 = root.querySelector('#um-unfreeze'); if (b2) b2.onclick = () => busy(b2, async () => { await api('POST', `${C}/admin/users/${userId}/unfreeze`, {}); toast('Unfrozen'); close(); after?.(); });
  }

  // --- Countries & sanctions ---
  async function countriesPane(root) {
    const [{ countries: all, defaults, header }, sanc] = await Promise.all([api('GET', `${C}/admin/countries`), api('GET', `${C}/admin/sanctions?limit=100`)]);
    let filter = '';
    root.innerHTML = `<div class="card"><h3>Country rules</h3><p class="muted" style="font-size:12px">Country comes from the <code>${esc(header)}</code> header (set by your CDN/proxy), otherwise the user's declared residence. Defaults – sanctioned: ${defaults.sanctioned.join(', ') || 'none'}; derivatives restricted: ${defaults.derivatives_restricted.join(', ') || 'none'}. Overrides below take precedence.</p>
      <div class="cm-filters"><div><label>Search</label><input id="c-q" placeholder="name or code"></div><div><label>Show</label><select id="c-show"><option value="all">all countries</option><option value="override">overrides only</option><option value="blocked">sanctioned or restricted</option></select></div></div>
      <div style="max-height:60vh;overflow:auto"><table class="t" id="c-table"></table></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:14px">
        <div class="card"><h3>Sanctions list – add entry</h3><label>Name</label><input id="s-name"><label>Aliases (one per line)</label><textarea id="s-alias" style="font-family:inherit;min-height:50px"></textarea>
          <div class="cm-grid2">${field('Source', '<input id="s-src" value="manual">')}${field('Program', '<input id="s-prog" placeholder="e.g. SDGT">')}${field('Reference id', '<input id="s-ref">')}${field('Date of birth', '<input id="s-dob" placeholder="YYYY-MM-DD">')}</div>
          <div style="margin-top:10px"><button class="btn" id="s-add">Add</button></div></div>
        <div class="card"><h3>Import a list</h3><p class="muted" style="font-size:12px">OFAC SDN: upload <code>SDN.CSV</code> (and optionally <code>ALT.CSV</code> for aliases) from the OFAC Sanctions List Service. EU/UK lists: convert to “one name per line” or JSON <code>[{name, aliases, source, program, ref_id, country, dob}]</code>.</p>
          <label>Format</label><select id="i-fmt"><option value="ofac_sdn">OFAC SDN.CSV (+ALT.CSV)</option><option value="lines">One name per line</option><option value="json">JSON array</option></select>
          <label>Files</label><input type="file" id="i-sdn" accept=".csv,.txt,.json"><label>ALT.CSV (optional)</label><input type="file" id="i-alt" accept=".csv">
          <label>…or paste text</label><textarea id="i-text" style="min-height:60px"></textarea>
          <div class="cm-grid2">${field('Source tag', '<input id="i-src" placeholder="ofac_sdn">')}<label class="cm-check"><input type="checkbox" id="i-rep"><span>Replace existing entries of this source</span></label></div>
          <div style="margin-top:10px"><button class="btn" id="i-go">Import</button></div></div>
        <div class="card"><h3>Screen a name</h3><label>Name</label><input id="sc-name" placeholder="Jane Doe"><label>Threshold (0–1)</label><input id="sc-th" value="0.85"><div style="margin-top:10px"><button class="btn" id="sc-go">Screen</button></div><div id="sc-out" style="margin-top:10px"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Sanctions list entries <span class="muted">(${sanc.total}; ${sanc.sources.map((s) => `${esc(s.source)}: ${s.n}`).join(', ') || 'empty'})</span></h3>
        <div class="cm-filters"><div><label>Search</label><input id="s-q"></div><div style="flex:0"><label>&nbsp;</label><button class="btn small" id="s-go">Search</button></div></div><div id="s-table"></div></div>`;
    const drawCountries = () => {
      const show = $('#c-show', root).value;
      const rows = all.filter((c) => (!filter || c.name.toLowerCase().includes(filter) || c.country.toLowerCase() === filter) && (show === 'all' || (show === 'override' && c.source === 'override') || (show === 'blocked' && (c.sanctioned || c.derivatives === 'blocked'))));
      $('#c-table', root).innerHTML = `<tr><th>Code</th><th>Country</th><th>Sanctioned</th><th>Derivatives</th><th>Note</th><th></th></tr>${rows.slice(0, 300).map((c) => `<tr data-cc="${c.country}"><td class="mono">${c.country}</td><td>${esc(c.name)} ${c.source === 'override' ? '<span class="badge">override</span>' : ''}</td>
        <td><input type="checkbox" class="c-s" style="width:auto" ${c.sanctioned ? 'checked' : ''}></td><td><select class="c-d"><option value="default">default (${c.sanctioned || defaults.derivatives_restricted.includes(c.country) ? 'blocked' : 'allowed'})</option><option value="allowed" ${c.source === 'override' && c.derivatives === 'allowed' ? 'selected' : ''}>allowed</option><option value="blocked" ${c.source === 'override' && c.derivatives === 'blocked' ? 'selected' : ''}>blocked</option></select></td>
        <td><input class="c-n" value="${esc(c.note || '')}" maxlength="300" placeholder="why"></td><td class="num cm-row-actions"><button class="btn small" data-save="${c.country}">Save</button>${c.source === 'override' ? ` <button class="btn small danger" data-reset="${c.country}">Reset</button>` : ''}</td></tr>`).join('')}${rows.length > 300 ? '<tr><td colspan="6" class="muted">Narrow the search to see more.</td></tr>' : ''}`;
      // Overrides with a derivatives value that equals the default still show as override; fix the select to reflect stored value
      root.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => busy(b, async () => {
        const tr = b.closest('tr');
        const r = await api('PUT', `${C}/admin/countries/${b.dataset.save}`, { sanctioned: tr.querySelector('.c-s').checked, derivatives: tr.querySelector('.c-d').value, note: tr.querySelector('.c-n').value });
        Object.assign(all.find((c) => c.country === r.rule.country), r.rule); toast(`${r.rule.name} saved`); drawCountries();
      })));
      root.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api('DELETE', `${C}/admin/countries/${b.dataset.reset}`); Object.assign(all.find((c) => c.country === r.rule.country), r.rule); toast('Override removed'); drawCountries(); })));
    };
    $('#c-q', root).oninput = (e) => { filter = e.target.value.trim().toLowerCase(); drawCountries(); };
    $('#c-show', root).onchange = drawCountries;
    drawCountries();

    const drawSanctions = (r) => {
      $('#s-table', root).innerHTML = `<table class="t"><tr><th>Name</th><th>Aliases</th><th>Source / program</th><th>Country · DOB</th><th></th></tr>${r.items.map((s) => `<tr><td>${esc(s.name)} <span class="muted">${esc(s.type)}</span></td><td class="wrap muted">${esc(s.aliases.slice(0, 4).join('; '))}${s.aliases.length > 4 ? '…' : ''}</td><td>${esc(s.source)}${s.program ? ` · ${esc(s.program)}` : ''}${s.ref_id ? ` <span class="muted">#${esc(s.ref_id)}</span>` : ''}</td><td>${esc(s.country || '')} ${esc(s.dob || '')}</td><td class="num"><button class="btn small danger" data-del="${s.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No entries. Add names or import a list.</td></tr>'}</table>${r.total > r.items.length ? `<p class="muted">Showing ${r.items.length} of ${r.total}. Use search to narrow.</p>` : ''}`;
      root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirm('Delete this entry?') && busy(b, async () => { await api('DELETE', `${C}/admin/sanctions/${b.dataset.del}`); drawSanctions(await api('GET', `${C}/admin/sanctions?limit=100&q=${encodeURIComponent($('#s-q', root).value.trim())}`)); })));
    };
    drawSanctions(sanc);
    $('#s-go', root).onclick = async () => drawSanctions(await api('GET', `${C}/admin/sanctions?limit=100&q=${encodeURIComponent($('#s-q', root).value.trim())}`));
    $('#s-add', root).onclick = (e) => busy(e.currentTarget, async () => {
      await api('POST', `${C}/admin/sanctions`, { name: $('#s-name', root).value, aliases: $('#s-alias', root).value.split('\n'), source: $('#s-src', root).value, program: $('#s-prog', root).value, ref_id: $('#s-ref', root).value, dob: $('#s-dob', root).value });
      toast('Added'); $('#s-name', root).value = ''; $('#s-alias', root).value = ''; drawSanctions(await api('GET', `${C}/admin/sanctions?limit=100`));
    });
    $('#i-go', root).onclick = (e) => busy(e.currentTarget, async () => {
      const fd = new FormData();
      fd.append('format', $('#i-fmt', root).value); fd.append('source', $('#i-src', root).value); fd.append('replace', String($('#i-rep', root).checked));
      const f1 = $('#i-sdn', root).files[0], f2 = $('#i-alt', root).files[0];
      if (f1) fd.append('sdn', f1, f1.name); else fd.append('text', $('#i-text', root).value);
      if (f2) fd.append('alt', f2, f2.name);
      const r = await api('POST', `${C}/admin/sanctions/import`, fd);
      toast(`Imported ${r.imported} entries${r.removed ? `, removed ${r.removed}` : ''}`); drawSanctions(await api('GET', `${C}/admin/sanctions?limit=100`));
    });
    $('#sc-go', root).onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api('POST', `${C}/admin/sanctions/screen`, { name: $('#sc-name', root).value, threshold: Number($('#sc-th', root).value) || undefined });
      $('#sc-out', root).innerHTML = r.matches.length ? `<table class="t">${r.matches.map((m) => `<tr><td>${esc(m.name)}${m.matched !== m.name ? ` <span class="muted">(${esc(m.matched)})</span>` : ''}</td><td>${esc(m.source)}</td><td class="num">${Math.round(m.score * 100)}%</td></tr>`).join('')}</table>` : '<p class="muted">No matches.</p>';
    });
  }

  // --- Travel rule ---
  async function travelPane(root) {
    let page = 1;
    const load = async () => {
      const r = await api('GET', `${C}/admin/travel-rule?page=${page}`);
      const pg = pager(r, (p) => { page = p; load(); });
      root.innerHTML = `<div class="card"><h3>Travel-rule declarations</h3><p class="muted" style="font-size:12px">Collected for withdrawals at or above the threshold (FATF R.16 / EU TFR). Originator = our verified customer data at the time; beneficiary = declared by the user. Forward these to the beneficiary VASP through your travel-rule messaging provider.</p>
        <table class="t"><tr><th>Withdrawal</th><th>User</th><th>Amount</th><th>Beneficiary</th><th>Wallet</th><th>Originator</th><th>When</th></tr>
        ${r.items.map((t) => `<tr><td>${t.withdrawal_id ? `#${t.withdrawal_id} ${badge(t.withdrawal_status || 'pending')}` : '<span class="muted">not linked</span>'}</td><td>${esc(t.email)} <span class="muted">#${t.user_id}</span></td><td>${fmt.num(t.amount)} ${esc(t.asset)}<br><span class="muted">≈ $${fmt.usd(t.amount_usd, 0)}</span></td><td class="wrap"><b>${esc(t.beneficiary_name)}</b><br><span class="muted">${esc(t.beneficiary_type.replace('_', ' '))}</span></td><td class="wrap">${esc(t.wallet_type.replace('_', '-'))}${t.vasp_name ? `<br>${esc(t.vasp_name)} ${esc(t.vasp_country || '')}` : ''}${t.self_hosted_confirmed ? '<br><span class="muted">ownership confirmed</span>' : ''}<br><span class="mono muted" style="font-size:11px">${esc(t.address)}</span></td><td class="wrap">${t.originator ? `${esc(t.originator.name || '—')}<br><span class="muted">${esc(t.originator.country || '')} ${esc(t.originator.dob || '')} · level ${t.originator.kyc_tier}</span>` : ''}</td><td>${fmt.date(t.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No declarations yet.</td></tr>'}</table>${pg.html}</div>`;
      pg.mount(root);
    };
    await load();
  }

  // --- Audit log ---
  async function auditPane(root) {
    const { actions } = await api('GET', `${C}/admin/audit/actions`);
    const f = { action: '', user: '', from: '', to: '', q: '', page: 1 };
    const load = async () => {
      const qs = Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const r = await api('GET', `${C}/admin/audit?${qs}`);
      const pg = pager(r, (p) => { f.page = p; load(); });
      root.innerHTML = `<div class="card"><div class="cm-filters">
          <div><label>Action</label><select id="a-act"><option value="">all</option>${actions.map((a) => `<option value="${esc(a.action)}" ${f.action === a.action ? 'selected' : ''}>${esc(a.action)} (${a.n})</option>`).join('')}</select></div>
          <div><label>User id (actor or target)</label><input id="a-user" type="number" min="1" value="${esc(f.user)}"></div>
          <div><label>From</label><input id="a-from" type="date" value="${esc(f.from)}"></div><div><label>To</label><input id="a-to" type="date" value="${esc(f.to)}"></div>
          <div><label>Text</label><input id="a-q" value="${esc(f.q)}" placeholder="details, email, ip"></div><div style="flex:0"><label>&nbsp;</label><button class="btn small" id="a-go">Filter</button></div></div>
        <table class="t"><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th>IP</th></tr>
        ${r.items.map((a) => `<tr><td style="white-space:nowrap">${fmt.date(a.created_at)}</td><td class="mono">${esc(a.action)}</td><td>${a.actor_id === null ? '<span class="muted">system</span>' : `${esc(a.actor_email || '')} <span class="muted">#${a.actor_id}</span>`}</td><td>${a.target_id === null ? '' : `${esc(a.target_email || '')} <span class="muted">#${a.target_id}</span>`}</td><td class="wrap">${details(a.details)}</td><td class="mono muted">${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No entries.</td></tr>'}</table>${pg.html}</div>`;
      pg.mount(root);
      $('#a-go', root).onclick = () => { Object.assign(f, { action: $('#a-act', root).value, user: $('#a-user', root).value, from: $('#a-from', root).value, to: $('#a-to', root).value, q: $('#a-q', root).value.trim(), page: 1 }); load(); };
    };
    await load();
  }
})();
