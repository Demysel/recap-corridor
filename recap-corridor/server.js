/* ==========================================================================
   RÉCAP CORRIDOR — SERVEUR
   Node 20+, une seule dépendance (pg). Sert la page index.html et l'API
   (mêmes adresses que la version Netlify : session, etat, semaine, regles).
   Données : Postgres (Supabase), schéma « recap ».

   Variables d'environnement :
     DATABASE_URL   chaîne de connexion Postgres
     CODE_ADMIN     code d'accès complet (import, suppression, réglages)
     CODE_LECTURE   code visiteur : statistiques anonymes uniquement (aucun nom ni matricule)
     PORT           fourni par Render
   ========================================================================== */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const MAX_BODY = 200 * 1024 * 1024;     // 200 Mo : aucun fichier réel n'approche

/* --------------------------------------------------------- base de données */
let pool = null;
function makePool(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
}
/** Connexion au pooler Supabase ; bascule automatiquement entre les grappes aws-0 / aws-1 si besoin */
async function connectDb() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL absente');
  const candidates = [base];
  if (/aws-0-/.test(base)) candidates.push(base.replace('aws-0-', 'aws-1-'));
  else if (/aws-1-/.test(base)) candidates.push(base.replace('aws-1-', 'aws-0-'));
  let last;
  for (const url of candidates) {
    const p = makePool(url);
    try { await p.query('select 1 from recap.semaines limit 1'); pool = p; console.log('Base connectée :', new URL(url).host); return; }
    catch (e) { last = e; console.error('Connexion refusée par', new URL(url).host, '—', e.message); await p.end().catch(() => {}); }
  }
  throw last;
}
async function db() {
  if (!pool) await connectDb();
  return pool;
}

/* ------------------------------------------------------------ accès */
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function same(a, b) {
  const x = Buffer.from(norm(a)), y = Buffer.from(norm(b));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function role(req) {
  const given = req.headers['x-acces'] || '';
  if (process.env.CODE_ADMIN && same(given, process.env.CODE_ADMIN)) return 'admin';
  if (process.env.CODE_LECTURE && same(given, process.env.CODE_LECTURE)) return 'lecture';
  return null;
}
const echecs = new Map();   // ralentit les essais de code répétés
function trop(ip) {
  const e = echecs.get(ip); const now = Date.now();
  if (!e || now - e.t > 10 * 60e3) return false;
  return e.n >= 30;
}
function echec(ip) { const e = echecs.get(ip); const now = Date.now(); if (!e || now - e.t > 10 * 60e3) echecs.set(ip, { n: 1, t: now }); else e.n++; }

/* ------------------------------------------------------------ réponses */
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
};
function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { ...SEC, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|html|javascript|css/.test(type)) {
    buf = zlib.gzipSync(buf, { level: 6 }); headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers); res.end(buf);
}
const json = (req, res, status, obj) => send(req, res, status, obj);
async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(new Error('Envoi trop volumineux.'), { status: 413 }); chunks.push(c); }
  const raw = Buffer.concat(chunks);
  const txt = (req.headers['content-encoding'] || '').includes('gzip') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  try { return JSON.parse(txt || '{}'); } catch (e) { throw Object.assign(new Error('Contenu JSON invalide.'), { status: 400 }); }
}

/* ------------------------------------------------------------ moteur de calcul
   Le même code que la page : lu dans index.html, pour que les statistiques visiteur soient
   calculées ici et que seules des données agrégées et anonymes quittent le serveur. */
let moteur = null;
function engine() {
  if (moteur) return moteur;
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('1. LECTURE DU FICHIER'), b = html.indexOf('8. ACCÈS AU SERVEUR');
  const code = html.slice(html.lastIndexOf('<script>', a) + 8, html.lastIndexOf('/* ====', b));
  const ctx = vm.createContext({ console, Blob, Response, DecompressionStream, TextDecoder, TextEncoder, URL, Date, Math, structuredClone });
  vm.runInContext(code + ';globalThis.__E={vitrineData,loadRules};', ctx);
  moteur = ctx.__E;
  return moteur;
}
let vitrineCache = null;       // recalculée après chaque import, suppression ou changement de règles
async function vitrine(p) {
  if (vitrineCache) return vitrineCache;
  const d = await p.query('select week_id, data from recap.details order by week_id, agence_slug');
  const c = await p.query("select valeur from recap.config where cle = 'regles'");
  const weeks = new Map();
  for (const r of d.rows) {
    if (!weeks.has(r.week_id)) weeks.set(r.week_id, { meta: r.data.meta, agents: [] });
    weeks.get(r.week_id).agents.push(...(r.data.agents || []));
  }
  const E = engine();
  vitrineCache = JSON.parse(JSON.stringify(E.vitrineData([...weeks.values()], E.loadRules(c.rows[0]?.valeur || null))));
  return vitrineCache;
}
/** Résumé d'une semaine sans rien de nominatif (le résumé complet contient le nom du fichier et les anomalies de lecture) */
const resumePublic = (x) => ({ weekId: x.weekId, year: x.year, week: x.week, monday: x.monday, sunday: x.sunday });

/* ------------------------------------------------------------ API */
const ID = /^\d{4}-S\d{2}$/;
async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\/?/, '');
  if (route === 'ping') return json(req, res, 200, { ok: true });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (trop(ip)) return json(req, res, 429, { error: 'Trop d’essais. Réessayez dans quelques minutes.' });
  const r = role(req);
  if (!r) { if (req.headers['x-acces']) echec(ip); await new Promise((ok) => setTimeout(ok, 400)); return json(req, res, 401, { error: 'Code d’accès non reconnu.' }); }
  if (route === 'session') return json(req, res, 200, { role: r });
  const admin = r === 'admin';
  const p = await db();

  if (route === 'etat' && req.method === 'GET') {
    const w = await p.query('select resume from recap.semaines order by week_id desc');
    if (!admin) return json(req, res, 200, { role: r, weeks: w.rows.map((x) => resumePublic(x.resume)), regles: null });
    const c = await p.query("select cle, valeur from recap.config where cle in ('regles', 'suivi', 'journal')");
    const cfg = Object.fromEntries(c.rows.map((x) => [x.cle, x.valeur]));
    return json(req, res, 200, { role: r, weeks: w.rows.map((x) => x.resume), regles: cfg.regles || null,
      suivi: cfg.suivi || { alertes: {} }, journal: (cfg.journal || []).slice(-300) });
  }
  if (route === 'vitrine' && req.method === 'GET') return json(req, res, 200, await vitrine(p));
  if (route === 'semaine' && req.method === 'GET') {
    if (!admin) return json(req, res, 403, { error: 'Le code visiteur donne accès aux statistiques anonymes uniquement.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    const d = await p.query('select data from recap.details where week_id = $1 order by agence_slug', [id]);
    return json(req, res, 200, { docs: d.rows.map((x) => x.data) });
  }
  if (route === 'semaine' && req.method === 'PUT') {
    if (!admin) return json(req, res, 403, { error: 'Le code de lecture ne permet pas d’importer.' });
    const { resume, details } = await readBody(req);
    if (!resume || !ID.test(resume.weekId || '') || !Array.isArray(details) || !details.length) return json(req, res, 400, { error: 'Données d’import incomplètes.' });
    if (!resume.importedAt) resume.importedAt = new Date().toISOString();
    const c = await p.connect();
    try {
      await c.query('begin');
      await c.query('insert into recap.semaines(week_id, resume) values ($1, $2) on conflict (week_id) do update set resume = excluded.resume, maj = now()', [resume.weekId, resume]);
      await c.query('delete from recap.details where week_id = $1', [resume.weekId]);
      for (const d of details) {
        const sl = String(d.agenceSlug || '').replace(/[^a-z0-9._~:@+-]/gi, '').slice(0, 120);
        if (!sl) continue;
        await c.query('insert into recap.details(week_id, agence_slug, data) values ($1, $2, $3)', [resume.weekId, sl, d]);
      }
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    vitrineCache = null;
    return json(req, res, 200, { ok: true, weekId: resume.weekId });
  }
  if (route === 'semaine' && req.method === 'DELETE') {
    if (!admin) return json(req, res, 403, { error: 'Le code de lecture ne permet pas de supprimer.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    await p.query('delete from recap.semaines where week_id = $1', [id]);   // les détails suivent (cascade)
    vitrineCache = null;
    return json(req, res, 200, { ok: true });
  }
  if (route === 'regles' && req.method === 'PUT') {
    if (!admin) return json(req, res, 403, { error: 'Le code de lecture ne permet pas de modifier les règles.' });
    const { _journal, ...body } = await readBody(req);
    const le = new Date().toISOString();
    await p.query("insert into recap.config(cle, valeur) values ('regles', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()", [{ ...body, majLe: le }]);
    if (_journal) {   // journal des modifications : qui, quand, quoi, et l'effet sur les chiffres
      const j = await p.query("select valeur from recap.config where cle = 'journal'");
      const list = [...(j.rows[0]?.valeur || []), { ..._journal, le }].slice(-500);
      await p.query("insert into recap.config(cle, valeur) values ('journal', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()", [JSON.stringify(list)]);
    }
    vitrineCache = null;
    return json(req, res, 200, { ok: true });
  }
  if (route === 'suivi' && req.method === 'PUT') {   // suivi des alertes « À vérifier » : vu, corrigé, note
    if (!admin) return json(req, res, 403, { error: 'Le code visiteur ne permet pas de modifier le suivi.' });
    const body = await readBody(req);
    await p.query("insert into recap.config(cle, valeur) values ('suivi', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()", [{ alertes: body.alertes || {}, majLe: new Date().toISOString() }]);
    return json(req, res, 200, { ok: true });
  }
  return json(req, res, 404, { error: 'Adresse inconnue.' });
}

/* ------------------------------------------------------------ icônes (onglet, écran d'accueil, application) */
const ICONES = {
  '/icons/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/icons/favicon-32.png': ['favicon-32.png', 'image/png'],
  '/icons/favicon-16.png': ['favicon-16.png', 'image/png'], '/icons/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/icons/icon-192.png': ['icon-192.png', 'image/png'], '/icons/icon-512.png': ['icon-512.png', 'image/png'],
  '/icons/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'], '/icons/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  // adresses demandées d'office par certains navigateurs
  '/favicon.ico': ['favicon-32.png', 'image/png'], '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/apple-touch-icon-precomposed.png': ['apple-touch-icon.png', 'image/png'],
};
async function icone(req, res, path) {
  const [f, type] = ICONES[path];
  return send(req, res, 200, await readFile(join(ROOT, 'icons', f)), type, { 'Cache-Control': 'public, max-age=86400' });
}

/* ------------------------------------------------------------ page */
const PAGE = join(ROOT, 'index.html');
async function statique(req, res, url) {
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(req, res, 404, 'Page introuvable', 'text/plain; charset=utf-8');
  const buf = await readFile(PAGE);
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  return send(req, res, 200, buf, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache', ETag: etag });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/robots.txt') return send(req, res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    if (ICONES[url.pathname]) return await icone(req, res, url.pathname);
    return await statique(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(req, res, e.status || 500, { error: e.status ? e.message : 'Erreur serveur : ' + e.message });
  }
}).listen(PORT, () => {
  console.log('Récap Corridor à l’écoute sur le port', PORT);
  connectDb().catch((e) => console.error('Base indisponible au démarrage :', e.message));
});
