/* ==========================================================================
   RÉCAP CORRIDOR — MOTEUR DE CALCUL
   Module ES utilisé tel quel par le navigateur et par les tests Node.
   Aucune dépendance.

   Deux étages :
   1. parseWeek()  : lecture brute du fichier, indépendante des règles.
                     C'est ce qui est stocké en base.
   2. applyRules() : fusion des doublons + tous les calculs.
                     Rejoué à chaque affichage : changer une règle ne
                     demande jamais de réimporter.
   ========================================================================== */

/* ------------------------------------------------------------------ XLSX */
async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function readZip(ab) {
  const by = new Uint8Array(ab), dv = new DataView(ab);
  let eo = -1;
  const max = Math.min(by.length, 66000);
  for (let i = by.length - 22; i >= by.length - max && i >= 0; i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) lisible.");
  let n = dv.getUint16(eo + 10, true), cd = dv.getUint32(eo + 16, true);
  if (cd === 0xffffffff || n === 0xffff) {
    for (let i = eo - 20; i >= 0; i--) if (dv.getUint32(i, true) === 0x07064b50) {
      const z = Number(dv.getBigUint64(i + 8, true));
      if (dv.getUint32(z, true) === 0x06064b50) { n = Number(dv.getBigUint64(z + 32, true)); cd = Number(dv.getBigUint64(z + 48, true)); }
      break;
    }
  }
  const dec = new TextDecoder('utf-8'), ent = [];
  let p = cd;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let cs = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    let off = dv.getUint32(p + 42, true);
    const name = dec.decode(by.subarray(p + 46, p + 46 + nl));
    if (cs === 0xffffffff || off === 0xffffffff) {
      let e = p + 46 + nl; const end = e + xl;
      while (e < end) {
        const hid = dv.getUint16(e, true), hs = dv.getUint16(e + 2, true);
        if (hid === 1) {
          let q = e + 4;
          if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (cs === 0xffffffff) { cs = Number(dv.getBigUint64(q, true)); q += 8; }
          if (off === 0xffffffff) off = Number(dv.getBigUint64(q, true));
          break;
        }
        e += 4 + hs;
      }
    }
    ent.push({ name, method, cs, off });
    p += 46 + nl + xl + cl;
  }
  const out = new Map();
  for (const e of ent) {
    const nl = dv.getUint16(e.off + 26, true), xl = dv.getUint16(e.off + 28, true);
    const st = e.off + 30 + nl + xl, raw = by.subarray(st, st + e.cs);
    out.set(e.name, { method: e.method, raw });
  }
  // décompression paresseuse : seules les parties utiles sont inflatées
  return {
    has: (k) => out.has(k),
    async text(k) {
      const e = out.get(k); if (!e) return null;
      const bytes = e.method === 0 ? e.raw : await inflateRaw(e.raw);
      return dec.decode(bytes);
    },
  };
}
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENT[e]);
const normTxt = (s) => s.replace(/_x000D_/g, '').replace(/_x000A_/g, '\n').replace(/\r\n?/g, '\n');
function colIdx(r) { const m = /^([A-Z]+)/.exec(r); if (!m) return 0; let n = 0; for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }
function parseSS(x) {
  const o = [];
  for (const m of x.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    let t = '';
    for (const q of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(q[1]);
    o.push(normTxt(t));
  }
  return o;
}
/** Lit la feuille ligne par ligne. `maxCols` borne la lecture aux colonnes utiles. */
function parseSheet(x, ss, maxCols = 60) {
  const rows = [];
  const reRow = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  const reCell = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let r;
  while ((r = reRow.exec(x))) {
    const attrs = r[1] || r[3] || '';
    const rm = /\br="(\d+)"/.exec(attrs);
    const ri = rm ? +rm[1] - 1 : rows.length;
    const cells = [];
    const body = r[2] || '';
    reCell.lastIndex = 0;
    let c;
    while ((c = reCell.exec(body))) {
      const at = c[1] || c[2] || '', bd = c[3] || '';
      const cm = /\br="([A-Z]+)\d+"/.exec(at), tm = /\bt="([^"]+)"/.exec(at);
      const ix = cm ? colIdx(cm[1]) : cells.length;
      if (ix >= maxCols) continue;
      const ty = tm ? tm[1] : 'n';
      let v = null;
      if (ty === 'inlineStr') {
        let t = '';
        for (const q of bd.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(q[1]);
        v = normTxt(t);
      } else {
        const vm = /<v[^>]*>([\s\S]*?)<\/v>/.exec(bd);
        if (vm) {
          const raw = unesc(vm[1]);
          v = ty === 's' ? (ss[+raw] ?? '') : (ty === 'str' || ty === 'e') ? normTxt(raw) : (raw === '' ? null : Number(raw));
        }
      }
      cells[ix] = (typeof v === 'string' && v.trim() === '') ? null : v;
    }
    rows[ri] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}
const serialDate = (n) => {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const d = new Date(Math.round((n - 25569) * 864e5));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
export const deacc = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function readRecapSheet(ab) {
  const zip = await readZip(ab);
  const wb = await zip.text('xl/workbook.xml');
  if (!wb) throw new Error("Classeur Excel (.xlsx) attendu — le fichier ne contient pas de feuille.");
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const rm = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1], tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && tg) rm[id] = tg.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g))
    sheets.push({ name: unesc(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? ''), path: rm[/\br:id="([^"]+)"/.exec(m[1])?.[1]] });
  const tgt = sheets.find((s) => deacc(s.name).toLowerCase().trim().startsWith('recap')) || sheets[0];
  if (!tgt) throw new Error("Aucune feuille trouvée dans le classeur.");
  const ss = zip.has('xl/sharedStrings.xml') ? parseSS(await zip.text('xl/sharedStrings.xml')) : [];
  const sx = (await zip.text('xl/' + tgt.path)) || (await zip.text(tgt.path));
  if (!sx) throw new Error(`La feuille « ${tgt.name} » est introuvable dans le fichier.`);
  return { sheetName: tgt.name, rows: parseSheet(sx, ss) };
}

/* ------------------------------------------------------- lecture métier */
export const JN = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const JS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const CODEF = [
  { k: 'RP', t: (c) => /^RP(-|\b)/i.test(c) }, { k: 'CP', t: (c) => /^CP$/i.test(c) }, { k: 'CPAT', t: (c) => /^CPAT/i.test(c) },
  { k: 'RCL', t: (c) => /^RCL/i.test(c) }, { k: 'RCC', t: (c) => /^RCC/i.test(c) }, { k: 'MAL', t: (c) => /^MAL/i.test(c) },
];
export const CODEL = { RP: 'Repos périodique', CP: 'Congé payé', CPAT: 'Congé CPAT', RCL: 'RCL', RCC: 'RCC', MAL: 'Maladie', AUTRE: 'Autre code', HORS: 'Mission datée hors de sa colonne' };
const codeFam = (c) => { const s = String(c).trim(); for (const f of CODEF) if (f.t(s)) return f.k; return 'AUTRE'; };
const RE_P = /^P(\d?)\s*:/i;
const RE_H = /^(\d{1,2})\s*\/\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2}):(\d{2})\s*$/;
const RE_PF = /^P\d?\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2}):(\d{2})\s*$/i;
const H = 36e5, DAY = 864e5;
function resolveDay(d, mon) { for (let o = -2; o <= 9; o++) { const x = new Date(mon.getTime() + o * DAY); if (x.getUTCDate() === d) return x; } return null; }
function mk(d, h, mi, mon) { const x = resolveDay(d, mon); return x ? new Date(x.getTime() + h * H + mi * 6e4) : null; }
export const r2 = (n) => Math.round(n * 100) / 100;
export function missionType(l) { const s = String(l).trim(); const m = /^(.*?)[-_]\s*\d{2,4}\b/.exec(s); return ((m ? m[1] : s).trim().replace(/\s+/g, ' ')) || s; }

/** Une cellule jour -> {kind:'VIDE'|'CODE'|'SERVICE'} */
export function parseDayCell(raw, mon) {
  if (raw == null) return { kind: 'VIDE' };
  const t = normTxt(String(raw)).trim();
  if (!t) return { kind: 'VIDE' };
  if (!t.includes('\n')) return { kind: 'CODE', code: t, family: codeFam(t) };
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const ms = []; let cur = null; const anom = [];
  for (const line of lines) {
    if (RE_P.test(line)) {
      if (!cur) continue;
      const m = RE_PF.exec(line);
      if (m) {
        const s = mk(+m[1], +m[2], +m[3], mon); let e = mk(+m[4], +m[5], +m[6], mon);
        if (s && e) { if (e < s) e = new Date(e.getTime() + DAY); cur.pauses.push([s, e]); }
      }
      continue;
    }
    const h = RE_H.exec(line);
    if (h && cur) {
      const s = mk(+h[1], +h[2], +h[3], mon); let e = mk(+h[4], +h[5], +h[6], mon);
      if (s && e) { if (e < s) e = new Date(e.getTime() + DAY); cur.start = s; cur.end = e; }
      else anom.push(`horaire illisible « ${line} »`);
      continue;
    }
    if (cur && !cur.od && / - /.test(line)) {
      const i = line.indexOf(' - '); cur.od = true; cur.from = line.slice(0, i).trim(); cur.to = line.slice(i + 3).trim(); continue;
    }
    cur = { label: line, from: null, to: null, od: false, start: null, end: null, pauses: [] }; ms.push(cur);
  }
  for (const m of ms) if (!m.start || !m.end) anom.push(`mission sans horaire « ${m.label} »`);
  const ok = ms.filter((m) => m.start && m.end).sort((a, b) => a.start - b.start);
  if (!ok.length) return { kind: 'CODE', code: lines[0], family: 'AUTRE', anom };
  return {
    kind: 'SERVICE', anom, missions: ok.map((m) => {
      const amp = (m.end - m.start) / H;
      // on ne garde que la partie des pauses comprise dans la mission
      const ps = m.pauses.map(([s, e]) => [new Date(Math.max(s, m.start)), new Date(Math.min(e, m.end))]).filter(([s, e]) => e > s);
      const pm = Math.round(ps.reduce((acc, [s, e]) => acc + (e - s), 0) / 6e4);
      return {
        label: m.label, type: missionType(m.label), from: m.from, to: m.to,
        start: m.start.toISOString(), end: m.end.toISOString(),
        amplitude: r2(amp), pauseMin: pm, travail: r2(amp - pm / 60), nbPauses: ps.length,
        pauses: ps.map(([s, e]) => [s.toISOString(), e.toISOString()]),
      };
    }),
  };
}
function isoWeek(dt) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  ft.setUTCDate(ft.getUTCDate() - ((ft.getUTCDay() + 6) % 7) + 3);
  return { year: d.getUTCFullYear(), week: 1 + Math.round((d - ft) / (7 * DAY)) };
}
export const isoD = (d) => d.toISOString().slice(0, 10);
export const slug = (s) => deacc(s).replace(/[^A-Za-z0-9._~:@+-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';

/** Feuille Récap -> semaine brute (format 2 : horaires de pause conservés) */
export function parseWeek(rows) {
  if (!rows.length) throw new Error('Feuille vide.');
  const r1 = rows[0] || [], r2r = rows[1] || [];
  const hd = r2r.map((c) => (c ? deacc(String(c)).toLowerCase().trim() : ''));
  const fc = (...n) => { for (const x of n) { const i = hd.indexOf(x); if (i >= 0) return i; } return -1; };
  let cMat = fc('matricule'), cNom = fc('nom'), cPre = fc('prenom'), cCor = fc('corridor'),
    cAge = fc('agence'), cMet = fc('metier'), cLun = fc('lundi');
  if (cMat < 0 || cNom < 0 || cLun < 0)
    throw new Error("En-têtes introuvables en ligne 2. Attendu : Matricule, Nom, Prénom, Corridor, Agence, Metier, puis Lundi…Dimanche.");
  if (cPre < 0) cPre = cNom + 1; if (cCor < 0) cCor = cNom + 2; if (cAge < 0) cAge = cNom + 3; if (cMet < 0) cMet = cNom + 4;
  let mon = serialDate(r1[cLun]);
  if (!mon) for (let i = cLun; i < cLun + 7; i++) { const d = serialDate(r1[i]); if (d) { mon = new Date(d.getTime() - (i - cLun) * DAY); break; } }
  if (!mon) throw new Error("Date du lundi introuvable en ligne 1 (cellule juste au-dessus de « Lundi »).");
  const ex = serialDate(r1[2]) || serialDate(r1[1]) || null;
  const days = Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * DAY));
  const { year, week } = isoWeek(mon);
  const anomalies = [], agents = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r.length) continue;
    const mat = r[cMat], nom = r[cNom];
    if (mat == null && nom == null) continue;
    if (!nom && !mat) continue;
    const jours = [];
    for (let d = 0; d < 7; d++) {
      const c = parseDayCell(r[cLun + d], mon);
      (c.anom || []).forEach((a) => anomalies.push({ agent: `${nom ?? ''} ${r[cPre] ?? ''}`.trim(), jour: JN[d], message: a }));
      delete c.anom; jours.push(c);
    }
    agents.push({
      matricule: mat == null ? '' : String(mat).trim(),
      nom: String(nom ?? '').trim(), prenom: String(r[cPre] ?? '').trim(),
      corridor: String(r[cCor] ?? '').trim(),
      agence: String(r[cAge] ?? '').trim() || '(sans agence)',
      metier: String(r[cMet] ?? '').trim().toUpperCase() || '(SANS MÉTIER)',
      jours,
    });
  }
  if (!agents.length) throw new Error("Aucune ligne d'agent trouvée sous les en-têtes.");
  return {
    meta: {
      format: 2, weekId: `${year}-S${String(week).padStart(2, '0')}`, year, week,
      monday: isoD(mon), sunday: isoD(days[6]), days: days.map(isoD),
      extractDate: ex ? isoD(ex) : null, nbAgents: agents.length,
      corridors: [...new Set(agents.map((a) => a.corridor).filter(Boolean))],
    },
    agents, anomalies,
  };
}

/* ------------------------------------------------------ règles de calcul */
export const DEFAULT_RULES = {
  rhrMetiers: ['CONDUCTEUR'],        // les AFR n'ont pas de RHR
  rhrMinHours: 0,
  rhrCountPending: true,
  jbExcludeNightOverlap: true,
  jbRequireFramed: true,
  residences: {},
  seuilHebdo: 35,                    // heures sup au-delà
  heuresATCMD: 5,                    // une ATCMD vaut 5 h de travail
  nuitAFR: [22, 7],                  // heures de nuit AFR
  nuitCDR: [22, 5],                  // heures de nuit conducteurs
  trajetTypes: ['VOY', 'VS'],        // « trajet seul » : intitulé réduit à l'un de ces types
  panierMidi: [11.5, 13.5, 1],       // plage, heures travaillées minimum
  panierSoir: [18.5, 20.5, 1],
  panierNuit: [22, 5, 3],
  panierRHR: true,                   // un RHR qui englobe la plage midi ou soir donne un panier
  fusionChevauchement: 'toutes',     // doublons : 'toutes' = tous les services comptés ; 'plus-longue' = parmi des services qui se chevauchent, seul le plus long reste
  horsColonne: 'ecarter',            // mission dont la date écrite ne correspond pas à sa colonne : 'ecarter' (non comptée, signalée) ou 'garder'
  horsColonneTolerance: 6,           // un service de nuit peut déborder sur le lendemain jusqu'à cette heure
};
export const personKey = (a) => (a.matricule ? 'm:' + a.matricule : 'n:' + deacc(`${a.nom}|${a.prenom}`).toUpperCase());
const isAFR = (metier) => /AFR/i.test(metier || '');

/** Conserve la trace des missions écartées (hors colonne) de toutes les lignes fusionnées */
function withHC(cell, cells) {
  const seen = new Set(), hc = [];
  for (const c of cells) for (const m of c.horsColonne || []) { const k = m.label + '|' + m.start; if (!seen.has(k)) { seen.add(k); hc.push(m); } }
  const { horsColonne, ...rest } = cell;
  return hc.length ? { ...rest, horsColonne: hc } : rest;
}
/** Fusion jour par jour des lignes d'une même personne dans une semaine */
export function mergeDuplicates(agents, rules = DEFAULT_RULES) {
  const groups = new Map(), order = [];
  for (const a of agents) {
    const k = personKey(a);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(a);
  }
  const out = [];
  for (const k of order) {
    const rows = groups.get(k);
    if (rows.length === 1) { out.push({ ...rows[0], fusion: null }); continue; }
    const svcDays = (a) => a.jours.filter((j) => j.kind === 'SERVICE').length;
    const main = rows.reduce((b, a) => (svcDays(a) > svcDays(b) ? a : b), rows[0]);
    let conflits = 0;
    const jours = [];
    for (let d = 0; d < 7; d++) {
      const cells = rows.map((r) => r.jours[d]);
      const svcs = cells.filter((c) => c.kind === 'SERVICE');
      const codes = cells.filter((c) => c.kind === 'CODE');
      const distinct = new Set(cells.filter((c) => c.kind !== 'VIDE').map((c) => JSON.stringify(c)));
      if (distinct.size > 1) conflits++;
      if (svcs.length) {
        const seen = new Set(), ms = [];
        for (const c of svcs) for (const m of c.missions) {
          const key = m.label + '|' + m.start + '|' + m.end;
          if (!seen.has(key)) { seen.add(key); ms.push(m); }
        }
        let keep = ms;
        if (rules.fusionChevauchement === 'plus-longue' && svcs.length > 1) {
          keep = [];
          for (const m of [...ms].sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))) {
            const s = Date.parse(m.start), en = Date.parse(m.end);
            if (!keep.some((k) => s < Date.parse(k.end) && Date.parse(k.start) < en)) keep.push(m);
          }
        }
        keep.sort((a, b) => new Date(a.start) - new Date(b.start));
        jours.push(withHC({ kind: 'SERVICE', missions: keep }, cells));
      } else if (codes.length) {
        // priorité : le code de la ligne principale, puis un vrai code, puis une case « hors colonne »
        const mc = main.jours[d];
        jours.push(withHC(mc.kind === 'CODE' && mc.family !== 'HORS' ? mc : (codes.find((c) => c.family !== 'HORS') || codes[0]), cells));
      } else jours.push({ kind: 'VIDE' });
    }
    out.push({
      ...main, jours,
      fusion: { lignes: rows.length, joursEnConflit: conflits, agences: [...new Set(rows.map((r) => r.agence))] },
    });
  }
  return out;
}
function deduceResidences(agents, rules) {
  const cnt = {}, res = {}, src = {};
  for (const a of agents) {
    if (!rules.rhrMetiers.includes(a.metier)) continue;
    cnt[a.agence] = cnt[a.agence] || {};
    for (const j of a.jours) if (j.kind === 'SERVICE') for (const m of j.missions)
      for (const l of [m.from, m.to]) if (l) cnt[a.agence][l] = (cnt[a.agence][l] || 0) + 1;
  }
  for (const ag of new Set(agents.map((a) => a.agence))) {
    if (rules.residences && rules.residences[ag]) { res[ag] = rules.residences[ag]; src[ag] = 'manuel'; }
    else {
      const b = Object.entries(cnt[ag] || {}).sort((x, y) => y[1] - x[1])[0];
      res[ag] = b ? b[0] : null; src[ag] = b ? 'auto' : 'indéterminée';
    }
  }
  return { residences: res, residenceSource: src, locCounts: cnt };
}

/* intervalles : [début, fin] en millisecondes */
const ovl = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const segOvl = (segs, w0, w1) => segs.reduce((s, [a, b]) => s + ovl(a, b, w0, w1), 0);
/** Segments réellement travaillés : la mission moins ses pauses */
function workSegments(m) {
  const S = Date.parse(m.start), E = Date.parse(m.end);
  const ps = (m.pauses || []).map(([s, e]) => [Date.parse(s), Date.parse(e)]).sort((x, y) => x[0] - y[0]);
  const out = []; let cur = S;
  for (const [s, e] of ps) { if (s > cur) out.push([cur, Math.min(s, E)]); cur = Math.max(cur, e); }
  if (cur < E) out.push([cur, E]);
  return out.filter(([a, b]) => b > a);
}
/** Plage horaire [de, à) d'une date (heures décimales ; à < de = plage à cheval sur minuit) */
function windowOf(dayMs, de, a) { const w0 = dayMs + de * H; const w1 = a > de ? dayMs + a * H : dayMs + DAY + a * H; return [w0, w1]; }
function hoursInDailyWindow(segs, de, a, fromDay, toDay) {
  let t = 0;
  for (let d = fromDay; d <= toDay; d += DAY) { const [w0, w1] = windowOf(d, de, a); t += segOvl(segs, w0, w1); }
  return t / H;
}

/**
 * Missions dont la date écrite dans la case ne correspond pas à la colonne
 * (ex. colonne « Lundi 31/08 » contenant « 29/11:30 - 29/17:30 ») : lignes
 * d'une autre semaine recopiées dans le fichier. Une mission reste rattachée
 * à sa colonne si elle a lieu ce jour-là, y compris un service de nuit commencé
 * la veille ou qui démarre après minuit avant `horsColonneTolerance` heures.
 */
export function splitHorsColonne(agents, days, rules) {
  const tol = (Number(rules.horsColonneTolerance) || 0) * H;
  const out = [], liste = [];
  for (const a of agents) {
    let touched = false;
    const jours = a.jours.map((j, d) => {
      if (j.kind !== 'SERVICE') return j;
      const D = days[d];
      const ok = [], hors = [];
      for (const m of j.missions) {
        const S = Date.parse(m.start), E = Date.parse(m.end);
        (S < D + DAY + tol && E > D ? ok : hors).push(m);
      }
      if (!hors.length) return j;
      touched = true;
      const hc = hors.map((m) => ({ label: m.label, start: m.start, end: m.end }));
      for (const m of hc) liste.push({ agent: `${a.nom} ${a.prenom}`.trim(), matricule: a.matricule, agence: a.agence, jour: JN[d], date: isoD(new Date(D)), ...m });
      return ok.length ? { kind: 'SERVICE', missions: ok, horsColonne: hc } : { kind: 'CODE', code: 'Hors colonne', family: 'HORS', horsColonne: hc };
    });
    out.push(touched ? { ...a, jours } : a);
  }
  return { agents: out, liste };
}

export function applyRules(parsed, rulesIn) {
  const rules = { ...DEFAULT_RULES, ...(rulesIn || {}) };
  const days = parsed.meta.days.map((d) => Date.parse(d + 'T00:00:00Z'));
  const hc = rules.horsColonne === 'garder' ? { agents: parsed.agents, liste: [] } : splitHorsColonne(parsed.agents, days, rules);
  const merged = mergeDuplicates(hc.agents, rules);
  const { residences, residenceSource, locCounts } = deduceResidences(merged, rules);
  const agents = merged.map((a) => computeAgent(a, days, rules, residences[a.agence], parsed.meta));
  return {
    meta: { ...parsed.meta, residences, residenceSource, locCounts, rules,
      fusions: merged.filter((a) => a.fusion).length, lignesFusionnees: merged.reduce((s, a) => s + (a.fusion ? a.fusion.lignes : 0), 0),
      horsColonne: hc.liste },
    agents, anomalies: parsed.anomalies || [],
  };
}
function dayIndexOf(t, days) { for (let i = 0; i < 7; i++) if (t >= days[i] && t < days[i] + DAY) return i; return t < days[0] ? -1 : 7; }
function nights(a, b) { const x = Math.floor(a / DAY), y = Math.floor(b / DAY); return y - x; }

function computeAgent(a, days, rules, residence, meta) {
  const rhrOk = rules.rhrMetiers.includes(a.metier);
  const legacy = !(meta.format >= 2);          // ancien format : horaires de pause inconnus
  const nuitW = isAFR(a.metier) ? rules.nuitAFR : rules.nuitCDR;
  const reTrajet = new Set(rules.trajetTypes.map((x) => String(x).toUpperCase().trim()));
  const jours = a.jours.map((j, d) => ({ ...j, d, date: isoD(new Date(days[d])) }));
  const all = [];
  const c = { joursService: 0, nbMissions: 0, heuresPlanifiees: 0, amplitude: 0, pauseMin: 0, heuresNuit: 0,
    heuresDimanche: 0, nbMHIS: 0, nbDISPO: 0, nbATCMD: 0, nbTrajetsSeuls: 0, weekendTravaille: 0 };
  const codeCounts = {}, types = {};
  let pausesInconnues = 0;
  const sunday0 = days[6], sunday1 = days[6] + DAY;
  for (const j of jours) {
    if (j.kind === 'CODE') codeCounts[j.family] = (codeCounts[j.family] || 0) + 1;
    else if (j.kind === 'SERVICE') {
      c.joursService++; if (j.d >= 5) c.weekendTravaille++;
      let hj = 0;
      for (const m of j.missions) {
        const S = Date.parse(m.start), E = Date.parse(m.end), amp = (E - S) / H;
        const atcmd = /ATCMD/i.test(m.label);
        const segs = workSegments(m);
        if (legacy && m.pauseMin > 0 && !(m.pauses && m.pauses.length)) pausesInconnues++;
        const hPlan = atcmd ? rules.heuresATCMD : Math.max(0, amp - (m.pauseMin || 0) / 60);
        const hNuit = hoursInDailyWindow(segs, nuitW[0], nuitW[1], Math.floor(S / DAY) * DAY - DAY, Math.floor(E / DAY) * DAY);
        const hDim = atcmd ? (amp > 0 ? rules.heuresATCMD * ovl(S, E, sunday0, sunday1) / (E - S) : 0) : segOvl(segs, sunday0, sunday1) / H;
        c.nbMissions++; c.heuresPlanifiees += hPlan; c.amplitude += amp; c.pauseMin += m.pauseMin || 0;
        c.heuresNuit += hNuit; c.heuresDimanche += hDim; hj += hPlan;
        if (/MHIS/i.test(m.label)) c.nbMHIS++;
        if (/DISPO/i.test(m.label)) c.nbDISPO++;
        if (atcmd) c.nbATCMD++;
        const ty = String(m.type || missionType(m.label)).toUpperCase().trim();
        if (reTrajet.has(ty)) c.nbTrajetsSeuls++;
        types[m.type] = (types[m.type] || 0) + 1;
        all.push({ ...m, S, E, segs, atcmd, hPlan, hNuit });
      }
      j.heures = r2(hj);
    }
  }
  all.sort((x, y) => x.S - y.S);

  /* --- RHR : 1 par coupure hors résidence (jour ou nuit) --- */
  const rhr = [], warn = [];
  let pending = 0;
  if (rhrOk && residence) {
    for (let i = 0; i < all.length; i++) {
      const m = all[i]; if (!m.to || m.to === residence) continue;
      const nx = all[i + 1];
      if (nx) {
        const dur = (nx.S - m.E) / H;
        if (dur < rules.rhrMinHours) continue;
        if (nx.from && nx.from !== m.to) warn.push(`reprise à ${nx.from} après une fin de service à ${m.to}`);
        rhr.push({ lieu: m.to, debut: m.end, fin: nx.start, dureeH: r2(dur), nuits: nights(m.E, nx.S),
          jourDebut: dayIndexOf(m.E, days), aller: m.label, retour: nx.label, enCours: false });
      } else if (rules.rhrCountPending) {
        pending = 1;
        rhr.push({ lieu: m.to, debut: m.end, fin: null, dureeH: null, nuits: null,
          jourDebut: dayIndexOf(m.E, days), aller: m.label, retour: null, enCours: true });
      }
    }
  }

  /* --- Journées blanches --- */
  const svcIdx = jours.filter((j) => j.kind === 'SERVICE').map((j) => j.d);
  const f = svcIdx[0] ?? -1, l = svcIdx[svcIdx.length - 1] ?? -1;
  const blanches = [];
  for (const j of jours) {
    if (j.kind !== 'VIDE') continue;
    if (rules.jbRequireFramed && !(f >= 0 && j.d > f && j.d < l)) continue;
    const ds = days[j.d], de = ds + DAY;
    const enService = all.some((m) => m.S < de && m.E > ds);
    if (enService) { j.nuitDebordante = true; if (rules.jbExcludeNightOverlap) continue; }
    const hors = rhr.some((x) => { const s = Date.parse(x.debut), e = x.fin ? Date.parse(x.fin) : Infinity; return s < de && e > ds; });
    const prev = [...jours].filter((y) => y.d < j.d && y.kind === 'SERVICE').pop();
    const next = jours.find((y) => y.d > j.d && y.kind === 'SERVICE');
    blanches.push({ d: j.d, date: j.date, horsResidence: hors,
      finPrec: prev ? prev.missions[prev.missions.length - 1].end : null, debutSuiv: next ? next.missions[0].start : null });
    j.blanche = true; if (hors) j.horsResidence = true;
  }
  for (const x of rhr) {
    const s = Date.parse(x.debut), e = x.fin ? Date.parse(x.fin) : days[6] + DAY;
    for (const j of jours) { const ds = days[j.d]; if (s < ds + DAY && e > ds) j.horsResidence = true; }
  }

  /* --- Paniers repas : un par plage et par date --- */
  const paniers = computePaniers(all, rhr, days, rules);

  const toucheRes = all.some((m) => m.from === residence || m.to === residence);
  const heuresPlanifiees = r2(c.heuresPlanifiees);
  return {
    matricule: a.matricule, nom: a.nom, prenom: a.prenom, agence: a.agence, metier: a.metier, corridor: a.corridor,
    residence: residence || null, rhrApplicable: rhrOk, fusion: a.fusion || null, jours,
    joursService: c.joursService, nbMissions: c.nbMissions,
    heuresPlanifiees, heuresSup: r2(Math.max(0, heuresPlanifiees - rules.seuilHebdo)),
    amplitudeTotale: r2(c.amplitude), pauseTotaleMin: c.pauseMin,
    heuresNuit: r2(c.heuresNuit), heuresDimanche: r2(c.heuresDimanche),
    nbMHIS: c.nbMHIS, nbDISPO: c.nbDISPO, nbATCMD: c.nbATCMD, nbTrajetsSeuls: c.nbTrajetsSeuls,
    weekendTravaille: c.weekendTravaille,
    joursRepos: codeCounts.RP || 0,
    joursCP: (codeCounts.CP || 0) + (codeCounts.CPAT || 0),
    joursAbsence: Object.entries(codeCounts).reduce((s, [k, v]) => s + (k === 'RP' || k === 'HORS' ? 0 : v), 0),
    nbHorsColonne: jours.reduce((s, j) => s + (j.horsColonne ? j.horsColonne.length : 0), 0),
    codeCounts, joursVides: jours.filter((j) => j.kind === 'VIDE').length,
    journeesBlanches: blanches.length, blanches,
    nbRHR: rhr.length, rhrEnCours: pending, rhrHeures: r2(rhr.reduce((s, x) => s + (x.dureeH || 0), 0)),
    rhrNuits: rhr.reduce((s, x) => s + (x.nuits || 0), 0), rhrLieux: [...new Set(rhr.map((x) => x.lieu))], rhr,
    paniers, nbPaniers: paniers.length,
    paniersMidi: paniers.filter((p) => p.plage === 'midi').length,
    paniersSoir: paniers.filter((p) => p.plage === 'soir').length,
    paniersNuit: paniers.filter((p) => p.plage === 'nuit').length,
    paniersRHR: paniers.filter((p) => p.source === 'RHR').length,
    warnings: warn, typesMission: types,
    pausesInconnues, legacy,
    jamaisEnResidence: rhrOk && !!residence && all.length > 0 && !toucheRes,
    premiereMission: all.length ? { label: all[0].label, from: all[0].from, start: all[0].start } : null,
  };
}

function computePaniers(all, rhr, days, rules) {
  const got = new Map();
  const add = (dayMs, plage, source) => { const k = isoD(new Date(dayMs)) + '|' + plage; if (!got.has(k)) got.set(k, { date: isoD(new Date(dayMs)), plage, source }); };
  if (!all.length && !rhr.length) return [];
  const segs = all.flatMap((m) => m.segs);
  const t0 = all.length ? Math.floor(all[0].S / DAY) * DAY - DAY : days[0];
  const t1 = all.length ? Math.floor(Math.max(...all.map((m) => m.E)) / DAY) * DAY : days[6];
  const plages = [['midi', rules.panierMidi], ['soir', rules.panierSoir], ['nuit', rules.panierNuit]];
  for (let d = t0; d <= t1; d += DAY) {
    for (const [nom, [de, a, min]] of plages) {
      const [w0, w1] = windowOf(d, de, a);
      if (segOvl(segs, w0, w1) / H >= min - 1e-9) add(d, nom, 'travail');
    }
  }
  if (rules.panierRHR) {
    for (const x of rhr) {
      const s = Date.parse(x.debut), e = x.fin ? Date.parse(x.fin) : days[6] + DAY;
      for (let d = Math.floor(s / DAY) * DAY; d <= e; d += DAY) {
        for (const [nom, [de, a]] of [['midi', rules.panierMidi], ['soir', rules.panierSoir]]) {
          const [w0, w1] = windowOf(d, de, a);
          if (s <= w0 && e >= w1) add(d, nom, 'RHR');
        }
      }
    }
  }
  return [...got.values()].sort((x, y) => (x.date + x.plage).localeCompare(y.date + y.plage));
}

/** Clôture les RHR ouverts grâce à la première mission de la semaine suivante */
export function reconcile(weeks, rulesIn) {
  const rules = { ...DEFAULT_RULES, ...(rulesIn || {}) };
  const ids = [...weeks.keys()].sort();
  for (let i = 0; i < ids.length - 1; i++) {
    const c = weeks.get(ids[i]), n = weeks.get(ids[i + 1]);
    if (!c || !n) continue;
    if (Date.parse(n.meta.monday + 'T00:00:00Z') - Date.parse(c.meta.sunday + 'T00:00:00Z') !== DAY) continue;
    const idx = new Map(n.agents.map((a) => [personKey(a), a]));
    for (const a of c.agents) {
      const p = a.rhr.find((x) => x.enCours && !x.fin);
      if (!p) continue;
      const pm = (idx.get(personKey(a)) || {}).premiereMission;
      if (!pm) continue;
      const fin = Date.parse(pm.start), deb = Date.parse(p.debut);
      if (fin <= deb) continue;
      p.fin = pm.start; p.dureeH = r2((fin - deb) / H); p.nuits = nights(deb, fin); p.retour = pm.label; p.cloturee = true;
      a.rhrHeures = r2(a.rhr.reduce((s, x) => s + (x.dureeH || 0), 0));
      a.rhrNuits = a.rhr.reduce((s, x) => s + (x.nuits || 0), 0);
      // paniers pris pendant la partie du RHR qui déborde sur la semaine suivante
      if (rules.panierRHR) {
        const seen = new Set(a.paniers.map((q) => q.date + '|' + q.plage));
        const sun1 = Date.parse(c.meta.sunday + 'T00:00:00Z') + DAY;
        for (let d = sun1; d <= fin; d += DAY) for (const [nom, [de, aa]] of [['midi', rules.panierMidi], ['soir', rules.panierSoir]]) {
          const [w0, w1] = windowOf(d, de, aa);
          const k = isoD(new Date(d)) + '|' + nom;
          if (deb <= w0 && fin >= w1 && !seen.has(k)) { a.paniers.push({ date: isoD(new Date(d)), plage: nom, source: 'RHR' }); seen.add(k); }
        }
        a.nbPaniers = a.paniers.length;
        a.paniersMidi = a.paniers.filter((q) => q.plage === 'midi').length;
        a.paniersSoir = a.paniers.filter((q) => q.plage === 'soir').length;
        a.paniersRHR = a.paniers.filter((q) => q.source === 'RHR').length;
      }
    }
  }
}

/* ------------------------------------------------------- agrégations */
/** Mesures additives (sommées sur les lignes agent-semaine) */
export const SUMS = ['joursService', 'nbMissions', 'heuresPlanifiees', 'heuresSup', 'amplitudeTotale', 'heuresNuit',
  'heuresDimanche', 'nbMHIS', 'nbDISPO', 'nbATCMD', 'nbTrajetsSeuls', 'weekendTravaille', 'joursRepos', 'joursCP',
  'joursAbsence', 'journeesBlanches', 'nbRHR', 'rhrHeures', 'rhrNuits', 'nbPaniers', 'paniersMidi', 'paniersSoir',
  'paniersNuit', 'paniersRHR', 'rhrEnCours', 'nbHorsColonne'];
/** Mesures RHR : moyennées uniquement sur les agents qui ont au moins un RHR (ni AFR ni agents à 0) */
export const RHR_KEYS = new Set(['nbRHR', 'rhrHeures', 'rhrNuits']);

export function agg(rows) {
  const g = { nbLignes: rows.length };
  for (const k of SUMS) g[k] = 0;
  const persons = new Set(), personsRHR = new Set(), weeks = new Set();
  let lignesRHR = 0, lignesBlanche = 0;
  for (const a of rows) {
    for (const k of SUMS) g[k] += a[k] || 0;
    persons.add(personKey(a)); weeks.add(a.weekId);
    if (a.nbRHR > 0) { personsRHR.add(personKey(a)); lignesRHR++; }
    if (a.journeesBlanches > 0) lignesBlanche++;
  }
  for (const k of SUMS) g[k] = r2(g[k]);
  g.nbAgents = persons.size;
  g.nbSemaines = weeks.size || 1;
  g.agentsAvecRHR = personsRHR.size;
  g.lignesAvecRHR = lignesRHR;
  g.lignesAvecBlanche = lignesBlanche;
  g.agentsHeuresSup = new Set(rows.filter((a) => a.heuresSup > 0).map(personKey)).size;
  g.ratioPanierJS = g.joursService ? r2(g.nbPaniers / g.joursService) : 0;
  g.heuresParJS = g.joursService ? r2(g.heuresPlanifiees / g.joursService) : 0;
  g.rhrParAgent = g.agentsAvecRHR ? r2(g.nbRHR / g.agentsAvecRHR) : 0;
  g.tempsRHRParAgent = g.agentsAvecRHR ? r2(g.rhrHeures / g.agentsAvecRHR) : 0;
  return g;
}
/**
 * Valeur selon le mode d'affichage :
 *  total   — somme sur la sélection
 *  semaine — moyenne par semaine sélectionnée
 *  agent   — moyenne par agent et par semaine (ligne agent-semaine) ;
 *            pour le RHR, seulement les agents qui ont eu au moins un RHR
 */
export function modeVal(g, k, mode) {
  const v = g[k] ?? 0;
  if (k === 'nbAgents') return mode === 'total' ? v : r2(g.nbLignes / g.nbSemaines);
  if (mode === 'semaine') return r2(v / g.nbSemaines);
  if (mode === 'agent') {
    const den = RHR_KEYS.has(k) ? g.lignesAvecRHR : g.nbLignes;
    return den ? r2(v / den) : 0;
  }
  return v;
}

export function groupBy(l, f) { const m = new Map(); for (const x of l) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

/** Une ligne par personne sur plusieurs semaines (les noms ne sont jamais en double) */
export function mergeAcrossWeeks(rows) {
  const out = [];
  for (const [, list] of groupBy(rows, personKey)) {
    list.sort((a, b) => String(a.weekId).localeCompare(String(b.weekId)));
    const last = list[list.length - 1];
    const p = { ...last, semaines: list.map((a) => a.weekId), parSemaine: list, nbSemaines: list.length,
      agences: [...new Set(list.map((a) => a.agence))], rhr: list.flatMap((a) => a.rhr.map((r) => ({ ...r, weekId: a.weekId }))),
      blanches: list.flatMap((a) => a.blanches.map((b) => ({ ...b, weekId: a.weekId }))),
      rhrLieux: [...new Set(list.flatMap((a) => a.rhrLieux))],
      fusion: list.some((a) => a.fusion) ? { semaines: list.filter((a) => a.fusion).map((a) => a.weekId) } : null,
      legacy: list.some((a) => a.legacy) };
    for (const k of SUMS) p[k] = r2(list.reduce((s, a) => s + (a[k] || 0), 0));
    p.ratioPanierJS = p.joursService ? r2(p.nbPaniers / p.joursService) : 0;
    p.rhrApplicable = list.some((a) => a.rhrApplicable);
    out.push(p);
  }
  return out;
}
