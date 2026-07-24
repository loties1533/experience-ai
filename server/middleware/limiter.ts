import rateLimit from 'express-rate-limit';

// Limiteur pour les générations lourdes (Claude + Tavily)
// 10 requêtes par heure pour éviter de vider le compte
export const aiGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10,
  message: {
    error: 'Trop de générations en peu de temps. Reposez-vous un peu (limite : 10/heure).',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiteur pour le chat et l'analyse
export const aiChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 messages par 15 minutes
  message: {
    error: "Calme-toi sur le chat ! Réessaye dans 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiteur des routes de partage, ouvertes SANS authentification (ADR-0008).
// Un jeton de 256 bits ne se devine pas, mais une route publique se balaie :
// on plafonne à 60 requêtes par quart d'heure et par IP, ce qui laisse
// largement de quoi consulter un parcours et réagir sur ses éléments.
export const partageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    error: 'Trop de requêtes sur ce lien. Réessayez dans quelques minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiteur dédié à l'authentification (connexion + inscription).
// Protège contre le bourrage d'identifiants (credential stuffing) et le spam
// de comptes : 10 tentatives max par fenêtre de 15 min et par IP.
// Une attaque par force brute a besoin de milliers d'essais → bloquée ici,
// alors qu'un utilisateur légitime dépasse rarement 10 essais en 15 minutes.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    error: 'Trop de tentatives de connexion. Réessaye dans 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
