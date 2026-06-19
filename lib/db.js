// lib/db.js — Couche d'accès à la base de données (Turso / libSQL).
// Version optimisée : cache session en mémoire, requêtes parallèles, nettoyage auto.

const { createClient } = require('@libsql/client');

// ---- Client singleton ----
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

// ---- Cache session en mémoire (réduit les allers-retours DB) ----
// TTL : 5 minutes. Clé = token, valeur = { session, user, cachedAt }
const SESSION_CACHE = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 min

function sessionCacheGet(token) {
  const entry = SESSION_CACHE.get(token);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > SESSION_CACHE_TTL) {
    SESSION_CACHE.delete(token);
    return null;
  }
  return entry;
}
function sessionCacheSet(token, session, user) {
  SESSION_CACHE.set(token, { session, user, cachedAt: Date.now() });
}
function sessionCacheDelete(token) {
  SESSION_CACHE.delete(token);
}

// ---- Initialisation du schéma (idempotent) ----
let _initDone = false;
async function init() {
  if (_initDone) return;
  const db = getClient();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
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
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_verifications (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT,
      image TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS actualities (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL DEFAULT 'info',
      title TEXT,
      text TEXT,
      image TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS typing (
      user_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ], 'deferred');

  // Migration douce (ignore si colonne existe déjà)
  try {
    await db.execute('ALTER TABLE messages ADD COLUMN image TEXT');
  } catch (_) {}
  try {
    await db.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  } catch (_) {}
  try {
    await db.execute('ALTER TABLE users ADD COLUMN profile_photo TEXT');
  } catch (_) {}

  _initDone = true;

  // Nettoyage périodique des sessions expirées (toutes les 30 min en serverless = à chaque cold start)
  cleanExpiredSessions().catch(() => {});
}

async function cleanExpiredSessions() {
  const db = getClient();
  await db.execute({
    sql: 'DELETE FROM sessions WHERE expires_at < ?',
    args: [Date.now()]
  });
}

// ---- Conversion ligne SQL → objet user (camelCase) ----
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
    profilePhoto: row.profile_photo || null,
    createdAt: row.created_at
  };
}

// ---- Utilisateurs ----
async function getUserByEmail(email) {
  const db = getClient();
  const res = await db.execute({ sql: 'SELECT * FROM users WHERE email = ? LIMIT 1', args: [email] });
  return rowToUser(res.rows[0]);
}

async function getUserById(id) {
  const db = getClient();
  const res = await db.execute({ sql: 'SELECT * FROM users WHERE id = ? LIMIT 1', args: [id] });
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
      user.id, user.firstName, user.lastName, user.email,
      user.birthDate || null, user.gender || null, user.passwordHash,
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

async function updateUserMembership(user) {
  const db = getClient();
  // Invalider le cache pour toutes les sessions de cet utilisateur
  for (const [token, entry] of SESSION_CACHE.entries()) {
    if (entry.user && entry.user.id === user.id) SESSION_CACHE.delete(token);
  }
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

async function markEmailVerified(userId) {
  const db = getClient();
  // Invalider le cache
  for (const [token, entry] of SESSION_CACHE.entries()) {
    if (entry.user && entry.user.id === userId) SESSION_CACHE.delete(token);
  }
  await db.execute({ sql: 'UPDATE users SET email_verified = 1 WHERE id = ?', args: [userId] });
}

// ---- Sessions (avec cache mémoire) ----
async function getSession(token) {
  // 1. Cache mémoire
  const cached = sessionCacheGet(token);
  if (cached) return cached.session;

  // 2. Base de données
  const db = getClient();
  const res = await db.execute({ sql: 'SELECT * FROM sessions WHERE token = ? LIMIT 1', args: [token] });
  const row = res.rows[0];
  if (!row) return null;
  return { token: row.token, userId: row.user_id, createdAt: row.created_at, expiresAt: Number(row.expires_at) };
}

// Récupère session + user en 1 seul aller-retour DB (ou depuis le cache)
async function getSessionWithUser(token) {
  // 1. Cache mémoire
  const cached = sessionCacheGet(token);
  if (cached) return { session: cached.session, user: cached.user };

  // 2. Requête jointe session + user
  const db = getClient();
  const res = await db.execute({
    sql: `SELECT s.token, s.user_id, s.created_at AS s_created_at, s.expires_at,
               u.id, u.first_name, u.last_name, u.email, u.birth_date, u.gender,
               u.password_hash, u.account_status, u.membership_requested,
               u.membership_approved, u.membership_message, u.membership_requested_at,
               u.membership_validated_at, u.email_verified, u.created_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
         WHERE s.token = ? LIMIT 1`,
    args: [token]
  });
  const row = res.rows[0];
  if (!row) return { session: null, user: null };

  const session = { token: row.token, userId: row.user_id, createdAt: row.s_created_at, expiresAt: Number(row.expires_at) };
  const user = rowToUser(row);
  sessionCacheSet(token, session, user);
  return { session, user };
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
  sessionCacheDelete(token);
  const db = getClient();
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

// ---- Vérification d'email ----
async function createEmailVerification(v) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT INTO email_verifications (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [v.token, v.userId, v.createdAt, v.expiresAt]
  });
  return v;
}

async function getEmailVerification(token) {
  const db = getClient();
  const res = await db.execute({ sql: 'SELECT * FROM email_verifications WHERE token = ? LIMIT 1', args: [token] });
  const row = res.rows[0];
  if (!row) return null;
  return { token: row.token, userId: row.user_id, createdAt: row.created_at, expiresAt: Number(row.expires_at) };
}

async function deleteEmailVerification(token) {
  const db = getClient();
  await db.execute({ sql: 'DELETE FROM email_verifications WHERE token = ?', args: [token] });
}

// ---- Messages ----
async function getMessages(groupId, limit = 50) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
    args: [groupId, limit]
  });
  return res.rows.map(r => ({
    id: r.id, groupId: r.group_id, userId: r.user_id,
    senderName: r.sender_name, text: r.text || '', image: r.image || null, createdAt: r.created_at
  })).reverse();
}

async function createMessage(msg) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT INTO messages (id, group_id, user_id, sender_name, text, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [msg.id, msg.groupId, msg.userId, msg.senderName, msg.text || '', msg.image || null, msg.createdAt]
  });
  return msg;
}

async function getLastMessage(groupId) {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1',
    args: [groupId]
  });
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return { id: r.id, groupId: r.group_id, userId: r.user_id, senderName: r.sender_name, text: r.text || '', image: r.image || null, createdAt: r.created_at };
}

// ---- Actualités ----
async function getActualities() {
  const db = getClient();
  const res = await db.execute('SELECT * FROM actualities ORDER BY created_at DESC LIMIT 50');
  return res.rows.map(r => ({
    id: r.id, tag: r.tag, title: r.title || '', text: r.text || '',
    image: r.image || null, createdAt: r.created_at
  }));
}

async function createActuality(a) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT INTO actualities (id, tag, title, text, image, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [a.id, a.tag, a.title || '', a.text || '', a.image || null, a.createdAt]
  });
  return a;
}

async function deleteActuality(id) {
  const db = getClient();
  await db.execute({ sql: 'DELETE FROM actualities WHERE id = ?', args: [id] });
}

// ---- Typing ----
async function setTyping(userId, groupId, userName) {
  const db = getClient();
  await db.execute({
    sql: 'INSERT OR REPLACE INTO typing (user_id, group_id, user_name, updated_at) VALUES (?, ?, ?, ?)',
    args: [userId, groupId, userName, Date.now()]
  });
}

async function getTyping(groupId, excludeUserId) {
  const db = getClient();
  const cutoff = Date.now() - 4000;
  const res = await db.execute({
    sql: 'SELECT user_name FROM typing WHERE group_id = ? AND user_id != ? AND updated_at > ?',
    args: [groupId, excludeUserId, cutoff]
  });
  return res.rows.map(r => r.user_name);
}

async function updateMembershipDetails(userId, membershipMessage) {
  // Met à jour uniquement le détail JSON, sans toucher au statut d'adhésion
  for (const [token, entry] of SESSION_CACHE.entries()) {
    if (entry.user && entry.user.id === userId) SESSION_CACHE.delete(token);
  }
  const db = getClient();
  await db.execute({ sql: 'UPDATE users SET membership_message = ? WHERE id = ?', args: [membershipMessage, userId] });
}

async function updateProfilePhoto(userId, photoData) {
  // Invalider cache session
  for (const [token, entry] of SESSION_CACHE.entries()) {
    if (entry.user && entry.user.id === userId) SESSION_CACHE.delete(token);
  }
  const db = getClient();
  await db.execute({ sql: 'UPDATE users SET profile_photo = ? WHERE id = ?', args: [photoData, userId] });
}

module.exports = {
  init,
  getUserByEmail, getUserById, getAllUsers, createUser, updateProfilePhoto, updateMembershipDetails,
  updateUserMembership, markEmailVerified,
  getSession, getSessionWithUser, createSession, deleteSession,
  createEmailVerification, getEmailVerification, deleteEmailVerification,
  getMessages, createMessage, getLastMessage,
  getActualities, createActuality, deleteActuality,
  setTyping, getTyping
};
