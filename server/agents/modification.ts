import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import {
  DemandeSurElementClientSchema,
  alternativesProposables,
  type DemandeSurElementClient,
  type Parcours,
} from '../domaine/parcours/index.js';

// L'AGENT MODIFICATION (IA n°2) : il traduit une phrase (« change le resto du
// jour 3 ») en UNE demande ciblée que le domaine sait appliquer. Il ne peut
// PAS régénérer le parcours : son vocabulaire de sortie, c'est
// DemandeSurElementClientSchema, rien d'autre. Le domaine reste seule autorité
// pour appliquer (ou refuser) la demande.
//
// Ce vocabulaire s'arrête volontairement aux éléments : partager au groupe,
// changer la visibilité ou réagir sont des gestes délibérés de l'utilisateur,
// jamais quelque chose qu'une phrase mal comprise pourrait déclencher.

const SYSTEM_MODIFICATION = `Tu traduis la demande d'un utilisateur en UNE modification ciblée de son parcours.
Réponds UNIQUEMENT en JSON valide, l'une de ces formes :
- {"type": "remplacer_element", "elementId": string, "remplacement": {"type": ..., "nom": ..., "lieu"?, "plage"?, "prix"?, "justification": string}}
- {"type": "supprimer_element", "elementId": string}
- {"type": "ajouter_element", "momentId": string, "element": {"type": ..., "nom": ..., "justification": string}}
- {"type": "modifier_justification", "elementId": string, "justification": string}
- {"type": "changer_statut", "elementId": string, "statut": "propose"|"accepte"|"a_remplacer"}
- {"type": "ecarter_alternative", "elementId": string, "alternativeId": string} (l'utilisateur tranche : cette option ne lui sera plus proposée)
- {"type": "modifier_sejour_hebergement", "elementId": string, "sejour": {"ville": string, "arrivee": "AAAA-MM-JJ", "depart": "AAAA-MM-JJ"}}
- {"type": "modifier_occupation_hebergement", "occupation": {"statut": "declaree", "adultes": number, "enfants": number, "chambres": number}}
- {"type": "remplacer_hotel", "elementId": string, "villeDemandee": string, "requete": string, "sejour"?: {"ville": string, "arrivee": "AAAA-MM-JJ", "depart": "AAAA-MM-JJ"}}
Utilise UNIQUEMENT les ids listés. Chaque élément proposé porte une justification (pourquoi il sert l'intention).
Un hébergement ne passe JAMAIS par remplacer_element ou ajouter_element : utilise remplacer_hotel, afin que le serveur recherche son identité.
N'écris jamais confiance, provenance, fournisseur, source, recupereLe, identifiantExterne, adresse, lienExterne, l'ancien champ reservation, disponibilité ni lien.
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
): Promise<DemandeSurElementClient> {
  const prompt = `Intention du parcours : ${parcours.intention.texte}
${resumerPourLLM(parcours)}

Demande de l'utilisateur : "${sanitizeInput(phrase)}"`;

  const brut = await callAI(prompt, SYSTEM_MODIFICATION, 'onboarding');
  const sortie = DemandeSurElementClientSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas compris cette modification, pouvez-vous préciser ?', 502);
  }
  return sortie.data;
}
