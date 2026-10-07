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
vm.runInContext(code + ';globalThis.E={parseWeek,applyRules,reconcile,sliceAgent,moisParts,nettoyerFeuille,readExtract,cocoCalcul,agg,mergeAcrossWeeks,fmtH,fmtHour,buildXlsx,readRecapSheet,vitrineData,loadRules,productionData,conformiteData,equiteData,trameSemaine,personKey,trainsReguliers,missionDuJour,planifAlertes,planifPreremplir,reposJournaliersCourts,planifAuto,planifRelier,planifTrajets,decalageRP,rpSemaines,rpSuites,coutHeuresSup,semainesEcoulees,calAgent,calEvenements,icsTexte};', ctx);
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

test('agenda .ics : missions en heure de Paris, RP et CP en journée entière, RHR, rien d’autre', () => {
  const j1 = [svc(['T1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '10:00']), svc(['T2', 'BORDEAUX', 'HENDAYE', 8, '06:00', 8, '10:00']), 'CP', 'MAL', 'RP-12', 'RP-13', 'RF'];
  const w = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'CHOISI', j: j1 }, { mat: '2', nom: 'AUTRE', j: j1 }]));
  const ics = E.calAgent([w], E.loadRules({ residences: { Hendaye: 'HENDAYE' } }), 'm:1', 'Choisi');
  const ev = ics.split('BEGIN:VEVENT').slice(1);
  assert.equal(ev.length, 6);                                              // 2 missions, CP, 2 RP, 1 RHR (ni MAL ni RF)
  assert.ok(ics.includes('DTSTART;TZID=Europe/Paris:20260907T060000'));   // heure du fichier, sans décalage
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260909') && ics.includes('SUMMARY:CP'));
  assert.ok(ics.includes('SUMMARY:RP-12') && ics.includes('DTEND;VALUE=DATE:20260912'));
  assert.ok(/SUMMARY:RHR · BORDEAUX/.test(ics) && ics.includes('LOCATION:HENDAYE → BORDEAUX'));
  assert.ok(!/MAL|SUMMARY:RF/.test(ics) && !ics.includes('AUTRE'));
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));   // lignes pliées
  assert.equal(E.calAgent([w], E.loadRules({}), 'm:1', 'x').match(/UID:[^\r]+/g).join(), ics.match(/UID:[^\r]+/g).join());   // UID stables
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

test('Production : ATCMD / DISPO pendant laquelle un autre agent, venu en trajet seul, a assuré un train du même lieu', () => {
  const w = run(week([2026, 9, 7], [
    { mat: '1', nom: 'A', j: [svc(['DISPO', 'HENDAYE', 'HENDAYE', 7, '08:00', 7, '14:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
    { mat: '2', nom: 'B', ag: 'Bordeaux-St-Jean', j: [svc(['VOY-1', 'BORDEAUX', 'HENDAYE', 7, '06:00', 7, '08:30'], ['T9', 'HENDAYE', 'BORDEAUX', 7, '09:00', 7, '12:00']), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
  ]), RES);
  const d = E.productionData(w.agents.filter((a) => a.nom === 'A'), w.agents, E.loadRules(RES));
  assert.equal(d.pistesCmd.length, 1);
  assert.equal(d.pistesCmd[0].train.label, 'T9');
  assert.equal(d.pistesCmd[0].journeeEco, true);
  const c = E.conformiteData(w.agents, E.loadRules(RES));
  assert.equal(c.filter((x) => x.type === 'cmd').length, 0);
});

test('Planning type S+1 : GPT de 6 jours en cours → repos double dès le lundi ; week-end déjà pris → pas deux de suite', () => {
  const d = (x) => svc(['T' + x, 'HENDAYE', 'HENDAYE', x, '08:00', x, '15:00']);
  const w = run(week([2026, 9, 7], [
    { mat: '1', nom: 'A', j: ['RP', d(8), d(9), d(10), d(11), d(12), d(13)] },
    { mat: '2', nom: 'B', j: [d(7), d(8), d(9), d(10), d(11), 'RP', 'RP'] },
  ]), RES);
  w.agents.forEach((a) => a.weekId = w.meta.weekId);
  const t = E.trameSemaine(w.agents, w.meta.weekId, new Set(w.agents.map(E.personKey)), E.loadRules(RES));
  assert.equal(t.jours[0], '2026-09-14');
  const A = t.agents.find((x) => x.nom.startsWith('A')), B = t.agents.find((x) => x.nom.startsWith('B'));
  assert.equal(A.g, 6);
  assert.equal(A.s, 0);
  assert.ok(A.n >= 2);
  assert.equal(A.cases[0].t, 'RP');
  assert.equal(B.k, 2);
  assert.ok(B.s >= 1);                                   // pas plus de 3 RP d'affilée avec ceux du week-end
  assert.ok(!(B.s <= 5 && B.s + B.n >= 7));             // week-end déjà pris ce mois-ci
  assert.match(B.cases[0].notes.join(' '), /reprise ≥ 03:00/);
});

test('Planification : train régulier (2 semaines sur 4), mission posée qui casse le repos journalier → alerte', () => {
  const t5 = (d) => svc(['T5', 'HENDAYE', 'IRUN', d, '06:00', d, '14:00']);
  const w1 = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: [t5(7), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  const w2 = E.parseWeek(week([2026, 9, 14], [{ mat: '1', nom: 'A', j: [t5(14), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
    { mat: '2', nom: 'B', j: ['RP', 'RP', 'RP', 'RP', 'RP', 'RP', svc(['N1', 'HENDAYE', 'HENDAYE', 20, '14:00', 20, '23:00'])] }]));
  const reg = E.trainsReguliers([w1, w2], 2);
  assert.equal(reg.length, 1);
  assert.equal(reg[0].label, 'T5');
  assert.equal(reg[0].d, 0);
  assert.equal(reg[0].pk, 'm:1');
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
  const vide = () => days.map(() => ({ c: '', m: [] }));
  const pl = { meta: { weekId: '2026-S39', year: 2026, week: 39, monday: days[0], sunday: days[6], days },
    agents: [{ matricule: '2', nom: 'B', prenom: 'P', agence: 'Hendaye', metier: 'CONDUCTEUR', jours: vide() }] };
  pl.agents[0].jours[0].m.push(E.missionDuJour(reg[0], days[0], 'x1'));   // B finit dimanche 23:00, reprend lundi 06:00 : 7 h
  const al = E.planifAlertes(pl, [w2], E.loadRules(RES));
  assert.ok(al.some((x) => x.type === 'rj' && x.date === days[0]));
});

test('Planification : pré-remplissage par agence — le train de Hendaye va à un agent de Hendaye libre, celui de Vaires à personne', () => {
  const t5 = (d) => svc(['T5', 'HENDAYE', 'HENDAYE', d, '06:00', d, '11:00']), t9 = (d) => svc(['T9', 'VAIRES', 'PARIS', d, '06:00', d, '12:00']);
  const mk = (l) => E.parseWeek(week(l, [{ mat: '1', nom: 'A', j: [t5(l[2]), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] },
    { mat: '9', nom: 'V', ag: 'Vaires', j: [t9(l[2]), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  const w1 = mk([2026, 9, 7]), w2 = mk([2026, 9, 14]);
  const reg = E.trainsReguliers([w1, w2], 2);
  assert.equal(reg.length, 2);
  const info = new Map([['m:1', { agence: 'Hendaye', metier: 'CONDUCTEUR' }], ['m:9', { agence: 'Vaires', metier: 'CONDUCTEUR' }], ['m:2', { agence: 'Hendaye', metier: 'CONDUCTEUR' }]]);
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
  const vide = () => days.map(() => ({ c: '', m: [] }));
  const pl = { meta: { weekId: '2026-S39', monday: days[0], sunday: days[6], days }, agents: [
    { matricule: '1', nom: 'A', prenom: 'P', agence: 'Hendaye', metier: 'CONDUCTEUR', jours: vide() },
    { matricule: '2', nom: 'B', prenom: 'P', agence: 'Hendaye', metier: 'CONDUCTEUR', jours: vide() }] };
  pl.agents[0].jours[0].c = 'RP';                        // l'agent habituel est en repos lundi
  const res = E.planifPreremplir(pl, reg, info, new Map(), E.loadRules(RES));
  assert.equal(pl.agents[1].jours[0].m.map((m) => m.label).join(), 'T5');
  assert.equal(pl.agents[0].jours[0].m.length, 0);
  assert.equal(res.length, 0);                           // T9 (Vaires) : aucune agence Vaires dans la grille, ignoré
});

test('Planification : même intitulé mais trajets différents = deux trains réguliers distincts', () => {
  const m = (d) => svc(['MHIS', 'HENDAYE', 'IRUN', d, '06:00', d, '10:00']), n = (d) => svc(['MHIS', 'BAYONNE', 'HENDAYE', d, '14:00', d, '18:00']);
  const mk = (l) => E.parseWeek(week(l, [{ mat: '1', nom: 'A', j: [m(l[2]), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }, { mat: '2', nom: 'B', j: [n(l[2]), 'RP', 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  const reg = E.trainsReguliers([mk([2026, 9, 7]), mk([2026, 9, 14])], 2);
  assert.equal(reg.length, 2);
  assert.equal(reg.map((t) => t.from + '>' + t.to).sort().join(), 'BAYONNE>HENDAYE,HENDAYE>IRUN');
});

test('Repos journaliers à résidence : au minimum (13 h conducteurs) et sous le minimum', () => {
  const a = one([svc(['T1', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '17:00']), svc(['T2', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '12:00'], ['T2B', 'HENDAYE', 'HENDAYE', 8, '15:00', 8, '20:00']),
    svc(['T3', 'HENDAYE', 'HENDAYE', 9, '05:00', 9, '10:00']), 'RP', 'RP', 'RP', 'RP'], {}, RES);
  a.weekId = '2026-S37';
  const r = E.reposJournaliersCourts([a], E.loadRules(RES));
  assert.equal(r.minimum.length, 1);   // lundi 17:00 → mardi 06:00 : 13 h
  assert.equal(r.sous.length, 1);      // mardi 20:00 → mercredi 05:00 : 9 h
  assert.equal(r.sous[0].sousPlancher, true);
  const b = one([svc(['T1', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '18:00']), svc(['T2', 'HENDAYE', 'HENDAYE', 8, '06:00', 8, '10:00']), 'RP', 'RP', 'RP', 'RP', 'RP'], { met: 'AFR' }, RES);
  b.weekId = '2026-S37';
  assert.equal(E.reposJournaliersCourts([b], E.loadRules(RES)).minimum.length, 1);   // AFR : 12 h
});

// ---------- planification automatique : lieu, RHR, trajets seuls, 35 h, repos ----------
const PDAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
const pvide = () => PDAYS.map(() => ({ c: '', m: [] }));
const pag = (mat, met = 'CONDUCTEUR') => ({ matricule: mat, nom: 'N' + mat, prenom: 'P', agence: 'Hendaye', metier: met, jours: pvide() });
const pmis = (id, label, from, to, d, h1, h2) => ({ id, label, from, to, start: `${PDAYS[d]}T${h1}:00.000Z`, end: `${h2 < h1 ? PDAYS[d + 1] : PDAYS[d]}T${h2}:00.000Z`, pauses: [], d, agence: 'Hendaye', fam: 'CDR' });
const pctx = (x = {}) => ({ res: {}, resAg: { Hendaye: ['HENDAYE'] }, trajets: {}, fins: {}, lieux: {}, ...x });
const pmeta = { weekId: '2026-S39', monday: PDAYS[0], sunday: PDAYS[6], days: PDAYS };

test('Planification auto : la mission va à l’agent déjà sur place (RHR à Bordeaux), pas à celui qui devrait y aller', () => {
  const pl = { meta: pmeta, agents: [pag('1'), pag('2')] };
  const ctx = pctx({ lieux: { 'm:2': 'BORDEAUX' }, fins: { 'm:2': Date.parse('2026-09-20T12:00:00Z') },
    trajets: { 'HENDAYE>BORDEAUX': [{ dep: 360, dur: 120 }], 'BORDEAUX>HENDAYE': [{ dep: 600, dur: 120 }] } });
  const r = E.planifAuto(pl, [pmis('x', 'T1', 'BORDEAUX', 'HENDAYE', 0, '10:00', '12:00')], ctx, E.loadRules(RES));
  assert.equal(r.reste.length, 0);
  assert.equal(pl.agents[1].jours[0].m.map((m) => m.label).join(), 'T1');
  assert.equal(pl.agents[0].jours[0].m.length, 0);
  assert.match(pl.agents[1].jours[0].m[0].pourquoi.join(' '), /déjà sur place/);
});

test('Planification auto : trajet seul ajouté sur un horaire observé, 30 min de battement, sinon raison', () => {
  const ctx = pctx({ trajets: { 'HENDAYE>BORDEAUX': [{ dep: 360, dur: 120 }], 'BORDEAUX>HENDAYE': [{ dep: 900, dur: 120 }] } });
  const pl = { meta: pmeta, agents: [pag('1')] };
  const r = E.planifAuto(pl, [pmis('x', 'T1', 'BORDEAUX', 'BORDEAUX', 0, '09:00', '12:00')], ctx, E.loadRules(RES));
  assert.equal(r.reste.length, 0);
  const l = pl.agents[0].jours.flatMap((j) => j.m).sort((a, b) => a.start.localeCompare(b.start));
  // aller (trajet seul observé 06:00–08:00, 30 min avant 09:00), mission ; retour le lendemain : le jour même, la journée
  // dépasserait 10 h de TTE (chaque mission de moins de 5 h compte 5 h), donc RHR de 9 h au moins puis premier train vu
  assert.deepEqual(l.map((m) => [m.label, m.start.slice(5, 16), m.end.slice(11, 16)]),
    [['VOY (ajouté)', '09-21T06:00', '08:00'], ['T1', '09-21T09:00', '12:00'], ['VOY (ajouté)', '09-22T15:00', '17:00']]);
  const pl2 = { meta: pmeta, agents: [pag('1')] };
  const r2 = E.planifAuto(pl2, [pmis('y', 'T2', 'BORDEAUX', 'BORDEAUX', 0, '08:10', '10:00')], ctx, E.loadRules(RES));
  assert.equal(r2.reste.length, 1);                      // arrivée 08:00, battement 30 min : trop tard
  assert.equal(r2.reste[0].raisons[0].raison, 'lieu');
});

test('Planification auto : un AFR rentre toujours le soir ; sans trajet de retour connu, la mission reste à placer', () => {
  const afr = () => pag('5', 'AFR');
  const m = () => ({ ...pmis('x', 'A1', 'HENDAYE', 'BAYONNE', 0, '08:00', '10:00'), fam: 'AFR' });
  const pl = { meta: pmeta, agents: [afr()] };
  const r = E.planifAuto(pl, [m()], pctx({ trajets: { 'BAYONNE>HENDAYE': [{ dep: 660, dur: 60 }] } }), E.loadRules(RES));
  assert.equal(r.reste.length, 0);
  assert.ok(pl.agents[0].jours[0].m.some((x) => x.ajout && x.to === 'HENDAYE' && x.start.slice(11, 16) === '11:00'));
  const pl2 = { meta: pmeta, agents: [afr()] };
  const r2 = E.planifAuto(pl2, [m()], pctx(), E.loadRules(RES));
  assert.equal(r2.reste.length, 1);
  assert.equal(r2.reste[0].raisons[0].raison, 'retour');
});

test('Planification auto : un conducteur peut découcher (RHR) et repartir le lendemain du lieu du RHR', () => {
  const pl = { meta: pmeta, agents: [pag('1')] };
  const ctx = pctx({ trajets: { 'BORDEAUX>HENDAYE': [{ dep: 900, dur: 120 }] } });
  const r = E.planifAuto(pl, [pmis('a', 'ALLER', 'HENDAYE', 'BORDEAUX', 0, '14:00', '17:00'), pmis('b', 'RETOUR', 'BORDEAUX', 'HENDAYE', 1, '06:00', '09:00')], ctx, E.loadRules(RES));
  assert.equal(r.reste.length, 0);                       // 17:00 → 06:00 : RHR de 13 h ≥ 9 h
  assert.equal(pl.agents[0].jours[0].m.filter((m) => m.ajout).length, 0);
  assert.equal(pl.agents[0].jours[1].m.filter((m) => m.ajout).length, 0);
  const pl2 = { meta: pmeta, agents: [pag('1')] };
  const r2 = E.planifAuto(pl2, [pmis('a', 'ALLER', 'HENDAYE', 'BORDEAUX', 0, '16:00', '21:30'), pmis('b', 'RETOUR', 'BORDEAUX', 'HENDAYE', 1, '06:00', '09:00')], ctx, E.loadRules(RES));
  assert.equal(r2.reste.length, 1);                      // 21:30 → 06:00 : 8 h 30 < 9 h
  assert.equal(r2.reste[0].raisons[0].raison, 'rhr');
});

test('Planification auto : priorité à l’agent le plus loin de 35 h ; repos du planning type déplacé si besoin', () => {
  const pl = { meta: pmeta, agents: [pag('1'), pag('2')] };
  for (let d = 1; d <= 4; d++) pl.agents[0].jours[d].m.push({ id: 'f' + d, label: 'F', from: 'HENDAYE', to: 'HENDAYE', start: `${PDAYS[d]}T08:00:00.000Z`, end: `${PDAYS[d]}T15:00:00.000Z`, pauses: [] });
  E.planifAuto(pl, [pmis('x', 'T1', 'HENDAYE', 'HENDAYE', 5, '08:00', '14:00')], pctx(), E.loadRules(RES));
  assert.equal(pl.agents[1].jours[5].m.length, 1);       // l'agent 2 (0 h) passe avant l'agent 1 (28 h)
  const pl2 = { meta: pmeta, agents: [pag('3')] };
  pl2.agents[0].jours[0].c = 'RP'; pl2.agents[0].jours[0].cAuto = true; pl2.agents[0].jours[1].c = 'RP'; pl2.agents[0].jours[1].cAuto = true;
  const r = E.planifAuto(pl2, [pmis('y', 'T2', 'HENDAYE', 'HENDAYE', 0, '08:00', '14:00')], pctx(), E.loadRules(RES));
  assert.equal(r.reste.length, 0);
  assert.equal(pl2.agents[0].jours[0].c, '');
  assert.equal(pl2.agents[0].jours.filter((j) => j.c === 'RP').length, 2);   // toujours 2 RP, ailleurs
});

test('Planification : horaires observés entre deux lieux (trajets seuls et trains vus dans les fichiers)', () => {
  const w = E.parseWeek(week([2026, 9, 7], [{ mat: '1', nom: 'A', j: [svc(['VOY-1', 'HENDAYE', 'BORDEAUX', 7, '06:00', 7, '08:00']), svc(['T7', 'HENDAYE', 'BORDEAUX', 8, '10:00', 8, '12:30']), 'RP', 'RP', 'RP', 'RP', 'RP'] }]));
  const t = E.planifTrajets([w]);
  assert.deepEqual(JSON.parse(JSON.stringify(t['HENDAYE>BORDEAUX'])), [{ dep: 360, dur: 120 }, { dep: 600, dur: 150 }]);
});

test('Planification auto : plus de 6 h de travail sans pause de 20 min → refusé (comme le contrôle de conformité)', () => {
  const pl = { meta: pmeta, agents: [pag('1')] };
  const r = E.planifAuto(pl, [pmis('x', 'LONG', 'HENDAYE', 'HENDAYE', 2, '06:00', '13:00')], pctx(), E.loadRules(RES));
  assert.equal(r.reste[0].raisons[0].raison, 'pause');
  const m = pmis('y', 'LONG', 'HENDAYE', 'HENDAYE', 2, '06:00', '13:00'); m.pauses = [['2026-09-23T09:00:00.000Z', '2026-09-23T09:30:00.000Z']];
  assert.equal(E.planifAuto({ meta: pmeta, agents: [pag('1')] }, [m], pctx(), E.loadRules(RES)).reste.length, 0);
});

test('Décalage des RP : numéro RP-n lu face à 117 / 52 × semaines (conducteur), 113 pour un AFR', () => {
  // semaine 20 de 2026 : du lundi 11/05 au dimanche 17/05
  const d = (x) => svc(['T' + x, 'HENDAYE', 'HENDAYE', x, '08:00', x, '14:00']);
  const w = run(week([2026, 5, 11], [{ mat: '1', nom: 'C', j: [d(11), d(12), 'RP-41', 'RP-42', d(15), d(16), d(17)] },
    { mat: '2', nom: 'F', met: 'AFR', j: [d(11), d(12), 'RP-50', 'RP', d(15), d(16), d(17)] }]), RES);
  const [c, f] = w.agents;
  assert.equal(E.semainesEcoulees('2026-05-17'), 20);
  const r = E.decalageRP([c, f], '2026-05-17', E.loadRules(RES));
  const x = r.get(E.personKey(c)), y = r.get(E.personKey(f));
  assert.equal(x.reel, 42); assert.equal(x.attendu, 45); assert.equal(x.ecart, -3);          // 3 RP de retard
  assert.equal(y.reel, 50); assert.ok(Math.abs(y.attendu - 113 / 52 * 20) < 1e-9); assert.ok(y.ecart > 6);   // en avance
});

test('RP par semaine : 4 RP dans la même semaine = quadruple, même non consécutifs ; coût des heures sup', () => {
  const d = (x) => svc(['T' + x, 'HENDAYE', 'HENDAYE', x, '08:00', x, '14:00']);
  const w1 = one([d(7), d(8), d(9), d(10), 'RP', 'RP', 'RP'], {}, RES);
  const w2 = run(week([2026, 9, 14], [{ mat: '1', nom: 'TEST', j: ['RP-88', 'RP-89', d(16), d(17), d(18), 'RP-90', 'RP-91'] }]), RES).agents[0];
  const b = E.rpSemaines([w1, w2]).get(E.personKey(w1));
  assert.deepEqual(JSON.parse(JSON.stringify(b)).map((x) => ({ ...x, jours: x.jours.map((j) => j.date + ' ' + j.code) })), [
    { lundi: '2026-09-07', dimanche: '2026-09-13', n: 3, jours: ['2026-09-11 RP', '2026-09-12 RP', '2026-09-13 RP'] },
    { lundi: '2026-09-14', dimanche: '2026-09-20', n: 4, jours: ['2026-09-14 RP-88', '2026-09-15 RP-89', '2026-09-19 RP-90', '2026-09-20 RP-91'] }]);
  // +3 RP consécutifs : la suite ven-sam-dim + lun-mar (à cheval sur deux semaines) = une suite de 5 ; sam-dim seuls = 2, pas comptés
  const c = JSON.parse(JSON.stringify(E.rpSuites([w1, w2]).get(E.personKey(w1))));
  assert.deepEqual(c.map((x) => [x.debut, x.fin, x.n]), [['2026-09-11', '2026-09-15', 5]]);
  assert.deepEqual(JSON.parse(JSON.stringify(E.rpSuites([w1, w2], 4).get(E.personKey(w1)))).map((x) => x.n), [5]);   // colonne : plus de 3 RP
  // un autre repos (RF) coupe la suite ; un jour absent des fichiers aussi
  const w3 = run(week([2026, 9, 21], [{ mat: '1', nom: 'TEST', j: ['RP', 'RP', 'RF', 'RP', 'RP', 'RP', d(27)] }]), RES).agents[0];
  assert.deepEqual(JSON.parse(JSON.stringify(E.rpSuites([w3]).get(E.personKey(w3)))).map((x) => [x.debut, x.n]), [['2026-09-24', 3]]);
  assert.deepEqual(JSON.parse(JSON.stringify(E.rpSuites([w1, w3]).get(E.personKey(w1)))).map((x) => [x.debut, x.fin]), [['2026-09-11', '2026-09-13'], ['2026-09-24', '2026-09-26']]);
  assert.equal(E.coutHeuresSup(10, 'CONDUCTEUR', {}), null);
  assert.equal(E.coutHeuresSup(10, 'CONDUCTEUR', { production: { coutHS: { cdr: 20, afr: 18, maj: 25 } } }), 250);
  assert.equal(E.coutHeuresSup(10, 'AFR', { production: { coutHS: { cdr: 20, afr: 18, maj: 25 } } }), 225);
});

test('Production : repos dus séparés conducteurs / AFR (Réglages), accord à défaut', () => {
  const d = (x) => svc(['T' + x, 'HENDAYE', 'HENDAYE', x, '08:00', x, '14:00']);
  const w = run(week([2026, 9, 7], [{ mat: '1', nom: 'C', j: [d(7), d(8), d(9), d(10), d(11), 'RP', 'RP'] },
    { mat: '2', nom: 'F', met: 'AFR', j: [d(7), d(8), d(9), d(10), d(11), 'RP', 'RP'] }]), RES);
  w.agents.forEach((a) => a.weekId = w.meta.weekId);
  const R = E.loadRules({ ...RES, production: { reposDusCDR: 2, reposDusAFR: 3, reposPar: 'semaine' } });
  const P = E.productionData(w.agents, w.agents, R).personnes;
  assert.ok(Math.abs(P.find((p) => p.nom === 'C').reposDus - 2) < 1e-9);
  assert.ok(Math.abs(P.find((p) => p.nom === 'F').reposDus - 3) < 1e-9);
  const P2 = E.productionData(w.agents, w.agents, E.loadRules(RES)).personnes;   // vide : accord 117 / 113 par an
  assert.ok(P2.find((p) => p.nom === 'C').reposDus > P2.find((p) => p.nom === 'F').reposDus);
});
