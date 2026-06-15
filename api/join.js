// api/join.js — POST /api/join
// Demande d'adhésion à la communauté : passe le compte en "pending".

const db = require('../lib/db');
const { handlePreflight, getCurrentUser, sanitizeUser, getBody } = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const { user } = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Vous devez être connecté pour rejoindre la communauté.' });
    }

    const body = await getBody(req);

    user.membershipRequested = true;
    user.membershipApproved = false;
    user.accountStatus = 'pending';
    user.membershipMessage = body.message ? String(body.message).slice(0, 500) : (user.membershipMessage || '');
    user.membershipRequestedAt = new Date().toISOString();

    await db.updateUserMembership(user);

    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur /api/join:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
