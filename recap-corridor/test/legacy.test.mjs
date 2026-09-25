import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { applyRules, reconcile, agg, mergeAcrossWeeks, modeVal, DEFAULT_RULES, groupBy } from '../public/engine.js';

const dir = process.argv[2] || process.env.RECAP_DETAIL_DIR || '/home/claude/v2/db/detail';
if (!fs.existsSync(dir)) { console.log(`Dossier de données ${dir} absent (données nominatives, non versionnées) — test ignoré.`); process.exit(0); }
const docs = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const weeks = new Map();
for (const [id, list] of groupBy(docs, d => d.weekId)) {
  const parsed = { meta: list[0].meta, agents: list.flatMap(d => d.agents) };
  const v = applyRules(parsed, DEFAULT_RULES);
  v.agents.forEach(a => a.weekId = id);
  weeks.set(id, v);
}
reconcile(new Map([...weeks.entries()].sort()), DEFAULT_RULES);
const rows = [...weeks.values()].flatMap(w => w.agents);
const brut = docs.reduce((s, d) => s + d.agents.length, 0);
console.log(`Semaines : ${weeks.size} | lignes brutes : ${brut} | après fusion : ${rows.length} (−${brut - rows.length})`);
const fus = rows.filter(a => a.fusion);
console.log(`Fusions : ${fus.length} personnes-semaines fusionnées, ${fus.reduce((s,a)=>s+a.fusion.lignes,0)} lignes d'origine`);
assert.equal(fus.length, 70, '70 doublons attendus');

// Contrôle TRAINA S31 : 3 lignes. La ligne principale est en CP toute la semaine (RP-70/71) ;
// les deux autres sont des semaines antérieures recopiées (RP-62/63, RP-64/65, dates 29/30/01… hors colonne).
const show = (t) => t.jours.map(j => j.kind === 'SERVICE' ? j.missions.map(m => m.label.split('-')[0]).join('+') : (j.code || '·')).join(' | ');
const t = weeks.get('2026-S31').agents.find(a => a.nom === 'TRAINA');
console.log('TRAINA S31 fusionné :', show(t), '| hors colonne écartées :', t.nbHorsColonne);
assert.equal(t.joursService, 0); assert.equal(t.joursCP, 5); assert.equal(t.nbHorsColonne, 5);
const t36 = weeks.get('2026-S36').agents.find(a => a.nom === 'TRAINA');
console.log('TRAINA S36 fusionné :', show(t36), '| heures', t36.heuresPlanifiees, '| sup', t36.heuresSup, '| écartées', t36.nbHorsColonne);
assert.ok(t36.heuresPlanifiees < 40, 'plus de journée à 25 h');
// Mode « garder » : ancien comportement, tout est compté tel qu'écrit
const t36g = applyRules({ meta: weeks.get('2026-S36').meta, agents: docs.filter(d => d.weekId === '2026-S36').flatMap(d => d.agents) }, { ...DEFAULT_RULES, horsColonne: 'garder' }).agents.find(a => a.nom === 'TRAINA');
console.log('  même agent, règle « garder » :', t36g.heuresPlanifiees, 'h');
const hcAll = [...weeks.values()].reduce((s, w) => s + w.meta.horsColonne.length, 0);
console.log(`Missions datées hors de leur colonne écartées sur la période : ${hcAll}`);

// Une seule ligne par personne sur toute la période
const per = mergeAcrossWeeks(rows);
const noms = per.map(p => p.nom + ' ' + p.prenom);
assert.equal(new Set(noms).size, noms.length, 'aucun nom en double');
console.log(`Tableau agents « toutes semaines » : ${per.length} lignes, aucun nom en double ✔`);

// Anciennes semaines : horaires de pause inconnus
const leg = rows.filter(a => a.legacy);
console.log(`Semaines au format 1 (à réimporter pour nuit/panier/dimanche exacts) : ${new Set(leg.map(a=>a.weekId)).size}/${weeks.size}`);

// Hendaye + Bordeaux sur toute la période
const sc = rows.filter(a => ['Hendaye', 'Bordeaux-St-Jean'].includes(a.agence));
const g = agg(sc);
console.log('\nHendaye + Bordeaux, 15 semaines');
for (const [k, l] of [['nbAgents','Agents distincts'],['heuresPlanifiees','Heures planifiées'],['heuresSup','Heures sup'],['nbRHR','RHR'],
  ['journeesBlanches','Journées blanches'],['nbMissions','Missions'],['nbTrajetsSeuls','Trajets seuls'],['nbPaniers','Paniers']])
  console.log(`  ${l.padEnd(20)} total ${String(modeVal(g,k,'total')).padStart(8)} | /semaine ${String(modeVal(g,k,'semaine')).padStart(7)} | /agent·sem ${String(modeVal(g,k,'agent')).padStart(6)}`);
console.log(`  RHR/agent (hors AFR et agents à 0) ${g.rhrParAgent} | temps RHR/agent ${g.tempsRHRParAgent} h | ratio panier/JS ${g.ratioPanierJS}`);
for (const [ag, l] of groupBy(sc, a => a.agence)) { const x = agg(l);
  console.log(`  ${ag.padEnd(18)} ${x.nbAgents} agents | h. sup ${x.heuresSup} (${x.agentsHeuresSup} agents) | RHR ${x.nbRHR} | trajets ${x.nbTrajetsSeuls} | MHIS ${x.nbMHIS} | DISPO ${x.nbDISPO} | ATCMD ${x.nbATCMD}`); }
