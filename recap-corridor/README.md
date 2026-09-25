# Récap Corridor

Extraction hebdomadaire des fichiers ARP « Récap National Corridor » : repos hors
résidence, journées blanches, heures planifiées et heures sup, heures de nuit et
du dimanche, paniers repas, MHIS / DISPO / ATCMD, trajets seuls — par agent,
par agence et par corps de métier, semaine par semaine ou cumulé.

## Architecture

| Élément | Rôle |
|---|---|
| `public/engine.js` | Moteur de calcul (lecture .xlsx, fusion des doublons, toutes les règles). Tourne dans le navigateur ; le fichier Excel n'est jamais envoyé, seules les données extraites le sont. |
| `public/app.js` | Interface : synthèse, statistiques, agents, RHR, journées blanches, exports, import, réglages. |
| `public/xlsx.js` | Écriture des exports Excel. |
| `server.js` | Serveur Node (une dépendance : `pg`). Contrôle les codes d'accès et stocke les semaines. |
| `db/schema.sql` | Schéma Postgres (Supabase), à exécuter une fois. |
| `render.yaml` | Configuration Render (service web gratuit, Francfort). |

Données : Supabase, schéma `recap`, accessible uniquement par le rôle `recap_app`
utilisé par le serveur. Les règles de calcul sont rejouées à chaque affichage :
modifier une règle dans l'onglet Réglages ne demande jamais de réimporter.

## Variables d'environnement (Render)

| Variable | Contenu |
|---|---|
| `DATABASE_URL` | `postgresql://recap_app.<ref>:<mot de passe>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres` |
| `CODE_ADMIN` | code d'accès complet (import, suppression, réglages) |
| `CODE_LECTURE` | code de consultation et d'export, à distribuer |
| `NODE_VERSION` | `22` |

Changer un code : Render → service → Environment → modifier → Save. Le service
redémarre, les données ne bougent pas.

## Mises à jour

Chaque envoi (push) sur la branche `main` redéploie automatiquement le site sur
Render en deux à trois minutes. Pour faire évoluer l'outil avec Claude, ouvrez
une session en y rattachant ce dépôt : les modifications sont poussées sur
`main` et Render les met en ligne.

## Sauvegarde

Onglet Import → « Télécharger une sauvegarde » : toutes les semaines et les
règles dans un fichier JSON. « Restaurer une sauvegarde » le recharge (les
semaines du fichier remplacent celles de même numéro). Le fichier contient des
données nominatives : à conserver en lieu sûr, jamais dans ce dépôt.

## En local

```
npm install
DATABASE_URL=postgresql://… CODE_ADMIN=… CODE_LECTURE=… npm start
```

Tests : `npm test`. Ils s'appuient sur des fichiers réels (données nominatives)
qui ne sont pas versionnés ; sans eux, ils sont ignorés.
