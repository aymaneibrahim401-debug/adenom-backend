// api/me.js — GET /api/me
// Renvoie l'utilisateur connecté (ou null).

const db = require('../lib/db');
const { handlePreflight, getCurrentUser, sanitizeUser } = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const { user } = await getCurrentUser(req);
    if (!user) {
      return res.status(200).json({ user: null });
    }
    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur /api/me:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
