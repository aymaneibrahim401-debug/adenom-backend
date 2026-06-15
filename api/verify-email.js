// api/verify-email.js — GET /api/verify-email?token=...
// Traite le clic sur le lien de confirmation reçu par email.
// Affiche une page HTML simple de résultat (succès, expiré, invalide).

const db = require('../lib/db');
const { handlePreflight } = require('../lib/http');

function renderPage({ title, message, success }) {
  const color = success ? '#1b4332' : '#b3261e';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ADENOM</title>
  <style>
    body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f5f5f4; }
    .card { background:#fff; padding:40px; border-radius:12px; max-width:420px; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    h1 { color: ${color}; font-size: 22px; margin-bottom: 12px; }
    p { color:#444; line-height:1.5; }
    a { color:#1b4332; font-weight:600; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/">Retour à l'accueil</a></p>
  </div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).send('Méthode non autorisée.');
  }

  try {
    await db.init();

    const token = String((req.query && req.query.token) || '');
    if (!token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(renderPage({
        title: 'Lien invalide',
        message: "Ce lien de confirmation est invalide.",
        success: false
      }));
    }

    const verification = await db.getEmailVerification(token);
    if (!verification) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(renderPage({
        title: 'Lien invalide ou déjà utilisé',
        message: "Ce lien de confirmation est invalide ou a déjà été utilisé.",
        success: false
      }));
    }

    if (Date.now() > verification.expiresAt) {
      await db.deleteEmailVerification(token);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(renderPage({
        title: 'Lien expiré',
        message: "Ce lien de confirmation a expiré. Reconnectez-vous pour en recevoir un nouveau.",
        success: false
      }));
    }

    await db.markEmailVerified(verification.userId);
    await db.deleteEmailVerification(token);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPage({
      title: 'Adresse e-mail confirmée ✅',
      message: 'Merci, votre adresse e-mail a bien été confirmée. Vous pouvez fermer cette page.',
      success: true
    }));
  } catch (err) {
    console.error('Erreur /api/verify-email:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderPage({
      title: 'Erreur',
      message: "Une erreur interne est survenue. Réessayez plus tard.",
      success: false
    }));
  }
};
