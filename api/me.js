// api/me.js — GET /api/me  |  POST /api/me?action=photo
const db = require('../lib/db');
const { handlePreflight, getCurrentUser, sanitizeUser, getBody } = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  try {
    await db.init();
    const { user } = await getCurrentUser(req);

    // GET — utilisateur courant
    if (req.method === 'GET') {
      if (!user) return res.status(200).json({ user: null });
      return res.status(200).json({ user: sanitizeUser(user) });
    }

    // POST ?action=photo — sauvegarder la photo de profil en DB
    if (req.method === 'POST' && req.query && req.query.action === 'photo') {
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      const body = await getBody(req);
      const photo = body.photo || null;
      // Limiter à ~500KB en base64
      if (photo && photo.length > 700000) {
        return res.status(400).json({ error: 'Photo trop volumineuse (max 500KB).' });
      }
      await db.updateProfilePhoto(user.id, photo);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée.' });
  } catch (err) {
    console.error('Erreur /api/me:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
