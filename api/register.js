// api/register.js — POST /api/register
// Crée un compte et connecte automatiquement l'utilisateur.

const db = require('../lib/db');
const { hashPassword, generateToken, generateId } = require('../lib/auth');
const { sendVerificationEmail } = require('../lib/email');
const {
  handlePreflight,
  normalizeEmail,
  isValidEmail,
  getBody,
} = require('../lib/http');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    await db.init();

    const body = await getBody(req);

    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const birthDate = body.birthDate ? String(body.birthDate).trim() : null;
    const gender = body.gender ? String(body.gender).trim() : null;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'Le prénom et le nom sont requis.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    const now = new Date().toISOString();
    const user = {
      id: generateId(),
      firstName,
      lastName,
      email,
      birthDate,
      gender,
      passwordHash: hashPassword(password),
      accountStatus: 'active',
      membershipRequested: false,
      membershipApproved: false,
      createdAt: now
    };

    await db.createUser(user);

    // Envoi de l'email de confirmation
    try {
      const verifyToken = generateToken();
      const verifyExpiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
      await db.createEmailVerification({
        token: verifyToken,
        userId: user.id,
        createdAt: now,
        expiresAt: verifyExpiresAt
      });
      await sendVerificationEmail({ to: user.email, firstName: user.firstName, token: verifyToken });
    } catch (emailErr) {
      console.error("Échec de l'envoi de l'email de vérification:", emailErr);
    }

    // Pas de session créée : le compte s'ouvre seulement après confirmation email
    return res.status(201).json({ emailSent: true });
  } catch (err) {
    console.error('Erreur /api/register:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};
