// lib/email.js — Envoi d'emails via l'API Brevo (https://brevo.com).
//
// Brevo permet d'envoyer jusqu'à 300 emails/jour gratuitement, sans avoir
// besoin de posséder un nom de domaine : il suffit de vérifier une adresse
// email expéditrice (ex: votre Gmail).
//
// Variables d'environnement requises (à définir sur Vercel) :
//   BREVO_API_KEY    -> clé API Brevo (Settings -> SMTP & API -> API Keys)
//   BREVO_FROM_EMAIL -> adresse expéditrice vérifiée dans Brevo
//   BREVO_FROM_NAME  -> nom affiché comme expéditeur (optionnel, ex: "ADENOM")
//   SITE_URL         -> URL publique du site, ex: "https://adenom.vercel.app"

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;
  const fromName = process.env.BREVO_FROM_NAME || 'ADENOM';

  if (!apiKey || !fromEmail) {
    console.warn(
      "BREVO_API_KEY ou BREVO_FROM_EMAIL manquant : email non envoyé (" + subject + " -> " + to + ")"
    );
    return { skipped: true };
  }

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
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
