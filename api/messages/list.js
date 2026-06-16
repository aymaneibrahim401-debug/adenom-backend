// api/messages/list.js — GET /api/messages/list?group=promo_2023
const db = require('../../lib/db');
const { handlePreflight, getCurrentUser } = require('../../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    await db.init();
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (user.accountStatus !== 'member') return res.status(403).json({ error: 'Accès réservé aux membres.' });

    const groupId = req.query.group;
    if (!groupId) return res.status(400).json({ error: 'group requis.' });

    // Vérifier que l'utilisateur appartient à ce groupe
    if (!canAccessGroup(groupId, user)) {
      return res.status(403).json({ error: 'Accès refusé à ce groupe.' });
    }

    const messages = await db.getMessages(groupId, 80);
    return res.status(200).json({ messages });
  } catch (err) {
    console.error('Erreur /api/messages/list:', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
};

function getUserPromo(user) {
  try { const d = JSON.parse(user.membershipMessage || '{}'); return d.promotion ? String(d.promotion).trim() : null; } catch(e) { return null; }
}
function getUserPoste(user) {
  try { const d = JSON.parse(user.membershipMessage || '{}'); return d.poste || null; } catch(e) { return null; }
}
function canAccessGroup(groupId, user) {
  const userPromo = getUserPromo(user);
  const userPoste = getUserPoste(user);
  if (groupId === 'general') return true;
  if (groupId === 'bureau') return userPoste === 'bureau';
  if (groupId.startsWith('promo_') && userPromo) return groupId === 'promo_' + userPromo;
  return false;
}
