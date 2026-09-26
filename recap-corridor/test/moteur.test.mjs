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
vm.runInContext(code + ';globalThis.E={parseWeek,applyRules,reconcile,agg,mergeAcrossWeeks,fmtH,fmtHour,buildXlsx,readRecapSheet,vitrineData,loadRules};', ctx);
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

test('journée blanche : case vide encadrée par deux services, pas le lendemain de nuit', () => {
  const a = one([svc(['T', 'HENDAYE', 'HENDAYE', 7, '06:00', 7, '12:00']), null, svc(['N', 'HENDAYE', 'HENDAYE', 9, '22:00', 10, '05:00']), null, null, svc(['T', 'HENDAYE', 'HENDAYE', 12, '06:00', 12, '12:00']), 'RP'], {}, RES);
  // mardi : blanche ; jeudi : fin du service de nuit, exclu ; vendredi : blanche
  assert.equal(JSON.stringify(a.blanches.map((x) => x.d)), "[1,4]");
});

test('heures planifiées, pauses, heures sup et ATCMD', () => {
  const j = [0, 1, 2, 3, 4].map((i) => svc(['T', 'HENDAYE', 'HENDAYE', 7 + i, '06:00', 7 + i, '14:00', [[7 + i, '10:00', 7 + i, '10:30']]]));
  const a = one([...j, svc(['ATCMD', 'HENDAYE', 'HENDAYE', 12, '06:00', 12, '14:00']), 'RP'], {}, RES);
  assert.equal(a.heuresPlanifiees, 5 * 7.5 + 5);
  assert.equal(a.heuresSup, 7.5);
  assert.equal(a.nbATCMD, 1);
  assert.equal(a.pauseTotaleMin, 150);
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
  const a = one(j, {}, RES);
  assert.equal(a.journeesBlanches, 1);
  assert.equal(a.casesVides.find((c) => c.d === 3).raison, 'fin du service de nuit à 02:00');
  assert.equal(a.casesVides.find((c) => c.d === 6).raison, 'après le dernier service de la semaine');
  assert.equal(one(j, {}, { ...RES, corrections: { jb: { 'm:1|2026-09-08': 'non' } } }).journeesBlanches, 0);
  assert.equal(one(j, {}, { ...RES, corrections: { jb: { 'm:1|2026-09-13': 'oui' } } }).journeesBlanches, 2);
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
