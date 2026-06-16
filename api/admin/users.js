// api/admin/users.js — GET /api/admin/users
// Liste tous les utilisateurs (protégé par code administrateur).

const db = require('../../lib/db');
const { handlePreflight, checkAdminCode, sanitizeUser } = require('../../lib/http');

// Version admin : inclut les photos CIN (contrairement à sanitizeUser)
function adminUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    if (!checkAdminCode(req)) {
      return res.status(403).json({ error: 'Code administrateur invalide.' });
    }

    const users = await db.getAllUsers();
    return res.status(200).json({ users: users.map(adminUser) });
  } catch (err) {
    console.error('Erreur /api/admin/users:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
