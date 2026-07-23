// Constantes techniques partagées.
//
// Le vocabulaire métier (modes de voyage, profils, ratios de budget, statuts)
// appartenait au modèle Pack : il est parti avec lui au sprint R6b. Ce que le
// produit sait décrire aujourd'hui vit dans server/domaine/parcours/.

// Nom du cookie httpOnly qui porte le JWT (posé par /api/auth, lu par requireAuth).
export const NOM_COOKIE_AUTH = 'tg_token';
