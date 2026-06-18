// api/resend-verification.js — POST /api/resend-verification
// Renvoie l'email de confirmation à l'utilisateur connecté.

const db = require('../lib/db');
const { sendVerificationEmail } = require('../lib/email');
const { handlePreflight, getCurrentUser } = require('../lib/http');
const { generateToken } = require('../lib/auth');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const { user } = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Vous devez être connecté.' });
    }

    if (user.emailVerified) {
      return res.status(200).json({ ok: true, alreadyVerified: true });
    }

    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
    await db.createEmailVerification({ token, userId: user.id, createdAt: now, expiresAt });
    await sendVerificationEmail({ to: user.email, firstName: user.firstName, token });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erreur /api/resend-verification:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
