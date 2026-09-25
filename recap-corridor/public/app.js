/* ==========================================================================
   RÉCAP CORRIDOR — INTERFACE
   ========================================================================== */
import * as E from './engine.js';
import { buildXlsx } from './xlsx.js';

const { JS, JN, CODEL, r2, agg, modeVal, groupBy, mergeAcrossWeeks, personKey, deacc, slug } = E;

/* ------------------------------------------------------------ formatage */
const nf = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const nfa = (n) => nf(n, Number.isInteger(n) ? 0 : (Math.abs(n) < 10 ? 2 : 1));
const fmtH = (h) => h == null || isNaN(h) ? '—' : `${Math.floor(h)}h${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`.replace(/h60$/, 'h00');
const dISO = (s) => { const d = new Date(s); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const dFull = (s) => { const d = new Date(s); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const dtISO = (s) => { const d = new Date(s); return `${dISO(s)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const hm = (s) => { const d = new Date(s); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const weekLabel = (m) => `S${String(m.week).padStart(2, '0')} ${m.year}`;
const weekRange = (m) => `${dISO(m.monday)} → ${dISO(m.sunday)}`;
const taille = (o) => o == null ? '' : o > 1048576 ? `${nf(o / 1048576, 1)} Mo` : `${nf(o / 1024, 0)} Ko`;
const el = (id) => document.getElementById(id);

/* Mesures : libellé, format, unité */
const M = {
  nbAgents: { l: 'Agents', f: nfa },
  joursService: { l: 'Jours de service', c: 'J. service', f: nfa },
  heuresPlanifiees: { l: 'Heures planifiées', c: 'H. planifiées', f: fmtH },
  heuresSup: { l: 'Heures supplémentaires', c: 'H. sup', f: fmtH },
  nbRHR: { l: 'Repos hors résidence', c: 'RHR', f: nfa },
  rhrHeures: { l: 'Temps en RHR', c: 'Temps RHR', f: fmtH },
  rhrNuits: { l: 'Nuits hors résidence', c: 'Nuits HR', f: nfa },
  journeesBlanches: { l: 'Journées blanches', c: 'J. blanches', f: nfa },
  nbMissions: { l: 'Missions', f: nfa },
  nbTrajetsSeuls: { l: 'Trajets seuls', f: nfa },
  nbMHIS: { l: 'MHIS', f: nfa },
  nbDISPO: { l: 'DISPO', f: nfa },
  nbATCMD: { l: 'ATCMD', f: nfa },
  heuresNuit: { l: 'Heures de nuit', c: 'H. nuit', f: fmtH },
  heuresDimanche: { l: 'Heures du dimanche', c: 'H. dimanche', f: fmtH },
  nbPaniers: { l: 'Paniers repas', c: 'Paniers', f: nfa },
  weekendTravaille: { l: 'Jours de week-end', c: 'J. week-end', f: nfa },
  joursRepos: { l: 'Repos (RP)', c: 'RP', f: nfa },
  joursCP: { l: 'Congés', f: nfa },
  joursAbsence: { l: 'Absences', f: nfa },
};
/* Les cinq mesures des statistiques */
const KEY = ['nbRHR', 'journeesBlanches', 'nbMissions', 'nbTrajetsSeuls', 'heuresPlanifiees'];
const MODES = [['total', 'Totaux'], ['semaine', 'Par semaine'], ['agent', 'Par agent']];
const modeSuffix = () => ({ total: '', semaine: ' / semaine', agent: ' / agent' }[S.mode]);

/* ---------------------------------------------------------------- API */
const LSK = 'recap-corridor-v2';
const api = {
  code: '',
  async call(path, opt = {}) {
    const r = await fetch('/api/' + path, {
      ...opt, headers: { ...(opt.headers || {}), 'x-acces': api.code, ...(opt.body ? { 'content-type': 'application/json' } : {}) },
    });
    let d = null; try { d = await r.json(); } catch (e) { /* réponse non JSON */ }
    if (!r.ok) throw Object.assign(new Error((d && d.error) || `Erreur ${r.status}`), { status: r.status });
    return d;
  },
  session: () => api.call('session'),
  etat: () => api.call('etat'),
  donnees: () => api.call('donnees'),
  save: (resume, details, restauration = false) => api.call('semaine', { method: 'PUT', body: JSON.stringify({ resume, details, restauration }) }),
  del: (id) => api.call('semaine?id=' + encodeURIComponent(id), { method: 'DELETE' }),
  regles: (r) => api.call('regles', { method: 'PUT', body: JSON.stringify(r) }),
};

/* --------------------------------------------------------------- état */
const S = {
  role: null, tab: 'synthese', weeks: [], rules: { ...E.DEFAULT_RULES },
  selWeek: '__all__', selAgences: null, selMetiers: null, search: '', mode: 'total',
  statMetric: 'nbRHR', topN: 25,
  parsed: new Map(), computed: new Map(),
  queue: [], busy: false, err: null, msg: null, delAsk: null, loading: false,
  sorts: {}, drawer: null, scopeOpen: false,
  cols: { identite: true, activite: true, temps: true, rhr: true, paniers: true, absences: true },
};
const prefs = () => { try { return JSON.parse(localStorage.getItem(LSK) || '{}'); } catch (e) { return {}; } };
function savePrefs() {
  try {
    localStorage.setItem(LSK, JSON.stringify({ code: api.code, selAgences: S.selAgences, selMetiers: S.selMetiers, tab: S.tab,
      mode: S.mode, statMetric: S.statMetric, cols: S.cols, theme: document.documentElement.dataset.theme || '' }));
  } catch (e) { /* stockage indisponible */ }
}

const allAgences = () => [...new Set([...S.computed.values()].flatMap((w) => w.agents.map((a) => a.agence)))].sort();
const allMetiers = () => [...new Set([...S.computed.values()].flatMap((w) => w.agents.map((a) => a.metier)))].sort();
const scopeAgences = () => S.selAgences || allAgences();
const scopeMetiers = () => S.selMetiers || allMetiers();
const activeWeeks = () => S.selWeek === '__all__' ? S.weeks.map((w) => w.weekId) : [S.selWeek];
const SER = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
const agenceColor = (ag) => { const sc = scopeAgences(); const i = sc.indexOf(ag); return sc.length <= 8 && i >= 0 ? `var(${SER[i]})` : 'var(--s1)'; };

function computeAll() {
  S.computed = new Map();
  for (const [id, p] of [...S.parsed.entries()].sort()) {
    const v = E.applyRules(p, S.rules);
    v.agents.forEach((a) => { a.weekId = id; });
    S.computed.set(id, v);
  }
  E.reconcile(S.computed, S.rules);
}
/** Lignes agent-semaine du périmètre courant */
function scopeRows(opts = {}) {
  const weeks = opts.allWeeks ? S.weeks.map((w) => w.weekId) : activeWeeks();
  const ags = new Set(scopeAgences()), mets = new Set(scopeMetiers());
  const q = S.search ? deacc(S.search).toLowerCase() : '';
  const out = [];
  for (const id of weeks) {
    const w = S.computed.get(id); if (!w) continue;
    for (const a of w.agents) {
      if (!ags.has(a.agence) || !mets.has(a.metier)) continue;
      if (q && !deacc(`${a.nom} ${a.prenom} ${a.matricule}`).toLowerCase().includes(q)) continue;
      out.push(a);
    }
  }
  return out;
}

/* ------------------------------------------------------------ graphiques */
let TIP = null;
function tipShow(html, x, y) {
  if (!TIP) { TIP = document.createElement('div'); TIP.className = 'tip'; document.body.appendChild(TIP); }
  TIP.innerHTML = html; TIP.hidden = false;
  const r = TIP.getBoundingClientRect();
  TIP.style.left = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8) + 'px';
  TIP.style.top = Math.max(8, y - r.height - 12) + 'px';
}
const tipHide = () => { if (TIP) TIP.hidden = true; };
const niceStep = (m) => { const raw = m / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

function barChart(items, opts = {}) {
  if (!items.length) return '<p class="mut sm">Aucune donnée sur ce périmètre.</p>';
  const max = Math.max(1e-9, ...items.map((i) => i.v));
  const f = opts.fmt || nfa;
  const avg = opts.avg != null ? opts.avg : null;
  return `<div class="bars">${items.map((i) => `
    <div class="bar" data-tip="${esc(`<b>${esc(i.l)}</b><span class="tr"><span>${esc(opts.label || 'Valeur')}</span><b>${f(i.v)}</b></span>${i.sub ? `<span class="tr"><span>${esc(i.subL || '')}</span><b>${esc(i.sub)}</b></span>` : ''}`)}">
      <span class="bl">${i.dot ? `<i class="cdot" style="background:${i.dot}"></i>` : ''}${esc(i.l)}</span>
      <span class="bt">${avg != null ? `<em style="left:${(avg / max * 100).toFixed(1)}%"></em>` : ''}<i style="width:${Math.max(0, i.v / max * 100).toFixed(1)}%;background:${i.c || 'var(--s1)'}"></i></span>
      <span class="bv">${f(i.v)}</span></div>`).join('')}</div>
    ${avg != null ? `<p class="hint">Trait vertical : moyenne (${f(avg)}).</p>` : ''}`;
}
function lineChart(series, labels, fmt) {
  if (!labels.length || !series.length) return '<p class="mut sm">Pas encore assez de semaines pour tracer une évolution.</p>';
  const W = 720, Hh = 230, ml = 52, mr = 60, mt = 14, mb = 28;
  const maxV = Math.max(1e-9, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const step = niceStep(maxV), top = Math.ceil(maxV / step) * step || step;
  const X = (i) => ml + (labels.length === 1 ? (W - ml - mr) / 2 : i * (W - ml - mr) / (labels.length - 1));
  const Y = (v) => mt + (1 - v / top) * (Hh - mt - mb);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step)
    g += `<line class="grid-l" x1="${ml}" y1="${Y(v).toFixed(1)}" x2="${W - mr}" y2="${Y(v).toFixed(1)}"/><text class="cv" x="${ml - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt === fmtH ? Math.round(v) + 'h' : nf(v, step < 1 ? 1 : 0)}</text>`;
  const every = Math.ceil(labels.length / 12);
  labels.forEach((l, i) => { if (i % every && i !== labels.length - 1) return; g += `<text class="ct" x="${X(i).toFixed(1)}" y="${Hh - 9}" text-anchor="middle">${esc(l)}</text>`; });
  let p = '';
  series.forEach((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean);
    if (!pts.length) return;
    p += `<path d="${pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((q) => { p += `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.2" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`; });
    const last = pts[pts.length - 1];
    p += `<text class="cvb" x="${(last[0] + 8).toFixed(1)}" y="${(last[1] + 4).toFixed(1)}">${esc(s.short)}</text>`;
  });
  let hz = '';
  const w = (W - ml - mr) / Math.max(1, labels.length - 1);
  labels.forEach((l, i) => {
    const rows = series.map((s) => ({ n: s.name, c: s.color, v: s.values[i] })).filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    hz += `<rect class="hovz" x="${(X(i) - w / 2).toFixed(1)}" y="${mt}" width="${w.toFixed(1)}" height="${Hh - mt - mb}" data-tip="${esc(`<b>${esc(l)}</b>` + rows.map((r) => `<span class="tr"><span><i class="cdot" style="background:${r.c}"></i>${esc(r.n)}</span><b>${(fmt || nfa)(r.v)}</b></span>`).join(''))}"/>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${Hh}" role="img">${g}<line class="axis-l" x1="${ml}" y1="${mt}" x2="${ml}" y2="${Hh - mb}"/>${p}${hz}</svg></div>`;
}

/* ---------------------------------------------------- tableau triable */
/**
 * cols : [{k, l, cls, v:(r)=>valeur de tri, f:(r)=>html, g:groupe}]
 * Le tri est mémorisé par tableau dans S.sorts[id].
 */
function table(id, cols, rows, opts = {}) {
  const st = S.sorts[id] || opts.sort || { k: cols[0].k, dir: 'asc' };
  const col = cols.find((c) => c.k === st.k) || cols[0];
  const val = (r) => (col.v ? col.v(r) : r[col.k]);
  const sorted = [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const r = (typeof x === 'number' || typeof y === 'number') ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? '').localeCompare(String(y ?? ''), 'fr');
    return st.dir === 'asc' ? r : -r;
  });
  const groups = [];
  if (opts.groups) { let cur = null; for (const c of cols) { if (!cur || cur.g !== c.g) { cur = { g: c.g, n: 0 }; groups.push(cur); } cur.n++; } }
  const foot = opts.foot ? `<tr class="tot">${cols.map((c, i) => `<td class="${c.cls || ''}${i === 0 && opts.sticky ? ' st' : ''}">${opts.foot(c) ?? ''}</td>`).join('')}</tr>` : '';
  if (opts.onRow) S['rows_' + id] = sorted;
  return `<div class="tw${opts.tall ? ' tall' : ''}"><table class="${opts.sticky ? 'sticky1' : ''}${opts.groups ? ' hasgrp' : ''}">
    <thead>${opts.groups ? `<tr class="grp">${groups.map((g) => `<th colspan="${g.n}" class="l">${esc(opts.groups[g.g] || '')}</th>`).join('')}</tr>` : ''}
    <tr>${cols.map((c, i) => `<th class="s ${c.cls || ''}${i === 0 && opts.sticky ? ' st' : ''}" data-sort="${id}|${c.k}"${st.k === c.k ? ` data-dir="${st.dir}"` : ''} title="Trier">${esc(c.l)}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((r, ri) => `<tr${opts.onRow ? ` class="clk" data-row="${id}|${ri}"` : ''}>${cols.map((c, i) => `<td class="${c.cls || ''}${i === 0 && opts.sticky ? ' st' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')}${foot}</tbody>
  </table></div>`;
}
const zero = (v, f = nfa) => (!v ? '<span class="z">0</span>' : f(v));

/* ---------------------------------------------------------------- vues */
const TABS = [
  ['synthese', 'Synthèse'], ['stats', 'Statistiques'], ['agents', 'Agents'], ['rhr', 'Repos hors résidence'],
  ['blanches', 'Journées blanches'], ['exports', 'Exports'], ['import', 'Import'], ['reglages', 'Réglages'],
];
function renderTabs() {
  const sc = scopeRows();
  const cnt = { agents: new Set(sc.map(personKey)).size, rhr: sc.reduce((s, a) => s + a.nbRHR, 0), blanches: sc.reduce((s, a) => s + a.journeesBlanches, 0), import: S.weeks.length };
  el('tabs').innerHTML = TABS.filter(([k]) => S.role === 'admin' || !['import', 'reglages'].includes(k))
    .map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${cnt[k] != null && S.weeks.length ? `<span class="cnt">${nf(cnt[k])}</span>` : ''}</button>`).join('');
}
function renderFilters() {
  if (!S.weeks.length) { el('filters').innerHTML = ''; return; }
  const ags = allAgences(), mets = allMetiers(), selA = scopeAgences(), selM = scopeMetiers();
  const resume = `${selA.length === ags.length ? 'Toutes les agences' : selA.length <= 2 ? selA.join(' + ') : selA.length + ' agences'} · ${selM.length === mets.length ? 'tous métiers' : selM.join(', ')}`;
  el('filters').innerHTML = `
    <div class="fbar">
      <label class="fld"><span class="flabel">Semaine</span>
        <select id="fWeek"><option value="__all__"${S.selWeek === '__all__' ? ' selected' : ''}>Toutes — ${S.weeks.length} semaine${S.weeks.length > 1 ? 's' : ''}</option>
        ${S.weeks.map((w) => `<option value="${w.weekId}"${S.selWeek === w.weekId ? ' selected' : ''}>${weekLabel(w)} · ${weekRange(w)}</option>`).join('')}</select></label>
      <div class="fld"><span class="flabel">Périmètre</span>
        <button class="sel" id="scopeBtn" aria-expanded="${S.scopeOpen}">${esc(resume)}<span class="car">▾</span></button></div>
      <label class="fld"><span class="flabel">Agent</span><input type="search" id="fSearch" placeholder="Nom ou matricule" value="${esc(S.search)}"></label>
      <div class="fld"><span class="flabel">Affichage</span>
        <div class="seg">${MODES.map(([k, l]) => `<button class="sg" data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join('')}</div></div>
      <div class="fld grow"></div>
      <div class="fld"><span class="flabel">&nbsp;</span><span class="badge">${S.role === 'admin' ? 'Accès complet' : 'Lecture seule'}</span></div>
    </div>
    ${S.scopeOpen ? `<div class="scope">
      <div class="sgrp"><span class="flabel">Agences</span><div class="frow">
        ${ags.map((a) => `<button class="chip" data-ag="${esc(a)}" aria-pressed="${selA.includes(a)}">${esc(a)}</button>`).join('')}
        <button class="chip chip-mini" id="agAll">Toutes</button>
        ${['Hendaye', 'Bordeaux-St-Jean'].every((x) => ags.includes(x)) ? '<button class="chip chip-mini" id="agHeBx">Hendaye + Bordeaux</button>' : ''}</div></div>
      <div class="sgrp"><span class="flabel">Métiers</span><div class="frow">
        ${mets.map((m) => `<button class="chip" data-me="${esc(m)}" aria-pressed="${selM.includes(m)}">${esc(m)}</button>`).join('')}
        <button class="chip chip-mini" id="meAll">Tous</button></div></div></div>` : ''}`;
}
function modeNote() {
  if (S.mode === 'semaine') return `Valeurs moyennes par semaine sur ${activeWeeks().length} semaine${activeWeeks().length > 1 ? 's' : ''}.`;
  if (S.mode === 'agent') return "Valeurs moyennes par agent et par semaine. Pour le RHR, la moyenne ne porte que sur les agents qui en ont eu au moins un : les AFR et les agents sans RHR n'y entrent pas.";
  return '';
}
function legacyBanner(rows) {
  const leg = [...new Set(rows.filter((a) => a.legacy).map((a) => a.weekId))];
  if (!leg.length) return '';
  return `<div class="note w"><b>${leg.length} semaine${leg.length > 1 ? 's' : ''} importée${leg.length > 1 ? 's' : ''} avant la mise à jour</b> (${leg.map((w) => w.replace(/^\d+-/, '')).join(', ')}) : l'horaire des pauses n'y était pas conservé. Heures planifiées et heures sup sont exactes ; heures de nuit, heures du dimanche et paniers y comptent les pauses, marqués « ≈ ». ${S.role === 'admin' ? 'Réimportez ces fichiers dans l\'onglet Import pour les rendre exacts.' : ''}</div>`;
}

function kpis(g, rows) {
  const sfx = modeSuffix();
  const multi = activeWeeks().length > 1 && S.mode === 'total';
  const perW = (k, f) => (multi ? `<span class="pw">${f(modeVal(g, k, 'semaine'))} / sem.</span>` : '');
  const t = (k) => modeVal(g, k, S.mode);
  const leg = rows.some((a) => a.legacy) ? '<span class="approx" title="Pauses non localisées sur les semaines importées avant la mise à jour">≈</span>' : '';
  return `<div class="kpis">
    <div class="kpi"><div class="k">Agents</div><div class="v">${nfa(t('nbAgents'))}</div><div class="n">${nf(g.joursService)} jours de service</div></div>
    <div class="kpi"><div class="k">Heures planifiées${sfx}</div><div class="v">${fmtH(t('heuresPlanifiees'))}</div><div class="n">${fmtH(g.heuresParJS)} par jour de service ${perW('heuresPlanifiees', fmtH)}</div></div>
    <div class="kpi hot-sup${g.heuresSup ? ' hot' : ''}"><div class="k">Heures sup${sfx}</div><div class="v">${fmtH(t('heuresSup'))}</div><div class="n">${nf(g.agentsHeuresSup)} agent${g.agentsHeuresSup > 1 ? 's' : ''} au-delà de ${S.rules.seuilHebdo} h ${perW('heuresSup', fmtH)}</div></div>
    <div class="kpi${g.nbRHR ? ' hot' : ''}"><div class="k">RHR${sfx}</div><div class="v">${nfa(t('nbRHR'))}</div><div class="n">${nf(g.agentsAvecRHR)} agent${g.agentsAvecRHR > 1 ? 's' : ''} · ${fmtH(g.tempsRHRParAgent)} par agent ${perW('nbRHR', nfa)}</div></div>
    <div class="kpi"><div class="k">Journées blanches${sfx}</div><div class="v">${nfa(t('journeesBlanches'))}</div><div class="n">${nf(new Set(rows.filter((a) => a.journeesBlanches).map(personKey)).size)} agent(s) concerné(s)</div></div>
    <div class="kpi"><div class="k">Missions${sfx}</div><div class="v">${nfa(t('nbMissions'))}</div><div class="n">dont ${nfa(t('nbTrajetsSeuls'))} trajets seuls ${perW('nbMissions', nfa)}</div></div>
    <div class="kpi"><div class="k">Paniers repas${sfx}</div><div class="v">${nfa(t('nbPaniers'))}${leg}</div><div class="n">${nf(g.ratioPanierJS, 2)} par jour de service travaillé</div></div>
    <div class="kpi"><div class="k">Heures de nuit${sfx}</div><div class="v">${fmtH(t('heuresNuit'))}${leg}</div><div class="n">hors pauses · dimanche ${fmtH(t('heuresDimanche'))}</div></div>
  </div>`;
}

/* colonnes « agence × métier », réutilisées par la synthèse et l'export */
function aggCols(mode) {
  const mv = (k) => (r) => modeVal(r.g, k, mode);
  const num = (k, f = nfa) => ({ k, l: M[k].c || M[k].l, v: mv(k), f: (r) => zero(mv(k)(r), f) });
  return [
    { k: 'agence', l: 'Agence', cls: 'l nm', v: (r) => r.agence, f: (r) => esc(r.agence) },
    { k: 'metier', l: 'Métier', cls: 'l', v: (r) => r.metier, f: (r) => esc(r.metier) },
    { k: 'nbAgents', l: 'Agents', v: (r) => r.g.nbAgents, f: (r) => nf(r.g.nbAgents) },
    num('joursService'), num('heuresPlanifiees', fmtH), num('heuresSup', fmtH),
    { k: 'nbRHR', l: 'RHR', v: mv('nbRHR'), f: (r) => (r.sansRHR ? '<span class="z">n/a</span>' : zero(mv('nbRHR')(r))) },
    { k: 'agentsAvecRHR', l: 'Agents RHR', v: (r) => r.g.agentsAvecRHR, f: (r) => (r.sansRHR ? '<span class="z">n/a</span>' : zero(r.g.agentsAvecRHR)) },
    { k: 'tempsRHRParAgent', l: 'Temps RHR / agent', v: (r) => r.g.tempsRHRParAgent, f: (r) => (r.sansRHR ? '<span class="z">n/a</span>' : zero(r.g.tempsRHRParAgent, fmtH)) },
    num('journeesBlanches'), num('nbMissions'), num('nbTrajetsSeuls'), num('nbMHIS'), num('nbDISPO'), num('nbATCMD'),
    num('heuresNuit', fmtH), num('heuresDimanche', fmtH), num('nbPaniers'),
    { k: 'ratioPanierJS', l: 'Panier / JS', v: (r) => r.g.ratioPanierJS, f: (r) => nf(r.g.ratioPanierJS, 2) },
    num('joursRepos'), num('joursCP'), num('joursAbsence'),
  ];
}
function viewSynthese() {
  const rows = scopeRows(); if (!rows.length) return emptyScope();
  const g = agg(rows);
  const groups = [...groupBy(rows, (a) => a.agence + '||' + a.metier)].map(([k, l]) => { const [agence, metier] = k.split('||'); return { agence, metier, g: agg(l), sansRHR: !l.some((x) => x.rhrApplicable) }; });
  const cols = aggCols(S.mode);
  const vig = rows.filter((a) => a.jamaisEnResidence), warn = rows.filter((a) => a.warnings.length), fus = rows.filter((a) => a.fusion);
  const hc = rows.filter((a) => a.nbHorsColonne > 0), nHC = hc.reduce((s, a) => s + a.nbHorsColonne, 0);
  return `${legacyBanner(rows)}
  ${modeNote() ? `<div class="note">${modeNote()}</div>` : ''}
  ${kpis(g, rows)}
  <section class="card"><div class="card-h"><div><h2>Par agence et corps de métier</h2><p class="card-s">cliquez un en-tête pour trier · ${MODES.find((m) => m[0] === S.mode)[1].toLowerCase()}</p></div>
    <button class="btn btn-sm" data-goto="exports">Exporter</button></div>
    <div class="card-b">${table('synth', cols, groups, { sticky: true, sort: { k: 'agence', dir: 'asc' },
      foot: (c) => c.k === 'agence' ? 'Total' : c.k === 'metier' ? '' : c.f ? c.f({ agence: '', metier: '', g }) : '' })}</div></section>
  ${(vig.length || warn.length || fus.length || hc.length) ? `<section class="card"><div class="card-h"><h2>Points de vigilance</h2></div><div class="card-b stack tight">
    ${hc.length ? `<div class="note w"><b>${nf(nHC)} mission${nHC > 1 ? 's' : ''} datée${nHC > 1 ? 's' : ''} hors de leur colonne ${S.rules.horsColonne === 'garder' ? 'comptée' + (nHC > 1 ? 's' : '') + ' telle' + (nHC > 1 ? 's' : '') + ' quelle' + (nHC > 1 ? 's' : '') : (nHC > 1 ? 'écartées' : 'écartée') + ' des calculs'}</b> — la date écrite dans la case ne correspond pas au jour de la colonne (par exemple une mission du 29/08 dans la colonne du lundi 31/08). Il s'agit le plus souvent de lignes d'une autre semaine recopiées dans le fichier. ${hc.slice(0, 6).map((a) => `${esc(a.nom)} ${esc(a.prenom)} (${a.weekId.replace(/^\d+-/, '')}, ${a.nbHorsColonne})`).join(' · ')}${hc.length > 6 ? ' …' : ''} <button class="btn btn-sm" data-goto="reglages">Règle</button></div>` : ''}
    ${fus.length ? `<div class="note"><b>${fus.length} agent${fus.length > 1 ? 's' : ''}-semaine${fus.length > 1 ? 's' : ''} apparaissai${fus.length > 1 ? 'en' : ''}t sur plusieurs lignes du fichier</b> et ${fus.length > 1 ? 'ont été fusionnés' : 'a été fusionné'} jour par jour : un service l'emporte sur un code, deux services différents le même jour sont comptés tous les deux. ${fus.slice(0, 6).map((a) => `${esc(a.nom)} ${esc(a.prenom)} (${a.weekId.replace(/^\d+-/, '')}, ${a.fusion.lignes} lignes)`).join(' · ')}${fus.length > 6 ? ' …' : ''}</div>` : ''}
    ${vig.length ? `<div class="note w"><b>${vig.length} agent(s) ne passent jamais par la résidence de leur agence</b> : ${vig.slice(0, 8).map((a) => `${esc(a.nom)} (${esc(a.agence)}, résidence ${esc(a.residence)})`).join(' · ')}. Vérifiez la résidence dans les Réglages.</div>` : ''}
    ${warn.length ? `<div class="note"><b>${warn.length} reprise(s) de service ailleurs que la fin du service précédent</b> : ${warn.slice(0, 6).map((a) => `${esc(a.nom)} (${esc(a.warnings[0])})`).join(' · ')}${warn.length > 6 ? ' …' : ''}</div>` : ''}
  </div></section>` : ''}`;
}

function viewStats() {
  let rows = scopeRows(); if (!rows.length) return emptyScope();
  const k = S.statMetric, m = M[k], f = m.f;
  const lab = m.l + modeSuffix();
  if (k === 'nbRHR') rows = rows.filter((x) => x.rhrApplicable);   // les AFR n'entrent pas dans les statistiques RHR
  const byAg = [...groupBy(rows, (a) => a.agence)].map(([l, list]) => ({ l, v: modeVal(agg(list), k, S.mode), c: agenceColor(l), sub: nf(agg(list).nbAgents) + ' agents', subL: 'Effectif' })).sort((a, b) => b.v - a.v);
  const byMe = [...groupBy(rows, (a) => a.metier)].map(([l, list]) => ({ l, v: modeVal(agg(list), k, S.mode), sub: nf(agg(list).nbAgents) + ' agents', subL: 'Effectif' })).sort((a, b) => b.v - a.v);
  // répartition par agent : une ligne par personne
  const persons = mergeAcrossWeeks(rows).filter((p) => k !== 'nbRHR' || p.nbRHR > 0);
  const pv = (p) => (S.mode === 'total' ? p[k] : r2(p[k] / (p.nbSemaines || 1)));
  const pers = persons.map((p) => ({ l: `${p.nom} ${p.prenom.slice(0, 1)}.`, v: pv(p), c: agenceColor(p.agence), dot: null, sub: p.agence + ' · ' + p.metier, subL: 'Agence' }))
    .sort((a, b) => b.v - a.v);
  const avgP = pers.length ? pers.reduce((s, x) => s + x.v, 0) / pers.length : 0;
  // évolution hebdomadaire
  const ids = S.weeks.map((w) => w.weekId).sort();
  const allRows = scopeRows({ allWeeks: true }).filter((x) => k !== 'nbRHR' || x.rhrApplicable);
  const shown = scopeAgences().slice(0, 8);
  const series = shown.map((ag) => ({ name: ag, short: ag.slice(0, 3).toUpperCase(), color: `var(${SER[shown.indexOf(ag)]})`,
    values: ids.map((id) => { const l = allRows.filter((a) => a.weekId === id && a.agence === ag); return l.length ? modeVal(agg(l), k, S.mode === 'semaine' ? 'total' : S.mode) : null; }) }));
  const labels = ids.map((id) => id.replace(/^\d+-/, ''));
  // moyennes par semaine
  const wkRows = [...groupBy(rows, (a) => a.agence)].map(([agence, l]) => ({ agence, g: agg(l) }));
  const wCols = [{ k: 'agence', l: 'Agence', cls: 'l nm', v: (r) => r.agence, f: (r) => esc(r.agence) },
    { k: 'nbAgents', l: 'Agents / sem.', v: (r) => modeVal(r.g, 'nbAgents', 'semaine'), f: (r) => nf(modeVal(r.g, 'nbAgents', 'semaine'), 1) },
    ...[...KEY, 'heuresSup', 'nbPaniers', 'heuresNuit'].map((x) => ({ k: x, l: (M[x].c || M[x].l) + ' / sem.', v: (r) => modeVal(r.g, x, 'semaine'), f: (r) => zero(modeVal(r.g, x, 'semaine'), M[x].f) }))];
  const gAll = agg(rows);
  return `${legacyBanner(rows)}
  <section class="card"><div class="card-b ctrls-card">
    <div class="ctrls">
      <div class="fld"><span class="flabel">Mesure</span><div class="seg">${KEY.map((x) => `<button class="sg" data-stat="${x}" aria-pressed="${k === x}">${M[x].c || M[x].l}</button>`).join('')}</div></div>
    </div>
    ${modeNote() ? `<p class="hint" style="margin:0">${modeNote()}</p>` : ''}</div></section>
  <div class="charts">
    <section class="card"><div class="card-h"><div><h2>Agences</h2><p class="card-s">${esc(lab)}</p></div></div><div class="card-b">${barChart(byAg, { fmt: f, label: lab })}</div></section>
    <section class="card"><div class="card-h"><div><h2>Métiers</h2><p class="card-s">${esc(lab)}</p></div></div><div class="card-b">${barChart(byMe, { fmt: f, label: lab })}</div></section>
  </div>
  <section class="card"><div class="card-h"><div><h2>Évolution hebdomadaire</h2><p class="card-s">${esc(m.l)}${S.mode === 'agent' ? ' / agent' : ''}, une courbe par agence${scopeAgences().length > 8 ? ' (8 premières agences du filtre)' : ''}</p></div></div>
    <div class="card-b">${lineChart(series, labels, f)}<div class="clg">${shown.map((ag, i) => `<span class="lg"><i class="cdot" style="background:var(${SER[i]})"></i>${esc(ag)}</span>`).join('')}</div></div></section>
  <section class="card"><div class="card-h"><div><h2>Répartition par agent</h2><p class="card-s">${esc(m.l)}${S.mode === 'total' ? '' : ' / semaine'} · ${nf(pers.length)} agents${k === 'nbRHR' ? ' ayant eu au moins un RHR (AFR et agents sans RHR exclus)' : ''}</p></div>
    <label class="fld inline"><span class="flabel">Afficher</span><select id="topN">${[15, 25, 50, 100, 0].map((n) => `<option value="${n}"${S.topN === n ? ' selected' : ''}>${n ? n + ' premiers' : 'tous'}</option>`).join('')}</select></label></div>
    <div class="card-b">${barChart(S.topN ? pers.slice(0, S.topN) : pers, { fmt: f, label: m.l, avg: avgP })}</div></section>
  <section class="card"><div class="card-h"><div><h2>Moyennes par semaine</h2><p class="card-s">sur ${nf(gAll.nbSemaines)} semaine${gAll.nbSemaines > 1 ? 's' : ''} · cliquez un en-tête pour trier</p></div></div>
    <div class="card-b">${table('wk', wCols, wkRows, { sticky: true, sort: { k: 'agence', dir: 'asc' }, foot: (c) => c.k === 'agence' ? 'Total' : c.f({ agence: '', g: gAll }) })}</div></section>`;
}

/* ---------- agents : une ligne par personne ---------- */
const GRP = { identite: 'Identité', activite: 'Activité', temps: 'Temps de travail', rhr: 'Hors résidence', paniers: 'Paniers repas', absences: 'Repos & absences' };
function agentCols() {
  const per = S.mode !== 'total';
  const pv = (k) => (p) => (per ? r2((p[k] || 0) / (p.nbSemaines || 1)) : (p[k] || 0));
  const num = (g, k, f = nfa, extra = '') => ({ g, k, l: (M[k]?.c || M[k]?.l || k), v: pv(k), f: (p) => zero(pv(k)(p), f) + (extra && p.legacy ? extra : '') });
  const approx = '<span class="approx">≈</span>';
  return [
    { g: 'identite', k: 'nom', l: 'Agent', cls: 'l', v: (p) => `${p.nom} ${p.prenom}`, f: (p) => `<span class="nm">${esc(p.nom)}</span> ${esc(p.prenom)}${p.fusion ? ' <span class="pill pill-n" title="Lignes en double fusionnées">fusion</span>' : ''}` },
    { g: 'identite', k: 'matricule', l: 'Matricule', cls: 'l mono', v: (p) => p.matricule, f: (p) => esc(p.matricule) },
    { g: 'identite', k: 'agence', l: 'Agence', cls: 'l', v: (p) => p.agence, f: (p) => `<i class="cdot" style="background:${agenceColor(p.agence)}"></i>${esc(p.agence)}${p.agences.length > 1 ? ` <span class="mut" title="${esc(p.agences.join(' → '))}">+${p.agences.length - 1}</span>` : ''}` },
    { g: 'identite', k: 'metier', l: 'Métier', cls: 'l', v: (p) => p.metier, f: (p) => esc(p.metier) },
    { g: 'identite', k: 'nbSemaines', l: 'Semaines', v: (p) => p.nbSemaines, f: (p) => nf(p.nbSemaines) },
    num('activite', 'joursService'), num('activite', 'nbMissions'), num('activite', 'nbTrajetsSeuls'),
    num('activite', 'nbMHIS'), num('activite', 'nbDISPO'), num('activite', 'nbATCMD'), num('activite', 'weekendTravaille'),
    num('temps', 'heuresPlanifiees', fmtH), num('temps', 'heuresSup', fmtH), num('temps', 'heuresNuit', fmtH, approx), num('temps', 'heuresDimanche', fmtH, approx),
    { g: 'rhr', k: 'nbRHR', l: 'RHR', v: pv('nbRHR'), f: (p) => (p.rhrApplicable ? zero(pv('nbRHR')(p)) : '<span class="z">n/a</span>') },
    num('rhr', 'rhrHeures', fmtH), num('rhr', 'rhrNuits'),
    { g: 'rhr', k: 'rhrLieux', l: 'Lieux', cls: 'l mono', v: (p) => p.rhrLieux.join(' '), f: (p) => (p.rhrLieux.length ? esc(p.rhrLieux.join(' ')) : '<span class="z">—</span>') },
    num('paniers', 'nbPaniers', nfa, approx),
    { g: 'paniers', k: 'ratioPanierJS', l: 'Panier / JS', v: (p) => p.ratioPanierJS, f: (p) => nf(p.ratioPanierJS, 2) },
    num('absences', 'journeesBlanches'), num('absences', 'joursRepos'), num('absences', 'joursCP'), num('absences', 'joursAbsence'),
  ].filter((c) => S.cols[c.g]);
}
function viewAgents() {
  const rows = scopeRows(); if (!rows.length) return emptyScope();
  const persons = mergeAcrossWeeks(rows);
  return `${legacyBanner(rows)}<section class="card">
    <div class="card-h"><div><h2>Détail par agent</h2><p class="card-s">${nf(persons.length)} agents, une ligne par personne${activeWeeks().length > 1 ? ` sur ${activeWeeks().length} semaines` : ''} · ${S.mode === 'total' ? 'totaux' : 'moyennes par semaine'} · cliquez une ligne pour le détail</p></div>
      <div class="chipset">${Object.entries(GRP).map(([k, l]) => `<button class="chip chip-mini" data-col="${k}" aria-pressed="${!!S.cols[k]}">${l}</button>`).join('')}</div></div>
    <div class="card-b">${table('agents', agentCols(), persons, { sticky: true, tall: true, groups: GRP, onRow: true, sort: { k: 'nom', dir: 'asc' } })}</div></section>`;
}

/* ---------- repos hors résidence ---------- */
function viewRHR() {
  const rows = scopeRows(); if (!rows.length) return emptyScope();
  const cdr = rows.filter((a) => a.rhrApplicable);
  const nbW = new Set(rows.map((a) => a.weekId)).size || 1;
  const byAg = [...groupBy(cdr, (a) => a.agence)].map(([agence, l]) => {
    const g = agg(l); const avec = l.filter((a) => a.nbRHR > 0);
    return { agence, g, avec: new Set(avec.map(personKey)).size, total: g.nbAgents, dispo: g.nbDISPO, atcmd: g.nbATCMD };
  });
  const sumCols = [
    { k: 'agence', l: 'Agence', cls: 'l nm', v: (r) => r.agence, f: (r) => esc(r.agence) },
    { k: 'total', l: 'Conducteurs', v: (r) => r.total, f: (r) => nf(r.total) },
    { k: 'avec', l: 'Agents avec RHR', v: (r) => r.avec, f: (r) => zero(r.avec) },
    { k: 'nbRHR', l: 'RHR', v: (r) => r.g.nbRHR, f: (r) => zero(r.g.nbRHR) },
    { k: 'rhrParAgent', l: 'RHR / agent', v: (r) => r.g.rhrParAgent, f: (r) => zero(r.g.rhrParAgent) },
    { k: 'rhrHeures', l: 'Temps en RHR', v: (r) => r.g.rhrHeures, f: (r) => zero(r.g.rhrHeures, fmtH) },
    { k: 'tempsRHRParAgent', l: 'Temps RHR / agent', v: (r) => r.g.tempsRHRParAgent, f: (r) => zero(r.g.tempsRHRParAgent, fmtH) },
    { k: 'tpsSem', l: 'Temps RHR / semaine', v: (r) => r.g.rhrHeures / nbW, f: (r) => zero(r.g.rhrHeures / nbW, fmtH) },
    { k: 'rhrNuits', l: 'Nuits HR', v: (r) => r.g.rhrNuits, f: (r) => zero(r.g.rhrNuits) },
    { k: 'dispo', l: 'DISPO', v: (r) => r.dispo, f: (r) => zero(r.dispo) },
    { k: 'atcmd', l: 'ATCMD', v: (r) => r.atcmd, f: (r) => zero(r.atcmd) },
    { k: 'heuresSup', l: 'Heures sup', v: (r) => r.g.heuresSup, f: (r) => zero(r.g.heuresSup, fmtH) },
  ];
  const gT = agg(cdr);
  const det = []; rows.forEach((a) => a.rhr.forEach((r) => det.push({ a, r })));
  const detCols = [
    { k: 'nom', l: 'Agent', cls: 'l', v: (x) => x.a.nom, f: (x) => `<span class="nm">${esc(x.a.nom)}</span> ${esc(x.a.prenom)}` },
    { k: 'agence', l: 'Agence', cls: 'l', v: (x) => x.a.agence, f: (x) => esc(x.a.agence) },
    { k: 'semaine', l: 'Semaine', cls: 'l mono', v: (x) => x.a.weekId, f: (x) => esc(x.a.weekId.replace('-', ' ')) },
    { k: 'jour', l: 'Jour', cls: 'l', v: (x) => x.a.weekId + x.r.jourDebut, f: (x) => JS[x.r.jourDebut] ?? '—' },
    { k: 'lieu', l: 'Lieu', cls: 'l', v: (x) => x.r.lieu, f: (x) => `<span class="pill pill-a">${esc(x.r.lieu)}</span>` },
    { k: 'duree', l: 'Durée', v: (x) => x.r.dureeH ?? -1, f: (x) => (x.r.dureeH != null ? fmtH(x.r.dureeH) : '<span class="pill pill-w">en cours</span>') },
    { k: 'nuits', l: 'Nuits', v: (x) => x.r.nuits ?? -1, f: (x) => x.r.nuits ?? '—' },
    { k: 'aller', l: 'Service aller', cls: 'l mono', v: (x) => x.r.aller, f: (x) => esc(x.r.aller) },
    { k: 'retour', l: 'Service retour', cls: 'l mono', v: (x) => x.r.retour || '', f: (x) => (x.r.retour ? esc(x.r.retour) : '—') },
  ];
  return `<section class="card"><div class="card-h"><div><h2>Par agence</h2><p class="card-s">conducteurs uniquement · les moyennes par agent ne portent que sur les agents qui ont eu au moins un RHR · cliquez un en-tête pour trier</p></div>
    <button class="btn btn-sm" data-goto="exports">Exporter</button></div>
    <div class="card-b">${table('rhrag', sumCols, byAg, { sticky: true, sort: { k: 'nbRHR', dir: 'desc' },
      foot: (c) => ({ agence: 'Total', total: nf(gT.nbAgents), avec: nf(gT.agentsAvecRHR), nbRHR: nf(gT.nbRHR), rhrParAgent: nf(gT.rhrParAgent, 2),
        rhrHeures: fmtH(gT.rhrHeures), tempsRHRParAgent: fmtH(gT.tempsRHRParAgent), tpsSem: fmtH(gT.rhrHeures / nbW), rhrNuits: nf(gT.rhrNuits),
        dispo: nf(gT.nbDISPO), atcmd: nf(gT.nbATCMD), heuresSup: fmtH(gT.heuresSup) })[c.k] })}
      <p class="hint">Une coupure compte pour un RHR dès que le service se termine ailleurs qu'à la résidence, de jour comme de nuit. DISPO et ATCMD sont comptés séparément ; une ATCMD vaut ${S.rules.heuresATCMD} h de travail dans les heures planifiées.</p></div></section>
  <section class="card"><div class="card-h"><div><h2>Détail des coupures</h2><p class="card-s">${nf(det.length)} RHR · cliquez un en-tête pour trier</p></div></div>
    <div class="card-b">${det.length ? table('rhrdet', detCols, det, { sticky: true, tall: true, sort: { k: 'semaine', dir: 'asc' } }) : '<p class="mut">Aucun repos hors résidence sur ce périmètre.</p>'}</div></section>`;
}

function viewBlanches() {
  const rows = scopeRows(); if (!rows.length) return emptyScope();
  const det = []; rows.forEach((a) => a.blanches.forEach((b) => det.push({ a, b })));
  const byAg = [...groupBy(det, (x) => x.a.agence + '||' + x.a.metier)].map(([k, l]) => { const [agence, metier] = k.split('||'); return { agence, metier, n: l.length, agents: new Set(l.map((x) => personKey(x.a))).size }; });
  const parJour = JS.map((j, i) => ({ l: j, v: det.filter((x) => x.b.d === i).length }));
  return `<section class="card"><div class="card-h"><div><h2>Journées blanches</h2><p class="card-s">${nf(det.length)} journée(s) · sans mission ni code, encadrées par deux services, hors lendemains de service de nuit</p></div>
    <button class="btn btn-sm" data-goto="exports">Exporter</button></div>
    <div class="card-b">${det.length ? `<div class="cols2 mb">
      ${table('jbag', [{ k: 'agence', l: 'Agence', cls: 'l nm' }, { k: 'metier', l: 'Métier', cls: 'l' }, { k: 'n', l: 'Journées', f: (r) => nf(r.n) }, { k: 'agents', l: 'Agents', f: (r) => nf(r.agents) }], byAg, { sort: { k: 'n', dir: 'desc' } })}
      <div>${barChart(parJour, { label: 'Journées blanches' })}</div></div>
      ${table('jbdet', [
        { k: 'nom', l: 'Agent', cls: 'l', v: (x) => x.a.nom, f: (x) => `<span class="nm">${esc(x.a.nom)}</span> ${esc(x.a.prenom)}` },
        { k: 'agence', l: 'Agence', cls: 'l', v: (x) => x.a.agence, f: (x) => esc(x.a.agence) },
        { k: 'metier', l: 'Métier', cls: 'l', v: (x) => x.a.metier, f: (x) => esc(x.a.metier) },
        { k: 'date', l: 'Date', cls: 'l mono', v: (x) => x.b.date, f: (x) => `${JS[x.b.d]} ${dISO(x.b.date)}` },
        { k: 'fin', l: 'Fin du service précédent', cls: 'l mono', v: (x) => x.b.finPrec || '', f: (x) => (x.b.finPrec ? dtISO(x.b.finPrec) : '—') },
        { k: 'deb', l: 'Début du service suivant', cls: 'l mono', v: (x) => x.b.debutSuiv || '', f: (x) => (x.b.debutSuiv ? dtISO(x.b.debutSuiv) : '—') },
        { k: 'hr', l: 'Situation', cls: 'l', v: (x) => (x.b.horsResidence ? 1 : 0), f: (x) => (x.b.horsResidence ? '<span class="pill pill-w">hors résidence</span>' : '<span class="pill pill-n">à la résidence</span>') },
      ], det, { sticky: true, tall: true, sort: { k: 'date', dir: 'asc' } })}` : '<p class="mut">Aucune journée blanche sur ce périmètre.</p>'}</div></section>`;
}

/* ---------- exports ---------- */
function tables() {
  const rows = scopeRows(), mode = S.mode;
  const mv = (g, k) => modeVal(g, k, mode);
  const groups = [...groupBy(rows, (a) => a.agence + '||' + a.metier)].sort((a, b) => a[0].localeCompare(b[0]));
  const synthRow = (ag, me, g) => [ag, me, g.nbAgents, mv(g, 'joursService'), mv(g, 'heuresPlanifiees'), mv(g, 'heuresSup'), mv(g, 'nbRHR'), g.agentsAvecRHR,
    g.tempsRHRParAgent, mv(g, 'journeesBlanches'), mv(g, 'nbMissions'), mv(g, 'nbTrajetsSeuls'), mv(g, 'nbMHIS'), mv(g, 'nbDISPO'), mv(g, 'nbATCMD'),
    mv(g, 'heuresNuit'), mv(g, 'heuresDimanche'), mv(g, 'nbPaniers'), g.ratioPanierJS, mv(g, 'joursRepos'), mv(g, 'joursCP'), mv(g, 'joursAbsence')];
  const synth = groups.map(([k, l]) => { const [ag, me] = k.split('||'); return synthRow(ag, me, agg(l)); });
  synth.push(synthRow('TOTAL', '', agg(rows)));
  const persons = mergeAcrossWeeks(rows).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const per = mode !== 'total';
  const pv = (p, k) => (per ? r2((p[k] || 0) / (p.nbSemaines || 1)) : p[k] || 0);
  const agents = persons.map((p) => [p.matricule, p.nom, p.prenom, p.agence, p.metier, p.nbSemaines, p.residence || '',
    pv(p, 'joursService'), pv(p, 'nbMissions'), pv(p, 'nbTrajetsSeuls'), pv(p, 'nbMHIS'), pv(p, 'nbDISPO'), pv(p, 'nbATCMD'),
    pv(p, 'heuresPlanifiees'), pv(p, 'heuresSup'), pv(p, 'heuresNuit'), pv(p, 'heuresDimanche'),
    p.rhrApplicable ? pv(p, 'nbRHR') : '', pv(p, 'rhrHeures'), pv(p, 'rhrNuits'), p.rhrLieux.join(' '),
    pv(p, 'nbPaniers'), p.ratioPanierJS, pv(p, 'journeesBlanches'), pv(p, 'joursRepos'), pv(p, 'joursCP'), pv(p, 'joursAbsence'),
    p.fusion ? 'oui' : '', p.nbHorsColonne || '', p.legacy ? 'oui' : '']);
  const cdr = rows.filter((a) => a.rhrApplicable), nbW = new Set(rows.map((a) => a.weekId)).size || 1;
  const rhrAg = [...groupBy(cdr, (a) => a.agence)].sort((a, b) => a[0].localeCompare(b[0])).map(([ag, l]) => { const g = agg(l);
    return [ag, g.nbAgents, g.agentsAvecRHR, g.nbRHR, g.rhrParAgent, g.rhrHeures, g.tempsRHRParAgent, r2(g.rhrHeures / nbW), g.rhrNuits, g.nbDISPO, g.nbATCMD, g.heuresSup]; });
  const rhr = []; rows.forEach((a) => a.rhr.forEach((r) => rhr.push([a.weekId.replace('-', ' '), a.matricule, a.nom, a.prenom, a.agence, a.metier,
    JS[r.jourDebut] ?? '', r.lieu, r.dureeH ?? '', r.nuits ?? '', r.aller, r.retour || '', r.enCours && !r.fin ? 'en cours (semaine suivante)' : ''])));
  const bl = []; rows.forEach((a) => a.blanches.forEach((b) => bl.push([a.weekId.replace('-', ' '), a.matricule, a.nom, a.prenom, a.agence, a.metier, JN[b.d], dFull(b.date),
    b.finPrec ? dtISO(b.finPrec) : '', b.debutSuiv ? dtISO(b.debutSuiv) : '', b.horsResidence ? 'hors résidence' : 'à la résidence'])));
  const hist = S.weeks.slice().sort((a, b) => a.weekId.localeCompare(b.weekId)).map((w) => {
    const l = rows.filter((a) => a.weekId === w.weekId); const g = agg(l);
    return [weekLabel(w), dFull(w.monday), dFull(w.sunday), g.nbAgents, g.joursService, g.heuresPlanifiees, g.heuresSup, g.nbRHR, g.journeesBlanches, g.nbMissions, g.nbTrajetsSeuls, g.nbPaniers];
  }).filter((r) => r[3] > 0);
  const I = (t, w = 9) => ({ t, w, fmt: 'int' }), D = (t, w = 11) => ({ t, w, fmt: 'dec' }), T = (t, w = 14) => ({ t, w });
  const sfx = { total: '', semaine: ' / sem.', agent: ' / agent' }[mode];
  return {
    synthese: { name: 'Synthèse', cols: [T('Agence', 22), T('Métier', 13), I('Agents'), D('Jours de service' + sfx), D('Heures planifiées' + sfx, 13), D('Heures sup' + sfx),
      D('RHR' + sfx), I('Agents avec RHR', 11), D('Temps RHR / agent (h)', 13), D('Journées blanches' + sfx, 12), D('Missions' + sfx), D('Trajets seuls' + sfx),
      D('MHIS' + sfx), D('DISPO' + sfx), D('ATCMD' + sfx), D('Heures de nuit' + sfx, 12), D('Heures dimanche' + sfx, 12), D('Paniers' + sfx),
      D('Panier / JS'), D('RP' + sfx), D('Congés' + sfx), D('Absences' + sfx)], rows: synth },
    agents: { name: 'Agents', cols: [T('Matricule', 10), T('Nom', 20), T('Prénom', 14), T('Agence', 20), T('Métier', 13), I('Semaines'), T('Résidence', 10),
      D('Jours de service'), D('Missions'), D('Trajets seuls'), D('MHIS'), D('DISPO'), D('ATCMD'), D('Heures planifiées', 12), D('Heures sup'), D('Heures de nuit'),
      D('Heures dimanche', 12), D('RHR'), D('Temps RHR (h)'), D('Nuits HR'), T('Lieux RHR'), D('Paniers'), D('Panier / JS'), D('Journées blanches', 12),
      D('RP'), D('Congés'), D('Absences'), T('Lignes fusionnées', 12), I('Missions hors colonne', 13), T('Pauses non localisées', 14)], rows: agents },
    rhrag: { name: 'RHR par agence', cols: [T('Agence', 22), I('Conducteurs', 11), I('Agents avec RHR', 12), I('RHR'), D('RHR / agent'), D('Temps en RHR (h)', 13),
      D('Temps RHR / agent (h)', 14), D('Temps RHR / semaine (h)', 14), I('Nuits HR'), I('DISPO'), I('ATCMD'), D('Heures sup')], rows: rhrAg },
    rhr: { name: 'RHR détaillés', cols: [T('Semaine', 11), T('Matricule', 10), T('Nom', 20), T('Prénom', 14), T('Agence', 20), T('Métier', 13), T('Jour', 7), T('Lieu', 9),
      D('Durée (h)', 9), I('Nuits', 7), T('Service aller', 24), T('Service retour', 24), T('Statut', 22)], rows: rhr },
    blanches: { name: 'Journées blanches', cols: [T('Semaine', 11), T('Matricule', 10), T('Nom', 20), T('Prénom', 14), T('Agence', 20), T('Métier', 13), T('Jour', 10),
      T('Date', 11), T('Fin du service précédent', 16), T('Début du service suivant', 16), T('Situation', 16)], rows: bl },
    historique: { name: 'Évolution hebdomadaire', cols: [T('Semaine', 11), T('Lundi', 11), T('Dimanche', 11), I('Agents'), I('Jours de service', 11), D('Heures planifiées', 13),
      D('Heures sup'), I('RHR'), I('Journées blanches', 12), I('Missions'), I('Trajets seuls', 11), I('Paniers')], rows: hist },
  };
}
function download(name, data, mime) {
  const u = URL.createObjectURL(new Blob([data], { type: mime })), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
const scopeTag = () => (S.selWeek === '__all__' ? 'toutes-semaines' : S.selWeek) + (S.selAgences && S.selAgences.length <= 2 ? '-' + S.selAgences.map(slug).join('-') : '') + (S.mode !== 'total' ? '-' + S.mode : '');
function exportXlsx(which) {
  const t = tables();
  const keys = which === 'tout' ? ['synthese', 'agents', 'rhrag', 'rhr', 'blanches', 'historique'] : [which];
  download(`recap-corridor-${which}-${scopeTag()}.xlsx`, buildXlsx(keys.map((k) => t[k])), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function exportCsv(which) {
  const t = tables()[which];
  const q = (v) => { const s = v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  download(`recap-corridor-${which}-${scopeTag()}.csv`, '﻿' + [t.cols.map((c) => q(c.t)).join(';'), ...t.rows.map((r) => r.map(q).join(';'))].join('\r\n'), 'text/csv;charset=utf-8');
}
function buildReport() {
  const rows = scopeRows(), t = tables(), g = agg(rows);
  const wk = activeWeeks().map((id) => S.weeks.find((w) => w.weekId === id)).filter(Boolean).sort((a, b) => a.weekId.localeCompare(b.weekId));
  const periode = wk.length === 1 ? `${weekLabel(wk[0])} — du ${dFull(wk[0].monday)} au ${dFull(wk[0].sunday)}` : wk.length ? `${wk.length} semaines — du ${dFull(wk[0].monday)} au ${dFull(wk[wk.length - 1].sunday)}` : '—';
  const now = new Date(), genere = `${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const sfx = modeSuffix(), v = (k) => modeVal(g, k, S.mode);
  const kp = [['Agents', nfa(v('nbAgents')), `${nf(g.joursService)} jours de service`], ['Heures planifiées' + sfx, fmtH(v('heuresPlanifiees')), `${fmtH(g.heuresParJS)} par jour de service`],
    ['Heures sup' + sfx, fmtH(v('heuresSup')), `${nf(g.agentsHeuresSup)} agents au-delà de ${S.rules.seuilHebdo} h`, g.heuresSup > 0], ['RHR' + sfx, nfa(v('nbRHR')), `${nf(g.agentsAvecRHR)} agents · ${fmtH(g.tempsRHRParAgent)} par agent`, g.nbRHR > 0],
    ['Journées blanches' + sfx, nfa(v('journeesBlanches')), ''], ['Missions' + sfx, nfa(v('nbMissions')), `dont ${nfa(v('nbTrajetsSeuls'))} trajets seuls`],
    ['Paniers' + sfx, nfa(v('nbPaniers')), `${nf(g.ratioPanierJS, 2)} par jour de service`], ['Heures de nuit' + sfx, fmtH(v('heuresNuit')), 'hors pauses']];
  const SH = [['synthese', 'Synthèse'], ['rhrag', 'RHR par agence'], ['rhr', 'RHR détaillés'], ['blanches', 'Journées blanches'], ['agents', 'Agents'], ['historique', 'Évolution']];
  const tb = (k) => { const x = t[k]; if (!x.rows.length) return '<p class="mut">Aucune ligne.</p>'; const num = x.cols.map((c) => c.fmt && c.fmt !== 'txt');
    return `<div class="tw"><table><thead><tr>${x.cols.map((c, i) => `<th class="${num[i] ? '' : 'l'}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${x.rows.map((r) => `<tr${String(r[0]) === 'TOTAL' ? ' class="tot"' : ''}>${r.map((c, i) => `<td class="${num[i] ? '' : 'l'}">${c === '' || c == null ? '<span class="z">—</span>' : esc(typeof c === 'number' ? nf(c, Number.isInteger(c) ? 0 : 2) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Récap Corridor — ${esc(periode)}</title>
<style>:root{--g:#EBEEF2;--s:#fff;--s2:#F5F7FA;--s3:#EAEEF3;--l:#D5DCE5;--l2:#BAC5D2;--i:#0E1620;--i2:#46546A;--i3:#74859A;--a:#175E82;--as:#E0EDF4;--w:#9C6209;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--g:#0F141A;--s:#19202A;--s2:#202834;--s3:#28323F;--l:#2D3846;--l2:#3D4B5C;--i:#E9EEF4;--i2:#A4B3C4;--i3:#74859A;--a:#6FB6D9;--as:#12303E;--w:#E0A53E;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--g);color:var(--i);font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}.wrap{max-width:1500px;margin:0 auto;padding:22px 18px 60px}
h1{font-size:19px;margin:0}.hd{display:flex;gap:14px;justify-content:space-between;flex-wrap:wrap;padding-bottom:15px;margin-bottom:18px;border-bottom:1px solid var(--l)}.sub{font-size:12.5px;color:var(--i3);margin-top:4px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--l);border:1px solid var(--l);border-radius:10px;overflow:hidden;margin-bottom:18px}.kpi{background:var(--s);padding:13px 15px}
.kpi .k{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--i3)}.kpi .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:3px}.kpi.h .v{color:var(--w)}.kpi .n{font-size:11.5px;color:var(--i3)}
.tabs{display:flex;gap:2px;overflow-x:auto;border-bottom:1px solid var(--l);margin-bottom:14px}.tb{border:0;background:none;padding:9px 13px;font:inherit;font-size:13.5px;color:var(--i2);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.tb[aria-selected=true]{color:var(--a);border-bottom-color:var(--a);font-weight:600}.card{background:var(--s);border:1px solid var(--l);border-radius:10px;padding:15px 17px}.tw{overflow:auto;border:1px solid var(--l);border-radius:8px;max-height:74vh}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums;background:var(--s)}th,td{text-align:right;padding:6px 10px;border-bottom:1px solid var(--l);white-space:nowrap}
th{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--i3);background:var(--s2);position:sticky;top:0}.l{text-align:left}tbody tr:nth-child(even) td{background:var(--s2)}.tot td{font-weight:700;background:var(--s3)!important}
.z,.mut{color:var(--i3)}.note{background:var(--s2);border:1px solid var(--l);border-left:3px solid var(--a);border-radius:7px;padding:10px 14px;font-size:12.5px;color:var(--i2);margin-bottom:16px}.ft{margin-top:20px;font-size:11.5px;color:var(--i3)}
@media print{.tabs{display:none}.tw{max-height:none;overflow:visible}th{position:static}.sec{display:block!important;break-before:page}body{background:#fff}}</style></head><body><div class="wrap">
<div class="hd"><div><h1>Récap Corridor</h1><div class="sub">${esc(periode)} · ${esc({ total: 'totaux', semaine: 'moyennes par semaine', agent: 'moyennes par agent' }[S.mode])}</div></div>
<div class="sub" style="text-align:right">${esc(scopeAgences().length === allAgences().length ? 'Toutes les agences' : scopeAgences().join(' · '))}<br>${esc(scopeMetiers().join(' · '))}<br>Édité le ${genere}</div></div>
<div class="note">Rapport figé, extrait de Récap Corridor. RHR : une coupure hors résidence par RHR, de jour comme de nuit ; AFR et agents sans RHR exclus des moyennes RHR. Heures planifiées hors pauses, ATCMD = ${S.rules.heuresATCMD} h, heures sup au-delà de ${S.rules.seuilHebdo} h par semaine. Nuit hors pauses : AFR ${S.rules.nuitAFR.join('h–')}h, conducteurs ${S.rules.nuitCDR.join('h–')}h.</div>
<div class="kpis">${kp.map((x) => `<div class="kpi${x[3] ? ' h' : ''}"><div class="k">${esc(x[0])}</div><div class="v">${esc(x[1])}</div><div class="n">${esc(x[2])}</div></div>`).join('')}</div>
<div class="tabs">${SH.map(([k, l], i) => `<button class="tb" data-s="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
<div class="card">${SH.map(([k], i) => `<div class="sec" data-s="${k}"${i ? ' style="display:none"' : ''}>${tb(k)}</div>`).join('')}</div>
<p class="ft">Document de travail contenant des données nominatives d'agents, à diffuser uniquement aux personnes habilitées.</p></div>
<script>document.addEventListener('click',e=>{const b=e.target.closest('.tb');if(!b)return;document.querySelectorAll('.tb').forEach(x=>x.setAttribute('aria-selected',x===b));document.querySelectorAll('.sec').forEach(s=>s.style.display=s.dataset.s===b.dataset.s?'':'none');});<\/script></body></html>`;
}
function viewExports() {
  const rows = scopeRows(); if (!rows.length) return emptyScope();
  const t = tables();
  const items = [['tout', 'Classeur complet', 'Les six feuilles dans un seul fichier Excel.'], ['synthese', 'Synthèse par agence et métier', 'La feuille à diffuser en réunion.'],
    ['agents', 'Détail par agent', 'Une ligne par personne, sans doublon.'], ['rhrag', 'RHR par agence', 'Agents concernés, temps en RHR moyen par agent, DISPO, ATCMD, heures sup.'],
    ['rhr', 'RHR détaillés', 'Chaque coupure : lieu, durée, nuits, services aller et retour.'], ['blanches', 'Journées blanches', 'Avec la fin du service précédent et le début du suivant.'],
    ['historique', 'Évolution hebdomadaire', 'Une ligne par semaine.']];
  const n = (k) => (k === 'tout' ? t.agents.rows.length : t[k].rows.length);
  return `<section class="card"><div class="card-h"><div><h2>Exports</h2><p class="card-s">le périmètre et le mode d'affichage (${MODES.find((m) => m[0] === S.mode)[1].toLowerCase()}) s'appliquent</p></div>
    <button class="btn btn-sm" id="btnPrint">Version imprimable</button></div>
    <div class="card-b stack tight">
      <div class="row hl"><div class="rl"><div class="rt">Rapport autonome à diffuser</div><div class="rs">Un fichier HTML unique : s'ouvre dans n'importe quel navigateur, sans compte ni connexion. À envoyer par mail ; s'imprime en PDF.</div></div>
        <div class="ract"><button class="btn btn-sm btn-pri" id="btnReport">Générer le rapport</button></div></div>
      <div class="rows">${items.map(([k, nm, d]) => `<div class="row"><div class="rl"><div class="rt">${nm}</div><div class="rs">${d} — ${nf(n(k))} ligne(s)</div></div>
        <div class="ract"><button class="btn btn-sm btn-pri" data-xlsx="${k}">Excel</button>${k !== 'tout' ? `<button class="btn btn-sm" data-csv="${k}">CSV</button>` : ''}</div></div>`).join('')}</div>
    </div></section>`;
}

/* ---------- import ---------- */
function viewImport() {
  const leg = S.weeks.filter((w) => !(w.format >= 2));
  return `<section class="card"><div class="card-h"><div><h2>Importer des semaines</h2><p class="card-s">fichiers « Récap National Corridor » (.xlsx), plusieurs à la fois, sans limite de taille</p></div></div>
    <div class="card-b stack tight">
      <div class="drop" id="drop"><h3>Déposez un ou plusieurs fichiers Excel</h3>
        <p>ou <button class="btn btn-sm" id="pick">parcourir</button> — chaque semaine est reconnue d'après la date du lundi en ligne 1. Le fichier est lu dans votre navigateur ; seules les données extraites sont envoyées.</p>
        <input type="file" id="file" accept=".xlsx" multiple hidden></div>
      ${S.err ? `<div class="note c"><b>Lecture impossible.</b> ${esc(S.err)}</div>` : ''}
      ${S.queue.length ? queueView() : ''}
    </div></section>
    <section class="card"><div class="card-h"><div><h2>Fichiers importés</h2><p class="card-s">${S.weeks.length} semaine(s)${leg.length ? ` · ${leg.length} à réimporter pour des pauses localisées` : ''}</p></div></div>
      <div class="card-b">${S.weeks.length ? `<div class="rows">${S.weeks.map((w) => `
        <div class="row"><div class="rl"><div class="rt">${weekLabel(w)} <span class="mut nb">· ${weekRange(w)}</span>
          ${!(w.format >= 2) ? '<span class="pill pill-w">à réimporter</span>' : ''}</div>
          <div class="rs">${w.fichier && w.fichier.nom ? `${esc(w.fichier.nom)}${w.fichier.taille ? ` · ${taille(w.fichier.taille)}` : ''} · ` : ''}${nf(w.nbAgents)} lignes · ${(w.agences || []).length} agences · extrait ARP du ${w.extractDate ? dISO(w.extractDate) : '?'} · importé le ${w.importedAt ? dISO(w.importedAt) : '?'}</div></div>
        <div class="ract">${S.delAsk === w.weekId
          ? `<span class="confirm">Supprimer ${weekLabel(w)} ?</span><button class="btn btn-sm dgr" data-delok="${w.weekId}">Supprimer</button><button class="btn btn-sm" data-delno="1">Annuler</button>`
          : `<button class="btn btn-sm del" data-del="${w.weekId}" title="Supprimer ce fichier et sa semaine"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Supprimer</button>`}</div></div>`).join('')}</div>`
        : '<p class="mut">Aucune semaine importée pour l’instant.</p>'}</div></section>
    <section class="card"><div class="card-h"><div><h2>Sauvegarde</h2><p class="card-s">toutes les semaines et les règles dans un seul fichier, à conserver en lieu sûr</p></div></div>
      <div class="card-b"><div class="btns" style="margin:0">
        <button class="btn" id="bkOut"${S.weeks.length ? '' : ' disabled'}>Télécharger une sauvegarde</button>
        <button class="btn" id="bkIn"${S.busy ? ' disabled' : ''}>Restaurer une sauvegarde…</button>
        <input type="file" id="bkFile" accept=".json,application/json" hidden></div>
        ${S.restore ? `<p class="hint">${esc(S.restore)}</p>` : ''}
        <p class="hint">La restauration ajoute les semaines du fichier et remplace celles qui existent déjà sous le même numéro ; les autres semaines ne sont pas touchées. Le fichier contient des données nominatives : ne le diffusez pas.</p></div></section>`;
}
function backupData() {
  const semaines = S.weeks.slice().sort((a, b) => a.weekId.localeCompare(b.weekId)).map((w) => {
    const p = S.parsed.get(w.weekId); if (!p) return null;
    const ags = [...new Set(p.agents.map((a) => a.agence))].sort();
    return { resume: w, details: ags.map((ag) => ({ weekId: w.weekId, agence: ag, agenceSlug: slug(ag), meta: p.meta, agents: p.agents.filter((a) => a.agence === ag) })) };
  }).filter(Boolean);
  return { app: 'recap-corridor', version: 1, date: new Date().toISOString(), regles: S.rules, semaines };
}
async function restoreFile(f) {
  if (S.busy) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch (e) { S.msg = { m: `${f.name} n'est pas une sauvegarde lisible.`, t: 'c' }; render(); return; }
  if (!d || d.app !== 'recap-corridor' || !Array.isArray(d.semaines)) { S.msg = { m: `${f.name} n'est pas une sauvegarde Récap Corridor.`, t: 'c' }; render(); return; }
  S.busy = true; let n = 0; const ko = [];
  for (const x of d.semaines) {
    S.restore = `Restauration… ${n + ko.length + 1} / ${d.semaines.length} (${x.resume && x.resume.weekId})`; render();
    try { await api.save(x.resume, x.details, true); n++; } catch (e) { ko.push(`${x.resume && x.resume.weekId} : ${e.message}`); }
  }
  if (d.regles && !S.weeks.length) { try { await api.regles(d.regles); } catch (e) { /* règles facultatives */ } }
  S.busy = false; S.restore = null;
  await boot();
  S.tab = 'import';
  S.msg = ko.length ? { m: `${n} semaine(s) restaurée(s), ${ko.length} en échec — ${ko.join(' · ')}`, t: 'c' } : { m: `${n} semaine${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''}.` };
  render();
}
function queueView() {
  const ok = S.queue.filter((q) => q.state === 'pret').length;
  return `<div class="rows">${S.queue.map((q, i) => {
    const pill = { lecture: '<span class="pill pill-n">lecture…</span>', erreur: '<span class="pill pill-c">erreur</span>', enregistre: '<span class="pill pill-g">enregistrée</span>', envoi: '<span class="pill pill-a">envoi…</span>' }[q.state]
      || (q.existe ? '<span class="pill pill-w">remplacera l’existante</span>' : '<span class="pill pill-a">nouvelle</span>');
    return `<div class="row"><div class="rl"><div class="rt">${q.view ? weekLabel(q.view.meta) : esc(q.name)} ${pill}</div>
      <div class="rs">${q.view ? `${esc(q.name)} · ${taille(q.size)} · ${nf(q.parsed.agents.length)} lignes${q.fusions ? ` (${q.fusions} personne(s) en double, fusionnées)` : ''} · ${nf(q.stats.nbRHR)} RHR · ${fmtH(q.stats.heuresSup)} d'heures sup${q.anom ? ` · ${q.anom} cellule(s) illisible(s)` : ''}${q.hc ? ` · <b>${q.hc} mission(s) datée(s) hors de leur colonne</b>${S.rules.horsColonne === 'garder' ? '' : ', non comptée(s)'}` : ''}` : esc(q.err || q.name)}</div></div>
      <div class="ract">${q.state !== 'enregistre' && q.state !== 'envoi' ? `<button class="btn btn-sm" data-qdel="${i}">Retirer</button>` : ''}</div></div>`;
  }).join('')}</div>
  ${ok ? `<div class="btns"><button class="btn btn-pri" id="saveAll"${S.busy ? ' disabled' : ''}>${S.busy ? 'Enregistrement…' : `Enregistrer ${ok} semaine${ok > 1 ? 's' : ''}`}</button><button class="btn" id="clearQ"${S.busy ? ' disabled' : ''}>Tout retirer</button></div>` : ''}`;
}

/* ---------- réglages ---------- */
function viewReglages() {
  const ags = allAgences(), r = S.rules, mets = allMetiers();
  const first = [...S.computed.values()].pop()?.meta || { residences: {}, residenceSource: {}, locCounts: {} };
  const h = (x) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  return `<section class="card"><div class="card-h"><div><h2>Règles de calcul</h2><p class="card-s">appliquées à l'affichage pour tous les utilisateurs — aucun réimport nécessaire</p></div></div>
    <div class="card-b stack tight"><div class="rules-l">
      <label class="rule"><input type="checkbox" id="rMet" ${r.rhrMetiers.includes('AFR') ? '' : 'checked'}><span><span class="rn">Les AFR n'ont pas de repos hors résidence</span><span class="rd">Le RHR ne porte que sur les conducteurs. Décochez pour l'étendre à tous les métiers (${esc(mets.join(', '))}).</span></span></label>
      <label class="rule"><input type="checkbox" id="rPend" ${r.rhrCountPending ? 'checked' : ''}><span><span class="rn">Compter la coupure ouverte en fin de semaine</span><span class="rd">Parti le dimanche, rentré le lundi : un RHR sur la semaine de départ, sa durée se calcule à l'import de la semaine suivante.</span></span></label>
      <label class="rule"><input type="checkbox" id="rNight" ${r.jbExcludeNightOverlap ? 'checked' : ''}><span><span class="rn">Exclure les lendemains de service de nuit des journées blanches</span></span></label>
      <label class="rule"><input type="checkbox" id="rFramed" ${r.jbRequireFramed ? 'checked' : ''}><span><span class="rn">Ne compter que les journées blanches encadrées par deux services</span></span></label>
      <label class="rule"><input type="checkbox" id="rFus" ${r.fusionChevauchement === 'plus-longue' ? 'checked' : ''}><span><span class="rn">Doublons : garder le plus long des services qui se chevauchent</span><span class="rd">Quand une personne apparaît sur plusieurs lignes et que deux de ses services se chevauchent dans le temps, seul le plus long est compté. Décoché, tous les services sont comptés (règle actuelle), ce qui peut gonfler les heures d'un agent fusionné.</span></span></label>
      <label class="rule"><input type="checkbox" id="rHC" ${r.horsColonne !== 'garder' ? 'checked' : ''}><span><span class="rn">Écarter les missions datées hors de leur colonne</span><span class="rd">Une case de la colonne « lundi 31/08 » qui contient une mission du 29/08 ou du 06/09 n'est pas comptée : c'est en général une ligne d'une autre semaine recopiée dans le fichier. Les services de nuit à cheval sur minuit restent rattachés à leur jour, ainsi qu'un service qui démarre le lendemain avant ${r.horsColonneTolerance} h. Décoché, tout est compté tel qu'écrit dans la colonne.</span></span></label>
      <label class="rule"><input type="checkbox" id="rPRHR" ${r.panierRHR ? 'checked' : ''}><span><span class="rn">Un RHR qui englobe la plage midi ou soir donne un panier</span></span></label>
      <div class="rule grid"><span class="sp"></span><div class="rgrid">
        <label><span class="rn">Heures sup au-delà de</span><span class="inl"><input type="text" id="rSeuil" value="${r.seuilHebdo}" inputmode="decimal"> h / semaine</span></label>
        <label><span class="rn">Une ATCMD vaut</span><span class="inl"><input type="text" id="rATCMD" value="${r.heuresATCMD}" inputmode="decimal"> h de travail</span></label>
        <label><span class="rn">Nuit AFR</span><span class="inl"><input type="text" id="rNA0" value="${r.nuitAFR[0]}"> h à <input type="text" id="rNA1" value="${r.nuitAFR[1]}"> h</span></label>
        <label><span class="rn">Nuit conducteurs</span><span class="inl"><input type="text" id="rNC0" value="${r.nuitCDR[0]}"> h à <input type="text" id="rNC1" value="${r.nuitCDR[1]}"> h</span></label>
        <label><span class="rn">Trajet seul : intitulés</span><span class="inl"><input type="text" id="rTraj" value="${esc(r.trajetTypes.join(', '))}" style="width:130px"></span></label>
        <label><span class="rn">Durée minimale d'un RHR</span><span class="inl"><input type="text" id="rMin" value="${r.rhrMinHours}" inputmode="decimal"> h</span></label>
        <label><span class="rn">Service après minuit rattaché à la veille jusqu'à</span><span class="inl"><input type="text" id="rHCT" value="${r.horsColonneTolerance}" inputmode="decimal"> h</span></label>
      </div></div>
      <div class="rule"><span class="sp"></span><span><span class="rn">Paniers repas</span><span class="rd">Midi : ${r.panierMidi[2]} h travaillée entre ${h(r.panierMidi[0])} et ${h(r.panierMidi[1])}. Soir : ${r.panierSoir[2]} h entre ${h(r.panierSoir[0])} et ${h(r.panierSoir[1])}. Nuit : ${r.panierNuit[2]} h entre ${h(r.panierNuit[0])} et ${h(r.panierNuit[1])}. Temps travaillé hors pauses, un panier au plus par plage et par jour. Le ratio rapporte les paniers aux jours de service travaillés.</span></span></div>
    </div><div class="btns"><button class="btn btn-pri" id="saveRules">Appliquer et enregistrer</button></div></div></section>
  <section class="card"><div class="card-h"><div><h2>Résidence de chaque agence</h2><p class="card-s">référence du calcul « hors résidence »</p></div></div>
    <div class="card-b">${table('res', [
      { k: 'ag', l: 'Agence', cls: 'l nm', f: (x) => esc(x.ag) },
      { k: 'res', l: 'Résidence retenue', cls: 'l', v: (x) => x.ag, f: (x) => `<input type="text" data-res="${esc(x.ag)}" value="${esc(r.residences[x.ag] || first.residences?.[x.ag] || '')}" placeholder="—" class="mono sm-i">` },
      { k: 'src', l: 'Origine', cls: 'l', v: (x) => (r.residences[x.ag] ? 0 : 1), f: (x) => (r.residences[x.ag] ? '<span class="pill pill-a">manuelle</span>' : first.residenceSource?.[x.ag] === 'auto' ? '<span class="pill pill-n">automatique</span>' : '<span class="pill pill-w">indéterminée</span>') },
      { k: 'lc', l: 'Lieux relevés', cls: 'l', v: (x) => x.ag, f: (x) => Object.entries((first.locCounts || {})[x.ag] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${esc(l)} <span class="mut">${n}</span>`).join(' · ') || '<span class="z">—</span>' },
    ], ags.map((ag) => ({ ag })), { sort: { k: 'ag', dir: 'asc' } })}</div></section>
  <section class="card"><div class="card-h"><h2>Comment les chiffres sont calculés</h2></div><div class="card-b prose">
    <p><b>Doublons.</b> Une personne présente sur plusieurs lignes d'un même fichier est fusionnée jour par jour : un service l'emporte sur un code (CP, RP…), qui l'emporte sur une case vide ; deux services différents le même jour sont comptés tous les deux. Sur plusieurs semaines, le tableau des agents affiche une seule ligne par personne.</p>
    <p><b>Missions hors colonne.</b> ${r.horsColonne !== 'garder' ? `Une mission dont la date écrite ne correspond pas au jour de sa colonne n'est pas comptée ; elle reste visible, barrée, dans le détail de l'agent. Un service de nuit commencé la veille, ou qui démarre le lendemain avant ${r.horsColonneTolerance} h, reste rattaché à sa colonne.` : 'Toutes les missions sont comptées dans la colonne où elles figurent, quelle que soit la date écrite dans la case.'}</p>
    <p><b>Heures planifiées et heures sup.</b> Durée de chaque service moins ses pauses « P: » et « P2: ». Une ATCMD compte ${r.heuresATCMD} h quelle que soit sa durée. Les absences (CP, RCL, maladie…) n'apportent aucune heure. Les heures sup sont les heures planifiées au-delà de ${r.seuilHebdo} h, semaine par semaine.</p>
    <p><b>Repos hors résidence.</b> Chaque coupure entre deux services passée ailleurs qu'à la résidence de l'agence compte pour un RHR, de jour comme de nuit. Les moyennes RHR ne portent que sur les agents qui en ont eu au moins un : les AFR et les agents sans RHR en sont exclus.</p>
    <p><b>Heures de nuit.</b> Temps travaillé hors pauses entre ${r.nuitAFR[0]} h et ${r.nuitAFR[1]} h pour les AFR, entre ${r.nuitCDR[0]} h et ${r.nuitCDR[1]} h pour les conducteurs.</p>
    <p><b>Comptages.</b> MHIS, DISPO et ATCMD : toute mission dont l'intitulé contient ces lettres, même combiné à autre chose (« MHIS+RNF » compte comme MHIS). Trajet seul : mission dont l'intitulé se réduit à ${esc(r.trajetTypes.join(' ou '))}. Heures du dimanche : temps travaillé hors pauses entre 0 h et 24 h le dimanche.</p>
  </div></section>`;
}
function emptyScope() {
  if (S.loading) return '<section class="card"><div class="empty"><h3>Chargement des semaines…</h3><p>Le serveur gratuit peut mettre jusqu\'à une minute à se réveiller après une période d\'inactivité.</p></div></section>';
  if (!S.weeks.length) return `<section class="card"><div class="empty"><h3>Aucune semaine importée</h3><p>${S.role === 'admin' ? "Déposez un ou plusieurs fichiers « Récap National Corridor » dans l'onglet Import." : "Aucune donnée n'a encore été importée."}</p>${S.role === 'admin' ? '<p class="mt"><button class="btn btn-pri" data-goto="import">Importer</button></p>' : ''}</div></section>`;
  return '<section class="card"><div class="empty"><h3>Aucun agent sur ce périmètre</h3><p>Élargissez le filtre agence ou métier, ou changez de semaine.</p></div></section>';
}

/* ---------------------------------------------------------------- rendu */
function render() {
  if (!S.role) { renderLogin(); return; }
  el('shell').hidden = false; el('login').hidden = true;
  renderFilters(); renderTabs();
  const body = { synthese: viewSynthese, stats: viewStats, agents: viewAgents, rhr: viewRHR, blanches: viewBlanches, exports: viewExports, import: viewImport, reglages: viewReglages }[S.tab] || viewSynthese;
  el('view').innerHTML = (S.msg ? `<div class="note ${S.msg.t || ''}">${esc(S.msg.m)}</div>` : '') + body();
  el('brandsub').textContent = S.weeks.length ? `${S.weeks.length} semaine${S.weeks.length > 1 ? 's' : ''} · ${allAgences().length} agences` : 'Extraction hebdomadaire ARP';
  if (S.drawer) renderDrawer();
}
function renderLogin() {
  el('shell').hidden = true; el('login').hidden = false;
  el('login').innerHTML = `<div class="lg-card"><div class="lg-h"><span class="mark">${window.MARK || ''}</span><div><h1>Récap Corridor</h1><p>Extraction hebdomadaire ARP — repos hors résidence, heures, paniers et données par agent</p></div></div>
    <label class="fld"><span class="flabel">Code d'accès</span><input type="password" id="codeIn" placeholder="XXXX-XXXX-XXXX" autocomplete="current-password"></label>
    ${S.err ? `<div class="note c">${esc(S.err)}</div>` : ''}
    <button class="btn btn-pri lg-b" id="codeGo"${S.busy ? ' disabled' : ''}>${S.busy ? 'Vérification…' : 'Entrer'}</button>
    <p class="lg-n">Données nominatives d'agents : le code est remis par l'administrateur et réservé aux personnes habilitées. Le serveur peut mettre une minute à se réveiller.</p></div>`;
  setTimeout(() => el('codeIn')?.focus(), 30);
}
function renderDrawer() {
  const p = S.drawer; if (!p) return;
  document.querySelector('.ov')?.remove();
  const d = document.createElement('div'); d.className = 'ov';
  const band = (a) => `<div class="band">${a.jours.map((j) => {
    let cls = 'bd', body = '';
    if (j.kind === 'SERVICE') { cls += ' bd-svc'; body = j.missions.map((m) => `<div class="ml">${esc(m.label)}</div><div class="od">${esc(m.from)} → ${esc(m.to)}</div><div class="hr">${hm(m.start)}–${hm(m.end)}${m.pauses && m.pauses.length ? ` · P ${m.pauses.map((x) => hm(x[0]) + '–' + hm(x[1])).join(', ')}` : ''}</div>`).join('<div class="sep"></div>'); }
    else if (j.kind === 'CODE') { cls += j.family === 'HORS' ? ' bd-code bd-hc' : ' bd-code'; body = j.family === 'HORS' ? '<div class="cd">Non compté</div>' : `<div class="cd">${esc(j.code)}</div><div class="od mut">${esc(CODEL[j.family] || '')}</div>`; }
    else if (j.blanche) { cls += ' bd-blanche'; body = `<div class="cd">Journée blanche</div>`; }
    else { cls += ' bd-vide'; body = `<div class="od mut mt">${j.nuitDebordante ? 'fin de service de nuit' : '—'}</div>`; }
    if (j.horsResidence) cls += ' bd-hors';
    if (j.horsColonne) body += `<div class="hc" title="Date écrite différente du jour de la colonne — non compté">${j.horsColonne.map((m) => `<div><s>${esc(m.label)}</s> <span class="mono">${dISO(m.start.slice(0, 10))} ${hm(m.start)}</span></div>`).join('')}<div class="mut">hors colonne, non compté</div></div>`;
    return `<div class="${cls}"><div class="dn"><span>${JS[j.d]}</span><span>${dISO(j.date)}${j.heures ? ' · ' + fmtH(j.heures) : ''}</span></div>${body}</div>`;
  }).join('')}</div>`;
  const weeks = (p.parSemaine || [p]).slice().reverse();
  d.innerHTML = `<div class="dw" role="dialog" aria-label="Détail agent">
    <div class="dw-h"><div><h2>${esc(p.nom)} ${esc(p.prenom)}</h2><div class="s">${esc(p.matricule)} · ${esc(p.agences ? p.agences.join(' → ') : p.agence)} · ${esc(p.metier)} · ${nf(p.nbSemaines || 1)} semaine(s)${p.residence ? ` · résidence ${esc(p.residence)}` : ''}</div></div>
      <button class="x" id="dwx" aria-label="Fermer">×</button></div>
    <div class="ml2">${[['Jours de service', nf(p.joursService)], ['Heures planifiées', fmtH(p.heuresPlanifiees)], ['Heures sup', fmtH(p.heuresSup)], ['RHR', p.rhrApplicable ? nf(p.nbRHR) : 'n/a'],
      ['Temps en RHR', fmtH(p.rhrHeures)], ['Missions', nf(p.nbMissions)], ['Trajets seuls', nf(p.nbTrajetsSeuls)], ['MHIS · DISPO · ATCMD', `${p.nbMHIS} · ${p.nbDISPO} · ${p.nbATCMD}`],
      ['Heures de nuit', fmtH(p.heuresNuit)], ['Heures du dimanche', fmtH(p.heuresDimanche)], ['Paniers', `${nf(p.nbPaniers)} (${nf(p.ratioPanierJS, 2)}/JS)`], ['Journées blanches', nf(p.journeesBlanches)]]
      .map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    ${weeks.map((a) => { const w = S.weeks.find((x) => x.weekId === a.weekId);
      return `<section class="card"><div class="card-h"><div><h2>${w ? weekLabel(w) + ' · ' + weekRange(w) : esc(a.weekId)}</h2><p class="card-s">${esc(a.agence)} · ${fmtH(a.heuresPlanifiees)} planifiées${a.heuresSup ? ` · <b>${fmtH(a.heuresSup)} sup</b>` : ''} · ${a.nbRHR} RHR · ${a.nbPaniers} panier(s)${a.fusion ? ` · <span class="pill pill-n">${a.fusion.lignes} lignes fusionnées</span>` : ''}${a.legacy ? ' · <span class="pill pill-w">pauses non localisées</span>' : ''}${a.nbHorsColonne ? ` · <span class="pill pill-w">${a.nbHorsColonne} hors colonne</span>` : ''}</p></div></div><div class="card-b">${band(a)}</div></section>`; }).join('')}
    <div class="legend"><span class="lg"><span class="sw sw-svc"></span>Service</span><span class="lg"><span class="sw sw-code"></span>Repos / absence</span><span class="lg"><span class="sw sw-bl"></span>Journée blanche</span><span class="lg"><span class="sw sw-hr"></span>Hors résidence</span></div>
  </div>`;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.id === 'dwx') { S.drawer = null; d.remove(); } });
}

/* ---------------------------------------------------------------- import */
async function handleFiles(list) {
  S.err = null; S.msg = null;
  for (const f of [...list].filter(Boolean)) {
    const q = { name: f.name, size: f.size, state: 'lecture' }; S.queue.push(q); render();
    if (!/\.xlsx$/i.test(f.name)) { q.state = 'erreur'; q.err = `${f.name} — seuls les .xlsx sont lus.`; render(); continue; }
    try {
      const { rows } = await E.readRecapSheet(await f.arrayBuffer());
      const parsed = E.parseWeek(rows);
      const view = E.applyRules(parsed, S.rules);
      Object.assign(q, { parsed, view, anom: parsed.anomalies.length, stats: agg(view.agents.map((a) => ({ ...a, weekId: parsed.meta.weekId }))),
        fusions: view.meta.fusions, hc: view.meta.horsColonne.length, existe: S.weeks.some((w) => w.weekId === parsed.meta.weekId) });
      const dup = S.queue.find((o) => o !== q && o.view && o.view.meta.weekId === parsed.meta.weekId && o.state !== 'erreur');
      q.state = dup ? 'erreur' : 'pret';
      if (dup) q.err = `${f.name} — ${weekLabel(parsed.meta)} est déjà dans la liste.`;
    } catch (e) { q.state = 'erreur'; q.err = `${f.name} — ${e.message || e}`; }
    render();
  }
}
function payload(q) {
  const p = q.parsed, agences = [...new Set(p.agents.map((a) => a.agence))].sort();
  return {
    resume: { ...p.meta, agences, metiers: [...new Set(p.agents.map((a) => a.metier))].sort(), fichier: { nom: q.name, taille: q.size }, anomalies: p.anomalies.length },
    details: agences.map((ag) => ({ weekId: p.meta.weekId, agence: ag, agenceSlug: slug(ag), meta: p.meta, agents: p.agents.filter((a) => a.agence === ag) })),
  };
}
async function saveAll() {
  if (S.busy) return; S.busy = true; render();
  let n = 0;
  for (const q of S.queue) {
    if (q.state !== 'pret') continue;
    q.state = 'envoi'; render();
    try { const { resume, details } = payload(q); await api.save(resume, details); S.parsed.set(q.parsed.meta.weekId, q.parsed); q.state = 'enregistre'; n++; }
    catch (e) { q.state = 'erreur'; q.err = `${q.name} — ${e.message || e}`; }
    render();
  }
  S.busy = false;
  const { weeks } = await api.etat(); S.weeks = weeks;
  computeAll();
  S.queue = S.queue.filter((q) => q.state !== 'enregistre');
  S.msg = { m: `${n} semaine${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''}.` };
  if (!S.queue.length && n) S.tab = 'synthese';
  savePrefs(); render(); setTimeout(() => { S.msg = null; render(); }, 5000);
}

/* --------------------------------------------------------------- événements */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-goto],[data-xlsx],[data-csv],[data-sort],[data-row],[data-ag],[data-me],[data-del],[data-delok],[data-delno],[data-col],[data-mode],[data-stat],[data-qdel],#btnTheme,#btnOut,#agAll,#agHeBx,#meAll,#pick,#saveAll,#clearQ,#bkOut,#bkIn,#saveRules,#codeGo,#scopeBtn,#btnPrint,#btnReport');
  if (!t) return;
  const ds = t.dataset;
  if (t.id === 'codeGo') return login();
  if (t.id === 'btnOut') { api.code = ''; S.role = null; S.weeks = []; S.parsed.clear(); S.computed.clear(); savePrefs(); render(); return; }
  if (t.id === 'btnTheme') { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'; savePrefs(); return; }
  if (ds.tab) { S.tab = ds.tab; savePrefs(); render(); return; }
  if (ds.goto) { S.tab = ds.goto; savePrefs(); render(); return; }
  if (t.id === 'scopeBtn') { S.scopeOpen = !S.scopeOpen; render(); return; }
  if (ds.mode) { S.mode = ds.mode; savePrefs(); render(); return; }
  if (ds.stat) { S.statMetric = ds.stat; savePrefs(); render(); return; }
  if (ds.xlsx) { exportXlsx(ds.xlsx); return; }
  if (ds.csv) { exportCsv(ds.csv); return; }
  if (t.id === 'btnPrint') { window.print(); return; }
  if (t.id === 'btnReport') { download(`rapport-recap-corridor-${scopeTag()}.html`, buildReport(), 'text/html;charset=utf-8'); return; }
  if (ds.col) { S.cols[ds.col] = !S.cols[ds.col]; if (!Object.values(S.cols).some(Boolean)) S.cols.identite = true; savePrefs(); render(); return; }
  if (ds.sort) { const [id, k] = ds.sort.split('|'); const cur = S.sorts[id]; S.sorts[id] = cur && cur.k === k ? { k, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: ['agence', 'metier', 'nom', 'matricule', 'lieu', 'aller', 'retour', 'ag', 'semaine', 'date'].includes(k) ? 'asc' : 'desc' }; render(); return; }
  if (ds.row) { const [id, i] = ds.row.split('|'); const r = (S['rows_' + id] || [])[+i]; if (id === 'agents' && r) { S.drawer = r; renderDrawer(); } return; }
  if (ds.ag != null) { const ags = allAgences(); let c = S.selAgences || ags.slice(); c = c.includes(ds.ag) ? c.filter((x) => x !== ds.ag) : [...c, ds.ag]; S.selAgences = c.length && c.length < ags.length ? c : null; savePrefs(); render(); return; }
  if (t.id === 'agAll') { S.selAgences = null; savePrefs(); render(); return; }
  if (t.id === 'agHeBx') { S.selAgences = ['Hendaye', 'Bordeaux-St-Jean']; savePrefs(); render(); return; }
  if (ds.me != null) { const ms = allMetiers(); let c = S.selMetiers || ms.slice(); c = c.includes(ds.me) ? c.filter((x) => x !== ds.me) : [...c, ds.me]; S.selMetiers = c.length && c.length < ms.length ? c : null; savePrefs(); render(); return; }
  if (t.id === 'meAll') { S.selMetiers = null; savePrefs(); render(); return; }
  if (t.id === 'pick') { el('file').click(); return; }
  if (ds.qdel != null) { S.queue.splice(+ds.qdel, 1); render(); return; }
  if (t.id === 'clearQ') { S.queue = []; S.err = null; render(); return; }
  if (t.id === 'saveAll') { saveAll(); return; }
  if (t.id === 'bkOut') { download(`sauvegarde-recap-corridor-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backupData()), 'application/json'); return; }
  if (t.id === 'bkIn') { el('bkFile').click(); return; }
  if (ds.del) { S.delAsk = ds.del; render(); return; }
  if (ds.delno) { S.delAsk = null; render(); return; }
  if (ds.delok) {
    const id = ds.delok; S.delAsk = null;
    try { await api.del(id); S.parsed.delete(id); const { weeks } = await api.etat(); S.weeks = weeks; if (S.selWeek === id) S.selWeek = '__all__'; computeAll(); S.msg = { m: `${id.replace('-', ' ')} supprimée.` }; }
    catch (err) { S.msg = { m: err.message, t: 'c' }; }
    render(); setTimeout(() => { S.msg = null; render(); }, 4000); return;
  }
  if (t.id === 'saveRules') {
    const num = (id, d) => { const v = parseFloat(String(el(id)?.value ?? '').replace(',', '.')); return isFinite(v) ? v : d; };
    S.rules = { ...S.rules,
      rhrMetiers: el('rMet').checked ? ['CONDUCTEUR'] : allMetiers(), rhrCountPending: el('rPend').checked,
      jbExcludeNightOverlap: el('rNight').checked, jbRequireFramed: el('rFramed').checked, panierRHR: el('rPRHR').checked, fusionChevauchement: el('rFus').checked ? 'plus-longue' : 'toutes',
      horsColonne: el('rHC').checked ? 'ecarter' : 'garder', horsColonneTolerance: Math.min(12, Math.max(0, num('rHCT', 6))),
      seuilHebdo: num('rSeuil', 35), heuresATCMD: num('rATCMD', 5), rhrMinHours: Math.max(0, num('rMin', 0)),
      nuitAFR: [num('rNA0', 22), num('rNA1', 7)], nuitCDR: [num('rNC0', 22), num('rNC1', 5)],
      trajetTypes: String(el('rTraj').value).split(/[,;]/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      residences: Object.fromEntries([...document.querySelectorAll('[data-res]')].map((i) => [i.dataset.res, i.value.trim()]).filter(([, v]) => v)) };
    computeAll();
    try { await api.regles(S.rules); S.msg = { m: 'Règles enregistrées — elles s’appliquent à tous les utilisateurs.' }; } catch (err) { S.msg = { m: err.message, t: 'c' }; }
    render(); setTimeout(() => { S.msg = null; render(); }, 5000);
  }
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'fWeek') { S.selWeek = e.target.value; render(); }
  else if (id === 'file') { handleFiles(e.target.files); e.target.value = ''; }
  else if (id === 'bkFile') { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFile(f); }
  else if (id === 'topN') { S.topN = +e.target.value; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'fSearch') return;
  S.search = e.target.value; const p = e.target.selectionStart; render();
  const n = el('fSearch'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (x) { /* ignoré */ } }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.drawer) { S.drawer = null; document.querySelector('.ov')?.remove(); }
  if (e.key === 'Enter' && document.activeElement?.id === 'codeIn') login();
});
document.addEventListener('dragover', (e) => { if (S.role !== 'admin') return; e.preventDefault(); el('drop')?.classList.add('on'); });
document.addEventListener('dragleave', (e) => { const d = el('drop'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('on'); });
document.addEventListener('drop', (e) => {
  if (S.role !== 'admin' || !e.dataTransfer?.files?.length) return;
  e.preventDefault(); el('drop')?.classList.remove('on');
  if (S.tab !== 'import') { S.tab = 'import'; render(); }
  const fs = [...e.dataTransfer.files];
  const bk = fs.find((f) => /\.json$/i.test(f.name));
  if (bk && S.role === 'admin') { restoreFile(bk); return; }
  handleFiles(fs);
});
document.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-tip]'); if (t) tipShow(t.dataset.tip, e.clientX, e.clientY); });
document.addEventListener('mousemove', (e) => { const t = e.target.closest('[data-tip]'); if (t) tipShow(t.dataset.tip, e.clientX, e.clientY); else tipHide(); });

/* ---------------------------------------------------------------- démarrage */
async function login(code) {
  const v = code || el('codeIn')?.value || '';
  if (!v.trim()) return;
  S.busy = true; S.err = null; render();
  api.code = v.trim();
  try { const { role } = await api.session(); S.role = role; S.busy = false; savePrefs(); await boot(); }
  catch (e) { S.busy = false; api.code = ''; S.role = null; S.err = e.status === 401 ? "Code d'accès non reconnu." : 'Connexion impossible : ' + e.message; savePrefs(); render(); }
}
async function boot() {
  S.loading = true; render();
  try {
    const [{ weeks, regles }, { semaines }] = await Promise.all([api.etat(), api.donnees()]);
    S.weeks = weeks || [];
    if (regles) S.rules = { ...E.DEFAULT_RULES, ...regles };
    S.parsed = new Map(Object.entries(semaines || {}));
    computeAll();
    const p = prefs();
    const ags = allAgences(), mets = allMetiers();
    if (p.selAgences) { S.selAgences = p.selAgences.filter((a) => ags.includes(a)); if (!S.selAgences.length) S.selAgences = null; }
    if (p.selMetiers) { S.selMetiers = p.selMetiers.filter((m) => mets.includes(m)); if (!S.selMetiers.length) S.selMetiers = null; }
    if (!p.selAgences && ['Hendaye', 'Bordeaux-St-Jean'].every((a) => ags.includes(a))) S.selAgences = ['Hendaye', 'Bordeaux-St-Jean'];
    if (S.role !== 'admin' && ['import', 'reglages'].includes(S.tab)) S.tab = 'synthese';
  } catch (e) { S.msg = { m: 'Chargement impossible : ' + e.message, t: 'c' }; }
  S.loading = false; render();
}
(function start() {
  const p = prefs();
  if (p.theme) document.documentElement.dataset.theme = p.theme;
  if (p.cols) S.cols = { ...S.cols, ...p.cols };
  if (p.mode) S.mode = p.mode;
  if (p.statMetric && KEY.includes(p.statMetric)) S.statMetric = p.statMetric;
  if (p.tab && TABS.some(([k]) => k === p.tab)) S.tab = p.tab;
  render();
  if (p.code) login(p.code);
})();
