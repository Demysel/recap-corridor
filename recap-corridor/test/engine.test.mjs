import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readRecapSheet, parseWeek, applyRules, agg, mergeAcrossWeeks, reconcile, modeVal, DEFAULT_RULES, personKey } from '../public/engine.js';

const src = new URL('./S39.xlsx', import.meta.url);
if (!fs.existsSync(src)) { console.log('test/S39.xlsx absent (données nominatives, non versionnées) — test ignoré.'); process.exit(0); }
const buf = fs.readFileSync(src);
const { rows } = await readRecapSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const parsed = parseWeek(rows);
const v = applyRules(parsed, DEFAULT_RULES);
const tot = (l, k) => l.reduce((s, a) => s + (a[k] || 0), 0);

// 1. Non-régression sur les chiffres validés
assert.equal(parsed.meta.weekId, '2026-S39');
assert.equal(parsed.meta.format, 2);
assert.equal(v.agents.length, 258, 'aucun doublon dans S39');
assert.equal(tot(v.agents, 'nbRHR'), 246);
assert.equal(tot(v.agents, 'journeesBlanches'), 15);
const he = v.agents.filter(a => a.agence === 'Hendaye'), bx = v.agents.filter(a => a.agence === 'Bordeaux-St-Jean');
assert.equal(tot(he, 'nbRHR'), 7);
assert.equal(tot(bx, 'nbRHR'), 27);
console.log('✔ non-régression S39 : 258 agents, 246 RHR, 15 journées blanches, HE 7 / BX 27');

// 2. Pauses conservées
const ms = parsed.agents.flatMap(a => a.jours.flatMap(j => j.missions || []));
assert.ok(ms.filter(m => m.pauses.length).length > 500, 'horaires de pause conservés');
console.log(`✔ ${ms.filter(m => m.pauses.length).length} missions avec horaires de pause conservés sur ${ms.length}`);

// 3. Cas contrôlés à la main
const find = (nom, prenom) => v.agents.find(a => a.nom === nom && (!prenom || a.prenom === prenom));
// BIDORET (conducteur) mercredi NVT-312 20:30 -> 24/03:20, pause 24/02:45-03:05 : nuit 22h-5h = 5h20 - 20 min = 5h00
const bid = find('BIDORET');
const mer = bid.jours[2];
console.log('  BIDORET mer', mer.missions[0].label, mer.missions[0].pauses);
// ATCMD = 5 h
const soub = find('SOUBIGOU', 'Jérôme');
const atc = soub.jours[6].missions[0];
assert.match(atc.label, /ATCMD/);
console.log(`  SOUBIGOU J. dimanche ${atc.label} ${atc.start.slice(11,16)}-${atc.end.slice(11,16)} (${atc.amplitude} h d'amplitude) → compté 5 h`);
assert.equal(soub.nbATCMD, 1);
// MHIS non exclusif
const duphil = find('DUPHIL');
console.log(`  DUPHIL : ${duphil.nbMHIS} MHIS (MHIS-109, MHIS-308, …)`);
assert.equal(duphil.nbMHIS, 2);
// Heures de nuit AFR 22h-7h vs CDR 22h-5h
const lajaunie = find('LAJAUNIE'); // AFR, samedi RNF+KVF 18:00 -> 02:00, pause ?
console.log(`  LAJAUNIE (AFR) nuit ${lajaunie.heuresNuit} h`);

// 4. Détail d'un conducteur : BELLY
const b = find('BELLY');
console.log('\nBELLY Marc (conducteur Hendaye)');
console.log('  heures planifiées', b.heuresPlanifiees, '| sup', b.heuresSup, '| nuit', b.heuresNuit, '| dimanche', b.heuresDimanche);
console.log('  paniers', b.nbPaniers, b.paniers.map(p => `${p.date.slice(5)} ${p.plage}(${p.source})`).join(', '));
console.log('  RHR', b.rhr.map(r => `${r.lieu} ${r.debut.slice(5,16)}→${r.fin.slice(5,16)}`).join(' | '));

// 5. Agrégat HE+BX
const g = agg([...he, ...bx].map(a => ({ ...a, weekId: '2026-S39' })));
console.log('\nHE+BX :', JSON.stringify({ agents: g.nbAgents, hPlan: g.heuresPlanifiees, hSup: g.heuresSup, agentsSup: g.agentsHeuresSup,
  rhr: g.nbRHR, agentsRHR: g.agentsAvecRHR, rhrParAgent: g.rhrParAgent, tempsRHRParAgent: g.tempsRHRParAgent,
  trajets: g.nbTrajetsSeuls, mhis: g.nbMHIS, dispo: g.nbDISPO, atcmd: g.nbATCMD, paniers: g.nbPaniers, ratio: g.ratioPanierJS,
  nuit: g.heuresNuit, dim: g.heuresDimanche }));
console.log('  mode agent → RHR moyen', modeVal(g, 'nbRHR', 'agent'), '(sur', g.lignesAvecRHR, 'agents avec RHR), heures planifiées moyennes', modeVal(g, 'heuresPlanifiees', 'agent'));
