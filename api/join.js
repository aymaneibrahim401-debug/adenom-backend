// api/join.js — POST /api/join
// Demande d'adhésion à la communauté : passe le compte en "pending".

const db = require('../lib/db');
const { handlePreflight, getCurrentUser, sanitizeUser, getBody } = require('../lib/http');

// Taille max acceptée pour chaque photo base64 (≈ 5 Mo encodés = ~6,8 Mo base64)
const MAX_PHOTO_B64_LEN = 7 * 1024 * 1024;

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

    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Veuillez confirmer votre adresse e-mail avant de rejoindre la communauté. Vérifiez votre boîte de réception (et vos spams).'
      });
    }

    const body = await getBody(req);

    // Validation des photos CIN
    const cinPhotoRecto = body.cinPhotoRecto ? String(body.cinPhotoRecto) : null;
    const cinPhotoVerso = body.cinPhotoVerso ? String(body.cinPhotoVerso) : null;

    if (!cinPhotoRecto || !cinPhotoRecto.startsWith('data:image/')) {
      return res.status(400).json({ error: 'La photo recto du CIN est obligatoire.' });
    }
    if (!cinPhotoVerso || !cinPhotoVerso.startsWith('data:image/')) {
      return res.status(400).json({ error: 'La photo verso du CIN est obligatoire.' });
    }
    if (cinPhotoRecto.length > MAX_PHOTO_B64_LEN || cinPhotoVerso.length > MAX_PHOTO_B64_LEN) {
      return res.status(400).json({ error: 'Une des photos dépasse la taille maximale autorisée (5 Mo).' });
    }

    user.membershipRequested = true;
    user.membershipApproved = false;
    user.accountStatus = 'pending';
    user.membershipMessage = body.message ? String(body.message).slice(0, 500) : (user.membershipMessage || '');
    user.membershipRequestedAt = new Date().toISOString();

    await db.updateUserMembership(user);
    await db.updateCINPhotos(user.id, cinPhotoRecto, cinPhotoVerso);

    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Erreur /api/join:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
