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
  calculs, onglets (Synthèse, Agents, RHR, Journées blanches, Graphiques, Statistiques, Comparer, À vérifier, Vitrine, Guide de lecture, Exports,
  Import, Réglages), graphiques, exports Excel/CSV, rapport autonome. Le fichier Excel n'est jamais envoyé au serveur.
- `recap-corridor/server.js` — serveur Node (dépendance unique : `pg`). Sert `index.html` et l'API,
  aux mêmes adresses que l'ancienne fonction Netlify : `GET /api/session`, `GET /api/etat`,
  `GET|PUT|DELETE /api/semaine`, `PUT /api/regles` (avec `_journal` : ligne ajoutée au journal, clé `journal`),
  `PUT /api/suivi` (suivi des alertes « À vérifier », clé `suivi`), `GET|PUT /api/mentions` (mentions légales, clé `mentions` ;
  lecture pour les deux codes, écriture admin, champs limités à la liste `MENTIONS`), `GET /api/ping`, `GET /api/vitrine`.
- **Code visiteur (CODE_LECTURE) = vitrine RGPD** : le serveur ne lui envoie jamais de données
  nominatives (`/api/semaine` refusé, résumés sans nom de fichier ni anomalies, règles non envoyées).
  `/api/vitrine` renvoie des agrégats calculés sur le serveur par le moteur de la page
  (`vitrineData`) : chaque cellule semaine × agence × métier réunit au moins 5 agents ; les petits
  groupes sont fusionnés (« Autres métiers », « Tous métiers », « Autres agences ») ou écartés.
  La carte des flux de la vitrine ne publie un trajet ou un lieu de RHR que s'il concerne au moins 5 agents différents.
  Ne jamais ajouter de donnée individuelle à cette réponse.
  Vitrine : « Agences à comparer » — toucher une agence (depuis « Toutes ») ne garde qu'elle, les suivantes s'ajoutent ;
  avec une sélection, le tableau « Comparer : A · B » remonte juste sous les filtres et tous les chiffres portent dessus
  (agrégats déjà publiables, aucune donnée individuelle ajoutée).
  Agences et métiers de la vitrine sont des menus déroulants sur tous les écrans (bouton qui ouvre la liste ; sur
  ordinateur et tablette elle flotte sous le bouton, sur téléphone elle s'ouvre dans la page ; se ferme en touchant ailleurs ou Échap). Le code visiteur
  ne demande jamais le détail des semaines (`ensureLoaded` s'arrête pour un non-admin).
- Mentions légales (demandé par l'utilisateur) : onglet « Mentions légales » visible **uniquement dans la vue visiteur**
  (menu + lien en bas de chaque page visiteur). Éditeur, contact, directeur de la publication, rédacteur, hébergeurs, contact
  données personnelles, finalité, base légale, durée de conservation, autres mentions : saisis dans Réglages → « Mentions
  légales » (aperçu de la page visiteur), jamais écrits dans le code ; un champ vide n'est pas affiché. Textes fixes : vitrine
  anonyme (groupes d'au moins 5 agents), pas de cookie, stockage local du code et des préférences, polices Google Fonts.
- `recap-corridor/public/icons/` — icône de l'application (carré rouge, rail blanc, deux stations, comme la marque) :
  favicon SVG et PNG, `apple-touch-icon.png` (écran d'accueil iPhone), icônes 192/512 et `manifest.webmanifest`
  (installation en app). Servies par `server.js` (liste fermée `ICONES`, plus `/favicon.ico` et `/apple-touch-icon.png`).
- `recap-corridor/db/schema.sql` — schéma Postgres.
- `recap-corridor/test/moteur.test.mjs` — tests du moteur de calcul, lus directement dans `index.html`
  (`cd recap-corridor && npm test`, sans dépendance, données fictives). À lancer avant chaque envoi.

Quand l'utilisateur demande une modification : **garder l'affichage et les méthodes de calcul
existantes**, n'appliquer que ce qui est demandé. Ne pas réorganiser ni « moderniser ».

## Règles de calcul en vigueur (modifiables dans l'onglet Réglages, sans réimport)

- RHR = repos journalier hors résidence (accord d'entreprise ECR 2018, art. 18 ; PDF fourni par
  l'utilisateur, non versé au dépôt) : arrêt entre deux missions quand la première ne finit pas à la
  résidence, d'au moins 8 h (primes dès 8 h en annexe 1 ; minimum légal 9 h ; réglable), de jour comme
  de nuit, même dans une seule case. Un arrêt qui contient un jour de code (RP, RF, JF, congé…) n'est
  pas un RHR : le repos périodique = 24 h + repos journalier à résidence (art. 19). Arrêt de plus de
  44 h signalé (absence maximale du domicile, art. 18). Un arrêt de plusieurs nuits sans service = 1 RHR.
  Tranches de l'annexe 1 comptées : 8–12 h, 12–24 h, 24 h et plus ; RHR successifs (sans retour à
  résidence entre deux). Rattachement temporaire à une autre résidence pour une semaine (art. 8),
  saisi dans la fiche agent. AFR exclus. Moyennes RHR calculées uniquement sur les agents qui en ont eu.
  RHR commencé en fin de semaine : affiché « suite S+1 » (et « à finir en S+1 ») tant que la semaine suivante n'est pas
  importée ; clos avec la première mission de S+1 ; supprimé si S+1 est importée sans mission mais avec un code.
  Statut « en ce moment » (heure de l'appareil, comme les horaires du fichier) : « en service » pendant une mission,
  « en RHR · lieu » pendant un RHR — pastille dans Agents, RHR et la fiche ; note « En ce moment » dans la Synthèse.
- Agences hors production (`agencesExclues`, défaut ['Paris'], demandé par l'utilisateur) : l'agence et tous ses agents
  sont retirés dès la lecture (applyRules), donc de tous les chiffres, listes, exports et de la vitrine, pour les anciens
  comme les futurs fichiers ; nom comparé sans majuscules ni accents, « Agence Paris » = « Paris ». Réglages → « Agences hors
  production » (cocher / décocher, noté au journal). Un agent n'est retiré que les semaines où il est dans l'agence exclue.
- Lieux comparés sans majuscules, accents ni ponctuation (fautes de frappe des fichiers).
- Corrections manuelles (admin, depuis la fiche agent ou l'onglet Journées blanches) : coupure
  comptée / écartée, deux missions liées en un seul RHR, journée blanche oui / non, lieu appris comme
  résidence d'une agence, agent exclu des chiffres (toutes les semaines ou une seule, avec motif ;
  calculé mais retiré de tous les chiffres et de la vitrine, réintégrable), résidence propre à un agent et
  métier corrigé d'un agent, pour une période exclusive choisie dans la fiche : une semaine (clé …|w:2026-S38),
  un mois (…|m:2026-09) ou une année (…|y:2026), la plus précise l'emportant (`correctionPeriode` ; semaine à cheval :
  mois et année de son lundi) ; les anciennes
  résidences saisies « à partir de » (…|2026-S38) restent valables. Résidence propre prioritaire sur celle de
  l'agence, le rattachement temporaire d'une semaine restant prioritaire. Mémorisées dans `recap.config` (clé `regles`, champs
  `corrections` : rhr, jb, liens, residenceSemaine, residenceAgent, metierAgent, exclus, horaires ; `lieuxResidence`) et rejouées
  à chaque affichage, même après réimport. `horaires` : horaire saisi pour une mission sans horaire lisible
  (clé personne|date|intitulé ; les missions sans horaire sont gardées à part dans la case, `sansHoraire`).
- « À vérifier » propose de réparer selon le type d'alerte (en réutilisant ces corrections) : saisir l'horaire
  d'une mission, compter ou écarter un RHR de plus de 44 h, rattacher l'agent à son lieu habituel pour la semaine
  ou changer sa résidence à partir de la semaine, reconnaître un lieu comme résidence de l'agence, ouvrir les
  Réglages ou l'Import. Une alerte réparée disparaît d'elle-même.
  « Aperçu » (toute alerte liée à un agent) : panneau avec le texte brut de la case du fichier (`brut`, gardé à la lecture ;
  semaines importées avant cette version : réimporter pour le voir) et le planning de la semaine de l'agent, pour
  distinguer une erreur de lecture d'un vrai oubli. Mission sans horaire : formulaire début / fin (→ `horaires`) ou
  « Pas une mission : classer ». Missions qui se chevauchent : « Ignorer « X » » (`corrections.ignorees`, clé
  personne|début|intitulé, mission retirée des calculs). Mission hors colonne : « Compter quand même »
  (`corrections.garderHC`, clé personne|début). « Tout marquer vu » (liste affichée) et « Vider l'historique… »
  (historique du suivi seulement ; le journal des règles n'est jamais effacé). Tout se défait dans Réglages → corrections.
- Journée blanche : case vide encadrée par deux services, y compris le lendemain d'un service de nuit (validé par
  l'utilisateur, quelle que soit l'heure de fin ; ancienne exclusion réactivable dans Réglages, règles v4), et
  pas si l'agent est hors résidence ce jour-là (pendant un RHR). La veille d'une reprise juste après
  minuit compte si l'agent est à sa résidence.
  En début ou fin de semaine, la case est encadrée par la semaine voisine si elle est importée
  (validé par l'utilisateur). Un repos entre la case vide et le service ne l'empêche pas.
  Onglet Journées blanches : une seule liste « Journées blanches » (comptées et cases vides non comptées, avec
  leur statut) + « Corrigées à la main » (demandé par l'utilisateur).
  Chaque case vide non comptée affiche sa raison (avant le premier / après le dernier service, fin
  de service de nuit à hh:mm).
- Classement des codes (validé) : Repos = RP, RF, JF, RCL, RCC ; Congés = CP, CPAT, CFAM, CSS/CPAR ;
  Absences = tout le reste (MAL, AT, CPRCL…).
  Onglet Agents (groupe Repos & absences) : détail RP, RF, JF, RCL, RCC, puis CP sur la période et « CP <année> »
  (CP de toute l'année civile du dernier jour de la période sélectionnée, compté au jour près ; année civile validée par l'utilisateur,
  pas la période de référence mai–mai). Fiche agent : tuile « Codes » (acronyme + nombre).
  Tableau des agents : une seule colonne « Journées blanches » (le nombre de journées blanches, rien d'autre) ; la colonne
  « Cases vides » est supprimée (demandé par l'utilisateur). Tuile « Codes » de la fiche : chaque code s'ouvre (survol ou
  clic/toucher) sur la liste des jours décomptés avec le code écrit dans le fichier (utile pour « AUTRE »).
- Codes (précisés par l'utilisateur) : RF repos férié, JF jour férié, RCL repos compensatoire légal,
  RCC repos compensateur conventionnel, CFAM congé familial, CPRCL non défini, AT accident du travail,
  CPAR et CSS congés sans solde ; SUPP (dans un intitulé de mission) = supplémentaire.
- Formats de fichier : récent (ligne 1 dates, ligne 2 Matricule… Lundi…) et ancien (ligne 1
  Lundi…Dimanche, ligne 2 Matricule, Prenom, Nom, Region, Residence, Commentaires, dates ; feuille
  « Corridor … » à côté d'une feuille « Extract » ignorée). Métiers : CDR et « CDR + AFR » =
  CONDUCTEUR, Coordo = COORDO AFR. Agences « Agence X » rattachées automatiquement au nom récent
  qui commence pareil (modifiable dans Réglages). Codes « CP/CP » lus comme CP ; ponctuation finale ignorée (« JF, » = JF).
  La famille d'un code est relue sur le code écrit à chaque affichage (applyRules) : les semaines importées avec un
  ancien classement (JF, RF, AT, CSS… rangés dans « AUTRE ») sont reclassées sans réimport.
  RP : une case RP = 1 jour, mais un numéro « RP-n » du fichier n'est lu qu'une fois par agent et par année civile
  de la date (demandé par l'utilisateur ; `reconcileRP`, rejoué à chaque affichage) : s'il réapparaît (même semaine ou
  autre semaine), le jour est marqué `rpDouble`, non compté, visible dans la tuile « Codes » de la fiche (« déjà lu le… »),
  alerte « Numéro de RP en double » (niveau info) dans « À vérifier », et signalé à l'import (`rpDejaLus`, comparé aux
  semaines enregistrées de la même année). RP sans numéro : chaque case compte.
- TTE (temps de travail effectif, anciennement « heures planifiées », renommé à la demande) : amplitude
  moins les pauses « P: » ; une ATCMD compte 5 h de TTE, mais son amplitude reste l'horaire réel inscrit
  dans la case (précisé par l'utilisateur) ; ses paniers se lisent aussi sur cet horaire réel
  (ATCMD 10h–20h = panier midi + panier soir) ; ses heures de nuit et du dimanche sont ramenées aux 5 h, au prorata
  de l'horaire réel (ATCMD dim. 20h–lun. 6h : 10 h d'amplitude, 5 h de TTE, 3h30 de nuit, 2 h de dimanche ; validé).
  Mission (hors ATCMD) de moins de 5 h d'amplitude : comptée 5 h d'amplitude et 5 h de TTE, mission par mission
  (validé par l'utilisateur : deux missions de 4 h = 10 h ; réglable, 0 = désactivé). Nuit, dimanche et paniers restent lus sur l'horaire réel. Heures sup : TTE au-delà de 35 h par agent et par semaine.
  Calcul blindé : durées recalculées en minutes entières depuis les horaires (`missionMinutes`), pauses = réunion des
  pauses ramenées dans la mission (jamais déduites deux fois), totaux gardés en minutes exactes (`rM`, aucune dérive
  d'arrondi). Ligne de pause vide « P: - » = aucune pause, sans alerte (`RE_PV`). Signalés : pause illisible, pause hors mission, mission de 24 h ou plus, missions qui se chevauchent.
  Test aléatoire de 400 semaines contre un calcul de référence indépendant.
- Résidences : une résidence déduite automatiquement reste automatique à l'enregistrement des Réglages
  (elle peut s'écrire BX une semaine et BORDEAUX une autre) ; seule une valeur modifiée à la main devient manuelle.
  Alerte « À vérifier » si une résidence manuelle n'apparaît dans aucune mission d'une semaine.
- Heures de nuit, hors pauses : AFR 22h–7h, conducteurs 22h–5h (l'utilisateur a aussi évoqué
  22h–6h : réglable).
- Heures du dimanche : temps travaillé hors pauses le dimanche.
- MHIS, DISPO, ATCMD : intitulé qui contient ces lettres (non exclusif). DISPO et ATCMD comptés à part.
- Trajet seul : l'intitulé contient VOY ou VS comme mot à part (VOY-541-BX, 541-VOY, VS 12), jamais collé à un « + »
  (CSE+VOY, VOY+PREPA, VS+MHIS : pas un trajet seul) — précisé par l'utilisateur (`isTrajetSeul`).
- Paniers : 1 h en service entre 11h30 et 13h30 ; 1 h entre 18h30 et 20h30 ; 3 h entre 22h et 5h, lus sur
  l'horaire de la mission, pauses comprises (12:30–19:30 avec pause vers 18h45 = midi + soir ; précisé par l'utilisateur) ;
  ou RHR qui touche la plage (validé : dès que le RHR chevauche la plage, même brièvement) — un panier
  par plage touchée, donc midi ET soir si le RHR touche les deux. Un panier au plus par plage et par
  jour. Ratio = paniers / jours de service.
- Agents en double : une personne (matricule, sinon nom + prénom) n'apparaît jamais deux fois.
  Lignes en double d'un fichier fusionnées jour par jour (service > code > case vide). Missions
  datées hors de leur colonne (ligne d'une autre semaine recopiée) : non comptées, signalées.
- Nettoyage à l'import (`nettoyerFeuille`, demandé par l'utilisateur après la S35 où des lignes d'anciennes semaines
  avaient été ajoutées) : avant lecture, sont retirées (1) toute ligne dont toutes les cases datées portent un autre jour
  que celui de leur colonne (au moins 2 cases, ou la personne a une autre ligne) et (2) toute ligne en double d'une
  personne qui n'a que des codes ou des cases vides, la première ligne (plus haut dans le fichier) étant gardée. Liste des
  lignes retirées affichée sous le fichier dans Import (« Fichier nettoyé »). Les autres doublons restent fusionnés.

## Périodes

Sélecteur « Période » en haut (et dans la Vitrine, et pour les périodes A et B de l’onglet Comparer, qui gardent aussi le choix « du… au… ») : échantillons glissants comptés depuis la dernière
semaine enregistrée (2 et 4 dernières semaines, dernier mois, 3, 6 et 12 derniers mois, toujours),
années, mois, semaines. **Mois et années au jour près** (demandé par l'utilisateur : 2025 s'arrête au 31/12, 2026
commence au 01/01) : une semaine à cheval est coupée (`sliceAgent`, ventilation `parJour` de computeAgent ; `periodRange`,
`rowsOfPeriod`, `moisParts`) — missions, heures, nuit, dimanche, codes, journées blanches au jour de la case (une
mission ou un RHR à cheval sur minuit compte au jour où il commence, paniers du RHR avec lui) ; **heures sup comptées
à la semaine**, entières dans la partie qui contient le dimanche (choisi par l'utilisateur). **Une semaine va du lundi
00:00 au dimanche 23:59 ; le jeudi ne sert qu'à l'envoi du planning et n'intervient dans aucun calcul** (précisé par
l'utilisateur). Corrections de métier / résidence saisies pour un mois ou une année : une semaine à cheval prend celle
du mois et de l'année de son lundi (choisi par l'utilisateur). S'applique au filtre principal, à la fiche, à Comparer,
au « CP <année> », aux regroupements mois / trimestre / année des Statistiques et à la vitrine (cellules en plus par
mois pour une semaine à cheval, champ `p`, mêmes groupes ≥ 5 agents ; la carte des flux reste par semaine entière).
Les échantillons glissants (2, 4 semaines, n mois) restent en semaines entières.
Sélecteur « Agent » du filtre principal : choix multiple (liste avec recherche, puces retirables, « Effacer ») ;
toutes les vues se limitent aux agents choisis ; Comparer → « Agents » (plus d'agents A / B) : les agents choisis
s'affichent côte à côte (valeur la plus haute en ambre, la plus basse en rose), sur une période au choix avec les mêmes
options que le filtre principal ; pour une seule semaine, le planning de chaque agent suit. Colonne « Heures HR » retirée du détail par agent (demandé).
Fiche agent : elle suit la période du filtre principal ; un sélecteur « Période de la fiche » (mêmes choix) la
remplace tant que la fiche est ouverte ; à la fermeture, le filtre principal reprend la main (demandé par l'utilisateur).

## Interface

Couleurs DB Cargo : rouge (#EC0016) sur blanc en mode clair, rouge sur noir en mode sombre, sans dégradé ;
ambre pour ce qui demande attention. Menu latéral groupé (Pilotage, Détail, Analyse, Diffusion, Administration)
avec icônes, réductible en icônes seules (mémorisé), en tiroir sous une barre fixe sur téléphone. Synthèse :
quatre indicateurs principaux puis un bandeau compact pour les autres.

## Hébergement

- **Render**, service `recap-corridor` (gratuit, Francfort), déployé automatiquement à chaque
  commit sur `main`. Build : `cd recap-corridor && npm install --omit=dev`.
  Démarrage : `cd recap-corridor && npm start`.
- **Supabase**, projet `recap-corridor`, schéma `recap` (tables `semaines`, `details`, `config`),
  accessible uniquement par le rôle `recap_app`.
- Codes d'accès et chaîne de connexion : variables d'environnement Render (`CODE_ADMIN`,
  `CODE_LECTURE`, `DATABASE_URL`). **Ne jamais les écrire dans le dépôt.**
- Le dépôt ne doit contenir **aucune donnée nominative** (fichiers Excel, sauvegardes JSON).

## Site de test (demandé par l'utilisateur)

- Service Render `recap-corridor-dev`, branche Git **`dev`** (déployé à chaque commit sur `dev`) ; le site principal
  (`recap-corridor`, branche `main`, schéma `recap`) n'est jamais touché par le site de test.
- Même base Supabase, **schéma distinct `recap_dev`** (copie de `recap` au départ, mêmes tables), propriété d'un rôle
  dédié **`recap_dev_app`** qui n'a aucun droit sur `recap` (le site de test ne peut ni lire ni modifier le principal) :
  importer ou supprimer des semaines sur le site de test n'a aucun effet sur le principal.
- Variables Render du service de test : `APP_ENV=dev`, `DB_SCHEMA=recap_dev`, `DATABASE_URL` (rôle `recap_dev_app`),
  `CODE_ADMIN`, `CODE_LECTURE` — dans Render uniquement, jamais dans le dépôt.
- `APP_ENV=dev` : le serveur marque la page `data-env="dev"` → bleu électrique (#1F4BFF) au lieu du rouge, liseré jaune
  en haut, pastille jaune « SITE DE TEST » en bas, titre « [TEST] Récap Corridor ». Sans ces variables : schéma `recap`,
  couleurs normales (le code de `dev` peut donc être fusionné dans `main` sans effet sur le principal).
- Travail courant : développer et essayer sur `dev`, puis fusionner `dev` dans `main` pour mettre en production.

## Mise en ligne d'une modification

Pousser sur `main` (ou ouvrir une pull request vers `main` et indiquer à l'utilisateur de la
fusionner) : Render redéploie seul en 2 à 3 minutes.
