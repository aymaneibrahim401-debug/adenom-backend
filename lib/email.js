// lib/email.js — Envoi d'emails via l'API Resend (https://resend.com).
//
// Variables d'environnement requises (à définir sur Vercel) :
//   RESEND_API_KEY    -> clé API Resend
//   RESEND_FROM_EMAIL -> adresse d'expédition (doit appartenir à un domaine
//                        vérifié sur Resend), ex: "ADENOM <noreply@adenom.org>"
//   SITE_URL          -> URL publique du site, ex: "https://adenom.vercel.app"
//                        (utilisée pour construire le lien de vérification)

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    console.warn(
      "RESEND_API_KEY ou RESEND_FROM_EMAIL manquant : email non envoyé (" + subject + " -> " + to + ")"
    );
    return { skipped: true };
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ from, to, subject, html })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Échec de l'envoi de l'email (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Envoie l'email de confirmation d'inscription avec le lien de vérification
async function sendVerificationEmail({ to, firstName, token }) {
  const siteUrl = process.env.SITE_URL || '';
  const verifyUrl = `${siteUrl}/api/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Bienvenue sur ADENOM, ${escapeHtml(firstName)} !</h2>
      <p>Merci de vous être inscrit(e). Veuillez confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous :</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${verifyUrl}" style="background:#1b4332; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; display:inline-block;">
          Confirmer mon adresse e-mail
        </a>
      </p>
      <p>Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
      <p style="word-break:break-all; color:#555;">${verifyUrl}</p>
      <p style="color:#888; font-size:12px; margin-top:32px;">Ce lien est valable 24 heures. Si vous n'avez pas créé de compte ADENOM, vous pouvez ignorer cet email.</p>
    </div>
  `;

  return sendEmail({ to, subject: 'Confirmez votre adresse e-mail — ADENOM', html });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendEmail, sendVerificationEmail };
