# Récap Corridor — consignes pour Claude

Réponds toujours en français. Règle de l'utilisateur, à respecter strictement :
**« Ne déduis rien : si un doute existe sur la lecture des informations ou d'un document, pose la question. »**
Produis en continu sans demander de validation ; ne t'interromps que pour poser une vraie question.

## Ce que fait l'outil

Extraction hebdomadaire des fichiers ARP « Récap National Corridor » (.xlsx, feuille « Récap ») :
repos hors résidence (RHR), journées blanches, heures planifiées, heures sup, heures de nuit et
du dimanche, paniers repas, MHIS / DISPO / ATCMD, trajets seuls — par agent, agence et métier.
Agences suivies en priorité : **Hendaye** et **Bordeaux-St-Jean** ; filtre d'agence par défaut : **Hendaye seule** (demandé par l'utilisateur ; l'ancien défaut enregistré Hendaye + Bordeaux est remplacé une fois). Métiers : AFR et CONDUCTEUR.

## Structure (à conserver)

L'application reprend la structure du zip d'origine : **une seule page** qui contient tout.

- `recap-corridor/public/index.html` — toute l'application : lecture des .xlsx dans le navigateur,
  calculs, onglets (Synthèse, Agents, RHR, Journées blanches, Graphiques, Statistiques, Comparer, À vérifier, Vitrine, Guide de lecture, Exports,
  Import, Réglages), graphiques, exports Excel/CSV, rapport autonome. Le fichier Excel n'est jamais envoyé au serveur.
- `recap-corridor/server.js` — serveur Node (dépendance unique : `pg`). Sert `index.html` et l'API,
  aux mêmes adresses que l'ancienne fonction Netlify : `GET /api/session`, `GET /api/etat`,
  `GET|PUT|DELETE /api/semaine`, `PUT /api/regles` (avec `_journal` : ligne ajoutée au journal, clé `journal`),
  `PUT /api/suivi` (suivi des alertes « À vérifier », clé `suivi`), `GET|PUT /api/coco` (vue Coco, clé `coco`), `GET /api/source` (admin : fichier conservé d'une semaine), `GET|PUT /api/mentions` (mentions légales, clé `mentions` ;
  lecture pour les deux codes, écriture admin, champs limités à la liste `MENTIONS`), `GET /api/ping`, `GET /api/vitrine`, `/api/auth/…` et `/api/utilisateurs` (comptes e-mail, voir plus bas).
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
- **Vue Coco (copain covoit)**, demandée par l'utilisateur : troisième code d'accès `CODE_COVOIT` (variable Render, rôle
  `covoit`, valeur « covoit » sur les deux sites) qui ne voit que l'onglet « Coco ». Semaine au choix (par défaut celle
  d'aujourd'hui, ‹ › pour naviguer) ; chaque jour : graduation heure par heure (00 à 23), une ligne par agent choisi avec
  ses missions (barres grises sur 0–24 h, pauses hachurées dans la barre ; détail — trajet, horaire, amplitude, pauses — en infobulle comme la fiche agent) et ses
  RHR (cadre pointillé gris, lieu en infobulle), mission ou RHR à cheval sur minuit affiché sur chaque jour touché (« … »).
  Pastille « en service » (heure de l'appareil) et trait « maintenant » sur le jour en cours. **Covoiturage** : deux
  missions d'agents différents dont la prise ET la fin de service sont à 30 min près prennent une même couleur vive
  par groupe (`COCO_PAIRES`, `cocoGroupes` : missions reliées entre elles), avec cadre épais lumineux de cette couleur et ligne
  teintée, marquées ⇄ (avec qui, en infobulle ;
  `cocoCovoit`, liste `paires`) et rappelées en bandeau vert sous le titre du jour (« ⇄ A + B · 16:30–01:00 », demandé : liseré trop peu visible). **Couleurs** (demandé par l'utilisateur) : toutes les missions en gris neutre, seules les
  missions de covoiturage possible en couleur (les couleurs par agent `cocoCouleurs` restent mémorisées mais ne sont plus affichées). Rien d'autre n'est montré (ni codes, ni heures sup, ni paniers). Agents choisis par l'admin dans l'onglet Coco
  (recherche, ajout, retrait), mémorisés dans `recap.config` clé `coco` ({agents:[{pk,nom,metier,couleur}]}). Le serveur
  calcule la semaine avec les règles du site (`cocoCalcul` : applyRules + reconcile sur la semaine et ses voisines) et
  n'envoie que ces missions et RHR ; `/api/semaine`, `/api/source`, les règles restent refusés au code covoit.
- `recap-corridor/public/icons/` — icône de l'application (carré rouge, rail blanc, deux stations, comme la marque) :
  favicon SVG et PNG, `apple-touch-icon.png` (écran d'accueil iPhone), icônes 192/512 et `manifest.webmanifest`
  (installation en app). Servies par `server.js` (liste fermée `ICONES`, plus `/favicon.ico` et `/apple-touch-icon.png`).
- `recap-corridor/db/schema.sql` — schéma Postgres.
- `recap-corridor/test/moteur.test.mjs` — tests du moteur de calcul, lus directement dans `index.html`
  (`cd recap-corridor && npm test`, sans dépendance, données fictives). À lancer avant chaque envoi.

Quand l'utilisateur demande une modification : **garder l'affichage et les méthodes de calcul
existantes**, n'appliquer que ce qui est demandé. Ne pas réorganiser ni « moderniser ».

## Comptes e-mail et droits (demandé par l'utilisateur)

- Connexion par **e-mail + mot de passe** (écran par défaut). **Codes d'accès retirés du site principal** (demandé par
  l'utilisateur) : le serveur les refuse (`CODES` = site de test ou variable Render `CODES_ACCES=oui`, secours), `/api/ping`
  renvoie `codes`, la page masque l'onglet « Code d'accès » (`S.codesOff`) et oublie un code mémorisé ; sur le site de test
  les codes restent valables en parallèle. Choix de l'utilisateur : 5 droits séparés, inscription libre + validation.
  **E-mails par Brevo** (réinstallé à la demande de l'utilisateur) : variables Render `BREVO_API_KEY` et `MAIL_FROM` (expéditeur
  validé dans Brevo), sur les deux services, **jamais dans le dépôt** ; `mail()` / `mailLien()` (API HTTP Brevo) ; `MAIL` exposé
  dans `/api/ping`, `/api/auth/oubli` et `GET /api/utilisateurs` (`mail`) pour adapter les textes. Sans ces variables ou si
  l'envoi échoue : aucun e-mail, l'admin transmet lui-même les liens (SMS, WhatsApp…).
- **Droits** (`DROITS`, `capsDe`) : `vitrine` (statistiques anonymes), `coco` (vue covoiturage), `lecture` (consultation
  complète nominative, sans rien modifier), `modif` (import, réglages, corrections, planification, choix Coco ; comprend
  lecture), `admin` (gestion des comptes ; comprend tout). CODE_ADMIN = tous ; CODE_LECTURE = vitrine ; CODE_COVOIT = coco.
  Rôle d'affichage (`roleDe`) : lecture ⇒ page complète (`admin`, écriture seulement si `peut('modif')`, `admin()` =
  rôle admin + modif) ; vitrine + coco ⇒ `mixte` (Vitrine, Coco, Guide, Mentions) ; sinon comme les codes ; aucun droit ⇒
  `aucun` (message d'attente). Les droits sont relus à chaque appel : un retrait prend effet tout de suite.
- Serveur : tables `utilisateurs`, `sessions`, `jetons_mdp` (créées par `tablesAuth` ; `db/schema.sql`) ; mot de passe =
  empreinte scrypt (`scrypt$sel$clé`) ; jeton de session 30 jours (en-tête `x-session`, empreinte SHA-256 en base) ;
  routes publiques `POST /api/auth/login|inscription|oubli|reinit` (réponses identiques que l'adresse existe ou non ;
  compteur d'essais `echec`) ; `POST /api/auth/logout|mdp` ; `GET|POST|PUT|DELETE /api/utilisateurs` (droit admin :
  liste, invitation avec lien 3 jours, droits / validation / suspension, lien de mot de passe 24 h, suppression ; **le
  dernier administrateur ne peut être ni retiré ni supprimé**). « Mot de passe oublié » note la demande (colonne
  `demande`) et, si Brevo est configuré, envoie en arrière-plan un lien valable 1 h (comptes validés seulement, même réponse
  et même délai que l'adresse existe ou non) ; invitation et « Lien mot de passe » de l'admin partent aussi par e-mail (`envoye`)
  et restent affichés à copier : pastille et bandeau dans Utilisateurs, compteur sur l'onglet (inscriptions en attente + demandes) ; l'admin
  crée le lien (`/?reinit=…`, 24 h, invitation 3 jours, usage unique, bouton « Copier ») et le transmet ; la demande
  s'efface quand le mot de passe est changé ; toutes les sessions sont fermées après changement. Variable Render `APP_URL`
  (adresse du site dans les liens).
- Page : `lgForm` / `lgValider` (connexion, inscription, oubli, nouveau mot de passe), `reprendre` (session mémorisée,
  prefs `jeton`), onglets « Utilisateurs » (droit admin) et « Mon compte » (droits, changer de mot de passe).
- **Récap de la semaine par e-mail** (demandé par l'utilisateur) : dans Utilisateurs, colonne « Agent » — l'admin rattache un
  agent au compte (recherche dans les semaines chargées ; colonne `agent` jsonb {pk, nom} de `utilisateurs`, PUT
  `action:'agent'`), puis « Récap » (compte validé, Brevo configuré) : semaine au choix (dernière par défaut), aperçu, envoi
  quand l'admin le décide (PUT `action:'recap'` : la page construit le message, `recapSemaine`, le serveur l'envoie à ce
  compte seulement). Contenu choisi par l'utilisateur : jours de service, TTE, heures sup, heures de nuit, heures du dimanche,
  paniers (détail midi / soir / nuit / RHR), RHR et lieux (pas pour les AFR), journées blanches, planning jour par jour
  (missions, trajet, horaire, pauses, codes, RHR). **Covoiturage seulement si le compte a le droit Coco** (sinon la partie
  n'apparaît pas) : « vous avez accès à la vue Coco » + covoiturages possibles avec qui, calculés comme l'onglet Coco
  (`cocoCalcul` + `cocoCovoit`, parmi les agents de la vue Coco ; agent absent de la vue Coco : dit, sans calcul).
- **Agenda du téléphone** (demandé par l'utilisateur : les deux façons, avec missions, RP, CP et RHR) — moteur testé :
  `calEvenements(semaines lues, pk)` (missions avec trajet et pause ; codes de famille RP et CP seulement, en journée entière
  avec le code écrit ; RHR, « suite la semaine suivante » si non clos) et `icsTexte` (iCalendar, **heure de Paris** : les
  horaires du fichier sont des heures locales, écrites telles quelles avec `TZID=Europe/Paris` + VTIMEZONE ; UID stables ;
  lignes pliées à 75 octets). (1) **Pièce jointe** `planning-Sxx-aaaa.ics` du récap (PUT `action:'recap'` avec `ics`,
  pièce jointe Brevo). (2) **Lien d'abonnement** : bouton « Agenda » de la colonne Agent (PUT `action:'cal'` : nouveau jeton,
  l'ancien cesse de marcher ; empreinte dans la colonne `cal` ; e-mail `mailAgenda` avec la marche à suivre iPhone `webcal:`,
  Google Agenda depuis un ordinateur « À partir de l'URL », Outlook ; « × » = `calOff`). Route publique `GET /cal/<jeton>.ics`
  (`agenda` : 12 dernières semaines importées, `calAgent` dans le moteur du serveur avec les règles du site, `calCache` vidé
  avec `invalider` ; jeton inconnu = 404 compté comme essai). Un agent exclu des chiffres garde son planning dans l'agenda.
- **Présentation du récap comme la fiche agent** (demandé par l'utilisateur, capture de la fiche) : `recapTuiles` (mêmes
  tuiles que la fiche : jours de service, RHR ou n/a, journées blanches, amplitude, TTE, heures sup, nuit, dimanche, paniers
  avec /JS et détail, MHIS · DISPO · ATCMD, codes) et `recapFrise` (frise 0–24 h par jour : missions en rouge avec pauses
  foncées, RHR en pointillé ambre, code ou journée blanche sur la ligne, fin de mission de nuit + « Journée blanche » comme la
  fiche ; à cheval sur minuit sur chaque jour touché ; libellé coupé à la largeur du segment), **en tableaux HTML** (les
  clients mail n'acceptent ni SVG, ni grille CSS, ni script), 3 tuiles par ligne pour le téléphone ; puis le détail des
  missions et le covoiturage. **Bouton « Ajouter cette semaine à mon agenda »** (demandé : la semaine envoyée seulement) :
  `%%AGENDA%%` remplacé par le serveur à l'envoi (`boutonAgenda`, même texte que `recapBouton` de l'aperçu) par un lien vers
  le fichier .ics de la semaine envoyée, gardé 90 jours (table `agendas` : empreinte du jeton, ics, expiration ; route
  publique `GET /cal/s/<jeton>.ics`) ; la pièce jointe reste. Pied du récap (demandé) : « Estimations pouvant contenir des erreurs, ne fait aucunement foi
  devant les tribunaux populaires. » ; nom d'expéditeur du récap seulement : « Mon récapitulatif Hebdomadaire » (`mail(…, nom)` ;
  les autres mails gardent « Récap Corridor »).
- **Newsletter** (demandé par l'utilisateur) : case « Newsletter » dans Utilisateurs → Comptes, cochée par l'admin seulement
  (colonne `newsletter` boolean de `utilisateurs`, PUT `action:'newsletter'`). Onglet **« Newsletter »** (groupe Diffusion,
  droit admin, `viewNewsletter`) : message libre — titre (= objet de l'e-mail, **pas répété dans le corps** : demandé) et
  éditeur dans un cadre avec **barre d'outils en haut** (demandé : « comme un vrai outil de rédaction ») : annuler / rétablir,
  style (texte, titre, sous-titre, citation), police `NL_POLICES`, taille `NL_TAILLES`, gras, italique, souligné, barré,
  couleur du texte, surlignage, alignement gauche / centre / droite, listes à puces / numérotée, retraits, lien, image,
  ligne de séparation, chiffres du site, effacer la mise en forme ; boutons et listes suivent la sélection (`nlEtat`).
  **Lien hypertexte** (demandé) : panneau « Texte affiché » + « Adresse » (bouton ou Ctrl+K, qui l'emporte sur la recherche
  du site dans l'éditeur), modifier ou retirer un lien existant. Les panneaux lien / chiffres s'ouvrent sous la barre sans
  redessiner l'éditeur (`nlZones` : curseur gardé, insertion à l'endroit du curseur). Un retour à la ligne = un paragraphe. **Données du site = agrégats anonymes de la vitrine** (`S.vit`,
  cellules ≥ 5 agents, semaine entière, agence au choix ou toutes, chiffres `NL_DONNEES` : agents, TTE moyen, heures sup
  total / par agent, nuit, dimanche, RHR, journées blanches, paniers, trajets seuls) insérés comme tableau figé
  (`nlBlocDonnees`). Images : réduites à 1200 px (JPEG) dans la page, stockées en base (table `nl_images`), servies
  publiquement `GET /nl/img/<id>` (pour les messageries). Contenu nettoyé dans la page (`nlNettoyer`, balises et attributs
  autorisés) et au serveur (`nlPropre`). **Envoi quand l'admin le décide** (pas de récurrence, choix de l'utilisateur) :
  « M'envoyer un essai » (à son propre e-mail, objet « [Essai] ») puis « Envoyer aux N abonnés » (comptes validés et cochés,
  un e-mail par personne, confirmation). **Toutes les newsletters sont gardées** (table `newsletters` : titre, html, cree,
  maj, envoye, nb) : brouillon = « Ouvrir » ; envoyée = lecture seule, « Réutiliser comme modèle » (nouveau brouillon).
  API admin : `GET|POST|DELETE /api/newsletter`, `POST /api/newsletter/image`, `POST /api/newsletter/envoi` ({id, test}).
  **Désabonnement** : lien signé dans chaque e-mail (HMAC du courriel, secret aléatoire `config` clé `nlsecret`) + en-tête
  `List-Unsubscribe` ; `GET /nl/desabo` affiche une confirmation, le bouton (POST) décoche `newsletter` (un simple aperçu du
  lien par la messagerie ne désabonne personne) ; signature fausse = 400 comptée comme essai. Expéditeur : « Récap Corridor ».
- **Ne jamais écrire d'e-mail ni de mot de passe (même en empreinte) dans le dépôt** : les deux premiers administrateurs
  ont été ajoutés directement dans Supabase (`recap_dev` et `recap`, tables créées au nom de `recap_dev_app` / `recap_app`).
  `APP_URL` réglée sur les deux services Render.

## Onglet Production (demandé par l'utilisateur, admin seulement, groupe Pilotage)

**Publié sur le principal** (demandé par l'utilisateur), avec les réglages « Production » et « Accord d'entreprise ».
La **Planification reste en travail** : affichée seulement sur le site de test (`EN_TRAVAIL`, `enTest()` = page marquée
`data-env="dev"`) ; le code est le même sur les deux branches ; retirer un onglet de `EN_TRAVAIL` pour le publier.

Chiffres orientés production, calculés sur le planning seulement (ni réalisé, ni effectif théorique, ni coûts) par
`productionData(rows, pool, rules)` (moteur, testé) sur le périmètre et la période du filtre principal ; `viewProduction`.
- **Points d'attention** : phrases automatiques reprenant les chiffres ci-dessous.
- **Repos** : repos pris (codes choisis, défaut RP ; RP déjà lu non recompté) ; repos dus = nombre réglé par semaine /
  mois / an, **vide par défaut** (choix de l'utilisateur : ne rien inventer ; indicateur masqué tant que vide), ramené aux
  jours où l'agent est dans les fichiers ; écart ; week-ends complets (samedi + dimanche en RP/RF/JF/RCL/RCC) ; périodes
  de repos et repos doubles (≥ 2 jours d'affilée) ; repos à résidence plus courts que le minimum réglé (vide = non contrôlé).
- **Utilisation** : jours en service / jours présents, TTE par jour de service, heures sup, concentration (part faite par
  les 20 % d'agents en heures sup qui en font le plus), rééquilibrage (même agence, métier et semaine entière : heures sup
  face aux heures sous le seuil des agents présents toute la semaine sans congé ni absence).
- **Temps non productif** : heures neutralisées (minimum compté − temps réel des missions courtes, dont trajets seuls),
  trajets seuls (nombre, heures, % du TTE), journées « trajet seul », journées blanches, DISPO / ATCMD, RHR et lieux.
- **Irrégularité et défaillances** : écart moyen de prise de service d'un jour de service au lendemain, alternance jour /
  nuit (jour de nuit = jour avec heures de nuit), absences (codes hors repos et congés), RHR > 44 h, cases vides non classées.
- **Optimisation des plannings** (idée de l'utilisateur) : trajet seul X → Y remplaçable par un train productif X → Y (ni
  trajet seul, ni DISPO, ni ATCMD) assuré par un autre agent du même métier (toutes agences), parti entre l'arrivée de
  l'agent à X et le départ prévu + fenêtre réglable (défaut 2 h) ; « journée économisable » si l'agent de ce train était
  venu à X en trajet seul et n'a rien fait d'autre. Présenté comme piste à vérifier (habilitations, ligne, repos).
- Réglages → « Production » (`rules.production` : reposDusCDR / reposDusAFR — séparés à la demande de l'utilisateur, vide =
  accord 117 / 113 par an ; l'ancien `reposDus` commun reste lu en secours —, reposPar, reposCodes, reposResMin, optiFenetre, coutHS).
- **Accord d'entreprise ECR 2018** (PDF fourni par l'utilisateur, scanné, non versé au dépôt) — valeurs pré-remplies et
  réglables (`ACCORD_DEF`, `rules.accord`, Réglages → « Accord d'entreprise ») ; correspondance validée : CONDUCTEUR (dont
  « CDR + AFR ») = personnel roulant, chapitre 3 ; AFR et COORDO AFR = continuité de service, chapitre 4 titre 2.
  Conducteurs : TTE ≤ 10 h (9 h si > 2h30 entre 22h et 5h), amplitude ≤ 11 h (9h30), repos journalier à résidence 13 h
  (réductible une fois par GPT, jamais < 11 h, ni < 12 h après une journée de nuit), RHR ≥ 9 h (< 11 h : repos compensateur,
  2 RHR successifs une fois par GPT, > 24 h : repos à résidence de 15 h dans la GPT suivante), 117 RP / an (art. 12, 17–19).
  AFR / coordo : TTE ≤ 10 h (8h30 si > 2h30 entre 22h et 7h), amplitude ≤ 12 h, repos journalier 12 h (réduit une fois par
  GPT, ≥ 10 h), 113 RP / an (art. 28–30). Communs : 39 repos doubles / an dont 12 samedi-dimanche au minimum et un par mois,
  8 RP / mois, 3 RP consécutifs au plus, 2 repos simples successifs au plus, veille d'un repos simple fin ≤ 22 h et reprise
  ≥ 5 h (double : 23 h / 3 h), repos périodique = 24 h × jours + repos journalier, GPT ≤ 6 jours, GPT de 6 jours suivie d'un
  repos double, 2 GPT de 6 jours au plus sur 4 semaines, 48 h / semaine, 44 h en moyenne sur 4 semaines, pause ≥ 20 min
  au-delà de 6 h (art. 3, 19–20, 22, 30–32). **Choix de l'utilisateur** : repos périodique = RP seulement (RF / JF à part) ;
  GPT = jours consécutifs sans repos (RP, RF, JF, RCL, RCC ; CP et absences ne la coupent pas). **ATCMD = attente de la
  commande** (attend une mission pendant la plage), **DISPO = disponible à l'agence** (sur aucun train, prêt en cas de
  besoin) — précisé par l'utilisateur : contrôle 2 fois par semaine chacune, 3 au total (art. 15–16, 36–37), actif par défaut. Non contrôlables (absents des fichiers) : temps de
  conduite, réalisé. `conformiteData` (moteur, testé) → carte « Conformité à l'accord d'entreprise » (écarts par règle, détail
  par agent et par jour ; « à surveiller » : repos compensateur dû).
- Repos dus par défaut = accord (117 / 113 RP par an au prorata des jours présents) sauf nombre saisi dans Réglages ;
  repos doubles = RP d'affilée (dus 39 / an), doubles samedi-dimanche (12 / an).
- **Équité de répartition** (`equiteData`) : jours de service, heures de nuit, RHR, DISPO, journées blanches, ATCMD, heures
  sup, jours de week-end travaillés, par semaine de présence ; par agence × métier : moyenne, min–max, « inégal » si
  écart-type > moitié de la moyenne ; par agent : ambre au-dessus de moyenne + écart-type, rose en dessous.
- **ATCMD / DISPO = temps payé sans train, objectif 0** (l'utilisateur : avec des trains optimisés il ne devrait plus y en
  avoir) : nombre et heures dans « Points d'attention » et « Temps non productif » ; `pistesCmd` : pour chaque ATCMD / DISPO,
  les trains productifs partis du même lieu pendant la plage, assurés par un autre agent du même métier (toutes agences),
  de préférence un agent venu en trajet seul pour ce train (« trajet seul » économisé) ou qui n'a rien fait d'autre
  (« journée ») — tableau dans « Optimisation des plannings ».
- Périmètre choisi par l'utilisateur : contrôle + équité + pistes sur les plannings importés (pas de génération automatique).
- **Décalage des RP** (demandé par l'utilisateur) : avancement normal = RP dus / an (accord : 117 conducteurs, 113 AFR /
  coordo ; `rpAn`) / 52 × semaines écoulées à la fin de la période (fin de la S20 : 117 / 52 × 20 = 45 ; `semainesEcoulees` :
  numéro de semaine ISO, au prorata des jours pour une fin en milieu de semaine) ; RP réalisés = **dernier numéro « RP-n »
  lu dans le fichier** depuis le 1er janvier (choix de l'utilisateur ; sans numéro : RP comptés) ; écart = réalisés −
  attendus (+ avance, − retard) — `decalageRP` (moteur, testé). Colonne « Décalage RP » de l'onglet Agents (groupe Repos &
  absences, pastille ambre = retard, verte = avance, détail en infobulle) ; tuile « Décalage des RP » de la Synthèse (choix :
  agents en retard / en avance, arrondi au RP près, + à l'heure et moyenne ; clic → Agents). Agents, Synthèse et Production
  chargent toute l'année de la période.
- **RP triples / quadruples** (demandé par l'utilisateur ; règle précisée : **nombre de RP dans la même semaine civile**,
  lundi → dimanche, qu'ils se suivent ou non — S40 : RP lun-mar + sam-dim = quadruple ; RP seulement, numéro déjà lu non
  recompté ; 5 et + à part) : `rpSemaines` (moteur, testé) ; semaines de la période repérées par leur dimanche ; colonnes
  Agents « RP triples », « RP quadruples », « RP 5 et + » (nombre de semaines).
- **Coût des heures sup** (demandé par l'utilisateur ; choix : taux saisis par l'utilisateur, vides par défaut) : Réglages →
  Production, taux AFR / coordo et conducteurs (€/h) + majoration % (`rules.production.coutHS` {afr, cdr, maj}) ;
  `coutHeuresSup` (moteur, testé) = heures sup × taux du métier × (1 + majoration) ; carte Production « Heures sup et repos,
  semaine par semaine » (`hsSemainesCard`) : coût total et par agence × métier (sinon lien vers Réglages), barres des heures
  sup par semaine et, alignées dessous, cellules (échelle propre à chaque ligne) : agents avec 3, 4, 5 RP et + dans la semaine, jours de CP, RCL, RCC ; filtre d'agence propre (`S.prHsAg`) ; semaines les plus chargées
  dans le sous-titre. Deux échelles séparées alignées semaine par semaine, jamais de double axe.
- **Planning type de la semaine suivante** (demandé par l'utilisateur ; choix : trame service / repos **sans trains**, pour la
  semaine qui suit la dernière importée, périmètre du filtre) : `trameSemaine(rowsAll, lastWeekId, scopePks, rules)` (moteur,
  testé) ; la carte « Planning type — Sxx » (`trameCard`) n'est plus affichée dans Production (retirée à la demande de
  l'utilisateur : elle encombrait la vue) ; `trameSemaine` sert toujours à poser les RP de la semaine à venir en Planification. État repris de S-1 : GPT en cours, RP en fin de
  semaine, dernier service (fin, lieu, résidence ou RHR, journée de nuit), RP pris depuis le 1er janvier, repos double
  samedi-dimanche du mois. Règles appliquées (affichées) : RP de la semaine = dus à la fin de la semaine − pris, borné 2–3, en
  un seul bloc ; bloc placé pour GPT ≤ 6 jours, ≤ 3 RP d'affilée avec la fin de S-1, sur samedi-dimanche si le mois n'en a
  pas (obligatoire au dernier samedi du mois), pas deux week-ends de suite sinon, puis équilibre de l'effectif en service par
  jour (cible : moyenne des 4 dernières semaines du groupe agence × métier). Contraintes relâchées dans l'ordre week-end,
  3 RP d'affilée si elles ne tiennent pas avec la GPT (signalé). Notes par jour : reprise au plus tôt (repos journalier,
  RHR, lendemain de repos), fin au plus tard la veille du repos, GPT de 6 jours. Congés / absences de S+1 inconnus.

## Onglet Planification (demandé par l'utilisateur, admin seulement, groupe Pilotage)

Semaine au choix (semaines importées + les 4 qui suivent la dernière, `planifSemaines`). **Deux tableaux côte à côte**
(demandé par l'utilisateur, pour que l'outil soit plus intuitif) : à gauche **Missions** (liste de toutes les missions de la
semaine, placées ou à placer : jour, intitulé, horaire, trajet, agent ou « à placer », agence · métier, régularité x/4 ;
filtres propres : agence, métier — conducteurs / AFR et coordo —, statut à placer / placées / toutes, jour ; boutons
« Remplir automatiquement » et « Tout remettre à placer » ; formulaire d'ajout avec agence et métier), à droite **Planning**
(grille agents × jours, filtres propres : agence, métier ; un code par jour : RP, RF, JF, RCL, RCC, CP, MAL, AT, FORM ou rien).
Filtres par défaut : première agence du filtre du haut (Hendaye), tous métiers ; les missions suivent l'agence / le métier du
planning tant qu'on ne les a pas changés (`plFiltres`). Le brouillon contient **toutes les agences** (les filtres ne
choisissent que ce qu'on voit) ; les brouillons de l'ancienne version (une seule agence) demandent « Repartir ».
Seuil des trains réguliers réglable dans la page (1 à 4 fois sur 4 semaines, défaut 2 ; refait le brouillon).
- Premier brouillon (`construirePlanif`) : semaine importée = missions et codes du fichier ; semaine à venir = jours de RP du
  planning type pour S+1 (vide au-delà). **Trains réguliers** (choix de l'utilisateur : même intitulé, même trajet départ → arrivée — ajouté à la demande, pour ne pas
  confondre des missions génériques comme « MHIS » —, même jour de semaine,
  au moins 2 fois sur les 4 semaines importées qui précèdent ; ATCMD et DISPO exclus, ce ne sont pas des trains) :
  `trainsReguliers` (horaire, trajet et pauses les plus fréquents ; agent habituel = celui qui l'a fait le plus) ; semaine à
  venir : **pré-remplissage par agence** (demandé par l'utilisateur : un agent de Hendaye ne fait pas une mission de
  Vaires) — `planifPreremplir` (moteur, testé) : chaque train appartient à l'agence et à la famille de métier (AFR /
  conducteurs) majoritaires chez les agents qui l'ont assuré, et ne va qu'à un agent de cette agence et de ce métier,
  choisi par `planifAuto` (lieu, trajets seuls, règles de l'accord, priorité 35 h puis agent habituel ; voir plus bas) ;
  sinon réserve (étiquetée avec l'agence, avec les raisons). Trains d'agences absentes de la grille : ignorés.
  Semaine importée : les trains réguliers de ses agences absents de la semaine vont en réserve. La grille et la réserve
  suivent leurs filtres propres. « Remplir automatiquement » : `planifAuto` (voir plus bas) sur les missions à placer du filtre
  missions ; message : combien placées, trajets seuls ajoutés, combien restent et pourquoi (raisons les plus fréquentes).
  Missions ajoutées à la main (formulaire : jour, intitulé, départ, arrivée, début, fin, agence, métier) dans « à placer ».
- **Moteur de planification automatique** (demandé par l'utilisateur : « vrai outil de planification automatisé » ; remplace
  `planifPlacer`) — `planifAuto(pl, items, ctx, rules)` (moteur, testé) ; choix de l'utilisateur : **lieu suivi** (une
  mission part de là où est l'agent : fin de la veille, RHR, résidence ; `ctx.lieux` / `ctx.fins` = fin de S-1) ; **trajet
  seul ajouté en dernier recours** sur un horaire déjà vu dans les fichiers entre les deux lieux (`planifTrajets` : tous les
  trains vus, durée + heure de départ ; libellé « VOY (ajouté) », `ajout:true`) ; **30 min** au moins entre deux missions
  (`PL_BAT`) ; **AFR / coordo rentrent chaque soir**, conducteurs en RHR possible (pas la veille d'un repos, ni le dimanche,
  ni une 3e nuit ; un jour sans mission n'est jamais passé dehors) ; **priorité 35 h** (candidats classés : rester sous 35 h,
  pas de trajet seul, le moins d'heures, l'agent habituel) ; **repos placés avec les missions** : RP posés par le planning
  type (`cAuto`) déplacés si tous les agents sont en repos, GPT ≤ 6 et 3 RP d'affilée respectés (`plReposOk`) sans nouvel
  écart pour ce qui est déjà placé. Essai (`plEssai`) : semaine de l'agent refaite avec la mission (`plRelierAgent` : trajets
  seuls aller / retour) et comparée à la semaine sans elle (`plEcarts`) : liaison impossible, chevauchement, amplitude / TTE
  (temps réel, comme la conformité) et pause de 20 min au-delà de 6 h (`plJourRaison`), repos journalier à résidence
  (13 h / 12 h) ou RHR ≥ 9 h, repos périodiques (24 h × jours + RJ, veille 22 h / 23 h, lendemain 5 h / 3 h, repos de fin
  de S-1 compris), 48 h. Raisons (`PL_RAISONS`) gardées par mission non placée (`raisons`), explication du choix
  (`pourquoi`). `planifRelier` refait tous les trajets seuls après chaque changement (y compris à la main) ; liaison
  impossible → alerte « retour à organiser » (une fois, l'agent est ensuite compté rentré). Contexte (`planifContexte`) :
  résidences de l'agent (règles du site, résidence propre de la fiche comprise), état de fin de S-1, horaires observés sur
  toutes les semaines chargées. Résidence inconnue ⇒ aucun contrôle de retour. Résidence propre d'un agent (fiche) prise
  en compte, jamais étendue à son agence (précisé par l'utilisateur : l'unique AFR de Bayonne est rattaché à l'agence de
  Hendaye mais prend et finit toujours son service à Bayonne ; résidence propre BYE déjà saisie sur les deux sites).
- Interface : bandeau de synthèse (`plSynthese` : missions placées, à placer, TTE moyen, sous / au-dessus de 35 h, nuits en
  RHR, trajets seuls ajoutés, alertes) ; sous chaque nom, heures / 35 h avec barre (ambre sous, rouge au-dessus), RHR et
  trajets ajoutés (`plStats`) ; dans les cases « depuis X (RHR) » et « ☾ RHR · X » ; trajets ajoutés en pointillé (non
  déplaçables, refaits seuls) ; bouton « ? » sur chaque mission (`planifPourquoi` : pourquoi cet agent, autres possibles,
  écartés ; pour une mission à placer, chaque agent et sa raison) ; raison résumée sous chaque mission à placer
  (`plResume`) ; filtre « seulement les agents en RHR » ; « Annuler » (30 derniers changements, `planifMemo` / `S.plHist`).
- Glisser-déposer (liste → case, case ↔ case, case → liste pour retirer une mission d'un agent ; sur téléphone : toucher la mission puis la case) ; une mission changée de
  jour garde son heure (`planifDeplacer`). À chaque changement, `planifAlertes` (moteur, testé) : semaine planifiée
  convertie en semaine lue (`planifVersSemaine`) + 2 semaines importées précédentes → `conformiteData` (toutes les règles de
  l'accord) + chevauchements + mission sur un jour codé ; alerte dans la case (cadre rouge) et message immédiat si le dépôt
  crée une alerte pour l'agent. Écarts de la veille (S-1) repris seulement s'ils touchent la semaine (repos, GPT, RHR).
- Brouillon enregistré sur le serveur (choix de l'utilisateur) : `GET|PUT|DELETE /api/planif?id=` (admin seulement), config
  `planif` = {semaine: brouillon}, 30 semaines au plus ; « Repartir du fichier / du planning type » efface le brouillon.
  La page ne se rafraîchit pas automatiquement dans cet onglet.

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
  Tableau des agents : colonnes « Résidence » et « Nuits HR » retirées (demandé). « CP <année> » = CP du 1er janvier au dernier
  jour de la période choisie (`finPeriode`, demandé par l'utilisateur). Une seule colonne « Journées blanches » (le nombre de journées blanches, rien d'autre) ; la colonne
  « Cases vides » est supprimée (demandé par l'utilisateur). Contrôle (demandé par l'utilisateur) après « Absences » : « Total jours »
  (service + repos + journées blanches + congés + absences, / jours de la période couverts par les semaines importées,
  `joursDePeriode` ; pastille ≠ si différent), « Autres cases vides » (cases vides qui ne sont pas des journées blanches,
  colonne à part demandée), « Hors fichier » (jours où l'agent n'est dans aucun fichier : arrivée, départ,
  autre agence, agence hors production, semaine exclue) et « Non classés » (cases vides qui ne sont pas des journées
  RP dont le numéro est déjà lu — non comptés, choix de l'utilisateur —, cases hors colonne) ; Total + Autres cases vides +
  Hors fichier + Non classés = jours de la période. Chacune de ces trois colonnes est cliquable (demandé par l'utilisateur,
  `detailControle`) : panneau jour par jour — autres cases vides : raison de la non-comptée en journée blanche ; hors
  fichier : par semaine, les jours absents et pourquoi (absent du fichier, autre agence hors du filtre, métier hors filtre,
  agence hors production, agent exclu avec motif, semaine non chargée) ; non classés : RP dont le numéro a déjà été lu (date
  et semaine de la première lecture), cases hors colonne (mission et date écrite).
  Groupe « Temps de travail » : **« RJ au minimum »** et **« RJ sous le minimum »** (demandé par l'utilisateur ; minimum
  précisé par l'utilisateur = durée du repos journalier entre deux missions : **13 h conducteurs, 12 h AFR / coordo** ; RHR non
  comptés) — `reposJournaliersCourts` (moteur, testé) : repos à résidence entre deux jours de service qui se suivent (journée
  précédente finie à la résidence ; AFR / coordo : toujours) ; au minimum = égal à la minute près, sous le minimum = plus
  court. Cliquables : détail (fin, reprise, durée), avec mention quand le repos passe aussi sous la réduction exceptionnelle
  de l'accord (11 h conducteurs, 12 h après une journée de nuit ; 10 h AFR ; valeurs de Réglages → Accord). Tuile « Codes » de la fiche : chaque code s'ouvre (survol ou
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
  (validé par l'utilisateur : deux missions de 4 h = 10 h ; réglable, 0 = désactivé), quel que soit le jour : ses heures de
  nuit et du dimanche sont ramenées aux 5 h au prorata de son temps travaillé réel (VOY dim. 10h–13h = 5 h de dimanche ;
  23h–02h = 5 h de nuit ; précisé par l'utilisateur). Paniers lus sur l'horaire réel. Heures sup : TTE au-delà de 35 h par agent et par semaine.
  Calcul blindé : durées recalculées en minutes entières depuis les horaires (`missionMinutes`), pauses = réunion des
  pauses ramenées dans la mission (jamais déduites deux fois), totaux gardés en minutes exactes (`rM`, aucune dérive
  d'arrondi). **Anciens fichiers (S01 à S19, onglet « Corridor Atlantique ») : les pauses ne sont pas dans les cases** ; elles
  viennent de l'onglet « Extract » (une ligne par agent et par jour, clé matricule|date, `readExtract`) : la lecture note
  [T, U] sur la journée (`tu`), le calcul (`pausesExtractJour`, dans applyRules, donc rejoué sans réimport) retire la pause
  de la journée = WorkDuration (T) − WorkDurationEffective (U) (précisé par l'utilisateur), répartie entre les missions du
  jour au prorata de leur durée, placée au milieu de chaque mission (donc retirée des heures de nuit et du dimanche là où
  elle tombe). Jamais de pause sur une ATCMD (5 h fixes) ni sur un **trajet seul** (`isTrajetSeul` : l'écart T − U y est
  souvent un coefficient, pas une pause → horaire complet) ; une **mission mixte** (VOY+CSE, CSE+VOY, VS+VOY…) reçoit sa
  pause (précisé par l'utilisateur, cas Bonzi S13) ; jour trajet seul + autre JS : la pause va à l'autre JS. Rien n'est
  ajouté si la case a déjà ses pauses « P: ». Ligne de pause vide « P: - » = aucune pause, sans alerte (`RE_PV`). Signalés : pause illisible, pause hors mission, mission de 24 h ou plus, missions qui se chevauchent.
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
- Fichier conservé et « Relire » (demandé par l'utilisateur) : à chaque import, la feuille lue (lignes brutes, 60 colonnes au
  plus) et les durées T / U de l'Extract pour les jours de la semaine sont enregistrées avec la semaine (document `details`
  d'`agence_slug` `~source`, jamais envoyé au visiteur ni à la vitrine ; `GET /api/source`). Import → « Relire » (par semaine)
  ou « Tout relire » : refait la lecture avec les règles actuelles (nettoyage, pauses, Extract), place la semaine dans la file
  avec l'écart avant → après (TTE, heures sup, missions, RHR, paniers, nuit) ; rien n'est enregistré sans « Enregistrer ».
  Semaines importées avant cette version : à réimporter une fois.

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

## Actualisation automatique (demandée par l'utilisateur)

Pas de tâche planifiée sur le serveur : la page ouverte interroge `/api/etat` toutes les 2 minutes (et au retour sur
l'onglet) ; si les semaines, les règles ou la sélection Coco ont changé (`sigEtat`), elle recharge les chiffres
(admin : semaines rechargées ; visiteur : vitrine ; covoit : `/api/coco` à chaque passage) et l'indique brièvement.
Jamais pendant une saisie, un import, dans Réglages / Import (saisies non enregistrées) ni onglet caché (`rafraichir`).
Chaque minute, Coco et la Synthèse sont redessinées (pastille « en service », trait « maintenant »).

## Performances

Serveur : page lue, empreinte (ETag) et version compressée calculées une fois par démarrage (`lirePage`) ; au réveil,
base connectée, moteur chargé et vitrine préparée d'avance ; vue Coco gardée en mémoire par semaine (`cocoCache`),
vidée comme la vitrine à chaque import, suppression, changement de règles ou de sélection Coco (`invalider`).
Page : semaines demandées au serveur en parallèle, 6 à la fois (`ensureLoaded`).
**Cache local des semaines** (demandé par l'utilisateur, le site ramait) : `cacheSem` (IndexedDB `recap-cache`, magasin
`semaines`) garde le détail brut de chaque semaine avec sa signature (date d'import + nombre de lignes) ; `ensureLoaded` lit
d'abord le cache, ne demande au serveur que les semaines absentes ou réimportées, puis les met en cache ; semaines supprimées
retirées au démarrage et à l'actualisation (`nettoyer`) ; cache vidé à la déconnexion ; jamais pour le visiteur (qui ne
charge pas de détail). Les règles et corrections restent appliquées à chaque affichage (cache = données brutes du fichier).

## Interface

Couleurs DB Cargo : rouge (#EC0016) sur blanc en mode clair, rouge sur noir en mode sombre, sans dégradé ;
ambre pour ce qui demande attention. Menu latéral groupé (Pilotage, Détail, Analyse, Diffusion, Administration)
avec icônes, réductible en icônes seules (mémorisé), en tiroir sous une barre fixe sur téléphone. Synthèse :
quatre indicateurs principaux puis un bandeau compact pour les autres.

## Hébergement

- **Render**, service `recap-corridor` (gratuit, Francfort), déployé automatiquement à chaque
  commit sur `main`. Build : `cd recap-corridor && npm install --omit=dev`.
  Démarrage : `cd recap-corridor && npm start`.
- Site principal gardé éveillé (demandé par l'utilisateur, offre gratuite conservée) : tâche GitHub Actions
  `.github/workflows/garder-eveille.yml` qui appelle `https://recap-corridor.onrender.com/api/ping` toutes les 10 min.
  Jamais pour le site de test (750 h gratuites par mois pour tout le compte). GitHub la désactive après 60 jours sans
  commit : la réactiver dans l'onglet Actions.
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
