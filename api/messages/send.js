// api/messages/send.js — POST /api/messages/send
const db = require('../../lib/db');
const { handlePreflight, getCurrentUser } = require('../../lib/http');
const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    await db.init();
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (user.accountStatus !== 'member') return res.status(403).json({ error: 'Accès réservé aux membres.' });

    const body = req.body || {};
    const groupId = body.groupId;
    const text = (body.text || '').trim().slice(0, 2000);
    if (!groupId || !text) return res.status(400).json({ error: 'groupId et text requis.' });

    // Vérifier accès au groupe
    if (!canAccessGroup(groupId, user)) {
      return res.status(403).json({ error: 'Accès refusé à ce groupe.' });
    }

    const msg = {
      id: randomUUID(),
      groupId,
      userId: user.id,
      senderName: `${user.firstName} ${user.lastName}`.trim(),
      text,
      createdAt: new Date().toISOString()
    };
    await db.createMessage(msg);
    return res.status(200).json({ message: msg });
  } catch (err) {
    console.error('Erreur /api/messages/send:', err);
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
