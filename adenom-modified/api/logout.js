// api/logout.js — POST /api/logout
// Supprime la session courante.

const db = require('../lib/db');
const {
  handlePreflight,
  parseCookies,
  clearSessionCookie
} = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const cookies = parseCookies(req);
    const token = cookies.adenom_session;
    if (token) {
      await db.deleteSession(token);
    }
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erreur /api/logout:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
