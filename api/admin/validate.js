// api/admin/validate.js — POST /api/admin/validate
// Valide (ou rejette) une demande d'adhésion en attente.

const db = require('../../lib/db');
const { handlePreflight, checkAdminCode, sanitizeUser, getBody } = require('../../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const body = await getBody(req);

    if (!checkAdminCode(req, body)) {
      return res.status(403).json({ error: 'Code administrateur invalide.' });
    }

    const userId = String(body.userId || '');
    const approve = body.approve !== false; // par défaut true

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (approve) {
      user.membershipApproved = true;
      user.accountStatus = 'member';
    } else {
      user.membershipApproved = false;
      user.membershipRequested = false;
      user.accountStatus = 'active';
    }
    user.membershipValidatedAt = new Date().toISOString();

    await db.updateUserMembership(user);

    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur /api/admin/validate:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
