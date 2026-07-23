/**
 * MOCKS DE SECOURS — TRIPGENIE
 * Données utilisées uniquement quand aucun fournisseur IA n'est disponible
 * (quotas épuisés). Objectif : l'app reste utilisable au lieu de planter.
 */

import type { ResultatOnboarding, Pack } from '../lib/types.js';

export const MOCK_ONBOARDING: ResultatOnboarding & { isMock: boolean } = {
  response:
    "Nos suggestions habituelles sont momentanément indisponibles. En attendant, je peux vous proposer un itinéraire basé sur des préférences classiques. Cela vous tente ?",
  chips: ['Oui, montre-moi', 'Je préfère attendre'],
  extractedData: {
    profile: 'Voyageur',
    budget: 2000,
    duration: 7,
    mode: 'relax',
  },
  isReady: false,
  isMock: true,
};

export interface MockDestination {
  city: string;
  country: string;
  reason: string;
  match_score: number;
}

export const MOCK_DESTINATIONS: { destinations: MockDestination[]; isMock: boolean } = {
  destinations: [
    {
      city: 'Ibiza',
      country: 'Espagne',
      reason: 'Île réputée pour sa vie nocturne et ses criques.',
      match_score: 98,
    },
    {
      city: 'Hvar',
      country: 'Croatie',
      reason: "Île ensoleillée de l'Adriatique, adaptée aux groupes.",
      match_score: 92,
    },
    {
      city: 'Lisbonne',
      country: 'Portugal',
      reason: 'Capitale animée et accessible, bien desservie.',
      match_score: 89,
    },
  ],
  isMock: true,
};

// Pack de secours cohérent (Ibiza de bout en bout), factuel et sans emoji.
export const MOCK_PACK: Partial<Pack> & { isMock: boolean } = {
  destination: 'Ibiza',
  country: 'Espagne',
  tagline: 'Île des Baléares, entre plages et vie nocturne.',
  overview:
    "Ibiza combine plages, criques et sorties, avec des coins plus calmes à l'écart des zones animées.",
  weather: { avg_temp: '26°C', conditions: 'Ensoleillé' },
  summary: { total_budget: '2000€', nights: 5, activities_count: 3 },
  activities: [
    { name: 'Cala Salada', category: 'Plage', description: 'Crique connue au nord de l\'île.', duration: '4h', price: 'Gratuit', best_time: 'Journée' },
    { name: 'Dalt Vila', category: 'Culture', description: 'Vieille ville fortifiée d\'Ibiza.', duration: '2h', price: 'Gratuit', best_time: 'Matin' },
    { name: 'Café del Mar', category: 'Expérience', description: 'Bar en bord de mer, coucher de soleil.', duration: '2h', price: '20€', best_time: 'Soir' },
  ],
  flights: [
    { from: 'BOD', from_city: 'Bordeaux', to: 'IBZ', to_city: 'Ibiza', departure_time: '10:15', arrival_time: '12:00', duration: '1h45', stops: 'Direct', airline: 'Vueling', price_per_person: '145€', type: 'outbound' },
    { from: 'IBZ', from_city: 'Ibiza', to: 'BOD', to_city: 'Bordeaux', departure_time: '18:30', arrival_time: '20:15', duration: '1h45', stops: 'Direct', airline: 'Vueling', price_per_person: '145€', type: 'return' },
  ],
  hotels: [
    { name: 'Hôtel Montesol', location: 'Ibiza-ville', stars: 4, price_per_night: '180€', highlights: 'Proche du port et de la vieille ville.', match_reason: 'Central, bien situé' },
    { name: 'Hostal La Marina', location: 'Port', stars: 3, price_per_night: '110€', highlights: 'Vue sur le port, bon rapport qualité-prix.', match_reason: 'Économique, proche des sorties' },
  ],
  itinerary: [
    {
      day: 1, title: 'Arrivée et installation', subtitle: 'Premiers pas sur l\'île',
      items: [
        { time: '14:00', type: 'activity', title: 'Installation à l\'hôtel', description: 'Arrivée et découverte du quartier.', price: 'Inclus', duration: '1h' },
        { time: '19:00', type: 'food', title: 'Dîner dans le port', description: 'Restaurant en bord de mer.', price: '40€', duration: '2h' },
      ],
    },
    {
      day: 2, title: 'Criques et baignade', subtitle: 'Eaux turquoise',
      items: [
        { time: '10:00', type: 'activity', title: 'Cala Salada', description: 'Baignade dans une crique au nord de l\'île.', price: 'Gratuit', duration: '4h' },
        { time: '22:00', type: 'event', title: 'Sortie en ville', description: 'Première soirée dans le centre.', price: '30€', duration: 'Soirée' },
      ],
    },
  ],
  events: [],
  budget_breakdown: { vols: '580€', hebergement: '900€', activites: '300€', restauration: '150€', transports: '50€', divers: '20€', total: '2000€' },
  tips: [],
  isMock: true,
};
