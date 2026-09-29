/* Tests du moteur de calcul, lu directement dans public/index.html (l'application reste une seule page).
   Lancer : npm test  — aucune dépendance, Node 20+. Données 100 % fictives. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const a = html.indexOf('1. LECTURE DU FICHIER'), b = html.indexOf('8. ACCÈS AU SERVEUR');
const code = html.slice(html.lastIndexOf('<script>', a) + 8, html.lastIndexOf('/* ====', b));
const ctx = vm.createContext({ console, Blob, Response, DecompressionStream, TextDecoder, TextEncoder, URL, Date, Math, structuredClone });
vm.runInContext(code + ';globalThis.E={parseWeek,applyRules,reconcile,sliceAgent,moisParts,nettoyerFeuille,readExtract,cocoCalcul,agg,mergeAcrossWeeks,fmtH,fmtHour,buildXlsx,readRecapSheet,vitrineData,loadRules,productionData,conformiteData,equiteData};', ctx);
const E = ctx.E;

/* ---- fabrique de feuilles fictives ---- */
const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5 + 25569;
const HDR = ['Matricule', 'Nom', 'Prénom', 'Corridor', 'Agence', 'Metier', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const p2 = (n) => String(n).padStart(2, '0');
/** mission : [intitulé, départ, arrivée, jour début, 'hh:mm', jour fin, 'hh:mm', pauses?] */
const svc = (...ms) => ms.map(([l, f, t, d1, h1, d2, h2, ps = []]) =>
  [l, `${f} - ${t}`, `${p2(d1)}/${h1} - ${p2(d2)}/${h2}`, ...ps.map(([pd1, ph1, pd2, ph2]) => `P: ${p2(pd1)}/${ph1} - ${p2(pd2)}/${ph2}`)].join('\n')).join('\n');
function week(lundi, agents) {           // lundi = [a, m, j]
  const s = serial(...lundi);
  return [[null, null, null, null, null, null, ...[0, 1, 2, 3, 4, 5, 6].map((i) => s + i)], HDR,
    ...agents.map((x) => [x.mat, x.nom, x.pre || 'P', 'C1', x.ag || 'Hendaye', x.met || 'CONDUCTEUR', ...x.j])];
}
const run = (rows, rules = {}) => E.applyRules(E.parseWeek(rows), rules);
const one = (j, extra = {}, rules) => run(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j, ...extra }]), rules).agents[0];
// semaine du lundi 07/09/2026 au dimanche 13/09/2026
const RES = { residences: { Hendaye: 'HENDAYE' } };

test('la page entière se compile (aucune erreur de syntaxe)', () => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});

test('lecture de la semaine : identifiant ISO et dates', () => {
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: Array(7).fill('RP') }]));
  assert.equal(p.meta.weekId, '2026-S37');
  assert.equal(p.meta.monday, '2026-09-07');
  assert.equal(p.meta.sunday, '2026-09-13');
});

test('en-têtes absents : message clair', () => {
  assert.throws(() => E.parseWeek([[1], ['x', 'y']]), /En-têtes introuvables/);
});

test('RHR : une coupure hors résidence = 1 RHR, durée jusqu’au service suivant', () => {
  const a = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbRHR, 1);
  assert.equal(a.rhr[0].lieu, 'BORDEAUX');
  assert.equal(a.rhr[0].dureeH, 20);
  assert.equal(a.rhr[0].nuits, 1);
});

test('RHR : les AFR sont exclus', () => {
  const a = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], { met: 'AFR' }, RES);
  assert.equal(a.rhrApplicable, false);
  assert.equal(a.nbRHR, 0);
});

test('RHR : coupure ouverte en fin de semaine, clôturée par la semaine suivante', () => {
  const w1 = run(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: ['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['T1', 'HENDAYE', 'BORDEAUX', 13, '06:00', 13, '10:00'])] }]), RES);
  const w2 = run(week([2026, 9, 14], [{ mat: '1', nom: 'A', j: [svc(['T2', 'BORDEAUX', 'HENDAYE', 14, '08:00', 14, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]), RES);
  assert.equal(w1.agents[0].rhrEnCours, 1);
  E.reconcile(new Map([['2026-S37', w1], ['2026-S38', w2]]), RES);
  assert.equal(w1.agents[0].rhr[0].dureeH, 22);
  assert.equal(w2.agents[0].nbRHR, 0);
});

test('journée blanche : case vide encadrée par deux services, lendemain de nuit compris (règle validée par l’utilisateur)', () => {
  const j = [svc(['T', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00']), null, svc(['N', 'HENDAYE', 'HENDAYE', 9, '22:00', 10, '05:00']), null, null, svc(['T', 'HENDAYE', 'HENDAYE', 12, '06:00', 12, '12:00']), 'RP'];
  const a = one(j, {}, RES);
  // mardi, jeudi (lendemain du service de nuit, fini à 05:00) et vendredi : blanches
  assert.equal(JSON.stringify(a.blanches.map((x) => x.d)), "[1,3,4]");
  // l'ancienne exclusion reste réglable
  assert.equal(JSON.stringify(one(j, {}, { ...RES, jbExcludeNightOverlap: true }).blanches.map((x) => x.d)), "[1,4]");
});

test('heures planifiées, pauses, heures sup et ATCMD', () => {
  const j = [0, 1, 2, 3, 4].map((i) => svc(['T', 'HENDAYE', 'HENDAYE', 7 + i, '06:00', 7 + i, '14:00', [[7 + i, '10:00', 7 + i, '10:30']]]));
  const a = one([...j, svc(['ATCMD', 'HENDAYE', 'HENDAYE', 12, '06:00', 12, '14:00']), 'RP'], {}, RES);
  assert.equal(a.heuresPlanifiees, 5 * 7.5 + 5);
  assert.equal(a.heuresSup, 7.5);
  assert.equal(a.nbATCMD, 1);
  assert.equal(a.pauseTotaleMin, 150);
});

test('ATCMD : 5 h de TTE, mais l’amplitude reste l’horaire réel de la case', () => {
  const a = one([svc(['ATCMD', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '14:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.heuresPlanifiees, 5);
  assert.equal(a.amplitudeTotale, 8);
});

test('ATCMD : les paniers se lisent sur la plage horaire réelle, pas sur les 5 h de TTE', () => {
  const a = one([svc(['ATCMD', 'HENDAYE', 'HENDAYE', 7, '10:00', 7, '20:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.heuresPlanifiees, 5);
  assert.equal(a.paniersMidi, 1);
  assert.equal(a.paniersSoir, 1);
  assert.equal(a.nbPaniers, 2);
});

test('mission de moins de 5 h d’amplitude : comptée 5 h (amplitude et TTE), chaque mission à part, ATCMD à part', () => {
  const j = [svc(['T1', 'HENDAYE', 'BAYONNE', 7, '06:00', 7, '09:00'], ['T2', 'BAYONNE', 'HENDAYE', 7, '12:00', 7, '14:00']),
    svc(['T3', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '14:00', [[8, '10:00', 8, '10:30']]]),
    svc(['ATCMD', 'HENDAYE', 'HENDAYE', 9, '10:00', 9, '12:00']), 'RP', 'RP', 'RP', 'RP'];
  const a = one(j, {}, RES);
  // lundi : 2 missions courtes = 5 + 5 ; mardi : 8 h d'amplitude, 7h30 de TTE ; mercredi : ATCMD 2 h réelles, 5 h de TTE
  assert.equal(a.amplitudeTotale, 5 + 5 + 8 + 2);
  assert.equal(a.heuresPlanifiees, 5 + 5 + 7.5 + 5);
  const b = one(j, {}, { ...RES, minMission: 0 });
  assert.equal(b.amplitudeTotale, 3 + 2 + 8 + 2);
  assert.equal(b.heuresPlanifiees, 3 + 2 + 7.5 + 5);
});

test('ATCMD : heures de nuit et du dimanche ramenées aux 5 h, au prorata de l’horaire réel', () => {
  // dimanche 13/09 20:00 → lundi 14/09 06:00 : 10 h réelles, 7 h dans 22h–5h, 4 h le dimanche
  const a = one(['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['ATCMD', 'HENDAYE', 'HENDAYE', 13, '20:00', 14, '06:00'])], {}, RES);
  assert.equal(a.amplitudeTotale, 10);
  assert.equal(a.heuresPlanifiees, 5);
  assert.equal(a.heuresNuit, 3.5);
  assert.equal(a.heuresDimanche, 2);
});

test('mission de moins de 5 h : nuit et dimanche ramenés aux 5 h, au prorata du temps travaillé réel', () => {
  // dimanche 13/09 : VOY 10:00–13:00 (3 h) → 5 h de dimanche ; lundi 07/09 23:00 → mardi 02:00 (3 h de nuit) → 5 h de nuit
  const a = one([svc(['N', 'HENDAYE', 'HENDAYE', 7, '23:00', 8, '02:00']), 'RP', 'RP', 'RP', 'RP', 'RP', svc(['VOY-1', 'HENDAYE', 'BAYONNE', 13, '10:00', 13, '13:00'])], {}, RES);
  assert.equal(a.heuresDimanche, 5);
  assert.equal(a.heuresNuit, 5);
  const b = one([svc(['N', 'HENDAYE', 'HENDAYE', 7, '23:00', 8, '02:00']), 'RP', 'RP', 'RP', 'RP', 'RP', svc(['VOY-1', 'HENDAYE', 'BAYONNE', 13, '10:00', 13, '13:00'])], {}, { ...RES, minMission: 0 });
  assert.equal(b.heuresDimanche, 3);
  assert.equal(b.heuresNuit, 3);
});

test('deux missions de 4 h dans la semaine : 10 h au décompte', () => {
  const a = one([svc(['T1', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '10:00']), 'RP', svc(['T2', 'HENDAYE', 'HENDAYE', 9, '06:00', 9, '10:00']), 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.heuresPlanifiees, 10);
});

test('mission sans horaire : signalée, puis comptée une fois l’horaire saisi', () => {
  const cell = 'TRAIN X\nHENDAYE - BORDEAUX';
  const rows = week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: [cell, svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'] }]);
  const p = E.parseWeek(rows);
  const an = p.anomalies.find((x) => /sans horaire/.test(x.message));
  assert.equal(an.pk, 'm:1');
  assert.equal(an.date, '2026-09-07');
  assert.equal(E.applyRules(p, RES).agents[0].nbRHR, 0);
  const corr = { corrections: { rhr: {}, jb: {}, liens: [], horaires: { 'm:1|2026-09-07|TRAIN X': { debut: '18:00', fin: '22:00' } } } };
  const a = E.applyRules(p, { ...RES, ...corr }).agents[0];
  assert.equal(a.nbMissions, 2);
  assert.equal(a.nbRHR, 1);
  assert.equal(a.rhr[0].lieu, 'BORDEAUX');
  assert.equal(a.rhr[0].dureeH, 8);
});

test('heures de nuit hors pauses : conducteurs 22h–5h, AFR 22h–7h', () => {
  const j = [svc(['N', 'HENDAYE', 'HENDAYE', 7, '21:00', 8, '07:00', [[8, '01:00', 8, '02:00']]]), null, null, null, null, null, null];
  assert.equal(one(j, {}, RES).heuresNuit, 6);
  assert.equal(one(j, { met: 'AFR' }, RES).heuresNuit, 8);
});

test('heures du dimanche', () => {
  const a = one(['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['T', 'HENDAYE', 'HENDAYE', 13, '20:00', 14, '02:00'])], {}, RES);
  assert.equal(a.heuresDimanche, 4);
});

test('paniers : midi, soir, nuit', () => {
  const a = one([svc(['T', 'HENDAYE', 'HENDAYE', 7, '11:00', 7, '21:00']), svc(['N', 'HENDAYE', 'HENDAYE', 8, '22:00', 9, '04:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.paniersMidi, 1);
  assert.equal(a.paniersSoir, 1);
  assert.equal(a.paniersNuit, 1);
});

test('paniers : plage lue sur l’horaire de la mission, pauses comprises (12:30–19:30 = midi + soir)', () => {
  // pause de 18:15 à 19:05 : il ne reste que 25 min travaillées dans 18h30–20h30, mais l'horaire couvre 1 h de la plage
  const a = one([svc(['DELEG', 'BX', 'BX', 7, '12:30', 7, '19:30', [[7, '18:15', 7, '19:05']]]), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, { residences: { Hendaye: 'BX' } });
  assert.equal(a.paniersMidi, 1);
  assert.equal(a.paniersSoir, 1);
  assert.equal(a.nbPaniers, 2);
});

test('comptages MHIS / DISPO / trajets seuls', () => {
  const a = one([svc(['VS+MHIS', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '08:00'], ['DISPO', 'HENDAYE', 'HENDAYE', 7, '09:00', 7, '10:00'], ['VOY', 'HENDAYE', 'HENDAYE', 7, '11:00', 7, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbMHIS, 1);
  assert.equal(a.nbDISPO, 1);
  assert.equal(a.nbTrajetsSeuls, 1);
});

test('agents en double : fusion jour par jour', () => {
  const v = run(week([2026, 9, 7], [
    { mat: '9', nom: 'D', j: [svc(['T', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00']), null, 'RP', null, null, null, null] },
    { mat: '9', nom: 'D', j: [null, svc(['T', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '12:00']), null, null, null, null, null] },
  ]), RES);
  assert.equal(v.agents.length, 1);
  assert.equal(v.agents[0].joursService, 2);
  assert.equal(v.agents[0].joursRepos, 1);
});

test('mission datée hors de sa colonne : non comptée, signalée', () => {
  const v = run(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: [svc(['T', 'HENDAYE', 'HENDAYE', 5, '06:00', 5, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]), RES);
  assert.equal(v.agents[0].joursService, 0);
  assert.equal(v.meta.horsColonne.length, 1);
});

test('affichage des durées : jamais « 7h60 »', () => {
  assert.equal(E.fmtH(7.999), '8h00');
  assert.equal(E.fmtH(7.5), '7h30');
  assert.equal(E.fmtHour(5.9999), '06h00');
});

test('classeur Excel produit puis relu', async () => {
  const x = E.buildXlsx([{ name: 'Récap', cols: [{ t: 'Matricule' }, { t: 'Nom' }], rows: [['12', 'DUPONT']] }]);
  const r = await E.readRecapSheet(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength));
  assert.equal(r.sheetName, 'Récap');
  assert.equal(JSON.stringify(r.rows[1]), JSON.stringify(["12", "DUPONT"]));
});

/* ---- règles précisées par l'utilisateur (septembre 2026) ---- */
test('RHR : un arrêt de 30 min hors résidence ne compte pas, un arrêt de 12 h dans la même case compte', () => {
  const a = one([svc(['VOY-1', 'HENDAYE', 'IRUN', 7, '08:00', 7, '09:00'], ['T-2', 'IRUN', 'HENDAYE', 7, '09:30', 7, '11:00']),
    svc(['VOY-3', 'HENDAYE', 'BORDEAUX', 8, '08:00', 8, '11:30'], ['T-4', 'BORDEAUX', 'HENDAYE', 8, '23:30', 9, '07:12']), null, 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbRHR, 1);
  assert.equal(a.rhr[0].lieu, 'BORDEAUX');
  assert.equal(a.coupures.find((c) => c.lieu === 'IRUN').statut, 'court');
});

test('lieux comparés sans majuscules ni accents', () => {
  const a = one([svc(['T1', 'HENDAYE', 'Hendaye ', 7, '06:00', 7, '10:00']), svc(['T2', 'hendaye', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbRHR, 0);
});

test('corrections mémorisées : coupure écartée, coupure forcée, missions liées, lieu appris', () => {
  const j = [svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'DAX', 8, '06:00', 8, '10:00']), svc(['T3', 'DAX', 'HE', 9, '06:00', 9, '10:00']), null, null, null, null];
  const base = one(j, {}, RES);
  assert.equal(base.nbRHR, 3);                            // BORDEAUX, DAX, et HE (écriture inconnue de la résidence)
  const k = base.coupures.find((c) => c.lieu === 'BORDEAUX').key;
  assert.equal(one(j, {}, { ...RES, corrections: { rhr: { [k]: 'non' } } }).nbRHR, 2);
  assert.equal(one(j, {}, { ...RES, lieuxResidence: { Hendaye: ['he'] } }).nbRHR, 2);
  const lie = one(j, {}, { ...RES, lieuxResidence: { Hendaye: ['HE'] }, corrections: { liens: [{ p: 'm:1', a: base.missions[0].start, b: base.missions[2].start }] } });
  assert.equal(lie.nbRHR, 1);
  assert.equal(lie.rhr[0].dureeH, 44);
});

test('journée blanche : corrections jour par jour et raison des cases non comptées', () => {
  const j = [svc(['T', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00']), null, svc(['T', 'HENDAYE', 'HENDAYE', 9, '18:00', 10, '02:00']), null, svc(['T', 'HENDAYE', 'HENDAYE', 11, '06:00', 11, '12:00']), 'RP', null];
  const a = one(j, {}, { ...RES, jbExcludeNightOverlap: true });
  assert.equal(a.journeesBlanches, 1);
  assert.equal(a.casesVides.find((c) => c.d === 3).raison, 'fin du service de nuit à 02:00');
  assert.equal(one(j, {}, RES).journeesBlanches, 2);
  assert.equal(a.casesVides.find((c) => c.d === 6).raison, 'après le dernier service de la semaine');
  const N = { ...RES, jbExcludeNightOverlap: true };
  assert.equal(one(j, {}, { ...N, corrections: { jb: { 'm:1|2026-09-08': 'non' } } }).journeesBlanches, 0);
  assert.equal(one(j, {}, { ...N, corrections: { jb: { 'm:1|2026-09-13': 'oui' } } }).journeesBlanches, 2);
});

test('ancien format : jours en ligne 1, dates en ligne 2, métier dans « Commentaires », codes « CP/CP »', () => {
  const s = serial(2025, 12, 29);
  const rows = [
    [null, null, 'Extrait ARP effectué le : ', 'Lundi 22 Décembre 2025', null, null, 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
    ['Matricule', 'Prenom', 'Nom', 'Region', 'Residence', 'Commentaires', s, s + 1, s + 2, s + 3, s + 4, s + 5, s + 6],
    [11, 'LUC', 'TEST', 'CEW', 'Agence Bordeaux', 'CDR', 'CP/CP', 'ENTRETIEN\nVS-251-BX\nBX - BX\n30/8:00 - 30/14:00', 'JF/JF', null, null, 'RP-1', 'RP-2'],
    [12, 'ANA', 'ESSAI', 'CEW', 'Agence Bordeaux', 'CDR + AFR', null, null, null, null, null, null, null],
    [null, 'Congé', 'CP + RF + RCC + RP'],
  ];
  const p = E.parseWeek(rows);
  assert.equal(p.meta.weekId, '2026-S01');
  assert.equal(p.meta.extractDate, '2025-12-22');
  assert.equal(p.agents.length, 2);
  assert.equal(p.agents[0].metier, 'CONDUCTEUR');
  assert.equal(p.agents[1].metier, 'CONDUCTEUR');
  assert.equal(p.anomalies.length, 0);
  const v = E.applyRules(p, { agencesAlias: { 'Agence Bordeaux': 'Bordeaux-St-Jean' } });
  const a = v.agents[0];
  assert.equal(a.agence, 'Bordeaux-St-Jean');
  assert.equal(a.jours[0].family, 'CP');
  assert.equal(a.jours[0].code, 'CP');
  assert.equal(a.jours[2].family, 'JF');
  assert.equal(a.jours[1].missions[0].label, 'VS-251-BX');
  assert.equal(a.jours[1].missions[0].note, 'ENTRETIEN');
});

test('journée blanche : comptée la veille d’une reprise après minuit, sauf si l’agent est hors résidence', () => {
  // à la résidence : mardi vide, reprise mercredi 01h28 -> journée blanche
  const a = one([svc(['T', 'HENDAYE', 'HENDAYE', 7, '14:00', 7, '22:20']), null, svc(['T', 'HENDAYE', 'HENDAYE', 9, '01:28', 9, '08:00']), 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.journeesBlanches, 1);
  // hors résidence : fin lundi à BORDEAUX, mardi vide, reprise mercredi de BORDEAUX -> pas de journée blanche
  const b = one([svc(['T', 'HENDAYE', 'BORDEAUX', 7, '14:00', 7, '22:20']), null, svc(['T', 'BORDEAUX', 'HENDAYE', 9, '01:28', 9, '08:00']), 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(b.nbRHR, 1);
  assert.equal(b.journeesBlanches, 0);
  assert.equal(b.casesVides[0].raison, 'agent hors résidence ce jour-là (RHR)');
});

test('RHR ouvert en fin de semaine : écarté à la clôture s’il dure moins que le minimum', () => {
  const w1 = run(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: ['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['T1', 'HENDAYE', 'IRUN', 13, '20:00', 13, '22:00'])] }]), RES);
  const w2 = run(week([2026, 9, 14], [{ mat: '1', nom: 'A', j: [svc(['T2', 'IRUN', 'HENDAYE', 13, '23:30', 14, '01:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]), RES);
  assert.equal(w1.agents[0].nbRHR, 1);
  E.reconcile(new Map([['2026-S37', w1], ['2026-S38', w2]]), RES);
  assert.equal(w1.agents[0].nbRHR, 0);
  assert.equal(w1.agents[0].rhrEnCours, 0);
  assert.equal(w1.agents[0].coupures[0].statut, 'court');
});

/* ---- accord d'entreprise ECR 2018 (art. 8, 18, 19, annexe 1) ---- */
test('accord : un arrêt de moins de 8 h n’est pas un RHR, un arrêt de 9 h en journée en est un', () => {
  const a = one([svc(['VS', 'HENDAYE', 'BORDEAUX', 7, '06:20', 7, '10:00'], ['KVG', 'BORDEAUX', 'HENDAYE', 7, '19:00', 8, '01:01']),
    svc(['VS', 'HENDAYE', 'DAX', 8, '12:00', 8, '14:00'], ['KVG', 'DAX', 'HENDAYE', 8, '19:00', 8, '23:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbRHR, 1);
  assert.equal(a.rhr[0].lieu, 'BORDEAUX');
  assert.equal(a.coupures.find((c) => c.lieu === 'DAX').statut, 'court');
});

test('accord : un arrêt qui contient un jour de repos n’est pas un RHR (repos périodique = repos à résidence)', () => {
  const a = one(['RP', svc(['T', 'LILLE', 'LILLE', 8, '15:00', 8, '23:49']), svc(['T', 'LILLE', 'LILLE', 9, '15:00', 9, '23:49']), 'JF', 'RP',
    svc(['V', 'LILLE', 'PARIS', 12, '19:40', 12, '23:10']), svc(['N', 'PARIS', 'LILLE', 13, '17:44', 13, '23:10'])], {}, RES);
  const st = a.coupures.map((c) => c.statut).join(',');
  assert.equal(st, 'rhr,repos,rhr,ouvert');
  assert.equal(a.nbRHR, 3);
});

test('accord : tranches de prime et RHR successifs', () => {
  const a = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00'], ['T2', 'BORDEAUX', 'DAX', 7, '20:00', 7, '23:00']), null,
    svc(['T3', 'DAX', 'HENDAYE', 9, '06:00', 9, '10:00']), null, null, 'RP', 'RP'], {}, RES);
  // BORDEAUX 10 h (8–12 h), puis DAX 31 h (24 h et plus), sans retour à résidence entre les deux
  assert.equal(a.rhr8_12, 1);
  assert.equal(a.rhr24, 1);
  assert.equal(a.rhrSuccessifs, 1);
});

test('accord : rattachement temporaire à une autre résidence pour une semaine (art. 8)', () => {
  const j = ['RP', svc(['T', 'LILLE', 'LILLE', 8, '15:00', 8, '23:49']), svc(['T', 'LILLE', 'LILLE', 9, '15:00', 9, '23:49']), null, null, null, null];
  assert.equal(one(j, {}, RES).nbRHR, 2);
  assert.equal(one(j, {}, { ...RES, corrections: { residenceSemaine: { 'm:1|2026-S37': 'LILLE' } } }).nbRHR, 0);
});

test('journée blanche en début ou fin de semaine : encadrée par la semaine voisine', () => {
  const w1 = run(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: ['RP', svc(['T', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '12:00']), 'RP', 'RP', 'RP', svc(['T', 'HENDAYE', 'HENDAYE', 12, '06:00', 12, '12:00']), null] }]), RES);
  const w2 = run(week([2026, 9, 14], [{ mat: '1', nom: 'A', j: [null, svc(['T', 'HENDAYE', 'HENDAYE', 15, '06:00', 15, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP'] }]), RES);
  E.reconcile(new Map([['2026-S37', w1]]), RES);
  assert.equal(w1.agents[0].journeesBlanches, 0);
  assert.match(w1.agents[0].casesVides[0].raison, /semaine suivante non importée/);
  E.reconcile(new Map([['2026-S37', w1], ['2026-S38', w2]]), RES);
  assert.equal(w1.agents[0].journeesBlanches, 1);          // dimanche 13/09
  assert.equal(w2.agents[0].journeesBlanches, 1);          // lundi 14/09
  assert.equal(w2.agents[0].casesVides[0].avant.end, '2026-09-12T12:00:00.000Z');
});

test('codes classés : repos (RP, RF, JF, RCL, RCC), congés (CP, CPAT, CFAM, CSS/CPAR), absences (le reste)', () => {
  const a = one(['RP-1', 'RF/RF', 'JF', 'CPAR/CPAR', 'CFAM', 'AT/AT', 'CPRCL'], {}, RES);
  assert.equal(a.joursRepos, 3);
  assert.equal(a.joursCP, 2);
  assert.equal(a.joursAbsence, 2);
});

/* ---- vitrine anonyme (code visiteur) ---- */
test('vitrine : aucune donnée nominative, groupes d’au moins 5 agents, petits groupes fusionnés ou écartés', () => {
  const ag = (mat, nom, agence, met) => ({ mat, nom, ag: agence, met, j: [svc(['T', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), null, 'RP', 'RP', 'RP', 'RP'] });
  const agents = [...[1, 2, 3, 4, 5, 6].map((i) => ag('10' + i, 'NOMSECRET' + i, 'Hendaye', 'CONDUCTEUR')),
    ...[1, 2].map((i) => ag('20' + i, 'NOMSECRET' + i, 'Hendaye', 'AFR')),
    ...[1, 2, 3].map((i) => ag('30' + i, 'NOMSECRET' + i, 'Dax', 'CONDUCTEUR'))];
  const v = E.vitrineData([E.parseWeek(week([2026, 9, 7], agents))], E.loadRules({ residences: { Hendaye: 'HENDAYE', Dax: 'DAX' } }));
  const txt = JSON.stringify(v);
  assert.ok(!/NOMSECRET|"10[1-6]"|matricule|"nom"/.test(txt), 'aucun nom ni matricule');
  assert.ok(v.cells.every((c) => c.n >= 5));
  assert.equal(v.cells.length, 1);                       // Hendaye tous métiers (6 + 2), Dax (3) écarté
  assert.equal(v.cells[0].me, 'Tous métiers');
  assert.equal(v.cells[0].n, 8);
  assert.equal(v.ecartes, 3);
  assert.equal(v.cells[0].s.nbRHR, 6);
});

test('vitrine : un trajet n’est publié que si au moins 5 agents différents l’empruntent', () => {
  const ag = (mat, dest) => ({ mat, nom: 'X' + mat, ag: 'Hendaye', met: 'CONDUCTEUR', j: [svc(['T', 'HENDAYE', dest, 7, '06:00', 7, '10:00']), svc(['T', dest, 'HENDAYE', 8, '06:00', 8, '10:00']), null, 'RP', 'RP', 'RP', 'RP'] });
  const agents = [...[1, 2, 3, 4, 5].map((i) => ag('1' + i, 'BORDEAUX')), ...[1, 2].map((i) => ag('2' + i, 'DAX'))];
  const v = E.vitrineData([E.parseWeek(week([2026, 9, 7], agents))], E.loadRules({ residences: { Hendaye: 'HENDAYE' } }));
  const e = v.flux[0].edges.map((x) => x.a + '-' + x.b).join(',');
  assert.equal(e, 'BORDEAUX-HENDAYE');
  assert.equal(v.flux[0].rhr.map((x) => x.l).join(','), 'BORDEAUX');
});

test('agent exclu des chiffres : signalé, et retiré de la vitrine', () => {
  const agents = [1, 2, 3, 4, 5, 6].map((i) => ({ mat: '4' + i, nom: 'Y' + i, j: [svc(['T', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), null, 'RP', 'RP', 'RP', 'RP'] }));
  const rules = E.loadRules({ residences: { Hendaye: 'HENDAYE' }, corrections: { exclus: { 'm:41': { motif: 'test' }, 'm:42|2026-S37': { motif: 'semaine' } } } });
  const v = E.applyRules(E.parseWeek(week([2026, 9, 7], agents)), rules);
  assert.equal(v.agents.filter((a) => a.exclu).length, 2);
  const vit = E.vitrineData([E.parseWeek(week([2026, 9, 7], agents))], rules);
  assert.equal(vit.cells.length, 0);                    // 4 agents restants : sous le seuil de 5
  assert.equal(vit.ecartes, 4);
});

test('résidence propre à l’agent à partir d’une semaine (mouvement d’agence)', () => {
  const j = [svc(['T', 'LILLE', 'LILLE', 7, '06:00', 7, '14:00']), svc(['T', 'LILLE', 'LILLE', 8, '06:00', 8, '14:00']), null, null, null, null, null];
  assert.equal(one(j, {}, RES).nbRHR, 2);
  const a = one(j, {}, { ...RES, corrections: { residenceAgent: { 'm:1|2026-S37': 'LILLE' } } });
  assert.equal(a.nbRHR, 0);
  assert.equal(a.residence, 'LILLE');
  assert.equal(one(j, {}, { ...RES, corrections: { residenceAgent: { 'm:1|2026-S38': 'LILLE' } } }).nbRHR, 2);   // à partir de la semaine suivante seulement
});

test('paniers en RHR : un par plage touchée, midi et soir (règle précisée par l’utilisateur)', () => {
  // RHR à BORDEAUX de 12h00 à 20h00 : touche la plage du midi et celle du soir → 2 paniers
  const a = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '04:00', 7, '12:00'], ['T2', 'BORDEAUX', 'HENDAYE', 7, '20:00', 7, '23:30']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.nbRHR, 1);
  assert.equal(a.paniersRHR, 2);
  // RHR de 13h15 à 19h00 : midi et soir déjà obtenus par le travail (1 h dans chaque plage) → pas de doublon
  const b = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '04:00', 7, '13:15'], ['T2', 'BORDEAUX', 'HENDAYE', 7, '19:00', 7, '23:30']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, { ...RES, rhrMinHours: 5 });
  assert.equal(b.paniersMidi + b.paniersSoir, 2);
  assert.equal(b.paniersRHR, 0);
  // RHR de 14h00 à 22h30 : touche seulement la plage du soir (le midi vient du travail)
  const c = one([svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '04:00', 7, '14:00'], ['T2', 'BORDEAUX', 'HENDAYE', 7, '22:30', 7, '23:30']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(c.paniers.filter((p) => p.source === 'RHR').map((p) => p.plage).join(','), 'soir');
});

/* ---- blindage amplitude / TTE : minutes exactes, sans dérive d'arrondi ---- */
test('amplitude et TTE : cinq missions de 7h25 = 37h05 exactement (pas 37h06)', () => {
  const j = [7, 8, 9, 10, 11].map((d) => svc(['T', 'HENDAYE', 'HENDAYE', d, '06:00', d, '13:25']));
  const a = one([...j, 'RP', 'RP'], {}, RES);
  assert.equal(Math.round(a.amplitudeTotale * 60), 5 * 445);
  assert.equal(E.fmtH(a.amplitudeTotale), '37h05');
  assert.equal(E.fmtH(a.heuresPlanifiees), '37h05');
  assert.equal(E.fmtH(a.heuresSup), '2h05');
});

test('pauses : deux pauses qui se chevauchent ne sont déduites qu’une fois ; une pause hors mission est rognée et signalée', () => {
  const rows = week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: [
    svc(['T', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '14:00', [[7, '10:00', 7, '10:30'], [7, '10:15', 7, '10:45']]]),
    svc(['T', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '14:00', [[8, '13:30', 8, '14:30']]]),
    'RP', 'RP', 'RP', 'RP', 'RP'] }]);
  const p = E.parseWeek(rows), a = E.applyRules(p, RES).agents[0];
  assert.equal(a.pauseTotaleMin, 45 + 30);
  assert.equal(Math.round(a.heuresPlanifiees * 60), 8 * 60 - 45 + 8 * 60 - 30);
  assert.ok(p.anomalies.some((x) => /en dehors de la mission/.test(x.message)));
});

test('pause illisible : signalée (elle n’est pas déduite du TTE)', () => {
  const cell = 'T\nHENDAYE - HENDAYE\n07/06:00 - 07/14:00\nP: 10h-10h30';
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: [cell, 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  assert.ok(p.anomalies.some((x) => /pause illisible/.test(x.message)));
});

test('contrôle aléatoire : 400 semaines d’agent, amplitude et TTE identiques au calcul de référence à la minute près', () => {
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const hh = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
  const all = []; let refAmpTot = 0, refTteTot = 0;
  for (let k = 0; k < 400; k++) {
    const j = []; let refAmp = 0, refTte = 0;
    for (let d = 0; d < 7; d++) {
      if (rnd(4) === 0) { j.push('RP'); continue; }
      const ms = []; let t = rnd(8 * 60);
      for (let n = 1 + rnd(3); n > 0 && t < 22 * 60; n--) {
        const len = 30 + rnd(9 * 60), s = t, e = Math.min(s + len, 23 * 60 + 59), day = 7 + d;
        const atc = rnd(8) === 0, label = atc ? 'ATCMD' : `T${rnd(900) + 100}`;
        const ps = []; if (e - s > 90 && rnd(2)) { const a = s + 30 + rnd(e - s - 60), b = Math.min(e + (rnd(4) === 0 ? 20 : 0), a + 10 + rnd(50)); ps.push([day, hh(a), day, hh(Math.min(b, 23 * 60 + 59))]); }
        if (ps.length && rnd(3) === 0) { const [, a0] = ps[0]; const a = +a0.slice(0, 2) * 60 + +a0.slice(3) + 5; if (a + 20 < e) ps.push([day, hh(a), day, hh(a + 20)]); }
        ms.push([label, 'HENDAYE', 'HENDAYE', day, hh(s), day, hh(e), ps]);
        // référence indépendante, en minutes
        const amp = e - s; const iv = ps.map(([, a, , b]) => [Math.max(s, +a.slice(0, 2) * 60 + +a.slice(3)), Math.min(e, +b.slice(0, 2) * 60 + +b.slice(3))]).filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0]);
        let pz = 0, cs = null, ce = null; for (const [x, y] of iv) { if (cs === null || x > ce) { if (cs !== null) pz += ce - cs; cs = x; ce = y; } else ce = Math.max(ce, y); } if (cs !== null) pz += ce - cs;
        if (atc) { refAmp += amp; refTte += 300; } else if (amp < 300) { refAmp += 300; refTte += 300; } else { refAmp += amp; refTte += amp - pz; }
        t = e + 30 + rnd(120);
      }
      j.push(ms.length ? svc(...ms) : 'RP');
    }
    const a = one(j, { mat: String(k) }, RES);
    assert.equal(Math.round(a.amplitudeTotale * 60), refAmp, `amplitude, semaine ${k}`);
    assert.equal(Math.round(a.heuresPlanifiees * 60), refTte, `TTE, semaine ${k}`);
    assert.ok(Math.abs(a.amplitudeTotale * 60 - refAmp) < 1e-6 && Math.abs(a.heuresPlanifiees * 60 - refTte) < 1e-6, `minutes exactes, semaine ${k}`);
    all.push(a); refAmpTot += refAmp; refTteTot += refTte;
  }
  const g = E.agg(all);
  assert.equal(Math.round(g.amplitudeTotale * 60), refAmpTot);
  assert.equal(Math.round(g.heuresPlanifiees * 60), refTteTot);
});

test('missions qui se chevauchent : signalées', () => {
  const a = one([svc(['A', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00'], ['B', 'HENDAYE', 'HENDAYE', 7, '11:00', 7, '15:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES);
  assert.equal(a.chevauchements.length, 1);
  assert.equal(a.chevauchements[0].min, 60);
});

/* ---- trajets seuls : VOY / VS comme mot à part, jamais collé à un « + » ---- */
test('trajet seul : VOY- / -VOY / VS- / -VS oui ; collé à un + non', () => {
  const lab = (l) => one([svc([l, 'HENDAYE', 'BAYONNE', 7, '06:00', 7, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'], {}, RES).nbTrajetsSeuls;
  for (const l of ['VOY-541-BX', 'VOY', '541-VOY', 'BX-VOY-541', 'VS-12', 'vs-12', '12-VS', 'VS 12', 'Voy - 541'])
    assert.equal(lab(l), 1, l);
  for (const l of ['CSE+VOY-541-BX', 'VOY+PREPA CSE-341-BX', 'VS+MHIS', 'MHIS+VS', 'CSE + VOY-12', 'VOY +PREPA', 'VOYAGE-12', 'VSX-12', 'TRAIN 4512', 'DISPO'])
    assert.equal(lab(l), 0, l);
});

/* ---- corrections propres à un agent sur une période exclusive (semaine, mois, année) ---- */
test('métier corrigé pour une semaine, un mois ou une année ; le plus précis l’emporte ; résidence exclusive', () => {
  const j = [svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'];
  const C = (c) => ({ ...RES, corrections: { rhr: {}, jb: {}, liens: [], ...c } });
  // semaine du 07/09/2026 = 2026-S37, lundi 07/09 → septembre 2026
  assert.equal(one(j, { met: 'AFR' }, C({ metierAgent: { 'm:1|w:2026-S37': 'CONDUCTEUR' } })).metier, 'CONDUCTEUR');
  assert.equal(one(j, { met: 'AFR' }, C({ metierAgent: { 'm:1|w:2026-S38': 'CONDUCTEUR' } })).metier, 'AFR');
  const a = one(j, { met: 'AFR' }, C({ metierAgent: { 'm:1|y:2026': 'CONDUCTEUR' } }));
  assert.equal(a.metier, 'CONDUCTEUR'); assert.equal(a.metierFichier, 'AFR'); assert.equal(a.nbRHR, 1);
  assert.equal(one(j, { met: 'AFR' }, C({ metierAgent: { 'm:1|y:2026': 'CONDUCTEUR', 'm:1|m:2026-09': 'AFR' } })).metier, 'AFR');
  // résidence BORDEAUX pour septembre seulement : plus de RHR à Bordeaux
  assert.equal(one(j, {}, C({ residenceAgent: { 'm:1|m:2026-09': 'BORDEAUX' } })).residence, 'BORDEAUX');
  assert.equal(one(j, {}, C({ residenceAgent: { 'm:1|m:2026-10': 'BORDEAUX' } })).residence, 'HENDAYE');
  // ancienne saisie « à partir de » toujours respectée
  assert.equal(one(j, {}, C({ residenceAgent: { 'm:1|2026-S30': 'BAYONNE' } })).residence, 'BAYONNE');
});

test('RHR de fin de semaine : semaine suivante importée avec seulement des codes → pas de RHR (plus « à finir en S+1 »)', () => {
  const w1 = run(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: ['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['T1', 'HENDAYE', 'BORDEAUX', 13, '06:00', 13, '10:00'])] }]), RES);
  const w2 = run(week([2026, 9, 14], [{ mat: '1', nom: 'A', j: ['RP', 'RP', 'CP', 'CP', 'CP', 'RP', 'RP'] }]), RES);
  assert.equal(w1.agents[0].rhrEnCours, 1);
  E.reconcile(new Map([['2026-S37', w1], ['2026-S38', w2]]), RES);
  assert.equal(w1.agents[0].rhrEnCours, 0);
  assert.equal(w1.agents[0].nbRHR, 0);
});

test('agence hors production (Paris) : ses agents sont retirés de tous les chiffres, anciens et nouveaux noms', () => {
  const rows = week([2026, 9, 7], [
    { mat: '1', nom: 'A', ag: 'Hendaye', j: Array(7).fill('RP') },
    { mat: '2', nom: 'B', ag: 'Paris', j: Array(7).fill('RP') },
    { mat: '3', nom: 'C', ag: 'Agence Paris', j: Array(7).fill('RP') },
    { mat: '4', nom: 'D', ag: 'PARIS', j: Array(7).fill('RP') }]);
  assert.equal(JSON.stringify(run(rows, RES).agents.map((a) => a.matricule)), '["1"]');
  assert.equal(run(rows, { ...RES, agencesExclues: [] }).agents.length, 4);
});

test('À vérifier : texte brut de la case gardé, mission ignorée à la main, mission hors colonne comptée quand même', () => {
  const cell = 'TRAIN X\nHENDAYE - BORDEAUX';
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: [cell, 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  assert.equal(p.anomalies[0].brut, cell);
  // deux missions qui se chevauchent : on en ignore une
  const j = [svc(['A', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00'], ['B', 'HENDAYE', 'HENDAYE', 7, '11:00', 7, '15:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'];
  const a0 = one(j, {}, RES);
  const k = 'm:1|' + a0.jours[0].missions[1].start + '|B';
  const a1 = one(j, {}, { ...RES, corrections: { rhr: {}, jb: {}, liens: [], ignorees: { [k]: true } } });
  assert.equal(a1.nbMissions, 1);
  assert.equal(a1.chevauchements.length, 0);
  // mission datée d'un autre jour (hors colonne) : écartée, puis comptée à la demande
  const hc = [svc(['T', 'HENDAYE', 'HENDAYE', 9, '06:00', 9, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'];
  assert.equal(one(hc, {}, RES).nbMissions, 0);
  const st = new Date(Date.UTC(2026, 8, 9, 6, 0)).toISOString();
  assert.equal(one(hc, {}, { ...RES, corrections: { rhr: {}, jb: {}, liens: [], garderHC: { ['m:1|' + st]: true } } }).nbMissions, 1);
});

test('codes : « JF, » reste un JF, et une semaine lue avec un ancien classement est reclassée à l’affichage', () => {
  const a = one(['JF,', 'RF', 'JF', 'CP,', 'RP-12', 'AI', 'RP'], {}, RES);
  assert.equal(a.jours.map((j) => j.family).join(), 'JF,RF,JF,CP,RP,AUTRE,RP');
  // ancien import : famille « AUTRE » enregistrée pour un JF
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: ['JF', 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  p.agents[0].jours[0] = { ...p.agents[0].jours[0], family: 'AUTRE' };
  assert.equal(E.applyRules(p, RES).agents[0].jours[0].family, 'JF');
});

test('RP : un numéro de RP n’est lu qu’une fois, même inscrit sur deux semaines (demandé par l’utilisateur)', () => {
  const w1 = E.parseWeek(week([2026, 3, 2], [{ mat: '1', nom: 'TEST', j: ['RP-20', 'RP-21', 'RP-21', 'RP', 'CP', 'RP', 'RP-24'] }]));
  const w2 = E.parseWeek(week([2026, 3, 9], [{ mat: '1', nom: 'TEST', j: ['RP-24', 'RP-25', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  const m = new Map([['2026-S10', E.applyRules(w1, RES)], ['2026-S11', E.applyRules(w2, RES)]]);
  E.reconcile(m, RES); E.reconcile(m, RES);   // rejoué : pas de double retrait
  const a = m.get('2026-S10').agents[0], b = m.get('2026-S11').agents[0];
  assert.equal(a.codeCounts.RP, 5);           // RP-21 en double dans la semaine : 6 cases, 5 comptées
  assert.equal(b.codeCounts.RP, 6);           // RP-24 déjà lu en S10
  assert.equal(b.jours[0].rpDouble.weekId, '2026-S10');
  assert.equal(a.joursRepos, 5);
});

test('périodes au jour près : une semaine à cheval sur deux années se coupe au 31/12 (demandé par l’utilisateur)', () => {
  // semaine du lundi 29/12/2025 au dimanche 04/01/2026
  const j = [svc(['A', 'HENDAYE', 'HENDAYE', 29, '06:00', 29, '14:00']), 'RP-117', svc(['N', 'HENDAYE', 'HENDAYE', 31, '22:00', 1, '06:00']),
    'JF', svc(['B', 'HENDAYE', 'HENDAYE', 2, '08:00', 2, '16:00']), 'RP-1', svc(['C', 'HENDAYE', 'HENDAYE', 4, '06:00', 4, '20:00'])];
  const a = run(week([2025, 12, 29], [{ mat: '1', nom: 'TEST', j }]), RES).agents[0];
  const y25 = E.sliceAgent(a, '2025-01-01', '2025-12-31'), y26 = E.sliceAgent(a, '2026-01-01', '2026-12-31');
  assert.equal(y25.nbMissions, 2);                 // la nuit du 31/12 → 01/01 reste au jour de début
  assert.equal(y25.heuresPlanifiees, 16);
  assert.equal(y25.heuresNuit, 7);
  assert.equal(y25.codeCounts.RP, 1);
  assert.equal(y25.codeCounts.JF, undefined);
  assert.equal(y26.nbMissions, 2);
  assert.equal(y26.codeCounts.JF, 1);
  assert.equal(y26.codeCounts.RP, 1);
  assert.equal(y26.heuresDimanche, a.heuresDimanche);
  // les deux parties redonnent la semaine entière ; heures sup entières dans la partie du dimanche (04/01)
  for (const k of ['nbMissions', 'heuresPlanifiees', 'amplitudeTotale', 'heuresNuit', 'joursService', 'nbPaniers', 'joursRepos'])
    assert.equal(Math.round((y25[k] + y26[k]) * 60), Math.round(a[k] * 60), k);
  assert.equal(y25.heuresSup, 0);
  assert.equal(y26.heuresSup, a.heuresSup);
  assert.equal(E.sliceAgent(a, '2025-12-29', '2026-01-04'), a);
  assert.equal(E.sliceAgent(a, '2026-02-01', '2026-02-28'), null);
  assert.equal(E.moisParts(a).map(([, m]) => m).join(), '2025-12,2026-01');
});

test('vitrine : une semaine à cheval sur deux années a aussi une cellule par partie, mêmes groupes (≥ 5 agents)', () => {
  const ag = (i) => ({ mat: '9' + i, nom: 'X' + i, ag: 'Hendaye', met: 'CONDUCTEUR',
    j: [svc(['A', 'HENDAYE', 'HENDAYE', 29, '06:00', 29, '14:00']), 'RP', svc(['B', 'HENDAYE', 'HENDAYE', 31, '06:00', 31, '14:00']), 'JF', svc(['C', 'HENDAYE', 'HENDAYE', 2, '06:00', 2, '14:00']), 'RP', 'RP'] });
  const v = E.vitrineData([E.parseWeek(week([2025, 12, 29], [1, 2, 3, 4, 5].map(ag)))], E.loadRules({ residences: { Hendaye: 'HENDAYE' } }));
  const full = v.cells.find((c) => !c.p), p25 = v.cells.find((c) => c.p === '2025-12'), p26 = v.cells.find((c) => c.p === '2026-01');
  assert.equal(v.cells.length, 3);
  assert.ok(v.cells.every((c) => c.n >= 5));
  assert.equal(full.s.nbMissions, 15);
  assert.equal(p25.s.nbMissions, 10);
  assert.equal(p26.s.nbMissions, 5);
});

test('semaine du lundi 00:00 au dimanche 23:59 : heures sup dans le mois du dimanche, corrections dans le mois du lundi', () => {
  // semaine du lundi 28/09/2026 au dimanche 04/10/2026 : 4 × 10 h = 40 h de TTE → 5 h sup
  const j = [28, 29, 30, 1].map((d) => svc(['M', 'HENDAYE', 'HENDAYE', d, '06:00', d, '16:00'])).concat(['RP', 'RP', 'RP']);
  const rules = { ...RES, corrections: { rhr: {}, jb: {}, liens: [], metierAgent: { 'm:1|m:2026-09': 'AFR', 'm:1|m:2026-10': 'COORDO AFR' } } };
  const a = run(week([2026, 9, 28], [{ mat: '1', nom: 'TEST', j }]), rules).agents[0];
  assert.equal(a.heuresSup, 5);
  assert.equal(E.sliceAgent(a, '2026-09-01', '2026-09-30').heuresSup, 0);
  assert.equal(E.sliceAgent(a, '2026-10-01', '2026-10-31').heuresSup, 5);
  assert.equal(a.metier, 'AFR');                     // correction du mois du lundi (septembre)
});

test('pause vide « P: - » : aucune pause, aucune alerte (fichier S39)', () => {
  const cell = 'VOY-523-SP_ATL\nVAI - SP\n11/10:30 - 11/14:00\nP:  -';
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j: ['RP', 'RP', 'RP', 'RP', cell, 'RP', 'RP'] }]));
  assert.equal(p.anomalies.length, 0);
  const a = E.applyRules(p, RES).agents[0];
  assert.equal(a.nbMissions, 1);
  assert.equal(a.heuresPlanifiees, 5);          // 3h30 d'amplitude sans pause → comptée 5 h (règle des missions courtes)
  assert.equal(a.pauseTotaleMin, 0);
});

test('nettoyage à l’import : lignes d’autres semaines et doublons sans horaire retirés, vraie ligne gardée', () => {
  const s35 = [svc(['A', 'HENDAYE', 'HENDAYE', 7, '10:00', 7, '17:00']), svc(['B', 'HENDAYE', 'HENDAYE', 8, '10:00', 8, '17:00']), 'RP-77', 'RP-78', 'CP', 'CP', 'CP'];
  const ancienne = [svc(['A', 'HENDAYE', 'HENDAYE', 17, '10:00', 17, '17:00']), svc(['B', 'HENDAYE', 'HENDAYE', 18, '10:00', 18, '17:00']), 'RP-75', 'RP-76', 'CP', 'CP', 'CP'];
  const rows = week([2026, 9, 7], [
    { mat: '1', nom: 'GARDE', j: s35 }, { mat: '2', nom: 'CODES', j: ['CP', 'CP', 'CP', 'CP', 'CP', 'RP-78', 'RP-79'] },
    { mat: '1', nom: 'GARDE', j: ancienne }, { mat: '2', nom: 'CODES', j: ['CP', 'CP', 'CP', 'CP', 'CP', 'RP-76', 'RP-77'] },
    { mat: '3', nom: 'SEUL', j: [svc(['N', 'HENDAYE', 'HENDAYE', 13, '22:00', 14, '06:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]);
  const n = E.nettoyerFeuille(rows);
  assert.equal(n.retraits.length, 2);
  assert.equal(n.retraits[0].ligne, 5);          // ancienne semaine de GARDE
  assert.match(n.retraits[1].raison, /double sans horaire/);
  const p = E.parseWeek(n.rows);
  assert.equal(p.agents.length, 3);
  assert.equal(p.anomalies.length, 0);
  assert.equal(p.agents.find((a) => a.nom === 'CODES').jours[6].code, 'RP-79');
  // un agent seul avec une seule case datée d'un autre jour n'est pas retiré (simple erreur de saisie, signalée à la lecture)
  assert.ok(p.agents.some((a) => a.nom === 'SEUL'));
});

test('anciens fichiers : pause = WorkDuration (T) − WorkDurationEffective (U) de l’onglet Extract', () => {
  // en-tête de l'Extract, puis une ligne par agent et par jour (durées en fraction de jour, comme Excel)
  const h = (x) => x / 24, d = (j) => serial(2026, 9, j);
  const HX = ['CodeID', 'Code', 'FullName', 'ID', 'Date', 'Nbr', null, 'JS1', 'D1', 'F1', 'From', 'To', 'JS2', 'D2', 'F2', 'From', 'To', 'DayType', 'Shift', 'WorkDuration', 'WorkDurationEffective'];
  const ligne = (id, j, T, U) => { const r = Array(21).fill(null); r[3] = id; r[4] = d(j); r[19] = h(T); r[20] = h(U); return r; };
  const ex = E.readExtract([HX, ligne('1', 7, 8, 7), ligne('1', 8, 11, 10.5), ligne('1', 9, 7, 2.5), ligne('1', 10, 5, 3), ligne('1', 11, 11 + 50 / 60, 10), ligne('1', 12, 10, 9 + 40 / 60), ligne('1', 13, 8, 7.5)]);
  assert.equal(ex['1|2026-09-07'].join(), '480,420');
  const j = [svc(['MHIS', 'HENDAYE', 'HENDAYE', 7, '08:00', 7, '16:00']),
    svc(['A', 'HENDAYE', 'HENDAYE', 8, '05:00', 8, '07:00'], ['B', 'HENDAYE', 'HENDAYE', 8, '14:00', 8, '23:00']),
    svc(['ATCMD-1', 'HENDAYE', 'HENDAYE', 9, '10:00', 9, '17:00']), svc(['VOY-7', 'HENDAYE', 'BORDEAUX', 10, '10:00', 10, '15:00']),
    svc(['VOY+CSE-353-HE', 'HENDAYE', 'PERIGUEUX', 11, '06:35', 11, '18:25']), svc(['CSE+VOY-553-HE', 'PERIGUEUX', 'HENDAYE', 12, '08:30', 12, '18:30']),
    svc(['N', 'HENDAYE', 'HENDAYE', 13, '06:00', 13, '14:00'])];
  const p = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j }]), ex);
  assert.equal(p.agents[0].jours[0].tu.join(), '480,420');               // la lecture note T / U du jour…
  assert.equal(p.agents[0].jours[0].missions[0].pauseMin, 0);            // …la pause est appliquée au calcul (règles)
  const a = E.applyRules(p, RES).agents[0], js = a.jours;
  assert.equal(js[0].missions[0].pauseMin, 60);                          // 8 h − 7 h
  assert.equal(js[0].missions[0].pauses[0][0], new Date(Date.UTC(2026, 8, 7, 11, 30)).toISOString());   // au milieu de la mission
  assert.equal(js[1].missions[0].pauseMin + js[1].missions[1].pauseMin, 30);   // 30 min pour la journée…
  assert.equal(js[1].missions[1].pauseMin, 25);                          // …au prorata des JS (2 h et 9 h)
  assert.equal(js[2].missions[0].pauseMin, 0);                           // ATCMD : jamais de pause
  assert.equal(js[3].missions[0].pauseMin, 0);                           // trajet seul VOY : horaire complet
  assert.equal(js[4].missions[0].pauseMin, 110);                         // mission mixte VOY+CSE : 11h50 − 10h00
  assert.equal(js[5].missions[0].pauseMin, 20);                          // mission mixte CSE+VOY : 10h00 − 9h40
  assert.equal(a.heuresDimanche, 7.5);                                   // pause retirée du dimanche
  const applis = () => E.applyRules(p, RES).agents[0].heuresPlanifiees;
  assert.equal(applis(), applis());                                      // rejoué à chaque affichage sans cumuler
  assert.equal(E.applyRules(E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'TEST', j }])), RES).agents[0].jours[0].missions[0].pauseMin, 0);   // sans Extract : rien
});

test('vue Coco : missions et RHR des agents choisis, mission de nuit sur deux jours, rien d’autre', () => {
  const j1 = [svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), svc(['N', 'HENDAYE', 'HENDAYE', 9, '22:00', 10, '05:00']), 'RP', 'RP', 'RP', 'RP'];
  const w = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'CHOISI', j: j1 }, { mat: '2', nom: 'AUTRE', j: j1 }]));
  const sem = E.cocoCalcul([w], E.loadRules({ residences: { Hendaye: 'HENDAYE' } }), '2026-S37', [{ pk: 'm:1', nom: 'x', metier: 'CONDUCTEUR', couleur: '#FFD600' }]);
  assert.equal(sem.agents.length, 1);                           // seul l'agent choisi
  const a = sem.agents[0];
  assert.equal(a.missions.length, 3);
  assert.equal(a.rhr.length, 1);                                // RHR à Bordeaux du lundi au mardi
  assert.equal(a.rhr[0].lieu, 'BORDEAUX');
  assert.equal(a.jours[2].m.length + a.jours[3].m.length, 2);   // mission de nuit : mercredi et suite jeudi
  assert.equal(a.jours[3].m[0].suite, true);
  assert.ok(!('heuresSup' in a) && !('codes' in a) && !/RP/.test(JSON.stringify(sem)));   // ni heures ni codes
});

test('Production : repos pris / dus, week-end complet, heures neutralisées, trajet seul remplaçable par un train', () => {
  const w = run(week([2026, 9, 7], [
    { mat: '1', nom: 'A', j: [svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00'], ['VOY-1', 'BORDEAUX', 'HENDAYE', 7, '11:00', 7, '13:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
    { mat: '2', nom: 'B', j: [svc(['VOY-9', 'HENDAYE', 'BORDEAUX', 7, '07:00', 7, '09:00'], ['T5', 'BORDEAUX', 'HENDAYE', 7, '11:30', 7, '14:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
  ]), { ...RES, production: { reposDus: 104, reposPar: 'an', reposCodes: ['RP'], optiFenetre: 2 } });
  const d = E.productionData(w.agents, w.agents, E.loadRules({ ...RES, production: { reposDus: 104, reposPar: 'an', reposCodes: ['RP'], optiFenetre: 2 } }));
  const a = d.personnes.find((x) => x.nom === 'A');
  assert.equal(a.reposPris, 6);
  assert.equal(Math.round(a.reposDus * 100) / 100, Math.round(104 * 7 / 365 * 100) / 100);
  assert.equal(a.weekends, 1);
  assert.equal(a.reposDoubles, 1);
  assert.equal(a.neutre, 1 + 3);          // T1 4 h → +1 h ; VOY 2 h → +3 h
  assert.equal(a.neutreVoy, 3);
  assert.equal(a.nbTraj, 1);
  const pa = d.pistes.filter((x) => x.nom.startsWith('A'));
  assert.equal(pa.length, 1);
  assert.equal(pa[0].train.label, 'T5');
  assert.equal(pa[0].journeeEco, true);   // B était venu en trajet seul pour ce train
  assert.equal(d.pistes.filter((x) => x.nom.startsWith('B')).length, 0);   // aucun train HENDAYE → BORDEAUX
});

test('Conformité à l’accord : amplitude, TTE, pause, repos journalier, reprise après RP, GPT de plus de 6 jours', () => {
  const w = run(week([2026, 9, 7], [
    { mat: '1', nom: 'A', j: [svc(['T1', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '17:30']), svc(['T2', 'HENDAYE', 'HENDAYE', 8, '03:00', 8, '08:00']), 'RP',
      svc(['T3', 'HENDAYE', 'HENDAYE', 10, '04:00', 10, '10:00', [[10, '07:00', 10, '07:30']]]), 'RP', 'RP', 'RP'] },
    { mat: '2', nom: 'B', j: [7, 8, 9, 10, 11, 12, 13].map((d) => svc(['T' + d, 'HENDAYE', 'HENDAYE', d, '08:00', d, '12:00'])) },
  ]), RES);
  const c = E.conformiteData(w.agents, E.loadRules(RES));
  const t = (n) => c.filter((x) => x.nom.startsWith(n)).map((x) => x.type).sort().join(',');
  assert.equal(t('A'), 'amp,pause,rj,rpLendemain,tte');
  assert.equal(t('B'), 'gpt');
  const e = E.equiteData(w.agents);
  assert.equal(e.groupes.length, 1);
  assert.equal(e.pers.find((p) => p.nom === 'B').v.joursService, 7);
});
