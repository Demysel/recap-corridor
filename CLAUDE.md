# Récap Corridor — consignes pour Claude

Réponds toujours en français. Règle de l'utilisateur, à respecter strictement :
**« Ne déduis rien : si un doute existe sur la lecture des informations ou d'un document, pose la question. »**
Produis en continu sans demander de validation ; ne t'interromps que pour poser une vraie question.

## Ce que fait l'outil

Extraction hebdomadaire des fichiers ARP « Récap National Corridor » (.xlsx, feuille « Récap ») :
repos hors résidence (RHR), journées blanches, heures planifiées, heures sup, heures de nuit et
du dimanche, paniers repas, MHIS / DISPO / ATCMD, trajets seuls — par agent, agence et métier.
Agences suivies en priorité : **Hendaye** et **Bordeaux-St-Jean**. Métiers : AFR et CONDUCTEUR.

## Structure (à conserver)

L'application reprend la structure du zip d'origine : **une seule page** qui contient tout.

- `recap-corridor/public/index.html` — toute l'application : lecture des .xlsx dans le navigateur,
  calculs, onglets (Synthèse, Agents, RHR, Journées blanches, Graphiques, Guide de lecture, Exports,
  Import, Réglages), graphiques, exports Excel/CSV, rapport autonome. Le fichier Excel n'est jamais envoyé au serveur.
- `recap-corridor/server.js` — serveur Node (dépendance unique : `pg`). Sert `index.html` et l'API,
  aux mêmes adresses que l'ancienne fonction Netlify : `GET /api/session`, `GET /api/etat`,
  `GET|PUT|DELETE /api/semaine`, `PUT /api/regles`, `GET /api/ping`.
- `recap-corridor/db/schema.sql` — schéma Postgres.
- `recap-corridor/test/moteur.test.mjs` — tests du moteur de calcul, lus directement dans `index.html`
  (`cd recap-corridor && npm test`, sans dépendance, données fictives). À lancer avant chaque envoi.

Quand l'utilisateur demande une modification : **garder l'affichage et les méthodes de calcul
existantes**, n'appliquer que ce qui est demandé. Ne pas réorganiser ni « moderniser ».

## Règles de calcul en vigueur (modifiables dans l'onglet Réglages, sans réimport)

- RHR : arrêt entre deux missions quand la première ne finit pas à la résidence de l'agence, et
  d'au moins 4 h (réglable) — un arrêt de 30 min n'est pas un RHR ; deux missions d'une même case
  séparées d'un long arrêt hors résidence en donnent un. De jour comme de nuit. AFR exclus.
  Moyennes RHR calculées uniquement sur les agents qui ont eu au moins un RHR.
- Lieux comparés sans majuscules, accents ni ponctuation (fautes de frappe des fichiers).
- Corrections manuelles (admin, depuis la fiche agent ou l'onglet Journées blanches) : coupure
  comptée / écartée, deux missions liées en un seul RHR, journée blanche oui / non, lieu appris comme
  résidence d'une agence. Mémorisées dans `recap.config` (clé `regles`, champs `corrections`,
  `lieuxResidence`) et rejouées à chaque affichage, même après réimport.
- Journée blanche : case vide encadrée par deux services, hors lendemain de service de nuit, et
  pas si l'agent est hors résidence ce jour-là (pendant un RHR). La veille d'une reprise juste après
  minuit compte si l'agent est à sa résidence.
  Chaque case vide non comptée affiche sa raison (avant le premier / après le dernier service, fin
  de service de nuit à hh:mm).
- Formats de fichier : récent (ligne 1 dates, ligne 2 Matricule… Lundi…) et ancien (ligne 1
  Lundi…Dimanche, ligne 2 Matricule, Prenom, Nom, Region, Residence, Commentaires, dates ; feuille
  « Corridor … » à côté d'une feuille « Extract » ignorée). Métiers : CDR et « CDR + AFR » =
  CONDUCTEUR, Coordo = COORDO AFR. Agences « Agence X » rattachées automatiquement au nom récent
  qui commence pareil (modifiable dans Réglages). Codes « CP/CP » lus comme CP.
- Heures planifiées : amplitude moins les pauses « P: » ; une ATCMD compte 5 h.
  Heures sup : au-delà de 35 h par agent et par semaine.
- Heures de nuit, hors pauses : AFR 22h–7h, conducteurs 22h–5h (l'utilisateur a aussi évoqué
  22h–6h : réglable).
- Heures du dimanche : temps travaillé hors pauses le dimanche.
- MHIS, DISPO, ATCMD : intitulé qui contient ces lettres (non exclusif). DISPO et ATCMD comptés à part.
- Trajet seul : intitulé réduit à VOY ou VS (hypothèse à confirmer par l'utilisateur).
- Paniers : 1 h travaillée entre 11h30 et 13h30 ; 1 h entre 18h30 et 20h30 ; 3 h entre 22h et 5h ;
  ou RHR qui englobe la plage midi/soir. Ratio = paniers / jours de service.
- Agents en double : une personne (matricule, sinon nom + prénom) n'apparaît jamais deux fois.
  Lignes en double d'un fichier fusionnées jour par jour (service > code > case vide). Missions
  datées hors de leur colonne (ligne d'une autre semaine recopiée) : non comptées, signalées.

## Hébergement

- **Render**, service `recap-corridor` (gratuit, Francfort), déployé automatiquement à chaque
  commit sur `main`. Build : `cd recap-corridor && npm install --omit=dev`.
  Démarrage : `cd recap-corridor && npm start`.
- **Supabase**, projet `recap-corridor`, schéma `recap` (tables `semaines`, `details`, `config`),
  accessible uniquement par le rôle `recap_app`.
- Codes d'accès et chaîne de connexion : variables d'environnement Render (`CODE_ADMIN`,
  `CODE_LECTURE`, `DATABASE_URL`). **Ne jamais les écrire dans le dépôt.**
- Le dépôt ne doit contenir **aucune donnée nominative** (fichiers Excel, sauvegardes JSON).

## Mise en ligne d'une modification

Pousser sur `main` (ou ouvrir une pull request vers `main` et indiquer à l'utilisateur de la
fusionner) : Render redéploie seul en 2 à 3 minutes.
