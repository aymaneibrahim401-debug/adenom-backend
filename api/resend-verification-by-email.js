// api/resend-verification-by-email.js — POST /api/resend-verification-by-email
// Renvoie l'email de confirmation à partir de l'adresse email (utilisateur non connecté).

const db = require('../lib/db');
const { sendVerificationEmail } = require('../lib/email');
const { generateToken } = require('../lib/auth');
const { handlePreflight, normalizeEmail, isValidEmail, getBody } = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const body = await getBody(req);
    const email = normalizeEmail(body.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }

    const user = await db.getUserByEmail(email);

    // On répond toujours OK pour ne pas révéler si l'email existe ou non
    if (!user || user.emailVerified) {
      return res.status(200).json({ ok: true });
    }

    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
    await db.createEmailVerification({ token, userId: user.id, createdAt: now, expiresAt });
    await sendVerificationEmail({ to: user.email, firstName: user.firstName, token });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erreur /api/resend-verification-by-email:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
