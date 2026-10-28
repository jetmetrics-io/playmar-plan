'use strict';
/* Playmar reels plan.
   A static page on GitHub Pages, no sign-in: the plan, the videos and the covers sit next to it in data/
   (plan.json, videos/, posters/; build.py makes them). The page has noindex, nofollow.
   Ticks are kept in this browser only (localStorage): nobody else sees them.
   Statistics screenshots go to a Yandex Cloud function (plan.statsApi) and on into a private bucket: uploading needs the
   code from Dmitry, kept in this browser; how many screenshots each post has is shared, everyone sees the same.
   The numbers are read off the screenshots by hand and come back as data/stats.json (Аналитика tab). */

const TICKS_KEY = 'pm-plan-ticks', PREF_KEY = 'pm-plan-prefs', CODE_KEY = 'pm-stats-code';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

const S = { plan: null, status: {}, view: 'plan', filter: 'all', hideDone: false, todoOnly: false, sheet: null, kept: true,
  up: null, upErr: null, nums: null, files: {}, busy: null };

const Data = {
  async plan() {
    const r = await fetch('data/plan.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`План не загрузился (${r.status}). Обновите страницу.`);
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
const fmtDate = (s) => new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(noonUTC(s));
const fmtDay = (s) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(noonUTC(s));
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
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
  return d === s ? `${t} у вас` : `${t} ${fmtDate(d)} у вас`;
}
function mondayOf(s) { const d = noonUTC(s); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = noonUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/* ---------- plan helpers ---------- */
const plat = (id) => S.plan.platforms.find((p) => p.id === id);
const lab = (id) => { const p = plat(id); return p.label || p.name; };
const itemById = (id) => S.plan.items.find((i) => i.id === id);
const videoOf = (it) => (it.video ? S.plan.videos[it.video] : null);
const isDone = (it, pid) => !!S.status[it.id]?.[pid]?.done;
const isSlot = (it) => it.kind === 'slot';
/* platforms of the day: required ones, then optional ones (LinkedIn for a pure-game reel) */
const plats = (it) => it.platforms.concat((it.optional || []).filter((p) => !it.platforms.includes(p)));
const isOpt = (it, pid) => (it.optional || []).includes(pid) && !it.platforms.includes(pid);
const FORMAT = { pure: 'Чистая игра', plates: 'С плашками' };
const liWriting = (it) => it.platforms.includes('li') && (it.linkedin || {}).status !== 'ready';
/* what still has to be made for this day: a video for an empty slot, a video in production, a LinkedIn text */
const needsWork = (it) => isSlot(it) || (it.video && !(videoOf(it) || {}).file) || liWriting(it);
function pState(it, pid) {
  if (!plats(it).includes(pid)) return 'off';
  if (isSlot(it)) return isOpt(it, pid) ? 'opt' : 'slot';
  if (isDone(it, pid)) return 'done';
  if (isOpt(it, pid)) return 'opt';
  const today = ukToday();
  if (it.date === today) return 'today';
  return it.date < today ? 'late' : 'todo';
}
const finished = (it) => !isSlot(it) && (S.filter === 'all' ? it.platforms.every((p) => isDone(it, p)) : isDone(it, S.filter));
function itemTitle(it) { const v = videoOf(it); return v ? v.title : it.video; }
function gameLine(it) { const v = videoOf(it); return v ? `${S.plan.games[v.game] || ''} · ${v.type}` : ''; }
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
    if (li.status === 'ready' && li.text) return [{ label: 'Текст поста', text: li.text, limit: 3000, big: true }];
    /* LinkedIn by choice (pure game): the first line and the description, no call to action, no hashtags */
    return isOpt(it, 'li') && it.hook ? [{ label: 'Текст поста', text: [it.hook, it.body].filter(Boolean).join('\n\n'), limit: 3000 }] : null;
  }
  if (!it.hook) return null;
  const tags = tagsFor(it, pid).join(' ');
  if (pid === 'yt') {
    const title = it.shortsTitle || it.hook;
    return [
      { label: 'Название', text: title, limit: 100 },
      { label: 'Описание', text: [it.shortsTitle ? it.hook : '', it.body, C.cta, tags].filter(Boolean).join('\n\n') }
    ];
  }
  const body = pid === 'tt' ? firstSentence(it.body) : it.body;
  return [
    { label: 'Подпись', text: [it.hook, body, C.cta, tags].filter(Boolean).join('\n\n'), first: pid === 'tt' ? 0 : 125 },
    { label: 'Только хэштеги', text: tags, small: true }
  ];
}

/* ---------- render: plan ---------- */
const ICON = { done: 'check', today: 'clock', late: 'alert-triangle' };
function pillHTML(it, p) {
  const st = pState(it, p.id);
  if (st === 'off') return `<span class="pill off" title="${esc(p.name)}: в этот день не выходит">${esc(p.short)}<span>—</span></span>`;
  if (st === 'slot') return `<span class="pill slot" title="${esc(p.name)}: ролика под этот день пока нет">${esc(p.short)}<i data-lucide="circle-dashed"></i></span>`;
  if (st === 'opt' && isSlot(it)) return `<span class="pill opt slot" title="${esc(p.name)}: по желанию">${esc(p.short)}<i data-lucide="plus"></i></span>`;
  if (st === 'opt') return `<button class="pill opt" data-id="${esc(it.id)}" data-p="${p.id}" title="${esc(p.name)}: по желанию">${esc(p.short)}<i data-lucide="plus"></i></button>`;
  const dim = S.filter !== 'all' && S.filter !== p.id ? ' dim' : '';
  const word = { done: 'выложено', today: 'сегодня', late: 'просрочено', todo: 'впереди' }[st];
  return `<button class="pill ${st}${dim}" data-id="${esc(it.id)}" data-p="${p.id}" title="${esc(p.name)}: ${word}">${esc(p.short)}${ICON[st] ? `<i data-lucide="${ICON[st]}"></i>` : '<span style="height:14px"></span>'}</button>`;
}
/* games of the nearest videos before and after: an empty slot needs a different game (rule: one game never twice in a row) */
function neighbourGames(it) {
  const seq = S.plan.items.filter((x) => x.video || isSlot(x));
  const i = seq.indexOf(it), near = [seq[i - 1], seq[i + 1]].filter((x) => x && x.video);
  return [...new Set(near.map((x) => (S.plan.games[videoOf(x).game] || '').split(' · ')[0]).filter(Boolean))];
}
function slotHTML(it) {
  const loc = localTime(it.date), near = neighbourGames(it);
  /* the slot's notes name its game: the "any game but…" hint would contradict them */
  const nearText = (it.notes || []).length ? '' : near.length ?`Любая игра, кроме ${near.join(' и ')}: ${near.length > 1 ? 'они выходят соседними роликами' : 'она выходит соседним роликом'}.` : 'Подойдёт любая игра: соседние дни тоже пока пустые.';
  return `<article class="card slot" data-id="${esc(it.id)}">
    <div class="when"><b>${fmtDate(it.date)}</b><span class="t">${esc(S.plan.time)} Лондон</span>${loc ? `<span class="loc">${esc(loc)}</span>` : ''}</div>
    <div class="what"><div class="badges"><span class="badge slot">Пустой слот</span>${it.format ? `<span class="badge ${it.format}">${FORMAT[it.format]}</span>` : ''}</div><p class="title">Нужен ролик</p>${nearText ? `<p class="game">${esc(nearText)}</p>` : ''}
      ${(it.notes || []).map((n) => `<p class="hook none">${esc(n)}</p>`).join('')}</div>
    <div class="pills">${S.plan.platforms.map((p) => pillHTML(it, p)).join('')}</div>
  </article>`;
}
function cardHTML(it) {
  if (isSlot(it)) return slotHTML(it);
  const v = videoOf(it), loc = localTime(it.date);
  const states = it.platforms.map((p) => pState(it, p));
  const cls = finished(it) ? ' done' : states.includes('late') ? ' is-late' : states.includes('today') ? ' is-today' : '';
  const badges = [`<span class="badge ${it.format}">${FORMAT[it.format]}</span>`];
  if (it.video) badges.push(v && v.file ? '<span class="badge ready">Видео готово</span>' : '<span class="badge notready">Видео делаем</span>');
  if (it.video) badges.push(`<span class="badge">${esc(it.video)}</span>`);
  if (it.platforms.includes('li') && (it.linkedin || {}).status !== 'ready') badges.push('<span class="badge notready">Текст LinkedIn пишем</span>');
  const hook = it.hook ? `<p class="hook">“${esc(it.shortsTitle && S.filter === 'yt' ? it.shortsTitle : it.hook)}”</p>` : '<p class="hook none">Подпись появится вместе с роликом</p>';
  return `<article class="card${cls}" data-id="${esc(it.id)}" tabindex="0">
    <div class="when"><b>${fmtDate(it.date)}</b><span class="t">${esc(S.plan.time)} Лондон</span>${loc ? `<span class="loc">${esc(loc)}</span>` : ''}</div>
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
    return `<div class="next bad" data-id="${esc(it.id)}" data-p="${p}"><span class="lbl">Просрочено · ${late.length}</span><span class="what">${esc(list)}${late.length > 4 ? ' …' : ''}</span><span class="muted">Уже выложили — отметьте. Не выложили — напишите Дмитрию.</span></div>`;
  }
  const up = S.plan.items.find((it) => !isSlot(it) && pids(it).some((p) => !isDone(it, p)));
  if (!up) return '<div class="next"><span class="lbl">Всё выложено</span><span class="what">Все посты плана отмечены.</span></div>';
  const todo = pids(up).filter((p) => !isDone(up, p));
  const loc = localTime(up.date);
  return `<div class="next" data-id="${esc(up.id)}" data-p="${todo[0]}"><span class="lbl">${up.date === ukToday() ? 'Сегодня' : 'Дальше'}</span>
    <span class="what">${fmtDate(up.date)}, ${esc(S.plan.time)} по Лондону${loc ? ` (${esc(loc)})` : ''} · ${esc(itemTitle(up))}</span>
    <span class="muted">${todo.map((p) => esc(lab(p))).join(', ')}</span></div>`;
}
function renderPlan() {
  const P = S.plan;
  let total = 0, done = 0; const per = {};
  /* optional platforms count only once posted */
  for (const it of P.items) for (const p of plats(it)) { if (isSlot(it) || (isOpt(it, p) && !isDone(it, p))) continue; total++; per[p] = per[p] || [0, 0]; per[p][1]++; if (isDone(it, p)) { done++; per[p][0]++; } }
  const chips = [`<button class="chip${S.filter === 'all' ? ' on' : ''}" data-f="all">Все <span class="n">${done}/${total}</span></button>`]
    .concat(P.platforms.map((p) => `<button class="chip${S.filter === p.id ? ' on' : ''}" data-f="${p.id}">${esc(lab(p.id))} <span class="n">${(per[p.id] || [0, 0]).join('/')}</span></button>`));
  const items = P.items.filter((it) => (S.filter === 'all' || plats(it).includes(S.filter)) && !(S.hideDone && finished(it)) && !(S.todoOnly && !needsWork(it)));
  const slots = P.items.filter(isSlot).length;
  const inProd = new Set(P.items.filter((it) => it.video && !(videoOf(it) || {}).file).map((it) => it.video)).size;
  const liTexts = P.items.filter(liWriting).length;
  const work = `<p class="work"><b>Нужно сделать: ${slots + inProd} ${plural(slots + inProd, 'ролик', 'ролика', 'роликов')}</b> — ${slots} ${plural(slots, 'пустой слот', 'пустых слота', 'пустых слотов')} и ${inProd} ${plural(inProd, 'ролик', 'ролика', 'роликов')} в работе; ${liTexts} ${plural(liTexts, 'текст', 'текста', 'текстов')} для LinkedIn.</p>`;
  const out = [];
  let week = null; const pausesShown = new Set(); let prev = null;
  for (const it of items) {
    for (const pz of P.pauses || []) if (!pausesShown.has(pz.from) && it.date > pz.to && prev && prev.date < pz.from) { pausesShown.add(pz.from); out.push(`<div class="pause"><i data-lucide="pause-circle"></i>${esc(pz.text)}</div>`); }
    const w = mondayOf(it.date);
    if (w !== week) {
      week = w;
      const inWeek = P.items.filter((x) => mondayOf(x.date) === w);
      const name = `Неделя с ${fmtDay(w)}`;
      const cnt = (x) => (S.filter === 'all' ? x.platforms.length : +x.platforms.includes(S.filter));
      const n = inWeek.filter((x) => !isSlot(x)).reduce((a, x) => a + cnt(x), 0);
      const e = inWeek.filter((x) => isSlot(x) && cnt(x)).length;
      out.push(`<div class="week"><h2>${esc(name)}</h2><span>${fmtDay(w)} – ${fmtDay(addDays(w, 6))} · ${n} ${plural(n, 'пост', 'поста', 'постов')}${e ? ` · ${e} ${plural(e, 'пустой слот', 'пустых слота', 'пустых слотов')}` : ''}</span></div>`);
    }
    out.push(cardHTML(it)); prev = it;
  }
  $('#main').innerHTML = `<section class="summary">
      <p class="intro">${esc(P.summary)} Откройте день — там видео, подпись и хэштеги для каждой площадки. Пост вышел — отметьте площадку. Галочки хранятся только в этом браузере, поэтому открывайте план всегда в одном и том же.</p>
      <div class="progress"><b>${done} из ${total}</b><span class="muted">выложено</span><div class="bar"><span style="width:${total ? (100 * done / total).toFixed(1) : 0}%"></span></div></div>
      ${work}
      <div class="filters">${chips.join('')}<label class="toggle"><input type="checkbox" id="hideDone"${S.hideDone ? ' checked' : ''}> Скрыть выложенное</label><label class="toggle"><input type="checkbox" id="todoOnly"${S.todoOnly ? ' checked' : ''}> Только то, что нужно сделать</label></div>
      ${nextHTML()}
    </section>${out.join('') || '<p class="empty">С такими фильтрами ничего нет.</p>'}`;
}

/* ---------- statistics: screenshots per post × platform × window ---------- */
const WINDOWS = [7, 28];
const Stats = {
  async call(body) {
    let r;
    /* a string body goes as text/plain: no CORS preflight. A request that never got an answer is tried twice more,
       except an upload: its answer may be lost after the screenshot is already saved, and a retry would save it twice */
    for (let i = 0; i < (body.a === 'upload' ? 1 : 3) && !r; i++) {
      if (i) await new Promise((res) => setTimeout(res, 1500));
      try { r = await fetch(S.plan.statsApi, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { /* no answer */ }
    }
    if (!r) throw new Error('Браузер не достучался до облака Яндекса. Помешать может блокировщик рекламы, VPN или сеть: отключите блокировщик для этой страницы и попробуйте ещё раз. Не помогло — напишите Дмитрию.');
    let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw Object.assign(new Error(j.error || (r.status === 413 ? 'Скрин слишком большой.' : `Облако ответило ${r.status}. Попробуйте ещё раз.`)), { badCode: !!j.badCode });
    return j;
  },
  async status() {
    if (!S.plan.statsApi) return;
    try { S.up = (await Stats.call({ a: 'status' })).status || {}; S.upErr = null; } catch (e) { S.upErr = e.message; }
  },
  async numbers() {
    try { const r = await fetch('data/stats.json', { cache: 'no-store' }); S.nums = r.ok ? await r.json() : { rows: [], notes: [] }; }
    catch (e) { S.nums = { rows: [], notes: [] }; }
  }
};
const code = () => get(CODE_KEY);
function forgetCode() { try { localStorage.removeItem(CODE_KEY); } catch (e) { /* nothing kept */ } S.files = {}; }
/* the 7th and the 28th day fall on the post's own weekday; 28 days after the last post of the plan — the next Monday (stats/README.md §2) */
function dueDate(it, w) {
  const d = addDays(it.date, w), last = S.plan.items[S.plan.items.length - 1].date;
  return w === 28 && d > last ? addDays(d, (8 - noonUTC(d).getUTCDay()) % 7) : d;
}
const upCount = (it, pid, w) => S.up?.[it.id]?.[pid]?.[w]?.n || 0;
const hasStats = (it) => !isSlot(it) && !!(videoOf(it) || {}).file && it.date <= ukToday();
/* platforms to collect: the required ones, plus LinkedIn by choice once ticked here or already uploaded */
const statPlats = (it) => it.platforms.concat((it.optional || []).filter((p) => !it.platforms.includes(p) && (isDone(it, p) || S.up?.[it.id]?.[p])));
function nextMonday(s) { return addDays(s, (8 - noonUTC(s).getUTCDay()) % 7); }
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmtN = (x, unit = '') => (x == null || x === '' ? '—' : typeof x === 'number' ? nf.format(x) + unit : esc(x));

function dueList() {
  const today = ukToday(), soon = addDays(today, 7), out = [];
  for (const it of S.plan.items) {
    if (isSlot(it) || !(videoOf(it) || {}).file) continue;
    for (const w of WINDOWS) {
      const due = dueDate(it, w);
      if (due > soon || it.date > today) continue;
      const ps = statPlats(it);
      out.push({ it, w, due, ps, left: ps.filter((p) => !upCount(it, p, w)) });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.it.date.localeCompare(b.it.date));
}
function dueRowHTML(x, today) {
  const pills = x.ps.map((p) => {
    const n = upCount(x.it, p, x.w), st = n ? 'done' : x.due < today ? 'late' : x.due === today ? 'today' : '';
    return `<button class="pill ${st}" data-stats="${esc(x.it.id)}" data-p="${p}" title="${esc(plat(p).name)}: ${n ? `${n} ${plural(n, 'скрин', 'скрина', 'скринов')}` : 'скринов нет'}">${esc(plat(p).short)}${n ? '<i data-lucide="check"></i>' : '<span style="height:14px"></span>'}</button>`;
  }).join('');
  return `<div class="drow"><div class="when"><b>${x.due === today ? 'Сегодня' : fmtDate(x.due)}</b><span class="t">срез ${x.w} дней</span></div>
    <div class="what"><div class="badges"><span class="badge ${x.it.format}">${FORMAT[x.it.format]}</span></div><p class="title">${esc(itemTitle(x.it))}</p>
      <p class="game">${esc((S.plan.games[videoOf(x.it).game] || '').split(' · ')[0])} · вышел ${fmtDate(x.it.date)}</p></div>
    <div class="pills">${pills}</div></div>`;
}
/* досмотр = average watch time ÷ video length (Сводка §7); a platform's own % only when the time is missing */
function watchPct(r) { const it = itemById(r['пост']), sec = (videoOf(it) || {}).sec; return r['среднее_время_с'] != null && sec ? 100 * r['среднее_время_с'] / sec : r['досмотр_%']; }
const per1000 = (r, k) => (r[k] != null && r['просмотры'] ? 1000 * r[k] / r['просмотры'] : null);
function pairsHTML(rows) {
  const M = [['Просмотры', (r) => r['просмотры'], ''], ['Досмотр', watchPct, ' %'], ['Подписки на 1 000', (r) => per1000(r, 'подписки'), '']];
  const week = rows.filter((r) => r['окно'] === 7), by = (id, p) => week.find((r) => r['пост'] === id && r['площадка'] === p);
  const lines = []; let pairs = 0, pureWins = 0, platesWins = 0;
  for (const g of Object.keys(S.plan.games)) {
    const of = (f) => S.plan.items.filter((it) => it.format === f && (videoOf(it) || {}).game === g && week.some((r) => r['пост'] === it.id));
    const a = of('pure')[0], b = of('plates')[0];
    if (!a || !b) continue;
    for (const p of S.plan.platforms.map((q) => q.id)) {
      const ra = by(a.id, p), rb = by(b.id, p);
      if (!ra || !rb) continue;
      const cells = M.map(([, f, unit], i) => {
        const x = f(ra), y = f(rb), win = x != null && y != null && x !== y ? (x > y ? 'a' : 'b') : '';
        if (i === 1 && win) { pairs++; win === 'a' ? pureWins++ : platesWins++; }
        return `<td class="${win === 'a' ? 'win' : ''}">${fmtN(x, unit)}</td><td class="${win === 'b' ? 'win' : ''}">${fmtN(y, unit)}</td>`;
      }).join('');
      lines.push(`<tr><th>${esc(S.plan.games[g].split(' · ')[0])}</th><td>${esc(lab(p))}</td>${cells}</tr>`);
    }
  }
  if (!lines.length) return '<p class="muted">Пар пока нет: нужны 7-дневные цифры чистой игры и ролика с плашками одной и той же игры на одной площадке.</p>';
  return `<div class="tscroll"><table class="stable"><thead><tr><th rowspan="2">Игра</th><th rowspan="2">Площадка</th>${M.map(([l]) => `<th colspan="2">${l}</th>`).join('')}</tr>
      <tr>${M.map(() => '<th>чистая</th><th>с плашками</th>').join('')}</tr></thead><tbody>${lines.join('')}</tbody></table></div>
    <p class="muted small">Срез 7 дней. Выделено лучшее в паре. Просмотры сравниваем только внутри площадки: площадки считают их по-разному. По досмотру чистая игра лучше в ${pureWins} ${plural(pureWins, 'паре', 'парах', 'парах')} из ${pairs}, с плашками — в ${platesWins}. Выводы — не раньше 10 пар; уверенно — если формат выиграл 9 из 10.</p>`;
}
function numbersHTML(rows) {
  const order = S.plan.platforms.map((p) => p.id);
  const sorted = rows.slice().sort((a, b) => a['пост'].localeCompare(b['пост']) || order.indexOf(a['площадка']) - order.indexOf(b['площадка']) || a['окно'] - b['окно']);
  const C = [['просмотры', 'Просмотры'], ['охват', 'Охват'], ['среднее_время_с', 'Ср. время, с'], [watchPct, 'Досмотр', ' %'], ['доля_не_подписчиков_%', 'Не подписчики', ' %'],
    ['лайки', 'Лайки'], ['комментарии', 'Комм.'], ['пересылки', 'Пересылки'], ['сохранения', 'Сохр.'], ['переходы_в_профиль', 'В профиль'], ['подписки', 'Подписки'], ['клики_по_ссылке', 'Клики']];
  const body = sorted.map((r) => {
    const it = itemById(r['пост']);
    return `<tr><th><span class="nm">${esc(itemTitle(it))}</span><span class="muted">${fmtDay(it.date)}</span></th><td>${esc(lab(r['площадка']))}</td><td>${r['окно']} дн</td>
      ${C.map(([k, , unit]) => `<td>${fmtN(typeof k === 'function' ? k(r) : r[k], unit || '')}</td>`).join('')}<td class="sp">${esc(r['особое'] || '')}</td></tr>`;
  }).join('');
  return `<div class="tscroll"><table class="stable all"><thead><tr><th>Пост</th><th>Площадка</th><th>Срез</th>${C.map(([, l]) => `<th>${l}</th>`).join('')}<th>Особое</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function renderStats() {
  const today = ukToday(), list = dueList(), N = S.nums || { rows: [], notes: [] };
  const late = list.filter((x) => x.due < today && x.left.length), now = list.filter((x) => x.due === today), soon = list.filter((x) => x.due > today);
  const group = (title, xs) => (xs.length ? `<h4 class="dgroup">${title}</h4>${xs.map((x) => dueRowHTML(x, today)).join('')}` : '');
  const todo = !S.plan.statsApi ? '<p class="muted">Загрузка скринов ещё не подключена.</p>'
    : (S.upErr ? `<div class="note warn">Не вижу, что уже загружено: ${esc(S.upErr)}</div>` : '')
      + (group(`Просрочено · ${late.length}`, late) + group('Сегодня', now) + group('Ближайшая неделя', soon) || '<p class="muted">На этой неделе снимать нечего.</p>');
  const nums = N.rows.length ? `${N.updated ? `<p class="muted small">Цифры на ${fmtDate(N.updated)}.</p>` : ''}${numbersHTML(N.rows)}`
    : `<p class="muted">Цифр пока нет. Скрины разбираем по понедельникам, ближайший разбор — ${fmtDate(nextMonday(today))}.</p>`;
  $('#main').innerHTML = `<div class="stats">
    <section class="rcard wide"><h3>Что снять</h3>
      <p class="muted small">Посту исполняется 7 и 28 дней в тот же день недели, что и выход. Нажмите площадку — откроется день: туда и загружайте скрины. Галочка — скрины уже есть, это видят все.</p>${todo}</section>
    ${(N.notes || []).length ? `<section class="rcard"><h3>Выводы разборов</h3><ul class="rules">${N.notes.map((n) => `<li>${n.date ? `<b>${fmtDay(n.date)}.</b> ` : ''}${esc(n.text)}</li>`).join('')}</ul></section>` : ''}
    <section class="rcard"><h3>Чистая игра и с плашками</h3>${N.rows.length ? pairsHTML(N.rows) : '<p class="muted">Сравнение появится вместе с цифрами.</p>'}</section>
    <section class="rcard"><h3>Все цифры</h3>${nums}</section></div>`;
}

/* the Статистика block of a day's sheet: one platform, both windows */
function statsHTML(it, pid) {
  if (!S.plan.statsApi || !hasStats(it) || !statPlats(it).includes(pid)) return '';
  const p = plat(pid), today = ukToday(), k = `${it.id}|${pid}`, has = !!code();
  const rows = WINDOWS.map((w) => {
    const due = dueDate(it, w), n = upCount(it, pid, w);
    const st = n ? 'done' : due < today ? 'late' : due === today ? 'today' : 'todo';
    const word = n ? `${n} ${plural(n, 'скрин', 'скрина', 'скринов')}` : { late: 'не загружено', today: 'снять сегодня', todo: 'впереди' }[st];
    const btn = has ? `<label class="btn small upbtn${S.busy ? ' off' : ''}"><i data-lucide="upload"></i>${n ? 'Добавить' : 'Загрузить'}<input type="file" accept="image/*" multiple data-up="${w}"${S.busy ? ' disabled' : ''}></label>` : '';
    return `<div class="srow"><div class="sw"><b>${w} дней</b><span class="muted">срез ${fmtDate(due)}</span></div><span class="up ${st}">${n ? '<i data-lucide="check"></i>' : ''}${word}</span>${btn}</div>`;
  }).join('');
  const R = S.plan.rules.stats || { general: [], platforms: {} };
  const hint = `<details class="hint"><summary>Что снимать в ${esc(p.name)}</summary><ul class="rules">${(R.platforms[pid] || []).concat(R.general).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  let files = '';
  if (!has) {
    files = `<div class="codebox"><label for="upCode"><b>Код для загрузки.</b> Его выдаёт Дмитрий, браузер запомнит.</label>
      <div class="field-row"><input id="upCode" type="password" autocomplete="off"><button class="btn small" id="saveCode">Сохранить</button></div></div>`;
  } else {
    const F = S.files[k];
    if (F === undefined) { S.files[k] = null; loadFiles(it.id, pid); }
    files = !F ? '<p class="muted small">Загружаю список скринов…</p>'
      : F.err ? `<div class="note warn">${esc(F.err)}</div>`
      : F.length ? `<div class="shots">${F.map((f) => `<figure class="shot">${f.thumb ? `<img src="${f.thumb}" alt="">` : '<div class="noimg"><i data-lucide="image"></i></div>'}
          <figcaption><b>${f.w} дн</b>${f.age != null && +f.age !== +f.w ? ` <span class="age" title="Возраст поста, когда загрузили">посту ${f.age} дн</span>` : ''}<br>${esc(new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(f.at)))}
          <button class="icon-btn" data-del="${esc(f.key)}" title="Удалить скрин"><i data-lucide="trash-2"></i></button></figcaption></figure>`).join('')}</div>`
      : '';
    files += `<p class="muted small">Код сохранён в этом браузере. <button class="linkbtn" id="forgetCode">Забыть код</button></p>`;
  }
  return `<div class="blk" id="statsBlk"><h4>Статистика в ${esc(p.name)}</h4>
    <p class="muted small" style="margin:0">Скрины статистики этого поста. Сколько загружено, видят все.</p>
    ${S.upErr ? `<div class="note warn">Не вижу, что уже загружено: ${esc(S.upErr)}</div>` : ''}
    <div class="srows">${rows}</div>${S.busy ? `<p class="busy">${esc(S.busy)}</p>` : ''}${hint}${files}</div>`;
}
async function loadFiles(id, pid) {
  const k = `${id}|${pid}`;
  try { S.files[k] = (await Stats.call({ a: 'files', code: code(), post: id, p: pid })).files; }
  catch (e) { if (e.badCode) { forgetCode(); toast(e.message, true); } else S.files[k] = { err: e.message }; }
  if (S.sheet && S.sheet.id === id && S.sheet.pid === pid) renderSheet();
}
async function saveCode() {
  const c = ($('#upCode')?.value || '').trim();
  if (!c) return;
  try { await Stats.call({ a: 'check', code: c }); }
  catch (e) { return toast(e.message, true); }
  if (!set(CODE_KEY, c)) return toast('Этот браузер не хранит данные (приватное окно?): код не запомнится.', true);
  toast('Код сохранён'); renderSheet();
}
/* screenshots → JPEG: long side ≤ 2600 px and ≤ 1.9 MB (a request to the function holds 3.5 MB with base64), plus a small preview */
function loadImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error(`«${file.name}» не открывается как картинка. Нужен PNG или JPEG.`)); };
    im.src = u;
  });
}
function toJpeg(im, max, q) {
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', q));
}
const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
async function shrink(file) {
  const im = await loadImage(file);
  let max = 2600, q = 0.9, b = await toJpeg(im, max, q);
  while (b.size > 1.9e6 && max > 1200) { q > 0.6 ? (q -= 0.1) : (max -= 400); b = await toJpeg(im, max, q); }
  return { data: await b64(b), thumb: await b64(await toJpeg(im, 360, 0.7)) };
}
async function upload(files, w) {
  const { id, pid } = S.sheet, list = [...files];
  if (!list.length) return;
  let ok = 0;
  for (const f of list) {
    S.busy = `Загружаю ${ok + 1} из ${list.length}…`; renderSheet();
    try {
      const { data, thumb } = await shrink(f);
      await Stats.call({ a: 'upload', code: code(), post: id, p: pid, w: String(w), name: f.name, data, thumb });
      ok++;
    } catch (e) { if (e.badCode) forgetCode(); toast(e.message, true); break; }
  }
  S.busy = null; delete S.files[`${id}|${pid}`];
  await Stats.status();
  if (ok) toast(`Загружено: ${ok} ${plural(ok, 'скрин', 'скрина', 'скринов')}`);
  render(); if (S.sheet) renderSheet();
}
async function removeShot(key) {
  if (!confirm('Удалить этот скрин?')) return;
  const { id, pid } = S.sheet;
  try { await Stats.call({ a: 'delete', code: code(), key }); toast('Скрин удалён'); }
  catch (e) { if (e.badCode) forgetCode(); toast(e.message, true); }
  delete S.files[`${id}|${pid}`];
  await Stats.status(); render(); if (S.sheet) renderSheet();
}

/* ---------- render: rules ---------- */
function renderRules() {
  const R = S.plan.rules, C = S.plan.constants;
  const legend = `<div class="legend">
      <span class="pill">TT<span style="height:14px"></span></span> впереди
      <span class="pill today">TT<i data-lucide="clock"></i></span> сегодня
      <span class="pill late">TT<i data-lucide="alert-triangle"></i></span> просрочено
      <span class="pill done">TT<i data-lucide="check"></i></span> выложено
      <span class="pill off">TT<span>—</span></span> в этот день не выходит
      <span class="pill slot">TT<i data-lucide="circle-dashed"></i></span> пустой слот: ролика пока нет
      <span class="pill opt">LI<i data-lucide="plus"></i></span> по желанию</div>`;
  const cards = S.plan.platforms.map((p) => {
    const n = C.tagCount[p.id] || 0;
    return `<section class="rcard"><h3>${esc(p.name)}</h3><p class="acc">${esc(p.account)} · метка ссылки utm_source=${esc(p.utm)}</p>
      <ul class="rules">${(R.platforms[p.id] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="muted" style="margin:4px 0 0;font-size:13px">Хэштеги: ${n ? `${n} · ${esc(C.baseTags.join(' '))} + один под ролик` : 'без хэштегов'}</p></section>`;
  }).join('');
  $('#main').innerHTML = `<div class="rules-grid">
      <section class="rcard wide"><h3>Как устроен план</h3><p style="margin:0">${esc(S.plan.summary)}</p>
        <ul class="rules">${R.general.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${legend}
        <p class="muted" style="margin:0;font-size:13px">Призыв в каждой подписи, кроме LinkedIn: «${esc(C.cta)}»</p></section>
      ${cards}</div>`;
}

function render() {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === S.view));
  if (S.view === 'rules') renderRules(); else if (S.view === 'stats') renderStats(); else renderPlan();
  window.lucide && lucide.createIcons();
}

/* ---------- sheet: one day × one platform ---------- */
function openSheet(id, pid, toStats = false) {
  const it = itemById(id); if (!it) return;
  if (!pid || !plats(it).includes(pid)) pid = (S.filter !== 'all' && it.platforms.includes(S.filter)) ? S.filter : (it.platforms.find((p) => !isDone(it, p)) || it.platforms[0]);
  S.sheet = { id, pid };
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSheet();
  $('.sheet').scrollTop = 0;
  if (toStats) $('#statsBlk')?.scrollIntoView({ block: 'start' });
}
function closeSheet() { S.sheet = null; $('#sheetWrap').hidden = true; document.body.style.overflow = ''; }
function renderSheet() {
  const { id, pid } = S.sheet, it = itemById(id), v = videoOf(it), p = plat(pid), st = S.status[id]?.[pid];
  const loc = localTime(it.date);
  const tabs = plats(it).map((q) => `<button class="ptab${q === pid ? ' on' : ''}" data-p="${q}"><span class="dot ${pState(it, q)}"></span>${esc(lab(q))}</button>`).join('');
  const parts = [];
  if (it.video) {
    parts.push(v && v.file
      ? `<div class="blk"><h4>Видео</h4><div class="video"><div class="poster" id="poster"><i data-lucide="film"></i></div>
          <div class="vid-actions"><a class="btn primary" id="dl" href="${esc(Data.url(v.file))}" download="Playmar_${esc(it.date)}_${esc(it.video)}.mp4"><i data-lucide="download"></i>Скачать видео</a>
          <button class="btn small" id="pv"><i data-lucide="play"></i>Посмотреть</button>
          <span class="muted" style="font-size:13px">${esc(it.video)} · MP4 9:16 · звук в файле</span></div></div></div>`
      : `<div class="blk"><h4>Видео</h4><div class="note warn">Ролик ещё делаем. Он появится здесь, когда будет готов. Нет его в свой день — пропустите слот и напишите Дмитрию.</div></div>`);
  } else parts.push('<div class="blk"><h4>Картинка</h4><div class="note warn">Картинка придёт вместе с текстом.</div></div>');
  if (isOpt(it, pid)) parts.push(`<div class="blk"><div class="note">${esc(p.name)} для этого ролика — по желанию. Выложили — отметьте ниже.</div></div>`);
  const F = fields(it, pid);
  if (F) {
    F.forEach((f, i) => {
      const len = [...f.text].length;
      let cnt = '';
      if (f.limit) cnt = `<span class="cnt${len > f.limit ? ' over' : ''}">${len} / ${f.limit}</span>`;
      else if (f.first) { const fl = [...f.text.split('\n')[0]].length; cnt = `<span class="cnt${fl > f.first ? ' over' : ''}">первая строка: ${fl} из ${f.first} видимых знаков</span>`; }
      parts.push(`<div class="blk"><h4>${esc(f.label)}${cnt}</h4><div class="field${f.big ? ' big' : ''}">${esc(f.text)}</div>
        <div class="field-row"><button class="btn small" data-copy="${i}"><i data-lucide="copy"></i>Скопировать ${esc(f.label.toLowerCase())}</button></div></div>`);
    });
  } else {
    const why = pid === 'li' ? 'Текст для LinkedIn пишем. Он появится здесь.' : 'Подпись появится здесь вместе с роликом.';
    parts.push(`<div class="blk"><h4>${pid === 'li' ? 'Текст поста' : 'Подпись'}</h4><div class="note warn">${why}</div></div>`);
  }
  if (it.notes && it.notes.length) parts.push(`<div class="blk"><h4>На этот день</h4>${it.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>`);
  parts.push(`<div class="blk"><h4>Перед публикацией в ${esc(p.name)}</h4><ul class="rules">${(S.plan.rules.platforms[pid] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  if (st && st.done) {
    const when = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(st.at));
    parts.push(`<div class="status done"><div class="who"><b>Выложено в ${esc(p.name)}</b> · отмечено ${esc(when)}</div>
      ${st.url ? `<a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.url)}</a>` : '<span class="muted">Ссылку не сохранили.</span>'}
      <div><button class="btn small" id="untick">Снять отметку</button></div></div>`);
  } else {
    parts.push(`<div class="status"><label class="who" for="postUrl"><b>Пост в ${esc(p.name)} вышел?</b> Вставьте ссылку на пост (можно без неё) и отметьте.</label>
      <input id="postUrl" type="url" placeholder="https://…" autocomplete="off">
      <div><button class="btn primary" id="tick"><i data-lucide="check"></i>Выложено в ${esc(p.name)}</button></div>
      <p class="muted keep">Галочки хранятся только в этом браузере.</p></div>`);
  }
  const stats = statsHTML(it, pid);
  if (stats) parts.push(stats);
  $('#sheet').innerHTML = `<div class="sh-head"><div class="sh-row"><div><span class="muted">${fmtDate(it.date)}, ${esc(S.plan.time)} по Лондону${loc ? ` · ${esc(loc)}` : ''}</span>
      <h3 id="sheetTitle">${esc(itemTitle(it))}</h3><span class="muted">${esc(gameLine(it))}</span></div>
      <button class="icon-btn" data-close title="Закрыть"><i data-lucide="x"></i></button></div><div class="ptabs">${tabs}</div></div>
    <div class="sh-body">${parts.join('')}</div>`;
  window.lucide && lucide.createIcons();
  if (v && v.poster) { const el = $('#poster'); el.style.backgroundImage = `url("${Data.url(v.poster)}")`; el.innerHTML = ''; }
  S.sheetFields = F;
}

function mark(done) {
  const { id, pid } = S.sheet, p = plat(pid);
  if (!done && !confirm(`Снять отметку для ${p.name}?`)) return;
  const url = done ? ($('#postUrl')?.value || '').trim() : '';
  S.status = Data.save((st) => {
    if (done) (st[id] = st[id] || {})[pid] = { done: true, at: new Date().toISOString(), ...(url ? { url } : {}) };
    else if (st[id]) { delete st[id][pid]; if (!Object.keys(st[id]).length) delete st[id]; }
  });
  if (!S.kept) toast('Этот браузер не хранит галочки (приватное окно?). Они пропадут, когда закроете вкладку.', true);
  else toast(done ? `Отмечено: ${p.name}` : `Отметка снята: ${p.name}`);
  render(); if (S.sheet) renderSheet();
}

function preview() {
  const v = videoOf(itemById(S.sheet.id)), el = $('#poster');
  el.style.backgroundImage = ''; el.innerHTML = `<video src="${esc(Data.url(v.file))}" controls autoplay playsinline></video>`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Скопировано');
}

/* ---------- misc ---------- */
let toastT;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), bad ? 6000 : 2200); }
function savePrefs() { set(PREF_KEY, JSON.stringify({ view: S.view, filter: S.filter, hideDone: S.hideDone, todoOnly: S.todoOnly })); }
function loadPrefs() { try { Object.assign(S, JSON.parse(get(PREF_KEY) || '{}')); } catch (e) { /* defaults */ } }

async function start() {
  S.plan = await Data.plan(); S.status = Data.status();
  if (S.filter !== 'all' && !S.plan.platforms.some((p) => p.id === S.filter)) S.filter = 'all';
  render();
  await Promise.all([Stats.status(), Stats.numbers()]);
  render(); if (S.sheet && !S.busy) renderSheet();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) return closeSheet();
  const tab = t.closest('.tab'); if (tab) { S.view = tab.dataset.view; savePrefs(); return render(); }
  const chip = t.closest('.chip'); if (chip) { S.filter = chip.dataset.f; savePrefs(); return render(); }
  const ptab = t.closest('.ptab'); if (ptab) { S.sheet.pid = ptab.dataset.p; renderSheet(); $('.sheet').scrollTop = 0; return; }
  const sp = t.closest('[data-stats]'); if (sp) return openSheet(sp.dataset.stats, sp.dataset.p, true);
  const pill = t.closest('.pill[data-id]'); if (pill) return openSheet(pill.dataset.id, pill.dataset.p);
  const nx = t.closest('.next[data-id]'); if (nx) return openSheet(nx.dataset.id, nx.dataset.p);
  const card = t.closest('.card'); if (card) return card.classList.contains('slot') ? undefined : openSheet(card.dataset.id);
  const cp = t.closest('[data-copy]'); if (cp) return copyText(S.sheetFields[+cp.dataset.copy].text);
  if (t.closest('#tick')) return mark(true);
  if (t.closest('#untick')) return mark(false);
  if (t.closest('#pv')) return preview();
  if (t.closest('#saveCode')) return saveCode();
  if (t.closest('#forgetCode')) { forgetCode(); return renderSheet(); }
  const del = t.closest('[data-del]'); if (del) return removeShot(del.dataset.del);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'hideDone') { S.hideDone = e.target.checked; savePrefs(); render(); }
  if (e.target.id === 'todoOnly') { S.todoOnly = e.target.checked; savePrefs(); render(); }
  if (e.target.dataset && e.target.dataset.up) upload(e.target.files, +e.target.dataset.up);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'upCode') return saveCode();
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) openSheet(e.target.dataset.id);
});
/* ticks made in another tab of this browser */
window.addEventListener('storage', (e) => { if (e.key === TICKS_KEY && S.plan) { S.status = Data.status(); render(); if (S.sheet) renderSheet(); } });

loadPrefs();
start().catch((e) => { $('#main').innerHTML = `<p class="empty">${esc(e.message || 'План не загрузился. Обновите страницу.')}</p>`; });
