'use strict';
/* Playmar reels plan.
   The page lives on GitHub Pages; the plan, the ticks and the videos live in a private repo:
   plan.json (what goes out where and when), status.json (ticks), videos/, posters/.
   The access token sits in auth.json, encrypted with the password (PBKDF2-SHA256 → AES-256-GCM),
   and is decrypted in the browser only. Each tick is a commit to status.json.
   Local test: ?local reads ./data/ next to the page; ticks stay in this browser. */

const CFG = { owner: 'jetmetrics-io', repo: 'playmar-content-plan', branch: 'main' };
const TOKEN_KEY = 'pm-plan-token', NAME_KEY = 'pm-plan-name', PREF_KEY = 'pm-plan-prefs', LOCAL_ST = 'pm-plan-local-status';
const LOCAL = new URLSearchParams(location.search).has('local');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (kind) => { try { return kind === 's' ? sessionStorage : localStorage; } catch (e) { return null; } };
const get = (k, kind = 'l') => { try { return store(kind)?.getItem(k) ?? null; } catch (e) { return null; } };
const set = (k, v, kind = 'l') => { try { store(kind)?.setItem(k, v); } catch (e) { /* no storage: lasts until the tab closes */ } };
const del = (k, kind = 'l') => { try { store(kind)?.removeItem(k); } catch (e) { /* no storage */ } };

const S = { plan: null, status: {}, view: 'plan', filter: 'all', hideDone: false, sheet: null, blobs: {}, name: '', saving: false };

/* ---------- GitHub ---------- */
class HttpError extends Error { constructor(r) { super(`GitHub answered ${r.status}`); this.status = r.status; } }
const b64bytes = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
const b64dec = (s) => new TextDecoder().decode(b64bytes(s));
const b64enc = (t) => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

const GH = {
  token: null,
  api(path, opt = {}) {
    return fetch('https://api.github.com' + path, { cache: 'no-store', ...opt, headers: { Authorization: 'Bearer ' + GH.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) } });
  },
  path: (p) => `/repos/${CFG.owner}/${CFG.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`,
  async raw(p) {
    const r = await GH.api(GH.path(p) + `?ref=${CFG.branch}`, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!r.ok) throw new HttpError(r);
    return r;
  }
};

const Data = {
  async plan() {
    if (LOCAL) return (await fetch('data/plan.json', { cache: 'no-store' })).json();
    return (await GH.raw('plan.json')).json();
  },
  async status() {
    if (LOCAL) {
      const saved = get(LOCAL_ST);
      if (saved) return { data: JSON.parse(saved), sha: 'local' };
      const r = await fetch('data/status.json', { cache: 'no-store' });
      return { data: r.ok ? await r.json() : {}, sha: 'local' };
    }
    const r = await GH.api(GH.path('status.json') + `?ref=${CFG.branch}`);
    if (r.status === 404) return { data: {}, sha: null };
    if (!r.ok) throw new HttpError(r);
    const j = await r.json();
    return { data: JSON.parse(b64dec(j.content) || '{}'), sha: j.sha };
  },
  /* the change is applied to the freshest status.json, so two people ticking at once don't overwrite each other */
  async save(change, message) {
    if (LOCAL) { const cur = (await Data.status()).data; change(cur); set(LOCAL_ST, JSON.stringify(cur)); return cur; }
    for (let i = 0; i < 5; i++) {
      const cur = await Data.status();
      change(cur.data);
      const body = { message, content: b64enc(JSON.stringify(cur.data, null, 1) + '\n'), branch: CFG.branch };
      if (cur.sha) body.sha = cur.sha;
      const r = await GH.api(GH.path('status.json'), { method: 'PUT', body: JSON.stringify(body) });
      if (r.ok) return cur.data;
      if (r.status === 409 || r.status === 422) { await sleep(300 + i * 500); continue; }
      throw new HttpError(r);
    }
    throw new Error('Someone else was saving at the same moment. Try again.');
  },
  async blobUrl(path) {
    if (S.blobs[path]) return S.blobs[path];
    let b;
    if (LOCAL) { const r = await fetch('data/' + path); if (!r.ok) throw new HttpError(r); b = await r.blob(); }
    else b = await (await GH.raw(path)).blob();
    return (S.blobs[path] = URL.createObjectURL(b));
  }
};

async function decryptToken(password) {
  const r = await fetch('auth.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('setup');
  const a = await r.json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64bytes(a.salt), iterations: a.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(a.iv) }, key, b64bytes(a.ct))); }
  catch (e) { throw new Error('password'); }
}

/* ---------- dates: every post at 15:00 UK time ---------- */
const ymd = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const ukToday = () => ymd(S.plan.tz);
const noonUTC = (s) => new Date(s + 'T12:00:00Z');
const fmtDate = (s) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(noonUTC(s));
const fmtDay = (s) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(noonUTC(s));
function slotInstant(s) {
  const [y, m, d] = s.split('-').map(Number), [hh, mm] = S.plan.time.split(':').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0));
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: S.plan.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(probe);
  const off = (+p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value) - 12 * 60;
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - off * 60000);
}
function localTime(s) {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === S.plan.tz) return '';
  const at = slotInstant(s);
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const d = ymd(undefined, at);
  if (t === S.plan.time && d === s) return '';
  return d === s ? `${t} your time` : `${t} ${fmtDate(d)} your time`;
}
function mondayOf(s) { const d = noonUTC(s); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = noonUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/* ---------- plan helpers ---------- */
const plat = (id) => S.plan.platforms.find((p) => p.id === id);
const lab = (id) => { const p = plat(id); return p.label || p.name; };
const itemById = (id) => S.plan.items.find((i) => i.id === id);
const videoOf = (it) => (it.video ? S.plan.videos[it.video] : null);
const isDone = (it, pid) => !!S.status[it.id]?.[pid]?.done;
function pState(it, pid) {
  if (!it.platforms.includes(pid)) return 'off';
  if (isDone(it, pid)) return 'done';
  const today = ukToday();
  if (it.date === today) return 'today';
  return it.date < today ? 'late' : 'todo';
}
const finished = (it) => (S.filter === 'all' ? it.platforms.every((p) => isDone(it, p)) : isDone(it, S.filter));
function itemTitle(it) { if (it.kind === 'li-image') return 'LinkedIn image post'; const v = videoOf(it); return v ? v.title : it.video; }
function gameLine(it) {
  if (it.kind === 'li-image') return 'Text and one image · no video';
  const v = videoOf(it); return v ? `${S.plan.games[v.game] || ''} · ${v.type}` : '';
}
function tagsFor(it, pid) {
  const n = S.plan.constants.tagCount[pid] || 0, base = S.plan.constants.baseTags;
  if (!n) return [];
  return [...new Set(it.tag ? base.slice(0, n - 1).concat(it.tag) : base.slice(0, n))].slice(0, n);
}
const firstSentence = (s) => { const m = String(s || '').match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(s || ''); };
/* the caption is put together from the plan's parts, per platform (rules in plan.json) */
function fields(it, pid) {
  const C = S.plan.constants;
  if (pid === 'li') {
    const li = it.linkedin || {};
    return li.status === 'ready' && li.text ? [{ label: 'Post text', text: li.text, limit: 3000, big: true }] : null;
  }
  if (!it.hook) return null;
  const tags = tagsFor(it, pid).join(' ');
  if (pid === 'yt') {
    const title = it.shortsTitle || it.hook;
    return [
      { label: 'Title', text: title, limit: 100 },
      { label: 'Description', text: [it.shortsTitle ? it.hook : '', it.body, C.cta, tags].filter(Boolean).join('\n\n') }
    ];
  }
  const body = pid === 'tt' ? firstSentence(it.body) : it.body;
  return [
    { label: 'Caption', text: [it.hook, body, C.cta, tags].filter(Boolean).join('\n\n'), first: pid === 'tt' ? 0 : 125 },
    { label: 'Hashtags only', text: tags, small: true }
  ];
}

/* ---------- render: plan ---------- */
const ICON = { done: 'check', today: 'clock', late: 'alert-triangle' };
function pillHTML(it, p) {
  const st = pState(it, p.id);
  if (st === 'off') return `<span class="pill off" title="${esc(p.name)}: not on this day">${esc(p.short)}<span>—</span></span>`;
  const dim = S.filter !== 'all' && S.filter !== p.id ? ' dim' : '';
  const word = { done: 'posted', today: 'today', late: 'overdue', todo: 'to do' }[st];
  return `<button class="pill ${st}${dim}" data-id="${esc(it.id)}" data-p="${p.id}" title="${esc(p.name)}: ${word}">${esc(p.short)}${ICON[st] ? `<i data-lucide="${ICON[st]}"></i>` : '<span style="height:14px"></span>'}</button>`;
}
function cardHTML(it) {
  const v = videoOf(it), loc = localTime(it.date);
  const states = it.platforms.map((p) => pState(it, p));
  const cls = finished(it) ? ' done' : states.includes('late') ? ' is-late' : states.includes('today') ? ' is-today' : '';
  const kind = { zero: ['zero', 'Zero week'], test: ['test', `Test ${it.test}`], extra: ['extra', 'Extra'], 'li-image': ['img', 'Image post'] }[it.kind];
  const badges = [`<span class="badge ${kind[0]}">${kind[1]}</span>`];
  if (it.video) badges.push(v && v.file ? '<span class="badge ready">Video ready</span>' : '<span class="badge notready">Video in production</span>');
  if (it.video) badges.push(`<span class="badge">${esc(it.video)}</span>`);
  if (it.platforms.includes('li') && (it.linkedin || {}).status !== 'ready') badges.push('<span class="badge notready">LinkedIn text in progress</span>');
  const hook = it.kind === 'li-image' ? '<p class="hook none">Text in progress</p>'
    : it.hook ? `<p class="hook">“${esc(it.shortsTitle && S.filter === 'yt' ? it.shortsTitle : it.hook)}”</p>` : '<p class="hook none">Caption comes with the video</p>';
  return `<article class="card${cls}" data-id="${esc(it.id)}" tabindex="0">
    <div class="when"><b>${fmtDate(it.date)}</b><span class="t">${esc(S.plan.time)} UK</span>${loc ? `<span class="loc">${esc(loc)}</span>` : ''}</div>
    <div class="what"><div class="badges">${badges.join('')}</div><p class="title">${esc(itemTitle(it))}</p><p class="game">${esc(gameLine(it))}</p>${hook}</div>
    <div class="pills">${S.plan.platforms.map((p) => pillHTML(it, p)).join('')}</div>
  </article>`;
}
function nextHTML() {
  const pids = (it) => it.platforms.filter((p) => S.filter === 'all' || p === S.filter);
  const late = [];
  for (const it of S.plan.items) for (const p of pids(it)) if (pState(it, p) === 'late') late.push([it, p]);
  if (late.length) {
    const [it, p] = late[0];
    const list = late.slice(0, 4).map(([i, q]) => `${fmtDate(i.date)} ${lab(q)}`).join(' · ');
    return `<div class="next bad" data-id="${esc(it.id)}" data-p="${p}"><span class="lbl">Overdue · ${late.length}</span><span class="what">${esc(list)}${late.length > 4 ? ' …' : ''}</span><span class="muted">Posted already? Tick it. Not posted? Tell Dmitry.</span></div>`;
  }
  const up = S.plan.items.find((it) => pids(it).some((p) => !isDone(it, p)));
  if (!up) return '<div class="next"><span class="lbl">All done</span><span class="what">Every post in the plan is ticked.</span></div>';
  const todo = pids(up).filter((p) => !isDone(up, p));
  const loc = localTime(up.date);
  return `<div class="next" data-id="${esc(up.id)}" data-p="${todo[0]}"><span class="lbl">${up.date === ukToday() ? 'Today' : 'Next'}</span>
    <span class="what">${fmtDate(up.date)}, ${esc(S.plan.time)} UK${loc ? ` (${esc(loc)})` : ''} · ${esc(itemTitle(up))}</span>
    <span class="muted">${todo.map((p) => esc(lab(p))).join(', ')}</span></div>`;
}
function renderPlan() {
  const P = S.plan;
  let total = 0, done = 0; const per = {};
  for (const it of P.items) for (const p of it.platforms) { total++; per[p] = per[p] || [0, 0]; per[p][1]++; if (isDone(it, p)) { done++; per[p][0]++; } }
  const chips = [`<button class="chip${S.filter === 'all' ? ' on' : ''}" data-f="all">All <span class="n">${done}/${total}</span></button>`]
    .concat(P.platforms.map((p) => `<button class="chip${S.filter === p.id ? ' on' : ''}" data-f="${p.id}">${esc(lab(p.id))} <span class="n">${(per[p.id] || [0, 0]).join('/')}</span></button>`));
  const items = P.items.filter((it) => (S.filter === 'all' || it.platforms.includes(S.filter)) && !(S.hideDone && finished(it)));
  const out = [];
  let week = null; const pausesShown = new Set(); let prev = null;
  for (const it of items) {
    for (const pz of P.pauses || []) if (!pausesShown.has(pz.from) && it.date > pz.to && prev && prev.date < pz.from) { pausesShown.add(pz.from); out.push(`<div class="pause"><i data-lucide="pause-circle"></i>${esc(pz.text)}</div>`); }
    const w = mondayOf(it.date);
    if (w !== week) {
      week = w;
      const zero = P.items.some((x) => x.kind === 'zero' && mondayOf(x.date) === w);
      const name = zero ? 'Zero week' : `Week of ${fmtDay(w)}`;
      const n = P.items.filter((x) => mondayOf(x.date) === w).reduce((a, x) => a + (S.filter === 'all' ? x.platforms.length : +x.platforms.includes(S.filter)), 0);
      out.push(`<div class="week"><h2>${esc(name)}</h2><span>${fmtDay(w)} – ${fmtDay(addDays(w, 6))} · ${n} post${n === 1 ? '' : 's'}</span></div>`);
    }
    out.push(cardHTML(it)); prev = it;
  }
  $('#main').innerHTML = `<section class="summary">
      <p class="intro">${esc(P.summary)} Open a day to get the video, the caption and the hashtags for each platform. Tick a platform when the post is live.</p>
      <div class="progress"><b>${done} of ${total}</b><span class="muted">posts done</span><div class="bar"><span style="width:${total ? (100 * done / total).toFixed(1) : 0}%"></span></div></div>
      <div class="filters">${chips.join('')}<label class="toggle"><input type="checkbox" id="hideDone"${S.hideDone ? ' checked' : ''}> Hide finished</label></div>
      ${nextHTML()}
    </section>${out.join('') || '<p class="empty">Nothing here with these filters.</p>'}`;
}

/* ---------- render: rules ---------- */
function renderRules() {
  const R = S.plan.rules, C = S.plan.constants;
  const legend = `<div class="legend">
      <span class="pill">TT<span style="height:14px"></span></span> to do
      <span class="pill today">TT<i data-lucide="clock"></i></span> today
      <span class="pill late">TT<i data-lucide="alert-triangle"></i></span> overdue
      <span class="pill done">TT<i data-lucide="check"></i></span> posted
      <span class="pill off">TT<span>—</span></span> not on this day</div>`;
  const cards = S.plan.platforms.map((p) => {
    const n = C.tagCount[p.id] || 0;
    return `<section class="rcard"><h3>${esc(p.name)}</h3><p class="acc">${esc(p.account)} · link tag utm_source=${esc(p.utm)}</p>
      <ul class="rules">${(R.platforms[p.id] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="muted" style="margin:4px 0 0;font-size:13px">Hashtags: ${n ? `${n} · ${esc(C.baseTags.join(' '))} + one per video` : 'none'}</p></section>`;
  }).join('');
  $('#main').innerHTML = `<div class="rules-grid">
      <section class="rcard wide"><h3>How this plan works</h3><p style="margin:0">${esc(S.plan.summary)}</p>
        <ul class="rules">${R.general.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${legend}
        <p class="muted" style="margin:0;font-size:13px">Call to action in every caption except LinkedIn: “${esc(C.cta)}”</p></section>
      ${cards}</div>`;
}

function render() {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === S.view));
  $('#meName').textContent = S.name ? `You: ${S.name}` : '';
  if (S.view === 'rules') renderRules(); else renderPlan();
  window.lucide && lucide.createIcons();
}

/* ---------- sheet: one day × one platform ---------- */
function openSheet(id, pid) {
  const it = itemById(id); if (!it) return;
  if (!pid || !it.platforms.includes(pid)) pid = (S.filter !== 'all' && it.platforms.includes(S.filter)) ? S.filter : (it.platforms.find((p) => !isDone(it, p)) || it.platforms[0]);
  S.sheet = { id, pid };
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSheet();
  $('.sheet').scrollTop = 0;
}
function closeSheet() { S.sheet = null; $('#sheetWrap').hidden = true; document.body.style.overflow = ''; }
function renderSheet() {
  const { id, pid } = S.sheet, it = itemById(id), v = videoOf(it), p = plat(pid), st = S.status[id]?.[pid];
  const loc = localTime(it.date);
  const tabs = it.platforms.map((q) => `<button class="ptab${q === pid ? ' on' : ''}" data-p="${q}"><span class="dot ${pState(it, q)}"></span>${esc(lab(q))}</button>`).join('');
  const parts = [];
  if (it.video) {
    parts.push(v && v.file
      ? `<div class="blk"><h4>Video</h4><div class="video"><div class="poster" id="poster"><i data-lucide="film"></i></div>
          <div class="vid-actions"><button class="btn primary" id="dl"><i data-lucide="download"></i>Download video</button>
          <button class="btn small" id="pv"><i data-lucide="play"></i>Preview</button>
          <span class="muted" style="font-size:13px">${esc(it.video)} · MP4 9:16 · sound inside</span></div></div></div>`
      : `<div class="blk"><h4>Video</h4><div class="note warn">This video is still in production. It will appear here when it's ready. Not here on the day? Skip the slot and tell Dmitry.</div></div>`);
  } else parts.push('<div class="blk"><h4>Image</h4><div class="note warn">The image comes with the text.</div></div>');
  const F = fields(it, pid);
  if (F) {
    F.forEach((f, i) => {
      const len = [...f.text].length;
      let cnt = '';
      if (f.limit) cnt = `<span class="cnt${len > f.limit ? ' over' : ''}">${len} / ${f.limit}</span>`;
      else if (f.first) { const fl = [...f.text.split('\n')[0]].length; cnt = `<span class="cnt${fl > f.first ? ' over' : ''}">first line ${fl} / ${f.first} visible</span>`; }
      parts.push(`<div class="blk"><h4>${esc(f.label)}${cnt}</h4><div class="field${f.big ? ' big' : ''}">${esc(f.text)}</div>
        <div class="field-row"><button class="btn small" data-copy="${i}"><i data-lucide="copy"></i>Copy ${esc(f.label.toLowerCase())}</button></div></div>`);
    });
  } else {
    const why = pid === 'li' ? 'The LinkedIn text is being written. It will appear here.' : 'The caption comes with the video. It will appear here.';
    parts.push(`<div class="blk"><h4>${pid === 'li' ? 'Post text' : 'Caption'}</h4><div class="note warn">${why}</div></div>`);
  }
  if (it.notes && it.notes.length) parts.push(`<div class="blk"><h4>For this day</h4>${it.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>`);
  parts.push(`<div class="blk"><h4>Before you post on ${esc(p.name)}</h4><ul class="rules">${(S.plan.rules.platforms[pid] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  if (st && st.done) {
    const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(st.at));
    parts.push(`<div class="status done"><div class="who"><b>Posted on ${esc(p.name)}</b> · ${esc(st.by || '')} · ${esc(when)}</div>
      ${st.url ? `<a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.url)}</a>` : '<span class="muted">No link saved.</span>'}
      <div><button class="btn small" id="untick">Mark as not posted</button></div></div>`);
  } else {
    parts.push(`<div class="status"><label class="who" for="postUrl"><b>Live on ${esc(p.name)}?</b> Paste the link to the post (optional) and tick it.</label>
      <input id="postUrl" type="url" placeholder="https://…" autocomplete="off">
      <div><button class="btn primary" id="tick"><i data-lucide="check"></i>Mark as posted on ${esc(p.name)}</button></div></div>`);
  }
  $('#sheet').innerHTML = `<div class="sh-head"><div class="sh-row"><div><span class="muted">${fmtDate(it.date)}, ${esc(S.plan.time)} UK${loc ? ` · ${esc(loc)}` : ''}</span>
      <h3 id="sheetTitle">${esc(itemTitle(it))}</h3><span class="muted">${esc(gameLine(it))}</span></div>
      <button class="icon-btn" data-close title="Close"><i data-lucide="x"></i></button></div><div class="ptabs">${tabs}</div></div>
    <div class="sh-body">${parts.join('')}</div>`;
  window.lucide && lucide.createIcons();
  if (v && v.poster) Data.blobUrl(v.poster).then((u) => { const el = $('#poster'); if (el && S.sheet && S.sheet.id === id) { el.style.backgroundImage = `url(${u})`; el.innerHTML = ''; } }).catch(() => {});
  S.sheetFields = F;
}

async function mark(done) {
  if (S.saving) return;
  const { id, pid } = S.sheet, it = itemById(id), p = plat(pid);
  if (!done && !confirm(`Mark as not posted on ${p.name}?`)) return;
  const url = done ? ($('#postUrl')?.value || '').trim() : '';
  const who = S.name || 'someone';
  const msg = `${it.date} ${it.video || 'LinkedIn image'} · ${p.name}: ${done ? 'posted' : 'unticked'} (${who})`;
  S.saving = true; $$('#tick, #untick').forEach((b) => (b.disabled = true));
  try {
    S.status = await Data.save((st) => {
      if (done) (st[id] = st[id] || {})[pid] = { done: true, by: who, at: new Date().toISOString(), ...(url ? { url } : {}) };
      else if (st[id]) { delete st[id][pid]; if (!Object.keys(st[id]).length) delete st[id]; }
    }, msg);
    toast(done ? `Ticked: ${p.name}` : `Unticked: ${p.name}`);
    render(); if (S.sheet) renderSheet();
  } catch (e) { toast(errText(e), true); $$('#tick, #untick').forEach((b) => (b.disabled = false)); }
  finally { S.saving = false; }
}

async function download() {
  const it = itemById(S.sheet.id), v = videoOf(it), b = $('#dl');
  b.disabled = true; b.lastChild.textContent = 'Loading…';
  try {
    const u = await Data.blobUrl(v.file);
    const a = document.createElement('a'); a.href = u; a.download = `Playmar_${it.date}_${it.video}.mp4`; document.body.append(a); a.click(); a.remove();
  } catch (e) { toast(errText(e), true); }
  finally { if ($('#dl')) { b.disabled = false; b.lastChild.textContent = 'Download video'; } }
}
async function preview() {
  const it = itemById(S.sheet.id), v = videoOf(it), el = $('#poster');
  el.innerHTML = '<i data-lucide="loader"></i>'; window.lucide && lucide.createIcons();
  try { const u = await Data.blobUrl(v.file); el.style.backgroundImage = ''; el.innerHTML = `<video src="${u}" controls autoplay playsinline></video>`; }
  catch (e) { toast(errText(e), true); }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied');
}

/* ---------- misc ---------- */
let toastT;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), bad ? 6000 : 2200); }
function errText(e) {
  if (e && (e.status === 401 || e.status === 403)) return 'Access expired or blocked. Sign out and in again; if that fails, ask Dmitry for a new password.';
  if (e && e.status === 404) return 'Not found in the plan repo. Ask Dmitry.';
  if (e instanceof TypeError) return 'No connection to GitHub. Check the internet and try again.';
  return (e && e.message) || 'Something went wrong.';
}
function savePrefs() { set(PREF_KEY, JSON.stringify({ view: S.view, filter: S.filter, hideDone: S.hideDone })); }
function loadPrefs() { try { Object.assign(S, JSON.parse(get(PREF_KEY) || '{}')); } catch (e) { /* defaults */ } }

async function refreshStatus(force = false) {
  if (S.saving || !S.plan) return;
  const before = JSON.stringify(S.status);
  try { S.status = (await Data.status()).data; } catch (e) { if (force) toast(errText(e), true); return; }
  if (force || JSON.stringify(S.status) !== before) {
    render();
    if (S.sheet && JSON.stringify(S.status[S.sheet.id] || {}) !== JSON.stringify(JSON.parse(before)[S.sheet.id] || {})) renderSheet();
  }
}

async function start() {
  const [plan, st] = await Promise.all([Data.plan(), Data.status()]);
  S.plan = plan; S.status = st.data;
  if (S.filter !== 'all' && !plan.platforms.some((p) => p.id === S.filter)) S.filter = 'all';
  $('#login').hidden = true; $('#app').hidden = false;
  render();
}
function showLogin(msg) {
  $('#app').hidden = true; $('#login').hidden = false;
  $('#nm').value = S.name || '';
  const e = $('#loginErr'); e.hidden = !msg; e.textContent = msg || '';
  ($('#nm').value ? $('#pw') : $('#nm')).focus();
}
function logout() { GH.token = null; del(TOKEN_KEY, 's'); del(TOKEN_KEY); S.plan = null; closeSheet(); showLogin(); }

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) return closeSheet();
  const tab = t.closest('.tab'); if (tab) { S.view = tab.dataset.view; savePrefs(); return render(); }
  const chip = t.closest('.chip'); if (chip) { S.filter = chip.dataset.f; savePrefs(); return render(); }
  const ptab = t.closest('.ptab'); if (ptab) { S.sheet.pid = ptab.dataset.p; renderSheet(); $('.sheet').scrollTop = 0; return; }
  const pill = t.closest('.pill[data-id]'); if (pill) return openSheet(pill.dataset.id, pill.dataset.p);
  const nx = t.closest('.next[data-id]'); if (nx) return openSheet(nx.dataset.id, nx.dataset.p);
  const card = t.closest('.card'); if (card) return openSheet(card.dataset.id);
  const cp = t.closest('[data-copy]'); if (cp) return copyText(S.sheetFields[+cp.dataset.copy].text);
  if (t.closest('#tick')) return mark(true);
  if (t.closest('#untick')) return mark(false);
  if (t.closest('#dl')) return download();
  if (t.closest('#pv')) return preview();
  if (t.closest('#refresh')) return refreshStatus(true).then(() => toast('Up to date'));
  if (t.closest('#logout')) return logout();
  if (t.closest('#meName')) { const n = prompt('Your name (shown next to your ticks):', S.name); if (n && n.trim()) { S.name = n.trim().slice(0, 40); set(NAME_KEY, S.name); render(); } }
});
document.addEventListener('change', (e) => { if (e.target.id === 'hideDone') { S.hideDone = e.target.checked; savePrefs(); render(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) openSheet(e.target.dataset.id);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
setInterval(() => { if (!document.hidden) refreshStatus(); }, 60000);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#loginForm button'), err = $('#loginErr');
  S.name = $('#nm').value.trim().slice(0, 40); set(NAME_KEY, S.name);
  btn.disabled = true; err.hidden = true;
  try {
    const token = await decryptToken($('#pw').value);
    GH.token = token;
    await start();
    set(TOKEN_KEY, token, 's'); if ($('#remember').checked) set(TOKEN_KEY, token);
  } catch (x) {
    GH.token = null;
    err.textContent = x.message === 'password' ? 'Wrong password.' : x.message === 'setup' ? 'Access is not set up yet. Ask Dmitry.' : errText(x);
    err.hidden = false;
  } finally { btn.disabled = false; }
});

(async function boot() {
  loadPrefs();
  S.name = get(NAME_KEY) || (LOCAL ? 'Local test' : '');
  if (LOCAL) { try { await start(); } catch (e) { showLogin(errText(e)); } return; }
  GH.token = get(TOKEN_KEY, 's') || get(TOKEN_KEY);
  if (GH.token) {
    try { await start(); return; }
    catch (e) { if (e.status === 401 || e.status === 403 || e.status === 404) { del(TOKEN_KEY, 's'); del(TOKEN_KEY); GH.token = null; } else return showLogin(errText(e)); }
  }
  showLogin();
})();
