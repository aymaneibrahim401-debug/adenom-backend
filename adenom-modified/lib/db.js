// lib/db.js — Couche d'accès à la base de données (Turso / libSQL).
//
// Remplace l'ancien stockage en fichier JSON par une vraie base de données
// SQL, accessible via HTTP — ce qui fonctionne parfaitement avec les
// fonctions serverless de Vercel (pas de connexion persistante nécessaire).
//
// Variables d'environnement requises (à définir sur Vercel) :
//   TURSO_DATABASE_URL  -> ex: libsql://adenom-xxxx.turso.io
//   TURSO_AUTH_TOKEN    -> jeton d'authentification Turso

const { createClient } = require('@libsql/client');

let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) {
      throw new Error(
        "Variable d'environnement TURSO_DATABASE_URL manquante. " +
        'Configurez-la dans les paramètres du projet Vercel.'
      );
    }
    _client = createClient({ url, authToken });
  }
  return _client;
}

// ----------------------------------------------------------------------
// Initialisation du schéma (idempotent — appelé au début de chaque requête)
// ----------------------------------------------------------------------

let _initPromise = null;
function init() {
  if (!_initPromise) {
    const db = getClient();
    _initPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          birth_date TEXT,
          gender TEXT,
          password_hash TEXT NOT NULL,
          account_status TEXT NOT NULL DEFAULT 'active',
          membership_requested INTEGER NOT NULL DEFAULT 0,
          membership_approved INTEGER NOT NULL DEFAULT 0,
          membership_message TEXT,
          membership_requested_at TEXT,
          membership_validated_at TEXT,
          email_verified INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      // Migration douce : ajoute la colonne email_verified si la table
      // "users" existait déjà sans cette colonne (déploiements précédents).
      try {
        await db.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
      } catch (err) {
        // La colonne existe déjà : on ignore l'erreur.
      }
    })();
  }
  return _initPromise;
}

// ----------------------------------------------------------------------
// Conversion ligne SQL <-> objet "user" (même forme qu'avant, en camelCase)
// ----------------------------------------------------------------------

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    birthDate: row.birth_date,
    gender: row.gender,
    passwordHash: row.password_hash,
    accountStatus: row.account_status,
    membershipRequested: !!row.membership_requested,
    membershipApproved: !!row.membership_approved,
    membershipMessage: row.membership_message || '',
    membershipRequestedAt: row.membership_requested_at || null,
    membershipValidatedAt: row.membership_validated_at || null,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at
  };
}

// ----------------------------------------------------------------------
// Utilisateurs
// ----------------------------------------------------------------------

async function getUserByEmail(email) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM users WHERE email = ? LIMIT 1',
    args: [email]
  });
  return rowToUser(res.rows[0]);
}

async function getUserById(id) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ? LIMIT 1',
    args: [id]
  });
  return rowToUser(res.rows[0]);
}

async function getAllUsers() {
  const db = getClient();
  const res = await db.execute('SELECT * FROM users ORDER BY created_at DESC');
  return res.rows.map(rowToUser);
}

async function createUser(user) {
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO users (
      id, first_name, last_name, email, birth_date, gender, password_hash,
      account_status, membership_requested, membership_approved,
      membership_message, membership_requested_at, membership_validated_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      user.id,
      user.firstName,
      user.lastName,
      user.email,
      user.birthDate || null,
      user.gender || null,
      user.passwordHash,
      user.accountStatus,
      user.membershipRequested ? 1 : 0,
      user.membershipApproved ? 1 : 0,
      user.membershipMessage || null,
      user.membershipRequestedAt || null,
      user.membershipValidatedAt || null,
      user.createdAt
    ]
  });
  return user;
}

// Met à jour les champs liés à l'adhésion / statut d'un utilisateur
async function updateUserMembership(user) {
  const db = getClient();
  await db.execute({
    sql: `UPDATE users SET
      account_status = ?,
      membership_requested = ?,
      membership_approved = ?,
      membership_message = ?,
      membership_requested_at = ?,
      membership_validated_at = ?
    WHERE id = ?`,
    args: [
      user.accountStatus,
      user.membershipRequested ? 1 : 0,
      user.membershipApproved ? 1 : 0,
      user.membershipMessage || null,
      user.membershipRequestedAt || null,
      user.membershipValidatedAt || null,
      user.id
    ]
  });
  return user;
}

// Marque l'email d'un utilisateur comme vérifié
async function markEmailVerified(userId) {
  const db = getClient();
  await db.execute({
    sql: 'UPDATE users SET email_verified = 1 WHERE id = ?',
    args: [userId]
  });
}

// ----------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------

async function getSession(token) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM sessions WHERE token = ? LIMIT 1',
    args: [token]
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: Number(row.expires_at)
  };
}

async function createSession(session) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [session.token, session.userId, session.createdAt, session.expiresAt]
  });
  return session;
}

async function deleteSession(token) {
  const db = getClient();
  await db.execute({
    sql: 'DELETE FROM sessions WHERE token = ?',
    args: [token]
  });
}

// ----------------------------------------------------------------------
// Vérification d'email
// ----------------------------------------------------------------------

async function createEmailVerification(verification) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT INTO email_verifications (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [verification.token, verification.userId, verification.createdAt, verification.expiresAt]
  });
  return verification;
}

async function getEmailVerification(token) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM email_verifications WHERE token = ? LIMIT 1',
    args: [token]
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: Number(row.expires_at)
  };
}

async function deleteEmailVerification(token) {
  const db = getClient();
  await db.execute({
    sql: 'DELETE FROM email_verifications WHERE token = ?',
    args: [token]
  });
}

module.exports = {
  init,
  getUserByEmail,
  getUserById,
  getAllUsers,
  createUser,
  updateUserMembership,
  markEmailVerified,
  getSession,
  createSession,
  deleteSession,
  createEmailVerification,
  getEmailVerification,
  deleteEmailVerification
};
