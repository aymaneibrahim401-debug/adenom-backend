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

    // POST ?action=profile — modifier école, porte, poste, niveau, promotion (sans changer le statut)
    if (req.method === 'POST' && req.query && req.query.action === 'profile') {
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      const body = await getBody(req);
      let details = {};
      try { details = JSON.parse(user.membershipMessage || '{}'); } catch (_) {}
      details.school     = (body.school || '').slice(0, 200);
      details.field      = (body.field || '').slice(0, 200);
      details.level      = (body.level || '').slice(0, 50);
      details.promotion  = (body.promotion || '').slice(0, 20);
      details.role       = (body.role || '').slice(0, 50);
      // poste n'est PAS modifiable depuis "Mon profil" — uniquement lors de l'adhésion initiale
      details.poste      = details.poste || 'membre';
      details.phone      = (body.phone || '').slice(0, 30);
      // Conserver le CIN et les images CIN déjà stockés
      const updatedMessage = JSON.stringify(details);
      await db.updateMembershipDetails(user.id, updatedMessage);
      const updatedUser = await db.getUserById(user.id);
      return res.status(200).json({ user: sanitizeUser(updatedUser) });
    }

    return res.status(405).json({ error: 'Méthode non autorisée.' });
  } catch (err) {
    console.error('Erreur /api/me:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
