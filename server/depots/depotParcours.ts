import type { Prisma } from '@prisma/client';
import prisma from '../db/prisma.js';
import { AppError } from '../lib/AppError.js';
import {
  ParcoursLectureSchema,
  ParcoursSchema,
  type Parcours,
} from '../domaine/parcours/index.js';

// Seule porte d'accès à la table `parcours` (ADR-0007) :
// - à l'écriture, l'agrégat est revalidé et les colonnes de projection
//   (intention, visibilite) sont dérivées du contenu — jamais fournies à part ;
// - à la lecture, le contenu est normalisé par ParcoursLectureSchema puis
//   revalidé : une réservation legacy reste lisible sans devenir « vérifiée ».

export interface ResumeParcours {
  id: string;
  intention: string;
  visibilite: string;
  misAJourLe: Date;
}

export async function sauvegarderParcours(userId: string, parcours: Parcours): Promise<void> {
  const contenu = ParcoursSchema.parse(parcours);

  const existant = await prisma.parcours.findUnique({
    where: { id: contenu.id },
    select: { user_id: true },
  });
  if (existant && existant.user_id !== userId) {
    throw new AppError('Parcours introuvable', 404);
  }

  const projections = {
    intention: contenu.intention.texte,
    visibilite: contenu.visibilite,
    contenu: contenu as unknown as Prisma.InputJsonValue,
  };
  await prisma.parcours.upsert({
    where: { id: contenu.id },
    create: { id: contenu.id, user_id: userId, ...projections },
    update: projections,
  });
}

export async function chargerParcours(userId: string, parcoursId: string): Promise<Parcours | null> {
  const ligne = await prisma.parcours.findFirst({
    where: { id: parcoursId, user_id: userId },
    select: { contenu: true },
  });
  if (!ligne) return null;

  const resultat = ParcoursLectureSchema.safeParse(ligne.contenu);
  if (!resultat.success) {
    throw new AppError('Le contenu de ce parcours est corrompu', 500);
  }
  return resultat.data;
}

export async function listerParcours(userId: string): Promise<ResumeParcours[]> {
  const lignes = await prisma.parcours.findMany({
    where: { user_id: userId },
    select: { id: true, intention: true, visibilite: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
  });
  return lignes.map((l) => ({
    id: l.id,
    intention: l.intention,
    visibilite: l.visibilite,
    misAJourLe: l.updated_at,
  }));
}

export async function supprimerParcours(userId: string, parcoursId: string): Promise<boolean> {
  const { count } = await prisma.parcours.deleteMany({
    where: { id: parcoursId, user_id: userId },
  });
  return count > 0;
}
