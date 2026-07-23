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

// Orientation d'une recherche externe : elle oriente les requêtes envoyées aux
// connecteurs (une soirée ne se cherche pas comme une après-midi tranquille).
export type TravelMode = 'party' | 'student' | 'group' | 'relax' | 'surprise';

// Lieu renvoyé par un connecteur de données (Foursquare, Yelp).
export interface Activite {
  name: string;
  category: string;
  description: string;
  duration: string;
  price: string | number;
  price_range?: string;
  best_time?: string;
  booking_url?: string;  // lien carte (Google Maps) — localisation du lieu
  reservation_url?: string | null;
}

// Liens de recherche d'hébergement construits par smartSearch.
export interface HotelLinks {
  booking: string;
  google: string;
}
