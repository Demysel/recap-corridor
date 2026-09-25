# Récap Corridor

Extraction hebdomadaire des fichiers ARP « Récap National Corridor » : repos hors
résidence, journées blanches, heures planifiées et heures sup, heures de nuit et
du dimanche, paniers repas, MHIS / DISPO / ATCMD, trajets seuls — par agent,
par agence et par corps de métier, semaine par semaine ou cumulé.

## Contenu

| Fichier | Rôle |
|---|---|
| `public/index.html` | L'application entière, comme dans la version d'origine : lecture des .xlsx dans le navigateur, calculs, onglets, graphiques, exports Excel/CSV et rapport autonome. |
| `server.js` | Serveur Node (une dépendance : `pg`). Contrôle les codes d'accès et stocke les semaines. Mêmes adresses que l'ancienne fonction Netlify : `session`, `etat`, `semaine`, `regles`. |
| `db/schema.sql` | Schéma Postgres (Supabase), à exécuter une fois. |
| `package.json` | Démarrage (`npm start`) et dépendance. |

Le fichier Excel n'est jamais envoyé au serveur : seules les données extraites
le sont. Les règles de calcul sont rejouées à chaque affichage : modifier une
règle dans l'onglet Réglages ne demande jamais de réimporter.

## Hébergement

- **Render** (service web gratuit, Francfort) : build `cd recap-corridor && npm install --omit=dev`,
  démarrage `cd recap-corridor && npm start`. Chaque envoi sur la branche `main`
  remet le site à jour en deux à trois minutes.
- **Supabase** : schéma `recap`, accessible uniquement par le rôle `recap_app`
  qu'utilise le serveur.

Variables d'environnement Render : `DATABASE_URL`, `CODE_ADMIN`, `CODE_LECTURE`,
`NODE_VERSION=22`. Changer un code : Render → service → Environment.

## Mises à jour avec Claude

Ouvrir une session sur claude.ai/code (ou l'app de bureau en mode Cloud) avec le
dépôt `Demysel/recap-corridor` sélectionné sous la zone de saisie. L'app Claude
doit être installée sur le dépôt (github.com/apps/claude/installations/new).
