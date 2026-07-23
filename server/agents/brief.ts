import { z } from 'zod';
import { ContexteSchema } from '../domaine/parcours/index.js';

// Le brief : ce que le dialogue d'intake doit réunir avant de générer.
// Intention + contexte sont co-égaux (ADR-0005) : les trois champs requis
// sont l'intention, avec qui, et la durée. Le reste enrichit sans bloquer.

export const BriefSchema = z.object({
  intention: z.string().min(1),
  avecQui: ContexteSchema.shape.avecQui,
  duree: ContexteSchema.shape.duree,
  lieux: z.array(z.string().min(1)).default([]),
  budgetTotal: z.number().positive().optional(),
  ambiance: z.string().optional(),
  contraintes: z.array(z.string().min(1)).default([]),
});

export const BriefPartielSchema = BriefSchema.partial();

export type Brief = z.infer<typeof BriefSchema>;
export type BriefPartiel = z.infer<typeof BriefPartielSchema>;

const LIBELLES_MANQUANTS: Record<'intention' | 'avecQui' | 'duree', string> = {
  intention: 'l’envie (que voulez-vous vivre ?)',
  avecQui: 'avec qui',
  duree: 'la durée',
};

/** Les champs requis encore absents — le dialogue ne pose que ces questions. */
export function champsManquants(brief: BriefPartiel): string[] {
  return (Object.keys(LIBELLES_MANQUANTS) as (keyof typeof LIBELLES_MANQUANTS)[])
    .filter((champ) => brief[champ] === undefined)
    .map((champ) => LIBELLES_MANQUANTS[champ]);
}

const LIBELLES_AVEC_QUI = {
  solo: 'en solo',
  couple: 'en couple',
  famille: 'en famille',
  amis: 'entre amis',
  groupe: 'en groupe',
} as const;

/** Reformulation affichable du brief compris — validée par l'utilisateur avant génération. */
export function reformulerBrief(brief: Brief): string {
  const morceaux = [
    `Vous voulez ${brief.intention}, ${LIBELLES_AVEC_QUI[brief.avecQui]}, sur ${brief.duree.valeur} ${brief.duree.unite}`,
  ];
  if (brief.lieux.length > 0) morceaux.push(`du côté de ${brief.lieux.join(', ')}`);
  if (brief.budgetTotal !== undefined) morceaux.push(`avec un budget d'environ ${brief.budgetTotal} €`);
  if (brief.ambiance) morceaux.push(`dans une ambiance ${brief.ambiance}`);
  const phrase = morceaux.join(', ');
  const fin = brief.contraintes.length > 0 ? `. À respecter : ${brief.contraintes.join(' ; ')}.` : '.';
  return phrase + fin;
}
