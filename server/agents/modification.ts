import { randomUUID } from 'node:crypto';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import {
  DemandeModificationSchema,
  alternativesProposables,
  type DemandeModification,
  type Parcours,
} from '../domaine/parcours/index.js';

// L'AGENT MODIFICATION (IA n°2) : il traduit une phrase (« change le resto du
// jour 3 ») en UNE demande ciblée que le domaine sait appliquer. Il ne peut
// PAS régénérer le parcours : son vocabulaire de sortie, c'est
// DemandeModificationSchema, rien d'autre. Le domaine reste seule autorité
// pour appliquer (ou refuser) la demande.

const SYSTEM_MODIFICATION = `Tu traduis la demande d'un utilisateur en UNE modification ciblée de son parcours.
Réponds UNIQUEMENT en JSON valide, l'une de ces cinq formes :
- {"type": "remplacer_element", "elementId": string, "remplacement": {"type": ..., "nom": ..., "lieu"?, "plage"?, "prix"?, "justification": string}}
- {"type": "supprimer_element", "elementId": string}
- {"type": "ajouter_element", "momentId": string, "element": {"id": "sera-remplace", "type": ..., "nom": ..., "justification": string}}
- {"type": "changer_statut", "elementId": string, "statut": "propose"|"accepte"|"a_remplacer"}
- {"type": "ecarter_alternative", "elementId": string, "alternativeId": string} (l'utilisateur tranche : cette option ne lui sera plus proposée)
Utilise UNIQUEMENT les ids listés. Chaque élément proposé porte une justification (pourquoi il sert l'intention).
Quand tu remplaces un élément qui a un prix, donne TOUJOURS le prix du remplaçant (en euros, même ordre de grandeur sauf si la demande implique le contraire) : un parcours sans prix fausse le budget.
Ne mets jamais deux options dans un même "nom" (pas de « X ou Y ») : choisis-en une.`;

/**
 * Vue compacte du parcours donnée au LLM : juste de quoi adresser les éléments
 * et les options encore ouvertes. Les options déjà écartées n'y figurent pas —
 * le modèle ne peut donc pas les reproposer (invariant 7).
 */
function resumerPourLLM(parcours: Parcours): string {
  return parcours.timeline
    .map(
      (moment) =>
        `Moment "${moment.titre}" (momentId: ${moment.id})\n` +
        moment.elements
          .map((e) => {
            const options = alternativesProposables(e)
              .map((a) => `      · ${a.nom} (alternativeId: ${a.id})`)
              .join('\n');
            // Le prix courant est donné au modèle : sans cet ancrage, un
            // remplaçant arrivait sans prix et le budget devenait faux.
            const prix = e.prix !== undefined ? `, prix actuel : ${e.prix} €` : '';
            return (
              `  - ${e.nom} [${e.type}] (elementId: ${e.id}${prix})` +
              (options ? `\n    options possibles :\n${options}` : '')
            );
          })
          .join('\n')
    )
    .join('\n');
}

export async function interpreterDemande(
  parcours: Parcours,
  phrase: string
): Promise<DemandeModification> {
  const prompt = `Intention du parcours : ${parcours.intention.texte}
${resumerPourLLM(parcours)}

Demande de l'utilisateur : "${sanitizeInput(phrase)}"`;

  const brut = await callAI(prompt, SYSTEM_MODIFICATION, 'onboarding');
  const sortie = DemandeModificationSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas compris cette modification, pouvez-vous préciser ?', 502);
  }

  // L'id d'un élément ajouté est attribué ici, jamais par le modèle.
  if (sortie.data.type === 'ajouter_element') {
    return { ...sortie.data, element: { ...sortie.data.element, id: randomUUID() } };
  }
  return sortie.data;
}
