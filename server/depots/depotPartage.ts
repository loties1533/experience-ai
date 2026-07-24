import { randomBytes } from 'node:crypto';
import prisma from '../db/prisma.js';
import { AppError } from '../lib/AppError.js';
import { ParcoursSchema, type Parcours } from '../domaine/parcours/index.js';

// Seule porte d'accès à la table `partages_parcours` (ADR-0008).
//
// Un lien = un jeton aléatoire attaché à UN participant. Le jeton ne dit rien
// du parcours (ce n'est pas son id) et ne se devine pas : 32 octets tirés au
// hasard cryptographique, soit 256 bits — hors de portée d'un balayage.
//
// Ce dépôt ne décide jamais QUI a droit à un lien : cette règle appartient au
// domaine (`participantsPartageables`). Il ne fait qu'appliquer la liste qu'on
// lui donne.

export interface LienPartage {
  participantId: string;
  jeton: string;
  creeLe: Date;
}

/** Le porteur d'un lien, tel que le serveur le reconnaît. */
export interface AccesParJeton {
  parcours: Parcours;
  /** Le compte propriétaire — jamais fourni par le client, toujours relu ici. */
  proprietaireId: string;
  /** Le participant que ce jeton désigne : c'est lui qui porte le rôle. */
  participantId: string;
}

function nouveauJeton(): string {
  return randomBytes(32).toString('base64url');
}

export async function listerLiens(parcoursId: string): Promise<LienPartage[]> {
  const lignes = await prisma.partageParcours.findMany({
    where: { parcours_id: parcoursId },
    select: { participant_id: true, jeton: true, created_at: true },
  });
  return lignes.map((l) => ({ participantId: l.participant_id, jeton: l.jeton, creeLe: l.created_at }));
}

/**
 * Aligne les liens existants sur la liste des participants qui y ont droit :
 * un lien manquant est émis, un lien devenu illégitime est **supprimé**.
 *
 * Idempotente et non destructrice pour les liens encore valides : un lien déjà
 * envoyé à quelqu'un ne doit pas se mettre à échouer parce que l'organisateur
 * a rouvert son panneau de partage.
 */
export async function synchroniserLiens(
  parcoursId: string,
  participantsAutorises: string[]
): Promise<LienPartage[]> {
  const existants = await listerLiens(parcoursId);
  const autorises = new Set(participantsAutorises);

  const aRevoquer = existants.filter((l) => !autorises.has(l.participantId));
  if (aRevoquer.length > 0) {
    await prisma.partageParcours.deleteMany({
      where: { jeton: { in: aRevoquer.map((l) => l.jeton) } },
    });
  }

  const dejaServis = new Set(existants.map((l) => l.participantId));
  const aEmettre = participantsAutorises.filter((id) => !dejaServis.has(id));
  if (aEmettre.length > 0) {
    await prisma.partageParcours.createMany({
      data: aEmettre.map((participantId) => ({
        jeton: nouveauJeton(),
        parcours_id: parcoursId,
        participant_id: participantId,
      })),
    });
  }

  return listerLiens(parcoursId);
}

/** Coupe tous les accès d'un coup (retour en privé, ou geste explicite). */
export async function revoquerTousLesLiens(parcoursId: string): Promise<void> {
  await prisma.partageParcours.deleteMany({ where: { parcours_id: parcoursId } });
}

/**
 * Résout un jeton : le parcours qu'il ouvre, et au nom de qui. Rend `null` si
 * le jeton n'existe pas ou plus — un lien révoqué est indiscernable d'un lien
 * inventé, on ne renseigne pas le curieux.
 *
 * Ne dit RIEN de la visibilité : c'est au domaine (`verifierAccesPartage`) de
 * trancher ensuite. Ce dépôt reconnaît, il n'autorise pas.
 */
export async function chargerParcoursParJeton(jeton: string): Promise<AccesParJeton | null> {
  const ligne = await prisma.partageParcours.findUnique({
    where: { jeton },
    select: {
      participant_id: true,
      parcours: { select: { user_id: true, contenu: true } },
    },
  });
  if (!ligne?.parcours) return null;

  const resultat = ParcoursSchema.safeParse(ligne.parcours.contenu);
  if (!resultat.success) {
    throw new AppError('Le contenu de ce parcours est corrompu', 500);
  }
  return {
    parcours: resultat.data,
    proprietaireId: ligne.parcours.user_id,
    participantId: ligne.participant_id,
  };
}
