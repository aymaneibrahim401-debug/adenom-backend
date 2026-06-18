// api/verify-email.js — GET /api/verify-email?token=...
// Traite le clic sur le lien de confirmation reçu par email.
// Connecte automatiquement l'utilisateur et le redirige vers le site.

const db = require('../lib/db');
const { generateToken } = require('../lib/auth');
const { handlePreflight, setSessionCookie, SESSION_DURATION_MS } = require('../lib/http');

function renderPage({ title, message, success, redirect }) {
  const color = success ? '#1b4332' : '#b3261e';
  const redirectScript = redirect
    ? `<script>setTimeout(function(){ window.location.href = '/'; }, 1500);</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ADENOM</title>
  ${redirectScript}
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
    ${!redirect ? '<p><a href="/">Retour à l\'accueil</a></p>' : ''}
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
        message: "Ce lien de confirmation est invalide ou a déjà été utilisé. <a href='/'>Retournez à l'accueil</a> pour vous connecter.",
        success: false
      }));
    }

    if (Date.now() > verification.expiresAt) {
      await db.deleteEmailVerification(token);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(renderPage({
        title: 'Lien expiré',
        message: "Ce lien de confirmation a expiré (valable 24h). <a href='/'>Retournez à l'accueil</a> et connectez-vous pour en recevoir un nouveau.",
        success: false
      }));
    }

    // Marquer l'email comme vérifié
    await db.markEmailVerified(verification.userId);
    await db.deleteEmailVerification(token);

    // Créer une session pour connecter automatiquement l'utilisateur
    const sessionToken = generateToken();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    await db.createSession({ token: sessionToken, userId: verification.userId, createdAt: now, expiresAt });
    setSessionCookie(res, sessionToken, SESSION_DURATION_MS);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPage({
      title: 'Email confirmé ✅',
      message: 'Votre adresse e-mail a bien été confirmée. Vous allez être redirigé vers le site...',
      success: true,
      redirect: true
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
