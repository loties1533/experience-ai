import type { Prisma } from '@prisma/client';
import prisma from '../db/prisma.js';
import {
  PreferencesParcoursSchema,
  type PreferencesParcours,
} from '../domaine/preferences.js';

// Seule porte d'accès à la table preferences_parcours (même principe que
// depotParcours, ADR-0007). Des préférences illisibles ne bloquent jamais
// l'utilisateur : on repart de préférences vides plutôt que d'échouer.

export async function chargerPreferences(userId: string): Promise<PreferencesParcours | null> {
  const ligne = await prisma.preferenceParcours.findUnique({
    where: { user_id: userId },
    select: { contenu: true },
  });
  if (!ligne) return null;

  const resultat = PreferencesParcoursSchema.safeParse(ligne.contenu);
  return resultat.success ? resultat.data : null;
}

export async function sauvegarderPreferences(
  userId: string,
  preferences: PreferencesParcours
): Promise<PreferencesParcours> {
  const contenu = PreferencesParcoursSchema.parse(preferences);
  await prisma.preferenceParcours.upsert({
    where: { user_id: userId },
    create: { user_id: userId, contenu: contenu as unknown as Prisma.InputJsonValue },
    update: { contenu: contenu as unknown as Prisma.InputJsonValue },
  });
  return contenu;
}
