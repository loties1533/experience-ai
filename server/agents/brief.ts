import { z } from 'zod';
import { ContexteSchema } from '../domaine/parcours/index.js';

// Le brief : ce que le dialogue d'intake doit réunir avant de générer.
// Intention + contexte sont co-égaux (ADR-0005) : les trois champs requis
// sont l'intention, avec qui, et la durée. Le reste enrichit sans bloquer.

export const BriefSchema = z.object({
  intention: z.string().min(1),
  avecQui: ContexteSchema.shape.avecQui,
  duree: ContexteSchema.shape.duree,
  // Optionnelles, comme dans le contexte : on ne bloque jamais le dialogue
  // sur des dates que l'utilisateur n'a pas encore arrêtées.
  dates: ContexteSchema.shape.dates,
  lieux: z.array(z.string().min(1)).default([]),
  budgetTotal: z.number().positive().optional(),
  ambiance: z.string().optional(),
  contraintes: z.array(z.string().min(1)).default([]),
});

export const BriefPartielSchema = BriefSchema.partial();

export type Brief = z.infer<typeof BriefSchema>;
export type BriefPartiel = z.infer<typeof BriefPartielSchema>;

const LIBELLES_MANQUANTS: Record<'intention' | 'avecQui' | 'duree' | 'dates', string> = {
  intention: 'l’envie (que voulez-vous vivre ?)',
  avecQui: 'avec qui',
  duree: 'la durée',
  // Une durée seule ("3 semaines") n'ancre le parcours à aucune vraie date :
  // les connecteurs (PredictHQ...) chercheraient alors sur une date inventée,
  // sans rapport avec le vrai séjour. Une date de départ, même approximative,
  // suffit — la fin se calcule ensuite depuis la durée (jamais confiée au LLM).
  // « point de départ » a été essayé puis abandonné : constaté en usage réel
  // (recette live), le modèle le comprend comme une VILLE, pas une date, et
  // demande d'où l'utilisateur part au lieu de quand.
  dates: 'une date de départ, même approximative (à quel moment, pas d’où)',
};

/**
 * « Du 4 au 6 septembre » désigne des JOURS, pas des instants : le 6 est
 * compris en entier. Le modèle rend pourtant des dates à minuit — une fin au
 * 6 à 00:00 exclut toute la journée du 6, et le brunch du dimanche tombait
 * alors hors des bornes du parcours. Résultat observé en recette : la
 * génération échouait en « parcours incohérent », sans que rien ne soit
 * réellement incohérent.
 *
 * Une fin posée à minuit est donc étendue à la fin de sa journée. Une fin qui
 * porte une heure explicite est respectée telle quelle : elle vient de
 * quelqu'un qui a voulu cette heure-là.
 */
export function normaliserDatesBrief<T extends BriefPartiel>(brief: T): T {
  if (!brief.dates) return brief;

  const fin = new Date(brief.dates.fin);
  const poseeAMinuit =
    fin.getUTCHours() === 0 &&
    fin.getUTCMinutes() === 0 &&
    fin.getUTCSeconds() === 0 &&
    fin.getUTCMilliseconds() === 0;
  if (!poseeAMinuit) return brief;

  const finDeJournee = new Date(fin);
  finDeJournee.setUTCHours(23, 59, 59, 999);
  return { ...brief, dates: { ...brief.dates, fin: finDeJournee.toISOString() } };
}

/**
 * La fin d'une plage se CALCULE depuis un début connu + la durée — jamais
 * confiée au LLM (arithmétique de dates, pas son fort). Utilisé une fois
 * qu'un point de départ a été obtenu, pour que le domaine porte toujours de
 * vraies dates avant la génération.
 */
export function calculerDates(
  debutISO: string,
  duree: { valeur: number; unite: 'heures' | 'jours' | 'semaines' }
): { debut: string; fin: string } {
  const HEURES_PAR_UNITE: Record<typeof duree.unite, number> = {
    heures: 1,
    jours: 24,
    semaines: 24 * 7,
  };
  const debut = new Date(debutISO);
  const fin = new Date(debut.getTime() + duree.valeur * HEURES_PAR_UNITE[duree.unite] * 3_600_000);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

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

/** Date affichable (« 12 juillet 2026 ») à partir d'un horodatage ISO. */
function enFrancais(horodatageISO: string): string {
  return new Date(horodatageISO).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const SINGULIERS: Record<'heures' | 'jours' | 'semaines', string> = {
  heures: 'heure',
  jours: 'jour',
  semaines: 'semaine',
};

/** « 1 jour », « 2 jours », « 3 semaines » : le singulier sous 2, sinon le pluriel. */
function accorderDuree(valeur: number, unite: 'heures' | 'jours' | 'semaines'): string {
  return `${valeur} ${valeur < 2 ? SINGULIERS[unite] : unite}`;
}

/** Reformulation affichable du brief compris — validée par l'utilisateur avant génération. */
export function reformulerBrief(brief: Brief): string {
  const morceaux = [
    `Tu veux ${brief.intention}, ${LIBELLES_AVEC_QUI[brief.avecQui]}, sur ${accorderDuree(brief.duree.valeur, brief.duree.unite)}`,
  ];
  if (brief.dates) {
    morceaux.push(`du ${enFrancais(brief.dates.debut)} au ${enFrancais(brief.dates.fin)}`);
  }
  if (brief.lieux.length > 0) morceaux.push(`du côté de ${brief.lieux.join(', ')}`);
  if (brief.budgetTotal !== undefined) morceaux.push(`avec un budget d'environ ${brief.budgetTotal} €`);
  if (brief.ambiance) morceaux.push(`dans une ambiance ${brief.ambiance}`);
  const phrase = morceaux.join(', ');
  const fin = brief.contraintes.length > 0 ? `. À respecter : ${brief.contraintes.join(' ; ')}.` : '.';
  return phrase + fin;
}
