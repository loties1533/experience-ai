import { z } from 'zod';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import { BriefPartielSchema, champsManquants, reformulerBrief, BriefSchema, type BriefPartiel } from './brief.js';

// Agent d'intake : mène le dialogue d'entrée, extrait le brief au fil des
// réponses et ne pose QUE les questions nécessaires. Il ne génère rien —
// la génération est le rôle de l'orchestrateur (generation.ts).

const SYSTEM_INTAKE = `Tu aides à comprendre l'envie d'un utilisateur pour construire un parcours personnalisé.
Réponds UNIQUEMENT en JSON valide : {"reponse": string, "brief": objet}.
- "brief" : uniquement les champs que le DERNIER message permet d'établir, parmi :
  intention (string, l'envie — jamais une destination), avecQui ("solo"|"couple"|"famille"|"amis"|"groupe"),
  duree ({"valeur": number, "unite": "heures"|"jours"}), lieux (string[]), budgetTotal (number, en euros),
  ambiance (string), contraintes (string[]).
- "reponse" : UNE question courte et chaleureuse en français sur UN champ requis manquant (intention, avecQui, duree). Jamais deux questions.
- N'invente jamais un champ que l'utilisateur n'a pas exprimé.`;

const SortieIntakeSchema = z.object({
  reponse: z.string().min(1),
  brief: z.unknown(),
});

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
    throw new AppError('Je n’ai pas réussi à comprendre, pouvez-vous reformuler ?', 502);
  }

  // Ne jamais faire confiance au LLM : ses extractions passent par Zod,
  // et ce qui ne valide pas est simplement ignoré (le dialogue redemandera).
  const extraction = BriefPartielSchema.safeParse(sortie.data.brief);
  const brief: BriefPartiel = { ...briefActuel, ...(extraction.success ? extraction.data : {}) };

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
