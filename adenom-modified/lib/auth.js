// auth.js — Fonctions de sécurité : hashage de mot de passe (PBKDF2)
// et génération/validation de tokens de session, sans dépendances externes.

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

/**
 * Hash un mot de passe avec PBKDF2 + sel aléatoire.
 * Retourne une chaîne au format "salt:hash" (hex).
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Vérifie un mot de passe en clair contre un hash stocké "salt:hash".
 */
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, originalHash] = stored.split(':');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  // Comparaison en temps constant
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Génère un token de session aléatoire et sécurisé.
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Génère un identifiant unique (pour les utilisateurs).
 */
function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  generateId
};
