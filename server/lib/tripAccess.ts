// TRIPGENIE — server/lib/tripAccess.ts
// Autorisation d'accès à un voyage. Trois niveaux de droits :
//   • propriétaire (trip.user_id) : accès complet (lire + modifier + supprimer) ;
//   • collaborateur « editor »    : peut lire ET modifier le voyage (pas le supprimer) ;
//   • collaborateur « viewer »    : lecture seule.
// La suppression du voyage reste réservée au propriétaire (voir routes/trips.ts).

import prisma from '../db/prisma.js';

export type NiveauAcces = 'owner' | 'editor' | 'viewer' | 'forbidden' | 'not_found';
export type AccesEdition = 'owner' | 'editor' | 'forbidden' | 'not_found';

/**
 * Détermine le niveau d'accès de `userId` sur le voyage `tripId`.
 * Distingue « voyage inexistant » (→ 404) de « connu mais sans droit » (→ 403).
 * Source unique de vérité pour les autorisations : lecture comme édition en dérivent.
 */
async function niveauAcces(userId: string, tripId: string): Promise<NiveauAcces> {
  const voyage = await prisma.trip.findUnique({
    where:  { id: tripId },
    select: { user_id: true },
  });
  if (!voyage) return 'not_found';
  if (voyage.user_id === userId) return 'owner';

  const collaboration = await prisma.tripCollaborator.findUnique({
    where:  { trip_id_user_id: { trip_id: tripId, user_id: userId } },
    select: { role: true },
  });
  if (collaboration?.role === 'editor') return 'editor';
  if (collaboration?.role === 'viewer') return 'viewer';
  return 'forbidden';
}

/**
 * Évalue le droit de MODIFIER le voyage. Un « viewer » n'a pas ce droit :
 * il est ramené à « forbidden » (403).
 */
export async function evaluerAccesEdition(userId: string, tripId: string): Promise<AccesEdition> {
  const acces = await niveauAcces(userId, tripId);
  return acces === 'viewer' ? 'forbidden' : acces;
}

/** Raccourci booléen : le voyage existe et l'utilisateur a le droit de le modifier. */
export async function peutEditerVoyage(userId: string, tripId: string): Promise<boolean> {
  const acces = await evaluerAccesEdition(userId, tripId);
  return acces === 'owner' || acces === 'editor';
}

/**
 * Raccourci booléen : l'utilisateur a le droit de LIRE le voyage.
 * Propriétaire, editor et viewer sont autorisés ; tout autre cas est refusé
 * (la route renverra un 404 pour ne pas révéler l'existence du voyage).
 */
export async function peutLireVoyage(userId: string, tripId: string): Promise<boolean> {
  const acces = await niveauAcces(userId, tripId);
  return acces === 'owner' || acces === 'editor' || acces === 'viewer';
}
