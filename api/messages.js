// api/messages.js — GET/POST /api/messages
// action=groups : liste des groupes
// action=list&group=xxx : messages d'un groupe
// action=send (POST) : envoyer un message

const db = require('../lib/db');
const { handlePreflight, getCurrentUser } = require('../lib/http');
const { randomUUID } = require('crypto');

const GENERAL_GROUPS = [
  { id: 'general', name: '🏠 Général', desc: 'Discussion générale pour tous les membres', color: '#0070ba', bg: '#e3f0ff' },
];
const BUREAU_GROUP = { id: 'bureau', name: '🏅 Bureau ADENOM', desc: 'Groupe privé — Membres de bureau uniquement', color: '#7b2fff', bg: '#f0e8ff', isBureau: true };

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  try {
    await db.init();
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (user.accountStatus !== 'member') return res.status(403).json({ error: 'Accès réservé aux membres.' });

    const action = req.query.action;

    // ---- GROUPS ----
    if (action === 'groups' && req.method === 'GET') {
      const groups = [...GENERAL_GROUPS];
      const userPoste = getUserPoste(user);
      const userPromo = getUserPromo(user);

      if (userPoste === 'bureau') groups.unshift({ ...BUREAU_GROUP });
      if (userPromo) {
        groups.splice(userPoste === 'bureau' ? 1 : 0, 0, {
          id: 'promo_' + userPromo,
          name: `🎓 Promo ${userPromo}`,
          desc: `Groupe privé — Promotion ${userPromo} uniquement`,
          color: '#003087', bg: '#e8f0fe', isPromo: true
        });
      }

      const groupsWithPreview = await Promise.all(groups.map(async g => {
        const last = await db.getLastMessage(g.id);
        return { ...g, lastMessage: last ? { senderName: last.senderName, text: last.text, createdAt: last.createdAt } : null };
      }));

      return res.status(200).json({ groups: groupsWithPreview });
    }

    // ---- LIST ----
    if (action === 'list' && req.method === 'GET') {
      const groupId = req.query.group;
      if (!groupId) return res.status(400).json({ error: 'group requis.' });
      if (!canAccessGroup(groupId, user)) return res.status(403).json({ error: 'Accès refusé.' });
      const messages = await db.getMessages(groupId, 80);
      return res.status(200).json({ messages });
    }

    // ---- SEND ----
    if (action === 'send' && req.method === 'POST') {
      const body = req.body || {};
      const groupId = body.groupId;
      const text = (body.text || '').trim().slice(0, 2000);
      if (!groupId || !text) return res.status(400).json({ error: 'groupId et text requis.' });
      if (!canAccessGroup(groupId, user)) return res.status(403).json({ error: 'Accès refusé.' });

      const msg = {
        id: randomUUID(), groupId,
        userId: user.id,
        senderName: `${user.firstName} ${user.lastName}`.trim(),
        text, createdAt: new Date().toISOString()
      };
      await db.createMessage(msg);
      return res.status(200).json({ message: msg });
    }

    return res.status(400).json({ error: 'Action inconnue.' });

  } catch (err) {
    console.error('Erreur /api/messages:', err);
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
