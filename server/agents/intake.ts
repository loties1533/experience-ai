import { z } from 'zod';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import {
  BriefPartielSchema,
  champsManquants,
  reformulerBrief,
  normaliserDatesBrief,
  BriefSchema,
  type BriefPartiel,
} from './brief.js';

// Agent d'intake : mène le dialogue d'entrée, extrait le brief au fil des
// réponses et ne pose QUE les questions nécessaires. Il ne génère rien —
// la génération est le rôle de l'orchestrateur (generation.ts).

const SYSTEM_INTAKE = `Tu aides à comprendre l'envie d'un utilisateur pour construire un parcours personnalisé.
Réponds UNIQUEMENT en JSON valide : {"reponse": string, "brief": objet}.
- "brief" : uniquement les champs que le DERNIER message permet d'établir, parmi :
  intention (string, l'envie — jamais une destination), avecQui ("solo"|"couple"|"famille"|"amis"|"groupe"),
  duree ({"valeur": number, "unite": "heures"|"jours"}), dates ({"debut": ISO, "fin": ISO} — UNIQUEMENT si l'utilisateur
  donne de vraies dates ; ne les déduis jamais de la durée), lieux (string[]), budgetTotal (number, en euros),
  ambiance (string), contraintes (string[]).
- "reponse" : UNE question courte et chaleureuse en français sur UN champ requis manquant (intention, avecQui, duree). Jamais deux questions. TUTOIE toujours l'utilisateur (« tu », jamais « vous »).
- N'invente jamais un champ que l'utilisateur n'a pas exprimé.`;

const SortieIntakeSchema = z.object({
  reponse: z.string().min(1),
  brief: z.unknown(),
});

/**
 * Ne jamais faire confiance au LLM : ses extractions passent par Zod. Mais la
 * validation se fait CHAMP PAR CHAMP, jamais sur l'objet entier.
 *
 * Pourquoi : `safeParse` est tout-ou-rien. Un seul champ mal formé — le modèle
 * écrit `avecQui: "groupe de 8"` là où l'enum attend `"amis"` — faisait perdre
 * TOUS les autres, pourtant valides. En pratique la ville, le budget et les
 * dates donnés dans la même phrase disparaissaient, et le dialogue les
 * redemandait : exactement ce que le produit s'interdit de faire.
 *
 * Ici, un champ invalide est le seul à être ignoré ; le dialogue le redemandera.
 */
function extraireChampsValides(brut: unknown): BriefPartiel {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return {};

  const formes = BriefPartielSchema.shape;
  const retenu: Record<string, unknown> = {};

  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    const forme = formes[cle as keyof typeof formes];
    if (!forme) continue; // champ inventé par le modèle : ignoré
    const resultat = forme.safeParse(valeur);
    if (resultat.success && resultat.data !== undefined) retenu[cle] = resultat.data;
  }

  return retenu as BriefPartiel;
}

export interface EtapeDialogue {
  /** Question suivante, ou reformulation à valider quand le brief est complet. */
  reponse: string;
  brief: BriefPartiel;
  estComplet: boolean;
}

export async function avancerDialogue(
  briefActuel: BriefPartiel,
  messageUtilisateur: string
): Promise<EtapeDialogue> {
  const prompt = `Brief déjà établi : ${JSON.stringify(briefActuel)}
Dernier message de l'utilisateur : "${sanitizeInput(messageUtilisateur)}"
Champs requis encore manquants : ${champsManquants(briefActuel).join(', ') || 'aucun'}`;

  const brut = await callAI(prompt, SYSTEM_INTAKE, 'onboarding');
  const sortie = SortieIntakeSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas réussi à comprendre, peux-tu reformuler ?', 502);
  }

  const brief: BriefPartiel = normaliserDatesBrief({
    ...briefActuel,
    ...extraireChampsValides(sortie.data.brief),
  });

  const complet = BriefSchema.safeParse(brief);
  if (complet.success) {
    return {
      reponse: `${reformulerBrief(complet.data)} C'est bien ça ?`,
      brief,
      estComplet: true,
    };
  }
  return { reponse: sortie.data.reponse, brief, estComplet: false };
}
