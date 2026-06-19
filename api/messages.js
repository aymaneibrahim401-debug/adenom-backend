// api/messages.js — GET/POST /api/messages
// Version optimisée : poll combiné messages+typing en 1 requête, body parsing unifié.

const db = require('../lib/db');
const { handlePreflight, getCurrentUser, getBody, checkAdminCode } = require('../lib/http');
const { randomUUID } = require('crypto');

const GENERAL_GROUPS = [
  { id: 'general', name: '🏠 Général', desc: 'Discussion générale pour tous les membres', color: '#0070ba', bg: '#e3f0ff' },
];
const BUREAU_GROUP = { id: 'bureau', name: '🏅 Bureau ADENOM', desc: 'Groupe privé — Membres de bureau uniquement', color: '#7b2fff', bg: '#f0e8ff', isBureau: true };

function getUserPromo(user) {
  try { const d = JSON.parse(user.membershipMessage || '{}'); return d.promotion ? String(d.promotion).trim() : null; } catch { return null; }
}
function getUserPoste(user) {
  try { const d = JSON.parse(user.membershipMessage || '{}'); return d.poste || null; } catch { return null; }
}
function canAccessGroup(groupId, user) {
  const userPromo = getUserPromo(user);
  const userPoste = getUserPoste(user);
  if (groupId === 'general') return true;
  if (groupId === 'bureau') return userPoste === 'bureau';
  if (groupId.startsWith('promo_') && userPromo) return groupId === 'promo_' + userPromo;
  return false;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  try {
    await db.init();
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (user.accountStatus !== 'member') return res.status(403).json({ error: 'Accès réservé aux membres.' });

    const action = req.query && req.query.action;
    // Parser le body une seule fois
    const body = (req.method === 'POST') ? await getBody(req) : {};

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

      // Toutes les requêtes getLastMessage en parallèle
      const lastMsgs = await Promise.all(groups.map(g => db.getLastMessage(g.id)));
      const groupsWithPreview = groups.map((g, i) => {
        const last = lastMsgs[i];
        return { ...g, lastMessage: last ? { userId: last.userId, senderName: last.senderName, text: last.text, createdAt: last.createdAt } : null };
      });
      return res.status(200).json({ groups: groupsWithPreview });
    }

    // ---- POLL COMBINÉ messages + typing + photos en 1 aller-retour ----
    if (action === 'poll' && req.method === 'GET') {
      const groupId = req.query.group;
      if (!groupId || !canAccessGroup(groupId, user)) return res.status(403).json({ error: 'Accès refusé.' });
      const [messages, typing] = await Promise.all([
        db.getMessages(groupId, 80),
        db.getTyping(groupId, user.id)
      ]);
      // Récupérer les photos des membres présents dans les messages
      const userIds = [...new Set(messages.map(m => m.userId))];
      const members = await Promise.all(userIds.map(id => db.getUserById(id)));
      const photos = {};
      for (const u of members) {
        if (u) photos[u.id] = u.profilePhoto || null;
      }
      return res.status(200).json({ messages, typing, photos });
    }

    // ---- SEND ----
    if (action === 'send' && req.method === 'POST') {
      const groupId = body.groupId;
      const text = (body.text || '').trim().slice(0, 2000);
      const image = body.image || null;
      if (!groupId || (!text && !image)) return res.status(400).json({ error: 'groupId et text ou image requis.' });
      // En base64, 4 chars = 3 octets → taille réelle ≈ length * 0.75
      if (image && image.length * 0.75 > 1.2 * 1024 * 1024) return res.status(400).json({ error: 'Image trop lourde (max ~1MB compressée).' });
      if (!canAccessGroup(groupId, user)) return res.status(403).json({ error: 'Accès refusé.' });

      const msg = {
        id: randomUUID(), groupId,
        userId: user.id,
        senderName: `${user.firstName} ${user.lastName}`.trim(),
        text, image: image || null, createdAt: new Date().toISOString()
      };
      await db.createMessage(msg);
      return res.status(200).json({ message: msg });
    }

    // ---- TYPING ----
    if (action === 'typing' && req.method === 'POST') {
      const groupId = body.groupId;
      if (!groupId || !canAccessGroup(groupId, user)) return res.status(403).json({ error: 'Accès refusé.' });
      await db.setTyping(user.id, groupId, `${user.firstName} ${user.lastName}`.trim());
      return res.status(200).json({ ok: true });
    }

    // ---- ACTUALITIES LIST ----
    if (action === 'actu-list' && req.method === 'GET') {
      const actualities = await db.getActualities();
      return res.status(200).json({ actualities });
    }

    // ---- ACTU POST (admin only) ----
    if (action === 'actu-post' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      const a = {
        id: randomUUID(),
        tag: body.tag || 'info',
        title: (body.title || '').slice(0, 200),
        text: (body.text || '').slice(0, 5000),
        image: body.image || null,
        createdAt: new Date().toISOString()
      };
      await db.createActuality(a);
      return res.status(200).json({ actuality: a });
    }

    // ---- ACTU DELETE (admin only) ----
    if (action === 'actu-delete' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      await db.deleteActuality(body.id);
      return res.status(200).json({ ok: true });
    }

    // ---- MEMBERS LIST (accessible à tout membre connecté) ----
    if (action === 'members' && req.method === 'GET') {
      const allUsers = await db.getAllUsers();
      const members = allUsers
        .filter(u => u.accountStatus === 'member')
        .map(u => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          profilePhoto: u.profilePhoto || null,
          membershipMessage: u.membershipMessage || ''
        }));
      return res.status(200).json({ members });
    }

    // ---- VOLA LIST ----
    if (action === 'vola-list' && req.method === 'GET') {
      const transactions = await db.getVolaTransactions();
      // Calcul solde = entrées - dépenses
      const solde = transactions.reduce((acc, t) => {
        return t.type === 'entree' ? acc + t.montant : acc - t.montant;
      }, 0);
      return res.status(200).json({ transactions, solde });
    }

    // ---- VOLA ADD (admin only) ----
    if (action === 'vola-add' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      const t = {
        id: randomUUID(),
        montant: parseFloat(body.montant) || 0,
        type: body.type === 'entree' ? 'entree' : 'depense',
        description: (body.description || '').slice(0, 500),
        faitPar: (body.faitPar || '').slice(0, 200),
        createdAt: body.createdAt || new Date().toISOString()
      };
      if (!t.montant || !t.description) return res.status(400).json({ error: 'Montant et description requis.' });
      await db.createVolaTransaction(t);
      return res.status(200).json({ transaction: t });
    }

    // ---- VOLA DELETE (admin only) ----
    if (action === 'vola-delete' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      await db.deleteVolaTransaction(body.id);
      return res.status(200).json({ ok: true });
    }

    // ---- MATERIELS LIST ----
    if (action === 'materiel-list' && req.method === 'GET') {
      const materiels = await db.getMateriels();
      return res.status(200).json({ materiels });
    }

    // ---- MATERIEL ADD (admin only) ----
    if (action === 'materiel-add' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      const m = {
        id: randomUUID(),
        nom: (body.nom || '').slice(0, 200),
        quantite: parseInt(body.quantite) || 1,
        etat: ['bon', 'moyen', 'mauvais'].includes(body.etat) ? body.etat : 'bon',
        description: (body.description || '').slice(0, 500),
        createdAt: new Date().toISOString()
      };
      if (!m.nom) return res.status(400).json({ error: 'Nom requis.' });
      await db.createMateriel(m);
      return res.status(200).json({ materiel: m });
    }

    // ---- MATERIEL UPDATE (admin only) ----
    if (action === 'materiel-update' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      const m = {
        id: body.id,
        nom: (body.nom || '').slice(0, 200),
        quantite: parseInt(body.quantite) || 1,
        etat: ['bon', 'moyen', 'mauvais'].includes(body.etat) ? body.etat : 'bon',
        description: (body.description || '').slice(0, 500)
      };
      if (!m.id || !m.nom) return res.status(400).json({ error: 'ID et nom requis.' });
      await db.updateMateriel(m);
      return res.status(200).json({ materiel: m });
    }

    // ---- MATERIEL DELETE (admin only) ----
    if (action === 'materiel-delete' && req.method === 'POST') {
      if (!checkAdminCode(req, body)) return res.status(403).json({ error: 'Code admin invalide.' });
      await db.deleteMateriel(body.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue.' });

  } catch (err) {
    console.error('Erreur /api/messages:', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
};
