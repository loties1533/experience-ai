// Types partagés côté serveur.
//
// Le modèle de domaine vit dans server/domaine/ (Parcours, préférences) : ce
// fichier ne garde que le strict nécessaire aux couches techniques —
// l'authentification et les connecteurs de données externes. Tout ce qui
// décrivait l'ancien Pack (voyage, hôtels, itinéraire, score, budget) est parti
// avec lui au sprint R6b.

// Payload du token JWT (ce qui est dans req.user)
export interface JwtPayload {
  id: string;
  email: string;
  name?: string;
  iat?: number;
  exp?: number;
}

// Événement réel renvoyé par un connecteur événementiel (PredictHQ).
export interface EventSearchResult {
  id: string;
  title: string;
  category: string;
  start: string;
  venue: string;
  description: string;
}

// Liens de recherche d'hébergement construits par smartSearch.
export interface HotelLinks {
  booking: string;
  google: string;
}
