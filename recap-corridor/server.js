/* ==========================================================================
   RÉCAP CORRIDOR — SERVEUR
   Node 20+, une seule dépendance (pg). Sert la page index.html et l'API
   (mêmes adresses que la version Netlify : session, etat, semaine, regles).
   Données : Postgres (Supabase), schéma « recap ».

   Variables d'environnement :
     DATABASE_URL   chaîne de connexion Postgres
     CODE_ADMIN     code d'accès complet (import, suppression, réglages)
     CODE_LECTURE   code visiteur : statistiques anonymes uniquement (aucun nom ni matricule)
     CODE_COVOIT    code « Coco » (copain covoit) : missions de la semaine des seuls agents choisis par l'admin
     CODES_ACCES    « oui » : accepte aussi les codes sur le site principal (secours ; par défaut, codes refusés sur le
                    principal à la demande de l'utilisateur, acceptés sur le site de test)
     APP_URL        adresse du site (liens de mot de passe), ex. https://recap-corridor.onrender.com
     BREVO_API_KEY  clé de l'API Brevo (envoi des e-mails de mot de passe) ; sans elle, aucun e-mail : l'admin transmet les liens
     MAIL_FROM      adresse d'expédition validée dans Brevo
     PORT           fourni par Render
     DB_SCHEMA      schéma Postgres (défaut « recap » ; « recap_dev » pour le site de test)
     APP_ENV        « dev » : site de test, couleurs différentes et bandeau « SITE DE TEST »
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
/** Site principal : schéma « recap ». Site de test : même base, schéma distinct (« recap_dev »), sans effet sur le principal */
const SCHEMA = /^[a-z_][a-z0-9_]{0,40}$/.test(process.env.DB_SCHEMA || '') ? process.env.DB_SCHEMA : 'recap';
const DEV = process.env.APP_ENV === 'dev';

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
    try { await p.query(`select 1 from ${SCHEMA}.semaines limit 1`); pool = p; console.log('Base connectée :', new URL(url).host); return; }
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
/** Codes d'accès : retirés du site principal (demandé par l'utilisateur : connexion par compte seulement) ; gardés sur le test */
const CODES = DEV || process.env.CODES_ACCES === 'oui';
function role(req) {
  if (!CODES) return null;
  const given = req.headers['x-acces'] || '';
  if (process.env.CODE_ADMIN && same(given, process.env.CODE_ADMIN)) return 'admin';
  if (process.env.CODE_LECTURE && same(given, process.env.CODE_LECTURE)) return 'lecture';
  if (process.env.CODE_COVOIT && same(given, process.env.CODE_COVOIT)) return 'covoit';
  return null;
}
/* Comptes e-mail + mot de passe (en plus des codes, gardés en parallèle). Cinq droits séparés :
   vitrine (statistiques anonymes), coco (vue covoiturage), lecture (consultation complète, nominative),
   modif (import, réglages, corrections, planification) et admin (gestion des utilisateurs). admin ⇒ tous ; modif ⇒ lecture.
   Mots de passe : empreinte scrypt seulement. Sessions et liens de réinitialisation : seule l'empreinte SHA-256 du jeton est gardée.
   Aucun e-mail envoyé (choix de l'utilisateur) : l'admin crée les liens (invitation, nouveau mot de passe) et les transmet lui-même ;
   « mot de passe oublié » et les inscriptions apparaissent dans Administration → Utilisateurs. */
const DROITS = ['vitrine', 'coco', 'lecture', 'modif', 'admin'];
function capsDe(d) {
  const c = Object.fromEntries(DROITS.map((k) => [k, !!(d && d[k])]));
  if (c.admin) for (const k of DROITS) c[k] = true;
  if (c.modif) c.lecture = true;
  return c;
}
/** Rôle d'affichage de la page : lecture ⇒ page complète ; vitrine + coco ⇒ « mixte » ; sinon comme les codes */
const roleDe = (c) => c.lecture ? 'admin' : c.vitrine && c.coco ? 'mixte' : c.coco ? 'covoit' : c.vitrine ? 'lecture' : 'aucun';
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const jetonNeuf = () => crypto.randomBytes(32).toString('base64url');
const JETON = /^[A-Za-z0-9_-]{30,100}$/;
const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,}$/i;
const scryptP = (mdp, sel) => new Promise((ok, ko) => crypto.scrypt(String(mdp).normalize('NFC'), sel, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? ko(e) : ok(k)));
async function hacher(mdp) { const sel = crypto.randomBytes(16); return 'scrypt$' + sel.toString('base64') + '$' + (await scryptP(mdp, sel)).toString('base64'); }
async function verifier(mdp, h) {
  const [algo, sel, k] = String(h || '').split('$');
  if (algo !== 'scrypt' || !sel || !k) { await scryptP(mdp, 'x'); return false; }   // même durée que si le compte existait
  const a = await scryptP(mdp, Buffer.from(sel, 'base64')), b = Buffer.from(k, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const mdpValide = (m) => typeof m === 'string' && m.length >= 10 && m.length <= 200;
let tablesPretes = false;
async function tablesAuth(p) {
  if (tablesPretes) return;
  await p.query(`create table if not exists ${SCHEMA}.utilisateurs (email text primary key, nom text not null default '', hash text not null,
      droits jsonb not null default '{}'::jsonb, valide boolean not null default false, cree timestamptz not null default now(),
      maj timestamptz not null default now(), derniere timestamptz);
    create table if not exists ${SCHEMA}.sessions (jeton text primary key,
      email text not null references ${SCHEMA}.utilisateurs(email) on delete cascade on update cascade, expire timestamptz not null);
    create table if not exists ${SCHEMA}.agendas (jeton text primary key, ics text not null, expire timestamptz not null);
    create table if not exists ${SCHEMA}.jetons_mdp (jeton text primary key,
      email text not null references ${SCHEMA}.utilisateurs(email) on delete cascade on update cascade, expire timestamptz not null);
    alter table ${SCHEMA}.utilisateurs add column if not exists demande timestamptz;
    alter table ${SCHEMA}.utilisateurs add column if not exists agent jsonb;
    alter table ${SCHEMA}.utilisateurs add column if not exists cal text;
    alter table ${SCHEMA}.utilisateurs enable row level security;
    alter table ${SCHEMA}.sessions enable row level security;
    alter table ${SCHEMA}.jetons_mdp enable row level security;
    alter table ${SCHEMA}.agendas enable row level security;`);
  tablesPretes = true;
}
/** Qui appelle : un code (x-acces) ou une session de compte (x-session) → { role, caps, user } ; null si inconnu */
async function acces(req) {
  const r = role(req);
  if (r) { const caps = r === 'admin' ? capsDe({ admin: true }) : capsDe({ [r === 'covoit' ? 'coco' : 'vitrine']: true }); return { role: r, caps, user: null }; }
  const s = req.headers['x-session'] || '';
  if (!JETON.test(s)) return null;
  const p = await db(); await tablesAuth(p);
  const q = await p.query(`select u.email, u.nom, u.droits, u.valide from ${SCHEMA}.sessions s join ${SCHEMA}.utilisateurs u on u.email = s.email
    where s.jeton = $1 and s.expire > now()`, [sha(s)]);
  const u = q.rows[0];
  if (!u) return null;
  const caps = u.valide ? capsDe(u.droits) : capsDe({});   // droits relus à chaque appel : un retrait prend effet tout de suite
  return { role: roleDe(caps), caps, user: { email: u.email, nom: u.nom } };
}
/** Adresse du site pour les liens de mot de passe : APP_URL, sinon l'hôte Render de la requête (jamais un hôte arbitraire) */
function base(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const h = String(req.headers.host || '');
  return /^[a-z0-9-]+\.onrender\.com$/i.test(h) ? 'https://' + h : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? 'http://' + h : null;
}
/** Lien de réinitialisation (ou d'invitation) : jeton aléatoire, empreinte seule en base */
async function lienMdp(p, req, email, heures) {
  const j = jetonNeuf();
  await p.query(`delete from ${SCHEMA}.jetons_mdp where expire < now() or email = $1`, [email]);
  await p.query(`insert into ${SCHEMA}.jetons_mdp(jeton, email, expire) values ($1, $2, now() + make_interval(hours => $3))`, [sha(j), email, heures]);
  const b = base(req);
  return b ? `${b}/?reinit=${j}` : null;
}
/** Envoi d'un e-mail par l'API Brevo (clé et expéditeur dans les variables Render) ; false si non configuré ou refusé */
const MAIL = !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
async function mail(to, sujet, html, pj) {
  if (!MAIL) return false;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: process.env.MAIL_FROM, name: (DEV ? '[TEST] ' : '') + 'Récap Corridor' }, to: [{ email: to }],
        subject: (DEV ? '[TEST] ' : '') + sujet,
        htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${html}</div>`,
        ...(pj ? { attachment: [{ name: pj.nom, content: Buffer.from(pj.texte, 'utf8').toString('base64') }] } : {}) }),
    });
    if (!r.ok) console.error('Brevo : envoi refusé', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) { console.error('Brevo : envoi impossible', e.message); return false; }
}
const escH = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** E-mail contenant un lien de mot de passe (oubli, réinitialisation par l'admin, invitation) */
function mailLien(email, lien, invitation, duree) {
  if (!lien) return Promise.resolve(false);
  const b = `<a href="${escH(lien)}" style="display:inline-block;background:#EC0016;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${invitation ? 'Choisir mon mot de passe' : 'Choisir un nouveau mot de passe'}</a>`;
  return invitation
    ? mail(email, 'Invitation à Récap Corridor', `<p>Bonjour,</p><p>Un compte Récap Corridor a été créé pour vous. Choisissez votre mot de passe :</p><p>${b}</p><p>Ce lien est valable ${duree} et ne sert qu’une fois.</p>`)
    : mail(email, 'Mot de passe Récap Corridor', `<p>Bonjour,</p><p>Pour choisir un nouveau mot de passe, ouvrez ce lien :</p><p>${b}</p><p>Il est valable ${duree} et ne sert qu’une fois. Si vous n’avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.</p>`);
}
/** Bouton du récap (même texte que recapBouton dans la page) */
const boutonAgenda = (u) => `<p style="margin:16px 0 4px"><a href="${escH(u)}" style="display:inline-block;background:#EC0016;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">📅 Ajouter cette semaine à mon agenda</a></p>
  <p style="margin:0;font-size:12px;color:#777">iPhone : touchez le bouton puis « Tout ajouter ». Android : ouvrez le fichier téléchargé avec votre agenda (Samsung Agenda, Outlook…).</p>`;
/** E-mail du lien d'abonnement à l'agenda, avec la marche à suivre iPhone / Android / Outlook */
function mailAgenda(email, lien) {
  const w = lien.replace(/^https?:/, 'webcal:'), b = `display:inline-block;background:#EC0016;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold`;
  return mail(email, 'Votre planning dans votre agenda', `<p>Bonjour,</p><p>Ajoutez une seule fois votre planning (missions, RP, CP, RHR) à l’agenda de votre téléphone : il se mettra ensuite à jour tout seul à chaque nouvelle semaine.</p>
    <p><b>iPhone</b> : touchez ce bouton puis « S’abonner ».</p><p><a href="${escH(w)}" style="${b}">Ajouter à mon agenda</a></p>
    <p><b>Android (Google Agenda)</b> : sur un ordinateur, ouvrez calendar.google.com, puis à gauche « Autres agendas » → « + » → « À partir de l’URL », et collez ce lien (l’agenda apparaît ensuite sur le téléphone ; Google le met à jour toutes les quelques heures) :</p>
    <p style="word-break:break-all;font-family:monospace;font-size:13px">${escH(lien)}</p>
    <p><b>Outlook</b> : « Ajouter un calendrier » → « À partir d’Internet », puis collez le même lien.</p>
    <p style="color:#666;font-size:13px">Ce lien est personnel : ne le partagez pas. Un administrateur peut le couper à tout moment.</p>`);
}
const nbAdmins = async (p, sauf) => (await p.query(`select count(*)::int n from ${SCHEMA}.utilisateurs where valide and (droits->>'admin')::boolean is true and email <> $1`, [sauf || ''])).rows[0].n;
const droitsPropres = (d) => Object.fromEntries(DROITS.filter((k) => d && d[k]).map((k) => [k, true]));
const emailNorm = (e) => String(e || '').trim().toLowerCase().slice(0, 254);

/** Routes des comptes accessibles sans être connecté : connexion, inscription, mot de passe oublié, nouveau mot de passe */
async function authPublique(req, res, route, ip) {
  if (req.method !== 'POST') return json(req, res, 405, { error: 'Méthode non permise.' });
  const body = await readBody(req);
  const p = await db(); await tablesAuth(p);
  const email = emailNorm(body.email);
  if (route === 'auth/login') {
    const u = (await p.query(`select email, nom, hash, droits, valide from ${SCHEMA}.utilisateurs where email = $1`, [email])).rows[0];
    const ok = await verifier(String(body.mdp || ''), u?.hash);
    if (!u || !ok) { echec(ip); await new Promise((r) => setTimeout(r, 400)); return json(req, res, 401, { error: 'E-mail ou mot de passe incorrect.' }); }
    if (!u.valide) return json(req, res, 403, { error: 'Votre compte attend la validation d’un administrateur.' });
    const j = jetonNeuf();
    await p.query(`delete from ${SCHEMA}.sessions where expire < now()`);
    await p.query(`insert into ${SCHEMA}.sessions(jeton, email, expire) values ($1, $2, now() + interval '30 days')`, [sha(j), u.email]);
    await p.query(`update ${SCHEMA}.utilisateurs set derniere = now() where email = $1`, [u.email]);
    const caps = capsDe(u.droits);
    return json(req, res, 200, { jeton: j, role: roleDe(caps), caps, user: { email: u.email, nom: u.nom } });
  }
  if (route === 'auth/inscription') {   // inscription libre, sans aucun droit tant qu'un administrateur ne l'a pas validée
    echec(ip);   // limite les inscriptions en rafale (même compteur que les essais de connexion)
    const nom = String(body.nom || '').trim().slice(0, 120);
    if (!EMAIL.test(email)) return json(req, res, 400, { error: 'Adresse e-mail invalide.' });
    if (!nom) return json(req, res, 400, { error: 'Indiquez votre nom.' });
    if (!mdpValide(body.mdp)) return json(req, res, 400, { error: 'Le mot de passe doit faire au moins 10 caractères.' });
    await p.query(`insert into ${SCHEMA}.utilisateurs(email, nom, hash) values ($1, $2, $3) on conflict (email) do nothing`, [email, nom, await hacher(body.mdp)]);
    // le compte apparaît « en attente » dans Administration → Utilisateurs ; même réponse si l'adresse existe déjà : on ne révèle pas qui est inscrit
    return json(req, res, 200, { ok: true });
  }
  if (route === 'auth/oubli') {
    echec(ip);
    // la demande est notée (l'admin la voit dans Utilisateurs) ; si Brevo est configuré, un lien valable 1 h part aussi par e-mail
    const u = EMAIL.test(email) && (await p.query(`update ${SCHEMA}.utilisateurs set demande = now() where email = $1 returning valide`, [email])).rows[0];
    if (u && u.valide && MAIL)   // envoi en arrière-plan : même délai de réponse que l'adresse existe ou non
      lienMdp(p, req, email, 1).then((l) => mailLien(email, l, false, '1 heure')).catch((e) => console.error('oubli :', e.message));
    return json(req, res, 200, { ok: true, mail: MAIL });   // même réponse que l'adresse existe ou non
  }
  if (route === 'auth/reinit') {
    const j = String(body.jeton || '');
    if (!mdpValide(body.mdp)) return json(req, res, 400, { error: 'Le mot de passe doit faire au moins 10 caractères.' });
    const t = JETON.test(j) && (await p.query(`delete from ${SCHEMA}.jetons_mdp where jeton = $1 and expire > now() returning email`, [sha(j)])).rows[0];
    if (!t) { echec(ip); return json(req, res, 400, { error: 'Lien expiré ou déjà utilisé. Refaites « Mot de passe oublié ».' }); }
    await p.query(`update ${SCHEMA}.utilisateurs set hash = $2, demande = null, maj = now() where email = $1`, [t.email, await hacher(body.mdp)]);
    await p.query(`delete from ${SCHEMA}.sessions where email = $1`, [t.email]);   // toutes les sessions ouvertes sont fermées
    return json(req, res, 200, { ok: true, email: t.email });
  }
  return json(req, res, 404, { error: 'Adresse inconnue.' });
}

/** Lien d'abonnement à l'agenda (GET /cal/<jeton>.ics, sans connexion) : planning des 12 dernières semaines importées de
    l'agent rattaché au compte (missions, RP, CP, RHR), calculé avec les règles du site. Jeton inconnu : 404 et essai compté. */
async function agenda(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (trop(ip)) return send(req, res, 429, 'Trop d’essais.', 'text/plain; charset=utf-8');
  const p = await db(); await tablesAuth(p);
  const js = (url.pathname.match(/^\/cal\/s\/([A-Za-z0-9_-]{20,100})\.ics$/) || [])[1];
  if (js) {   // semaine envoyée avec un récap (bouton « Ajouter cette semaine à mon agenda »)
    const r = (await p.query(`select ics from ${SCHEMA}.agendas where jeton = $1 and expire > now()`, [sha(js)])).rows[0];
    if (!r) { echec(ip); return send(req, res, 404, 'Lien expiré ou inconnu.', 'text/plain; charset=utf-8'); }
    return send(req, res, 200, r.ics, 'text/calendar; charset=utf-8', { 'Content-Disposition': 'inline; filename="planning-semaine.ics"' });
  }
  const j = (url.pathname.match(/^\/cal\/([A-Za-z0-9_-]{20,100})\.ics$/) || [])[1];
  const u = j && (await p.query(`select nom, agent, valide from ${SCHEMA}.utilisateurs where cal = $1`, [sha(j)])).rows[0];
  if (!u || !u.valide || !u.agent || !u.agent.pk) { echec(ip); return send(req, res, 404, 'Agenda introuvable.', 'text/plain; charset=utf-8'); }
  const cle = sha(j);
  if (!calCache.has(cle)) {
    const ids = (await p.query(`select week_id from ${SCHEMA}.semaines order by week_id desc limit 12`)).rows.map((x) => x.week_id);
    const d = await p.query(`select week_id, data from ${SCHEMA}.details where week_id = any($1) and agence_slug <> '~source' order by week_id, agence_slug`, [ids]);
    const weeks = new Map();
    for (const x of d.rows) { if (!weeks.has(x.week_id)) weeks.set(x.week_id, { meta: x.data.meta, agents: [] }); weeks.get(x.week_id).agents.push(...(x.data.agents || [])); }
    const c = await p.query(`select valeur from ${SCHEMA}.config where cle = 'regles'`);
    const E = engine();
    calCache.set(cle, String(E.calAgent([...weeks.values()], E.loadRules(c.rows[0]?.valeur || null), u.agent.pk, u.agent.nom || u.nom || '')));
  }
  return send(req, res, 200, calCache.get(cle), 'text/calendar; charset=utf-8', { 'Content-Disposition': 'inline; filename="planning.ics"' });
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
  vm.runInContext(code + ';globalThis.__E={vitrineData,loadRules,cocoCalcul,calAgent};', ctx);
  moteur = ctx.__E;
  return moteur;
}
let vitrineCache = null;       // recalculée après chaque import, suppression ou changement de règles
const cocoCache = new Map();   // vue Coco par semaine (la page du code covoit la redemande toutes les 2 minutes)
const calCache = new Map();    // agenda (.ics) par lien d'abonnement
function invalider() { vitrineCache = null; cocoCache.clear(); calCache.clear(); }
async function vitrine(p) {
  if (vitrineCache) return vitrineCache;
  const d = await p.query(`select week_id, data from ${SCHEMA}.details where agence_slug <> '~source' order by week_id, agence_slug`);
  const c = await p.query(`select valeur from ${SCHEMA}.config where cle = 'regles'`);
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
/** Champs des mentions légales (même liste que MENTIONS dans index.html) et longueur maximale */
const MENTIONS = [['site', 300], ['editeur', 300], ['editeurAdresse', 300], ['contact', 300], ['directeur', 300], ['redacteur', 300],
  ['hebergeur', 300], ['hebergeurAdresse', 300], ['hebergeurDonnees', 300], ['hebergeurDonneesAdresse', 300], ['rgpdContact', 300],
  ['finalite', 2000], ['baseLegale', 2000], ['conservation', 2000], ['autres', 2000]];
const ID = /^\d{4}-S\d{2}$/;
async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\/?/, '');
  if (route === 'ping') return json(req, res, 200, { ok: true, codes: CODES, mail: MAIL });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (trop(ip)) return json(req, res, 429, { error: 'Trop d’essais. Réessayez dans quelques minutes.' });
  if (['auth/login', 'auth/inscription', 'auth/oubli', 'auth/reinit'].includes(route)) return authPublique(req, res, route, ip);
  const A = await acces(req);
  if (!A) {
    if (req.headers['x-acces'] && CODES) echec(ip); await new Promise((ok) => setTimeout(ok, 400));
    return json(req, res, 401, { error: req.headers['x-session'] ? 'Session expirée : reconnectez-vous.' : CODES ? 'Code d’accès non reconnu.' : 'Connexion par code désactivée : connectez-vous avec votre e-mail.' });
  }
  const r = A.role, caps = A.caps;
  if (route === 'session') return json(req, res, 200, { role: r, caps, user: A.user });
  const p = await db();
  if (route === 'auth/logout' && req.method === 'POST') {
    if (A.user) await p.query(`delete from ${SCHEMA}.sessions where jeton = $1`, [sha(req.headers['x-session'])]);
    return json(req, res, 200, { ok: true });
  }
  if (route === 'auth/mdp' && req.method === 'POST') {   // changer son propre mot de passe
    if (!A.user) return json(req, res, 400, { error: 'Réservé aux comptes e-mail.' });
    const body = await readBody(req);
    const u = (await p.query(`select hash from ${SCHEMA}.utilisateurs where email = $1`, [A.user.email])).rows[0];
    if (!u || !(await verifier(String(body.ancien || ''), u.hash))) { echec(ip); return json(req, res, 400, { error: 'Mot de passe actuel incorrect.' }); }
    if (!mdpValide(body.nouveau)) return json(req, res, 400, { error: 'Le nouveau mot de passe doit faire au moins 10 caractères.' });
    await p.query(`update ${SCHEMA}.utilisateurs set hash = $2, maj = now() where email = $1`, [A.user.email, await hacher(body.nouveau)]);
    await p.query(`delete from ${SCHEMA}.sessions where email = $1 and jeton <> $2`, [A.user.email, sha(req.headers['x-session'])]);   // les autres appareils sont déconnectés
    return json(req, res, 200, { ok: true });
  }
  if (route === 'utilisateurs') {   // gestion des comptes : droit « admin » seulement
    if (!caps.admin) return json(req, res, 403, { error: 'Réservé aux administrateurs.' });
    await tablesAuth(p);
    const moi = A.user ? A.user.email : '';
    if (req.method === 'GET') {
      const q = await p.query(`select email, nom, droits, valide, cree, derniere, demande, agent, (cal is not null) as cal from ${SCHEMA}.utilisateurs order by valide, demande is null, lower(nom), email`);
      return json(req, res, 200, { utilisateurs: q.rows, moi, mail: MAIL });
    }
    if (req.method === 'POST') {   // invitation : compte validé avec les droits choisis, mot de passe choisi par la personne via le lien
      const body = await readBody(req), email = emailNorm(body.email), nom = String(body.nom || '').trim().slice(0, 120);
      if (!EMAIL.test(email)) return json(req, res, 400, { error: 'Adresse e-mail invalide.' });
      const ins = await p.query(`insert into ${SCHEMA}.utilisateurs(email, nom, hash, droits, valide) values ($1, $2, 'aucun', $3, true) on conflict (email) do nothing`, [email, nom, droitsPropres(body.droits)]);
      if (!ins.rowCount) return json(req, res, 409, { error: 'Cette adresse a déjà un compte.' });
      const lien = await lienMdp(p, req, email, 72);
      return json(req, res, 200, { ok: true, lien, envoye: await mailLien(email, lien, true, '3 jours') });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req), email = emailNorm(body.email);
      const u = (await p.query(`select email, nom, droits, valide from ${SCHEMA}.utilisateurs where email = $1`, [email])).rows[0];
      if (!u) return json(req, res, 404, { error: 'Compte introuvable.' });
      if (body.action === 'reinit') {   // lien de réinitialisation : envoyé par e-mail si Brevo est configuré, et affiché à l'admin
        const lien = await lienMdp(p, req, email, 24);
        return json(req, res, 200, { ok: true, lien, envoye: await mailLien(email, lien, false, '24 heures') });
      }
      if (body.action === 'agent') {   // agent rattaché au compte (récap de la semaine) ; null = aucun
        const a = body.agent && typeof body.agent.pk === 'string' && body.agent.pk.trim()
          ? { pk: body.agent.pk.trim().slice(0, 200), nom: String(body.agent.nom || '').trim().slice(0, 120) } : null;
        await p.query(`update ${SCHEMA}.utilisateurs set agent = $2, maj = now() where email = $1`, [email, a]);
        calCache.clear();
        return json(req, res, 200, { ok: true });
      }
      if (body.action === 'cal') {   // lien d'abonnement à l'agenda : nouveau jeton (l'ancien lien cesse de marcher), empreinte seule en base
        if (!u.valide) return json(req, res, 400, { error: 'Ce compte n’est pas validé.' });
        const j = jetonNeuf(), b = base(req);
        await p.query(`update ${SCHEMA}.utilisateurs set cal = $2, maj = now() where email = $1`, [email, sha(j)]);
        calCache.clear();
        const lien = b ? `${b}/cal/${j}.ics` : null;
        return json(req, res, 200, { ok: true, lien, envoye: lien ? await mailAgenda(email, lien) : false });
      }
      if (body.action === 'calOff') {
        await p.query(`update ${SCHEMA}.utilisateurs set cal = null, maj = now() where email = $1`, [email]);
        calCache.clear();
        return json(req, res, 200, { ok: true });
      }
      if (body.action === 'recap') {   // récap de la semaine de l'agent rattaché, préparé par la page de l'admin, envoyé à ce compte seulement
        if (!MAIL) return json(req, res, 400, { error: 'Envoi d’e-mail non configuré (BREVO_API_KEY, MAIL_FROM).' });
        if (!u.valide) return json(req, res, 400, { error: 'Ce compte n’est pas validé.' });
        const sujet = String(body.sujet || '').trim().slice(0, 200), ics = String(body.ics || '');
        let html = String(body.html || '');
        if (!sujet || !html || html.length > 300000 || ics.length > 300000) return json(req, res, 400, { error: 'Récap vide ou trop long.' });
        const pj = /^BEGIN:VCALENDAR/.test(ics) ? { nom: String(body.nomIcs || 'planning.ics').replace(/[^\w.-]/g, '_').slice(0, 60), texte: ics } : null;
        // bouton « Ajouter cette semaine à mon agenda » : lien vers le fichier de la semaine envoyée, gardé 90 jours
        let bouton = '';
        if (pj && base(req)) {
          const j = jetonNeuf();
          await p.query(`delete from ${SCHEMA}.agendas where expire < now()`);
          await p.query(`insert into ${SCHEMA}.agendas(jeton, ics, expire) values ($1, $2, now() + interval '90 days')`, [sha(j), ics]);
          bouton = boutonAgenda(`${base(req)}/cal/s/${j}.ics`);
        }
        html = html.replace('%%AGENDA%%', bouton);
        if (!(await mail(email, sujet, html, pj))) return json(req, res, 502, { error: 'L’e-mail n’a pas pu partir (voir les journaux Render).' });
        return json(req, res, 200, { ok: true, envoye: true });
      }
      const droits = body.droits ? droitsPropres(body.droits) : u.droits, valide = body.valide == null ? u.valide : !!body.valide;
      const restaitAdmin = valide && !!droits.admin;
      if (u.valide && u.droits && u.droits.admin && !restaitAdmin && !(await nbAdmins(p, email)))
        return json(req, res, 409, { error: 'Impossible : ce compte est le dernier administrateur.' });
      const nom = body.nom != null ? String(body.nom).trim().slice(0, 120) : u.nom;
      await p.query(`update ${SCHEMA}.utilisateurs set droits = $2, valide = $3, nom = $4, maj = now() where email = $1`, [email, droits, valide, nom]);
      if (!valide) await p.query(`delete from ${SCHEMA}.sessions where email = $1`, [email]);
      return json(req, res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const email = emailNorm(url.searchParams.get('email'));
      const u = (await p.query(`select droits, valide from ${SCHEMA}.utilisateurs where email = $1`, [email])).rows[0];
      if (!u) return json(req, res, 404, { error: 'Compte introuvable.' });
      if (u.valide && u.droits && u.droits.admin && !(await nbAdmins(p, email))) return json(req, res, 409, { error: 'Impossible : ce compte est le dernier administrateur.' });
      await p.query(`delete from ${SCHEMA}.utilisateurs where email = $1`, [email]);   // sessions et liens suivent (cascade)
      return json(req, res, 200, { ok: true });
    }
  }
  if (!DROITS.some((k) => caps[k])) return json(req, res, 403, { error: 'Votre compte n’a encore aucun droit : un administrateur doit vous en accorder.' });
  const voir = caps.lecture, modif = caps.modif;

  if (route === 'etat' && req.method === 'GET') {
    const w = await p.query(`select resume from ${SCHEMA}.semaines order by week_id desc`);
    if (!voir) return json(req, res, 200, { role: r, weeks: w.rows.map((x) => resumePublic(x.resume)), regles: null });
    const c = await p.query(`select cle, valeur from ${SCHEMA}.config where cle in ('regles', 'suivi', 'journal', 'coco')`);
    const cfg = Object.fromEntries(c.rows.map((x) => [x.cle, x.valeur]));
    return json(req, res, 200, { role: r, weeks: w.rows.map((x) => x.resume), regles: cfg.regles || null,
      suivi: cfg.suivi || { alertes: {} }, journal: (cfg.journal || []).slice(-300), coco: cfg.coco || null });
  }
  if (route === 'vitrine' && req.method === 'GET') return json(req, res, 200, await vitrine(p));
  if (route === 'semaine' && req.method === 'GET') {
    if (!voir) return json(req, res, 403, { error: 'Accès limité aux statistiques anonymes.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    const d = await p.query(`select data from ${SCHEMA}.details where week_id = $1 and agence_slug <> '~source' order by agence_slug`, [id]);
    return json(req, res, 200, { docs: d.rows.map((x) => x.data) });
  }
  if (route === 'coco' && req.method === 'GET') {   // vue Coco : missions de la semaine des agents choisis, rien d'autre
    if (!voir && !caps.coco) return json(req, res, 403, { error: 'Ce code ne donne pas accès à la vue Coco.' });
    const c = await p.query(`select valeur from ${SCHEMA}.config where cle = 'coco'`);
    const sel = (c.rows[0]?.valeur?.agents || []).filter((x) => x && x.pk);
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id) || !sel.length) return json(req, res, 200, { agents: sel.map(({ pk, nom, couleur }) => ({ pk, nom, couleur })), semaine: null });
    // la semaine et ses voisines (RHR commencé la semaine précédente), calculées avec les règles du site
    const ids = (await p.query(`select week_id from ${SCHEMA}.semaines order by week_id`)).rows.map((x) => x.week_id), k = ids.indexOf(id);
    if (k < 0) return json(req, res, 200, { agents: sel, semaine: null });
    const voisins = [ids[k - 1], id, ids[k + 1]].filter(Boolean);
    if (cocoCache.has(id)) return json(req, res, 200, { agents: sel, semaine: cocoCache.get(id) });
    const d = await p.query(`select week_id, data from ${SCHEMA}.details where week_id = any($1) and agence_slug <> '~source' order by week_id, agence_slug`, [voisins]);
    const weeks = new Map();
    for (const x of d.rows) { if (!weeks.has(x.week_id)) weeks.set(x.week_id, { meta: x.data.meta, agents: [] }); weeks.get(x.week_id).agents.push(...(x.data.agents || [])); }
    const c2 = await p.query(`select valeur from ${SCHEMA}.config where cle = 'regles'`);
    const E = engine();
    const sem = E.cocoCalcul([...weeks.values()], E.loadRules(c2.rows[0]?.valeur || null), id, sel);
    const semaine = sem ? JSON.parse(JSON.stringify(sem)) : null;
    cocoCache.set(id, semaine);
    return json(req, res, 200, { agents: sel, semaine });
  }
  if (route === 'coco' && req.method === 'PUT') {
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire pour choisir les agents de la vue Coco.' });
    const body = await readBody(req);
    const agents = (Array.isArray(body.agents) ? body.agents : []).slice(0, 60)
      .map((x) => ({ pk: String(x.pk || '').slice(0, 200), nom: String(x.nom || '').slice(0, 120), metier: String(x.metier || '').slice(0, 60), couleur: /^#[0-9a-f]{6}$/i.test(x.couleur || '') ? x.couleur : '#1F77B4' }))
      .filter((x) => x.pk);
    await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('coco', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [JSON.stringify({ agents })]);
    cocoCache.clear();
    return json(req, res, 200, { ok: true });
  }
  if (route === 'planif') {   // planification : brouillon d'une semaine, partagé entre admins, jamais envoyé aux autres codes
    if (!voir) return json(req, res, 403, { error: 'Accès limité aux statistiques anonymes.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    const c = await p.query(`select valeur from ${SCHEMA}.config where cle = 'planif'`);
    const tout = c.rows[0]?.valeur || {};
    if (req.method === 'GET') return json(req, res, 200, { planif: tout[id] || null });
    if (req.method === 'PUT' || req.method === 'DELETE') {
      if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire pour planifier.' });
      if (req.method === 'PUT') { const body = await readBody(req); if (!body || !Array.isArray(body.agents)) return json(req, res, 400, { error: 'Planning incomplet.' });
        tout[id] = { ...body, majLe: new Date().toISOString() }; } else delete tout[id];
      const garder = Object.keys(tout).sort().slice(-30);   // 30 semaines au plus
      const o = Object.fromEntries(garder.map((k) => [k, tout[k]]));
      await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('planif', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [JSON.stringify(o)]);
      return json(req, res, 200, { ok: true });
    }
  }
  if (route === 'source' && req.method === 'GET') {   // fichier conservé avec la semaine (feuille lue + Extract), pour « Relire »
    if (!voir) return json(req, res, 403, { error: 'Accès limité aux statistiques anonymes.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    const d = await p.query(`select data from ${SCHEMA}.details where week_id = $1 and agence_slug = '~source'`, [id]);
    return json(req, res, 200, { source: d.rows[0]?.data?.source || null });
  }
  if (route === 'semaine' && req.method === 'PUT') {
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire.' });
    const { resume, details } = await readBody(req);
    if (!resume || !ID.test(resume.weekId || '') || !Array.isArray(details) || !details.length) return json(req, res, 400, { error: 'Données d’import incomplètes.' });
    if (!resume.importedAt) resume.importedAt = new Date().toISOString();
    const c = await p.connect();
    try {
      await c.query('begin');
      await c.query(`insert into ${SCHEMA}.semaines(week_id, resume) values ($1, $2) on conflict (week_id) do update set resume = excluded.resume, maj = now()`, [resume.weekId, resume]);
      await c.query(`delete from ${SCHEMA}.details where week_id = $1`, [resume.weekId]);
      for (const d of details) {
        const sl = String(d.agenceSlug || '').replace(/[^a-z0-9._~:@+-]/gi, '').slice(0, 120);
        if (!sl) continue;
        await c.query(`insert into ${SCHEMA}.details(week_id, agence_slug, data) values ($1, $2, $3)`, [resume.weekId, sl, d]);
      }
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    invalider();
    return json(req, res, 200, { ok: true, weekId: resume.weekId });
  }
  if (route === 'semaine' && req.method === 'DELETE') {
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire.' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(req, res, 400, { error: 'Semaine non précisée.' });
    await p.query(`delete from ${SCHEMA}.semaines where week_id = $1`, [id]);   // les détails suivent (cascade)
    invalider();
    return json(req, res, 200, { ok: true });
  }
  if (route === 'regles' && req.method === 'PUT') {
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire.' });
    const { _journal, ...body } = await readBody(req);
    const le = new Date().toISOString();
    await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('regles', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [{ ...body, majLe: le }]);
    if (_journal) {   // journal des modifications : qui, quand, quoi, et l'effet sur les chiffres
      const j = await p.query(`select valeur from ${SCHEMA}.config where cle = 'journal'`);
      const list = [...(j.rows[0]?.valeur || []), { ..._journal, le }].slice(-500);
      await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('journal', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [JSON.stringify(list)]);
    }
    invalider();
    return json(req, res, 200, { ok: true });
  }
  if (route === 'mentions' && req.method === 'GET') {   // mentions légales : lisibles par les deux codes (page du visiteur)
    const m = await p.query(`select valeur from ${SCHEMA}.config where cle = 'mentions'`);
    return json(req, res, 200, m.rows[0]?.valeur || {});
  }
  if (route === 'mentions' && req.method === 'PUT') {
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire.' });
    const body = await readBody(req);
    const m = Object.fromEntries(MENTIONS.map(([k, max]) => [k, String(body[k] ?? '').trim().slice(0, max)]));
    m.majLe = new Date().toISOString();
    await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('mentions', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [m]);
    return json(req, res, 200, { ok: true, mentions: m });
  }
  if (route === 'suivi' && req.method === 'PUT') {   // suivi des alertes « À vérifier » : vu, corrigé, note
    if (!modif) return json(req, res, 403, { error: 'Le droit « Modification » est nécessaire.' });
    const body = await readBody(req);
    await p.query(`insert into ${SCHEMA}.config(cle, valeur) values ('suivi', $1) on conflict (cle) do update set valeur = excluded.valeur, maj = now()`, [{ alertes: body.alertes || {}, majLe: new Date().toISOString() }]);
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
let page = null;   // la page ne change qu'au redéploiement : lue, empreinte et version compressée calculées une seule fois
async function lirePage() {
  if (page) return page;
  let buf = await readFile(PAGE);
  // site de test : la page est marquée data-env="dev" (autres couleurs, bandeau) et son titre commence par « [TEST] »
  if (DEV) buf = Buffer.from(buf.toString('utf8').replace('<html lang="fr">', '<html lang="fr" data-env="dev">').replace('<title>Récap Corridor</title>', '<title>[TEST] Récap Corridor</title>'));
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"';
  page = { buf, gz: zlib.gzipSync(buf, { level: 9 }), etag };
  return page;
}
async function statique(req, res, url) {
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(req, res, 404, 'Page introuvable', 'text/plain; charset=utf-8');
  const { buf, gz, etag } = await lirePage();
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  const headers = { ...SEC, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag };
  const zip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (zip) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
  const out = zip ? gz : buf;
  headers['Content-Length'] = out.length;
  res.writeHead(200, headers); res.end(out);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/cal/')) return await agenda(req, res, url);
    if (url.pathname === '/robots.txt') return send(req, res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    if (ICONES[url.pathname]) return await icone(req, res, url.pathname);
    return await statique(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(req, res, e.status || 500, { error: e.status ? e.message : 'Erreur serveur : ' + e.message });
  }
}).listen(PORT, () => {
  console.log('Récap Corridor à l’écoute sur le port', PORT, '· schéma', SCHEMA, DEV ? '· SITE DE TEST' : '');
  lirePage().catch(() => {});
  // au réveil : base connectée, moteur chargé et vitrine préparée tout de suite, pour que le premier visiteur n'attende pas
  connectDb().then(() => { engine(); return vitrine(pool); }).catch((e) => console.error('Base indisponible au démarrage :', e.message));
});
