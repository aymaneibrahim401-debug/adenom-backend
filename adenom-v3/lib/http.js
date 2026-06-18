// lib/http.js — Utilitaires partagés (cookies, CORS, session, validation).
// Version optimisée : utilise getSessionWithUser() pour 1 seul aller-retour DB.

const db = require('./db');

const SESSION_COOKIE = 'adenom_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// ---- CORS ----
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Code');
}

function handlePreflight(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// ---- Cookies ----
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(pair => {
      const idx = pair.indexOf('=');
      if (idx === -1) return [];
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    }).filter(p => p.length === 2)
  );
}

function setSessionCookie(res, token, maxAgeMs) {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax; Secure`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`);
}

// ---- Validation ----
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ---- Body parsing ----
async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ---- Session courante (1 seul aller-retour DB grâce au JOIN + cache) ----
async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return { user: null, token: null };

  const { session, user } = await db.getSessionWithUser(token);
  if (!session || !user) return { user: null, token: null };

  if (Date.now() > session.expiresAt) {
    await db.deleteSession(token);
    return { user: null, token: null };
  }

  return { user, token };
}

// ---- Code administrateur ----
function checkAdminCode(req, body) {
  const ADMIN_CODE = process.env.ADMIN_CODE || 'adenom-admin-2026';
  const provided = (req.headers && req.headers['x-admin-code'])
    || (req.query && req.query.code)
    || (body && body.code);
  return provided === ADMIN_CODE;
}

module.exports = {
  SESSION_DURATION_MS,
  applyCors,
  handlePreflight,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  normalizeEmail,
  isValidEmail,
  sanitizeUser,
  getBody,
  getCurrentUser,
  checkAdminCode
};
