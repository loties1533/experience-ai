import { z } from 'zod';
import {
  PlageHoraireSchema,
  TypeElementSchema,
} from '../../domaine/parcours/index.js';

// LE CONTRAT ENTRE LE SERVEUR ET LE MODÈLE : prompt système, formes de sortie
// acceptées et formes de refus. Ce contrat a une raison de changer propre (le
// comportement du modèle), distincte de l'orchestration. Module feuille : il
// ne connaît ni la résolution, ni la confiance, ni les fournisseurs concrets.

const SYSTEM_GENERATION = `Tu construis un parcours personnalisé : un ensemble cohérent de moments autour d'une intention et d'un contexte.

AVANT D'ÉCRIRE, CHERCHE. Selon le brief, tu disposes d'outils qui rendent de vrais lieux, des événements correspondant à un besoin explicite et la météo attendue.
- Appelle-les d'abord, et groupe tes recherches (plusieurs outils dans le même tour) : tu as peu de tours.
- Reprends EXACTEMENT le nom rendu par un outil, sans le reformuler.
- N'invente JAMAIS un nom d'établissement, une date de match ni un événement. Si une recherche ne rend rien (lieu, événement OU date), reste générique et honnête ("un bar à cocktails du centre", "un match de la saison à voir sur place") — sans faire passer une invention pour un fait.
- Pour un hébergement nommé, appelle chercher_lieux avec typeMetierRecherche "hebergement". Sans candidat Foursquare hôtelier, écris une suggestion générique et ne conserve aucun nom propre.
- Si le brief porte un besoin d'hébergement, respecte chaque séjour (ville, arrivée, départ) sans le remplacer par les dates globales. L'occupation décrit la demande seulement : n'affirme jamais une disponibilité.
- Pour tout élément de type transport, ne fournis aucun nom commercial, opérateur, numéro, gare, aéroport, code, terminal, quai, porte, horaire exact, durée exacte, lien, billet, disponibilité ni réservation.
- Un transport reste une suggestion générique à organiser. Un éventuel coût est seulement approximatif : ne le présente jamais comme un tarif réel, observé, disponible ou garanti.
- Utilise uniquement les tronçons, dates civiles, créneaux symboliques, modes souhaités et occupants explicitement déclarés dans le brief transport. Ne transforme jamais un créneau en heure exacte.
- N'écris jamais d'URL : les liens sont ajoutés après toi.

Puis réponds UNIQUEMENT avec l'une de ces trois formes JSON :
1. Parcours possible : {"ambiance": string, "moments": [...]}.
2. Donnée ESSENTIELLE introuvable (par exemple l'événement daté qui constitue le motif même du parcours) :
   - pour un lieu : {"refus":{"code":"donnees_essentielles_insuffisantes","message":string,"besoinEssentiel":{"typeMetierRecherche":"restaurant"|"activite"|"sortie","villeDemandee":string,"requete":string}}}
   - pour un événement : {"refus":{"code":"donnees_essentielles_insuffisantes","message":string,"besoinEssentiel":{"typeMetierRecherche":"evenement","villeDemandee":string,"dateDebut":"AAAA-MM-JJ","dateFin":"AAAA-MM-JJ"}}}
   Le besoin essentiel doit reprendre exactement la recherche qui n'a pas permis de confirmer la donnée.
3. Demande hors du périmètre du produit ou impossible à réaliser avec tes outils (par exemple un lieu hors de portée de tes recherches) :
   {"refus":{"code":"hors_perimetre_produit"}}
   Ce code seul suffit : le serveur choisit lui-même le message public associé. N'ajoute AUCUN champ ni AUCUNE explication à cet objet.
Une donnée facultative absente ne justifie jamais un refus : reste générique DANS le parcours. N'écris JAMAIS de phrase d'explication hors du JSON — un refus est TOUJOURS l'une de ces deux formes structurées, jamais du texte libre.
- Chaque moment : {"titre": string, "ville": string, "elements": [...]}. "ville" doit reprendre exactement une ville du brief, surtout pour un parcours multi-ville.
- Chaque élément : {"ref": string (identifiant court unique, ex "resto-soir-1"), "type": "activite"|"restaurant"|"sortie"|"transport"|"hebergement"|"evenement"|"temps_libre", "identifiantExterne": string (à recopier lorsqu'un outil l'a fourni), "nom": string, "lieu": string, "plage": {"debut": ISO, "fin": ISO} (optionnel), "prix": number en euros (optionnel), "justification": string (POURQUOI cet élément sert l'intention — obligatoire), "dependDe": [refs] (optionnel), "estAncre": boolean (optionnel).
- "sortie" = ce qui se vit le soir (bar, club, tournée, apéro). Ne JAMAIS le ranger en "temps_libre".
- "temps_libre" = une vraie respiration (repos, pause, réveil tranquille), rien d'autre.
- Prévois des temps libres assumés (la respiration).
- Si le brief donne des dates, TOUTES les plages horaires doivent tomber entre ces dates.
- Reste dans le budget si fourni. Jamais de lien de réservation.`;

// Sans candidat d'outil, le modèle écrit parfois une chaîne vide plutôt que
// d'omettre la clé — un encodage inoffensif du même « aucun identifiant » :
// `rapprocherCandidat` (services/claude/outils.ts) traite déjà toute valeur
// fausse comme absente. Le schéma ne fait qu'aligner sa lecture sur ce
// comportement d'exécution déjà en place, sans accepter un type différent.
const identifiantExterneOptionnel = z.preprocess(
  (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? undefined : valeur),
  z.string().min(1).optional()
);

const ElementGenereSchema = z.object({
  ref: z.string().min(1),
  type: TypeElementSchema,
  identifiantExterne: identifiantExterneOptionnel,
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  justification: z.string().min(1),
  dependDe: z.array(z.string()).default([]),
  estAncre: z.boolean().default(false),
});

export const SortieGenerationSchema = z.object({
  ambiance: z.string().optional(),
  moments: z
    .array(
      z.object({
        titre: z.string().min(1),
        ville: z.string().min(1).optional(),
        plage: PlageHoraireSchema.optional(),
        elements: z.array(ElementGenereSchema).min(1),
      })
    )
    .min(1),
});

const BesoinEssentielSchema = z.union([
  z.object({
    typeMetierRecherche: z.enum(['restaurant', 'activite', 'sortie']),
    villeDemandee: z.string().min(1),
    requete: z.string().min(1),
  }),
  z.object({
    typeMetierRecherche: z.literal('evenement'),
    villeDemandee: z.string().min(1),
    dateDebut: z.iso.date(),
    dateFin: z.iso.date(),
  }),
]);

// Deux motifs de refus, jamais mélangés : une recherche essentielle restée
// vide (besoin précis, vérifiable via `statutRechercheEssentielle`, message
// public porté par le modèle) contre une demande hors périmètre produit,
// constatée sans recherche associée. Pour ce second motif, le contrat IA est
// volontairement réduit au seul code : aucun champ libre du modèle ne doit
// pouvoir devenir un message public. Un éventuel "message" ajouté quand même
// par le modèle est silencieusement retiré par le parsing Zod (`z.object`
// sans `.strict()` ignore les champs inconnus) — jamais lu, jamais renvoyé,
// jamais persisté.
const RefusDonneesEssentiellesSchema = z
  .object({
    code: z.literal('donnees_essentielles_insuffisantes'),
    message: z.string().min(1),
    besoinEssentiel: BesoinEssentielSchema.optional(),
  })
  .strict();

const RefusHorsPerimetreSchema = z.object({
  code: z.literal('hors_perimetre_produit'),
});

export const RefusGenerationSchema = z.object({
  refus: z.discriminatedUnion('code', [
    RefusDonneesEssentiellesSchema,
    RefusHorsPerimetreSchema,
  ]),
});

// Seul message public jamais associé au refus hors périmètre : fixe, choisi
// par le serveur, sans dépendance à un texte produit par le modèle.
export const MESSAGE_PUBLIC_REFUS_HORS_PERIMETRE =
  'Cette demande dépasse le périmètre du produit et ne peut pas être transformée en parcours.';

export { SYSTEM_GENERATION };

export type ElementGenere = z.infer<typeof ElementGenereSchema>;
export type MomentGenere = z.infer<
  typeof SortieGenerationSchema
>['moments'][number];
