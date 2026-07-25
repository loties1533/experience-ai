import { z } from 'zod';

// Traduction directe de docs/06-modele-conceptuel.md — aucune dépendance technique.
// Les invariants 1 (intention + contexte obligatoires) et 2 (justification par
// élément) sont portés par les schémas eux-mêmes ; les autres par invariants.ts.

export const RoleSchema = z.enum(['organisateur', 'participant', 'heros']);

export const VisibiliteSchema = z.enum(['prive', 'partage', 'surprise']);

// `sortie` désigne ce qui se vit le soir : bar, club, tournée, apéro.
// Sans ce type, le modèle rangeait la boîte de nuit et la virée bars dans
// `temps_libre` (constaté sur deux générations sur quatre) : le temps fort du
// parcours s'affichait alors comme un temps mort. Un produit qui tient sa
// cohérence d'un thème ne peut pas confondre le sommet de la soirée avec une
// pause café.
export const TypeElementSchema = z.enum([
  'activite',
  'restaurant',
  'sortie',
  'transport',
  'hebergement',
  'evenement',
  'temps_libre',
]);

export const StatutElementSchema = z.enum(['propose', 'accepte', 'a_remplacer']);

export const IntentionSchema = z.object({
  texte: z.string().min(1, 'une intention ne peut pas être vide'),
  motsCles: z.array(z.string().min(1)).default([]),
});

// Le LLM écrit systématiquement un ISO SANS le suffixe "Z" ("2025-01-15T08:00:00"
// au lieu de "…T08:00:00Z") — un format valide, juste pas celui que z.iso.datetime()
// exige seul. On l'ajoute avant validation plutôt que de compter sur le prompt
// pour l'obtenir à chaque fois (ne jamais faire confiance à la sortie du LLM :
// on la corrige, on ne l'espère pas). Un ISO déjà correct (avec Z ou un offset)
// n'est pas touché ; un format réellement invalide reste rejeté par z.iso.datetime().
const DateTimeISOSchema = z.preprocess((valeur) => {
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(valeur)) {
    return `${valeur}Z`;
  }
  return valeur;
}, z.iso.datetime());

export const PlageHoraireSchema = z
  .object({
    debut: DateTimeISOSchema,
    fin: DateTimeISOSchema,
  })
  // Comparer en dates, pas en chaînes : « 20:00:00.500Z » suit « 20:00:00Z ».
  .refine((p) => Date.parse(p.debut) < Date.parse(p.fin), {
    message: 'le début doit précéder la fin',
  });

export const ContexteSchema = z.object({
  avecQui: z.enum(['solo', 'couple', 'famille', 'amis', 'groupe']),
  // La durée voulue : l'ordre de grandeur de l'envie, toujours exprimable
  // (« une soirée », « trois semaines ») même sans date arrêtée.
  duree: z.object({
    valeur: z.number().positive(),
    unite: z.enum(['heures', 'jours', 'semaines']),
  }),
  // Les dates réelles, quand elles existent (le festival d'Inès les 12-14
  // juillet, les matchs datés de Thomas). Optionnelles : Karim qui sort « ce
  // soir » n'en a pas, et une envie peut vivre sans calendrier. Quand elles
  // sont là, ce sont ELLES qui font foi — la durée reste l'expression de
  // l'envie, on ne recalcule jamais l'une depuis l'autre.
  // Même objet-valeur qu'une plage d'élément : une seule règle de comparaison
  // dans tout le domaine, et « début avant fin » est déjà garanti.
  dates: PlageHoraireSchema.optional(),
  lieux: z.array(z.string().min(1)).default([]),
});

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  role: RoleSchema,
});

export const BudgetSchema = z.object({
  mode: z.enum(['individuel', 'partage']),
  montantTotal: z.number().nonnegative().optional(),
  devise: z.string().length(3).default('EUR'),
});

export const ContrainteSchema = z.discriminatedUnion('nature', [
  z.object({
    nature: z.literal('dure'),
    description: z.string().min(1),
    plage: PlageHoraireSchema,
  }),
  z.object({
    nature: z.literal('filtre'),
    description: z.string().min(1),
  }),
  z.object({
    nature: z.literal('souple'),
    description: z.string().min(1),
  }),
]);

// L'avis d'un participant sur un élément. Ce n'est PAS un vote qui décide :
// il éclaire l'organisateur, qui tranche (invariant 8). Le vote formel outillé
// reste en V2 (doc 07).
export const AvisSchema = z.enum(['pour', 'contre']);

export const ReactionSchema = z.object({
  // On stocke l'id du participant, jamais son nom : le nom se résout contre
  // `participants` et suit ses corrections. Un participant = un avis par
  // élément (le dernier remplace le précédent).
  participantId: z.string().min(1),
  avis: AvisSchema,
  le: z.iso.datetime(),
});

export const AlternativeSchema = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  description: z.string().optional(),
  prix: z.number().nonnegative().optional(),
  // Invariant 7 : la mémoire d'un arbitrage. Un simple drapeau suffit —
  // l'arbitrage reste un événement de l'Historique (doc 06), ce booléen dit
  // seulement « cette option a été tranchée » pour ne plus jamais la proposer.
  ecartee: z.boolean().default(false),
});

export const ReservationSchema = z.object({
  lienExterne: z.url(),
  fournisseur: z.string().optional(),
});

export const ElementSchema = z.object({
  id: z.string().min(1),
  type: TypeElementSchema,
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  justification: z.string().min(1, 'chaque élément porte une justification'),
  statut: StatutElementSchema.default('propose'),
  estAncre: z.boolean().default(false),
  dependDe: z.array(z.string().min(1)).default([]),
  alternatives: z.array(AlternativeSchema).default([]),
  contraintes: z.array(ContrainteSchema).default([]),
  reservation: ReservationSchema.optional(),
  reactions: z.array(ReactionSchema).default([]),
});

export const MomentSchema = z.object({
  id: z.string().min(1),
  titre: z.string().min(1),
  plage: PlageHoraireSchema.optional(),
  elements: z.array(ElementSchema).default([]),
});

export const ModificationSchema = z.object({
  date: z.iso.datetime(),
  description: z.string().min(1),
  elementId: z.string().optional(),
});

export const ParcoursSchema = z.object({
  id: z.string().min(1),
  intention: IntentionSchema,
  contexte: ContexteSchema,
  participants: z.array(ParticipantSchema).min(1),
  budget: BudgetSchema,
  ambiance: z.string().optional(),
  visibilite: VisibiliteSchema.default('prive'),
  historique: z.array(ModificationSchema).default([]),
  timeline: z.array(MomentSchema).default([]),
});

export type Role = z.infer<typeof RoleSchema>;
export type Visibilite = z.infer<typeof VisibiliteSchema>;
export type TypeElement = z.infer<typeof TypeElementSchema>;
export type StatutElement = z.infer<typeof StatutElementSchema>;
export type Intention = z.infer<typeof IntentionSchema>;
export type Contexte = z.infer<typeof ContexteSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type PlageHoraire = z.infer<typeof PlageHoraireSchema>;
export type Contrainte = z.infer<typeof ContrainteSchema>;
export type Avis = z.infer<typeof AvisSchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type Reservation = z.infer<typeof ReservationSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type Moment = z.infer<typeof MomentSchema>;
export type Modification = z.infer<typeof ModificationSchema>;
export type Parcours = z.infer<typeof ParcoursSchema>;
