# ADENOM — Backend (Vercel + Turso)

Ce projet a été adapté pour être déployé gratuitement sur **Vercel**, avec une
vraie base de données en ligne via **Turso** (SQLite distribué, compatible
serverless).

## 🗂 Structure du projet

```
.
├── api/                  -> Fonctions serverless (chaque fichier = une route)
│   ├── register.js       (POST /api/register)
│   ├── login.js          (POST /api/login)
│   ├── logout.js         (POST /api/logout)
│   ├── me.js              (GET  /api/me)
│   ├── join.js           (POST /api/join)
│   └── admin/
│       ├── users.js      (GET  /api/admin/users)
│       └── validate.js   (POST /api/admin/validate)
├── lib/
│   ├── db.js             -> Accès base de données (Turso/libSQL)
│   ├── auth.js           -> Hash de mots de passe, tokens (inchangé)
│   └── http.js           -> Cookies, CORS, session courante...
├── index.html            -> Page d'accueil du site (servie automatiquement)
├── images/               -> Images du site
├── package.json
├── vercel.json
└── .env.example
```

## 1️⃣ Créer la base de données Turso (gratuit)

1. Créez un compte sur https://turso.tech (gratuit, jusqu'à 500 bases / 9 Go).
2. Installez la CLI Turso (ou utilisez le tableau de bord web) :
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   ```
3. Créez la base de données :
   ```bash
   turso db create adenom
   ```
4. Récupérez l'URL et le jeton d'accès :
   ```bash
   turso db show adenom --url
   turso db tokens create adenom
   ```
   Vous obtenez :
   - `TURSO_DATABASE_URL` (ex: `libsql://adenom-xxxx.turso.io`)
   - `TURSO_AUTH_TOKEN`

   ⚠️ Aucune création de table manuelle n'est nécessaire : le schéma
   (`users`, `sessions`) est créé automatiquement au premier appel de l'API
   (voir `lib/db.js`, fonction `init()`).

## 2️⃣ Confirmation d'email (Brevo — gratuit, sans nom de domaine)

Pour envoyer l'email de confirmation à l'inscription :

1. Créez un compte sur https://brevo.com (gratuit, 300 emails/jour à vie)
2. Allez dans **Senders, Domains & IPs → Senders** et ajoutez une adresse
   expéditrice (par exemple votre Gmail, ex: `adenom.contact@gmail.com`)
3. Brevo envoie un code à 6 chiffres à cette adresse — entrez-le pour la valider
4. Allez dans **SMTP & API → API Keys** et créez une nouvelle clé API
5. Récupérez :
   - `BREVO_API_KEY` (la clé créée)
   - `BREVO_FROM_EMAIL` (l'adresse vérifiée à l'étape 2)
   - `BREVO_FROM_NAME` (optionnel, ex: `ADENOM`)

> Si ces variables ne sont pas configurées, l'inscription fonctionne quand même
> normalement — l'email de confirmation est simplement ignoré (un message est
> écrit dans les logs Vercel). Tant que l'email n'est pas confirmé, le compte
> peut se connecter normalement mais ne peut pas envoyer de demande d'adhésion
> ("Rejoindre la communauté").

## 3️⃣ Déployer sur Vercel

1. Poussez ce projet sur un dépôt GitHub (ou GitLab/Bitbucket).
2. Sur https://vercel.com, cliquez **"Add New" → "Project"** et importez le dépôt.
3. Vercel détecte automatiquement le dossier `api/` comme fonctions serverless
   et `index.html` / `images/` comme fichiers statiques. Aucune configuration
   de build n'est nécessaire.
4. Dans **Project Settings → Environment Variables**, ajoutez :
   | Nom | Valeur |
   |---|---|
   | `TURSO_DATABASE_URL` | (obtenu à l'étape 1) |
   | `TURSO_AUTH_TOKEN` | (obtenu à l'étape 1) |
   | `ADMIN_CODE` | un code secret de votre choix (remplace la valeur par défaut) |
   | `BREVO_API_KEY` | (obtenu à l'étape 2, optionnel) |
   | `BREVO_FROM_EMAIL` | (obtenu à l'étape 2, optionnel) |
   | `BREVO_FROM_NAME` | ex: `ADENOM` (optionnel) |
   | `SITE_URL` | l'URL de votre projet Vercel, ex: `https://adenom-backend.vercel.app` (optionnel, requis pour le lien de confirmation) |
5. Cliquez **Deploy**. Votre site est en ligne sur `https://votre-projet.vercel.app`.

## 3️⃣ Développement local

```bash
npm install
npm i -g vercel        # si pas déjà installé
cp .env.example .env   # puis remplissez les valeurs
vercel dev
```

`vercel dev` reproduit l'environnement serverless en local, sert `index.html`
et les fonctions `api/*` sur `http://localhost:3000`.

## 🔐 Notes de sécurité

- Les cookies de session sont marqués `Secure` (HTTPS uniquement) — Vercel
  fournit HTTPS automatiquement, donc cela fonctionne sans configuration
  supplémentaire. En local avec `vercel dev`, le proxy gère également le HTTPS.
- Changez impérativement la valeur de `ADMIN_CODE` avant la mise en production.
- Les mots de passe sont hashés avec PBKDF2 (100 000 itérations, SHA-512),
  comme dans la version originale — `lib/auth.js` est inchangé.

## ✅ Routes API (inchangées côté frontend)

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/register` | Inscription + connexion automatique |
| POST | `/api/login` | Connexion |
| POST | `/api/logout` | Déconnexion |
| GET | `/api/me` | Utilisateur courant |
| GET | `/api/verify-email?token=...` | Confirme l'adresse e-mail (lien cliqué) |
| POST | `/api/resend-verification` | Renvoie l'email de confirmation |
| POST | `/api/join` | Demande d'adhésion |
| GET | `/api/admin/users` | Liste des utilisateurs (code admin requis) |
| POST | `/api/admin/validate` | Valider/rejeter une adhésion (code admin requis) |

Le frontend (`index.html`) n'a **aucune modification à faire** : il appelle déjà
ces routes en chemin relatif (`API_BASE = ''`), ce qui fonctionne aussi bien
en local qu'en production sur Vercel.
