// lib/http.js — Utilitaires partagés par les fonctions serverless
// (cookies, CORS, validation, session courante...).

const db = require('./db');

const SESSION_COOKIE = 'adenom_session';

// Durée de vie d'une session (7 jours)
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------
// CORS — autorise le frontend (même origine ou origine spécifiée)
// ----------------------------------------------------------------------

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Code');
}

// Retourne true si la requête a été traitée (OPTIONS) — l'appelant doit
// alors `return` immédiatement.
function handlePreflight(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// ----------------------------------------------------------------------
// Cookies
// ----------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function setSessionCookie(res, token, maxAgeMs) {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax; Secure`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
  );
}

// ----------------------------------------------------------------------
// Validation / formatage
// ----------------------------------------------------------------------

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Retire les champs sensibles avant d'envoyer un utilisateur au client
function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, cinPhotoRecto, cinPhotoVerso, ...safe } = user;
  return safe;
}

// Récupère le corps JSON de la requête. Sur Vercel, req.body est déjà
// parsé automatiquement quand Content-Type: application/json. On garde
// un repli au cas où ce ne serait pas le cas (sécurité supplémentaire).
async function getBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ----------------------------------------------------------------------
// Session courante
// ----------------------------------------------------------------------

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return { user: null, token: null };

  const session = await db.getSession(token);
  if (!session) return { user: null, token: null };

  if (Date.now() > session.expiresAt) {
    await db.deleteSession(token);
    return { user: null, token: null };
  }

  const user = await db.getUserById(session.userId);
  return { user, token };
}

// ----------------------------------------------------------------------
// Code administrateur
// ----------------------------------------------------------------------

function checkAdminCode(req, body) {
  const ADMIN_CODE = process.env.ADMIN_CODE || 'adenom-admin-2026';
  const headerCode = req.headers['x-admin-code'];
  const queryCode = req.query && req.query.code;
  const bodyCode = body && body.code;
  const provided = headerCode || queryCode || bodyCode;
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
