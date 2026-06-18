// api/messages/groups.js — GET /api/messages/groups
// Retourne les groupes accessibles pour l'utilisateur connecté
const db = require('../../lib/db');
const { handlePreflight, getCurrentUser } = require('../../lib/http');

const GENERAL_GROUPS = [
  { id: 'general', name: '🏠 Général', desc: 'Discussion générale pour tous les membres', color: '#0070ba', bg: '#e3f0ff' },
];

const BUREAU_GROUP = { id: 'bureau', name: '🏅 Bureau ADENOM', desc: 'Groupe privé — Membres de bureau uniquement', color: '#7b2fff', bg: '#f0e8ff', isBureau: true };

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    await db.init();
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (user.accountStatus !== 'member') return res.status(403).json({ error: 'Accès réservé aux membres.' });

    const groups = [...GENERAL_GROUPS];

    // Ajouter le groupe bureau si membre de bureau
    const userPoste = getUserPoste(user);
    if (userPoste === 'bureau') {
      groups.unshift({ ...BUREAU_GROUP });
    }

    // Ajouter le groupe promo de l'utilisateur
    const userPromo = getUserPromo(user);
    if (userPromo) {
      groups.splice(userPoste === 'bureau' ? 1 : 0, 0, {
        id: 'promo_' + userPromo,
        name: `🎓 Promo ${userPromo}`,
        desc: `Groupe privé — Promotion ${userPromo} uniquement`,
        color: '#003087',
        bg: '#e8f0fe',
        isPromo: true
      });
    }

    // Récupérer le dernier message de chaque groupe
    const groupsWithPreview = await Promise.all(groups.map(async g => {
      const last = await db.getLastMessage(g.id);
      return {
        ...g,
        lastMessage: last ? { senderName: last.senderName, text: last.text, createdAt: last.createdAt } : null
      };
    }));

    return res.status(200).json({ groups: groupsWithPreview });
  } catch (err) {
    console.error('Erreur /api/messages/groups:', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
};

function getUserPromo(user) {
  try {
    const d = JSON.parse(user.membershipMessage || '{}');
    return d.promotion ? String(d.promotion).trim() : null;
  } catch(e) { return null; }
}

function getUserPoste(user) {
  try {
    const d = JSON.parse(user.membershipMessage || '{}');
    return d.poste || null;
  } catch(e) { return null; }
}
