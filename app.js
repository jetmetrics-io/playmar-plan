'use strict';
/* Playmar reels plan.
   A static page on GitHub Pages, no sign-in: the plan, the videos and the covers sit next to it in data/
   (plan.json, videos/, posters/; build.py makes them). The page has noindex, nofollow.
   Ticks are kept in this browser only (localStorage): nobody else sees them. */

const TICKS_KEY = 'pm-plan-ticks', PREF_KEY = 'pm-plan-prefs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

const S = { plan: null, status: {}, view: 'plan', filter: 'all', hideDone: false, sheet: null, kept: true };

const Data = {
  async plan() {
    const r = await fetch('data/plan.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`The plan did not load (${r.status}). Reload the page.`);
    return r.json();
  },
  status() { try { return JSON.parse(get(TICKS_KEY) || '{}'); } catch (e) { return {}; } },
  save(change) { const cur = Data.status(); change(cur); S.kept = set(TICKS_KEY, JSON.stringify(cur)); return cur; },
  url: (path) => 'data/' + path
};

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
      <p class="intro">${esc(P.summary)} Open a day to get the video, the caption and the hashtags for each platform. Tick a platform when the post is live: ticks are saved in this browser only, so use the same one each time.</p>
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
          <div class="vid-actions"><a class="btn primary" id="dl" href="${esc(Data.url(v.file))}" download="Playmar_${esc(it.date)}_${esc(it.video)}.mp4"><i data-lucide="download"></i>Download video</a>
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
    parts.push(`<div class="status done"><div class="who"><b>Posted on ${esc(p.name)}</b> · ticked ${esc(when)}</div>
      ${st.url ? `<a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.url)}</a>` : '<span class="muted">No link saved.</span>'}
      <div><button class="btn small" id="untick">Mark as not posted</button></div></div>`);
  } else {
    parts.push(`<div class="status"><label class="who" for="postUrl"><b>Live on ${esc(p.name)}?</b> Paste the link to the post (optional) and tick it.</label>
      <input id="postUrl" type="url" placeholder="https://…" autocomplete="off">
      <div><button class="btn primary" id="tick"><i data-lucide="check"></i>Mark as posted on ${esc(p.name)}</button></div>
      <p class="muted keep">Ticks are saved in this browser only.</p></div>`);
  }
  $('#sheet').innerHTML = `<div class="sh-head"><div class="sh-row"><div><span class="muted">${fmtDate(it.date)}, ${esc(S.plan.time)} UK${loc ? ` · ${esc(loc)}` : ''}</span>
      <h3 id="sheetTitle">${esc(itemTitle(it))}</h3><span class="muted">${esc(gameLine(it))}</span></div>
      <button class="icon-btn" data-close title="Close"><i data-lucide="x"></i></button></div><div class="ptabs">${tabs}</div></div>
    <div class="sh-body">${parts.join('')}</div>`;
  window.lucide && lucide.createIcons();
  if (v && v.poster) { const el = $('#poster'); el.style.backgroundImage = `url("${Data.url(v.poster)}")`; el.innerHTML = ''; }
  S.sheetFields = F;
}

function mark(done) {
  const { id, pid } = S.sheet, p = plat(pid);
  if (!done && !confirm(`Mark as not posted on ${p.name}?`)) return;
  const url = done ? ($('#postUrl')?.value || '').trim() : '';
  S.status = Data.save((st) => {
    if (done) (st[id] = st[id] || {})[pid] = { done: true, at: new Date().toISOString(), ...(url ? { url } : {}) };
    else if (st[id]) { delete st[id][pid]; if (!Object.keys(st[id]).length) delete st[id]; }
  });
  if (!S.kept) toast('This browser does not keep ticks (private window?). They will be gone when you close the tab.', true);
  else toast(done ? `Ticked: ${p.name}` : `Unticked: ${p.name}`);
  render(); if (S.sheet) renderSheet();
}

function preview() {
  const v = videoOf(itemById(S.sheet.id)), el = $('#poster');
  el.style.backgroundImage = ''; el.innerHTML = `<video src="${esc(Data.url(v.file))}" controls autoplay playsinline></video>`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied');
}

/* ---------- misc ---------- */
let toastT;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), bad ? 6000 : 2200); }
function savePrefs() { set(PREF_KEY, JSON.stringify({ view: S.view, filter: S.filter, hideDone: S.hideDone })); }
function loadPrefs() { try { Object.assign(S, JSON.parse(get(PREF_KEY) || '{}')); } catch (e) { /* defaults */ } }

async function start() {
  S.plan = await Data.plan(); S.status = Data.status();
  if (S.filter !== 'all' && !S.plan.platforms.some((p) => p.id === S.filter)) S.filter = 'all';
  render();
}

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
  if (t.closest('#pv')) return preview();
});
document.addEventListener('change', (e) => { if (e.target.id === 'hideDone') { S.hideDone = e.target.checked; savePrefs(); render(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) openSheet(e.target.dataset.id);
});
/* ticks made in another tab of this browser */
window.addEventListener('storage', (e) => { if (e.key === TICKS_KEY && S.plan) { S.status = Data.status(); render(); if (S.sheet) renderSheet(); } });

loadPrefs();
start().catch((e) => { $('#main').innerHTML = `<p class="empty">${esc(e.message || 'The plan did not load. Reload the page.')}</p>`; });
