import { z } from 'zod';
import {
  LienRechercheHebergementSchema,
  OccupationHebergementDeclareeSchema,
  SejourHebergementSchema,
  type LienRechercheHebergement,
  type OccupationHebergementDeclaree,
  type SejourHebergement,
} from '../domaine/parcours/index.js';

// ?? '' évite undefined si str est null/undefined
export function encoderURL(str: string): string {
  return encodeURIComponent(str?.trim() ?? '');
}

// Lien « Carte » (localisation Google Maps). Les liens de site officiel /
// billetterie, eux, relèvent du résolveur unique services/liens.ts.
export function lienGoogleMaps(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encoderURL(name + ' ' + city)}`;
}

export interface DemandeRechercheHotel {
  sejour: SejourHebergement;
  occupation: OccupationHebergementDeclaree;
  /** Uniquement l’identité réelle Foursquare, jamais un nom produit par le LLM. */
  nomHotel?: string;
}

export const DemandeRechercheHotelSchema = z
  .object({
    sejour: SejourHebergementSchema,
    occupation: OccupationHebergementDeclareeSchema,
    nomHotel: z.string().trim().min(1).optional(),
  })
  .strict();

const URL_RECHERCHE_BOOKING =
  'https://www.booking.com/searchresults.html';
const LIBELLE_RECHERCHE_BOOKING =
  'Rechercher des hébergements sur Booking' as const;

function normaliserTermeRecherche(valeur: string): string {
  return valeur
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function termeRechercheHotel(demande: DemandeRechercheHotel): string {
  const { ville } = demande.sejour;
  if (!demande.nomHotel) return ville;
  return normaliserTermeRecherche(demande.nomHotel).includes(
    normaliserTermeRecherche(ville)
  )
    ? demande.nomHotel
    : `${demande.nomHotel} ${ville}`;
}

/**
 * Construit uniquement une recherche Booking préremplie. Aucun appel réseau,
 * disponibilité, prix, réservation ou âge d’enfant n’est produit. Booking
 * pourra demander les âges lorsque `group_children` est supérieur à zéro :
 * F3-C2 ne les invente pas.
 */
export function construireUrlRechercheHotel(
  demandeBrute: DemandeRechercheHotel
): string {
  const demande = DemandeRechercheHotelSchema.parse(demandeBrute);
  const url = new URL(URL_RECHERCHE_BOOKING);
  const params = url.searchParams;
  params.set('ss', termeRechercheHotel(demande));
  params.set('checkin', demande.sejour.arrivee);
  params.set('checkout', demande.sejour.depart);
  params.set('group_adults', String(demande.occupation.adultes));
  params.set('group_children', String(demande.occupation.enfants));
  params.set('no_rooms', String(demande.occupation.chambres));
  return url.toString();
}

export function creerLienRechercheHebergement(
  demande: DemandeRechercheHotel,
  genereLe = new Date().toISOString()
): LienRechercheHebergement {
  return LienRechercheHebergementSchema.parse({
    type: 'recherche',
    fournisseur: 'Booking',
    url: construireUrlRechercheHotel(demande),
    libelle: LIBELLE_RECHERCHE_BOOKING,
    genereLe,
  });
}
