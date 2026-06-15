// api/login.js — POST /api/login
// Vérifie email + mot de passe et crée une session.

const db = require('../lib/db');
const { verifyPassword, generateToken } = require('../lib/auth');
const {
  handlePreflight,
  normalizeEmail,
  isValidEmail,
  sanitizeUser,
  setSessionCookie,
  getBody,
  SESSION_DURATION_MS
} = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const body = await getBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'E-mail ou mot de passe incorrect.' });
    }

    const user = await db.getUserByEmail(email);

    // Message volontairement générique pour ne pas révéler si l'email existe
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }

    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    await db.createSession({ token, userId: user.id, createdAt: now, expiresAt });

    setSessionCookie(res, token, SESSION_DURATION_MS);
    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur /api/login:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
