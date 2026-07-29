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

const IDENTIFIANTS_CATEGORIES_FOURSQUARE_HEBERGEMENT = new Set([
  '19010',
  '19011',
  '19012',
  '19013',
  '19014',
  '19015',
  '19016',
  '19017',
  '19018',
  '19019',
  '4bf58dd8d48988d1fa931735',
  '4bf58dd8d48988d1ee931735',
  '4bf58dd8d48988d1fb931735',
  '4bf58dd8d48988d12f951735',
  '4bf58dd8d48988d1f8931735',
]);

const LIBELLES_CATEGORIES_FOURSQUARE_HEBERGEMENT = [
  'hotel',
  'hôtel',
  'hostel',
  'auberge',
  'auberge de jeunesse',
  'aparthotel',
  'appart hotel',
  'appart hôtel',
  'motel',
  'resort',
  'bed and breakfast',
  'boarding house',
  'cabin',
  'guest house',
  'maison d hotes',
  'maison d hôtes',
  'inn',
  'lodge',
  'vacation rental',
];

function normaliserCategorieFoursquare(valeur: string): string {
  return valeur
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Taxonomie hôtelière partagée par le connecteur et le domaine persistant.
 * Un identifiant fournisseur présent fait foi : un identifiant inconnu ne
 * peut jamais être compensé par un libellé séduisant.
 */
export function estCategorieFoursquareHebergementCompatible(categorie: {
  identifiant?: string;
  nom: string;
}): boolean {
  if (categorie.identifiant !== undefined) {
    return IDENTIFIANTS_CATEGORIES_FOURSQUARE_HEBERGEMENT.has(
      categorie.identifiant
    );
  }
  const nom = normaliserCategorieFoursquare(categorie.nom);
  return LIBELLES_CATEGORIES_FOURSQUARE_HEBERGEMENT.some(
    (libelle) =>
      normaliserCategorieFoursquare(libelle) === nom
  );
}

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
export const DateTimeISOSchema = z.preprocess((valeur) => {
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

export const NombreAdultesHebergementSchema = z.number().int().min(1).max(20);
export const NombreEnfantsHebergementSchema = z.number().int().min(0).max(20);
export const NombreChambresHebergementSchema = z.number().int().min(1).max(10);

/**
 * Une occupation `declaree` est complète ou n'existe pas : aucun nombre ne
 * vient de `avecQui`, des participants ou d'un calcul de capacité. La variante
 * `a_confirmer` ne porte volontairement aucune valeur partielle dans le
 * parcours persistant ; ces saisies intermédiaires restent dans le brief.
 */
export const OccupationHebergementDeclareeSchema = z
  .object({
    statut: z.literal('declaree'),
    adultes: NombreAdultesHebergementSchema,
    enfants: NombreEnfantsHebergementSchema,
    chambres: NombreChambresHebergementSchema,
  })
  .strict();

export const OccupationHebergementSchema = z.discriminatedUnion('statut', [
  OccupationHebergementDeclareeSchema,
  z.object({ statut: z.literal('a_confirmer') }).strict(),
]);

/**
 * Les dates d'hôtel sont des dates civiles, sans heure ni conversion UTC.
 * Leur ordre se compare directement : le format ISO AAAA-MM-JJ est
 * lexicographiquement ordonné et Zod refuse les dates calendaires invalides.
 */
export const SejourHebergementSchema = z
  .object({
    ville: z.string().trim().min(1),
    arrivee: z.iso.date(),
    depart: z.iso.date(),
  })
  .strict()
  .refine((sejour) => sejour.arrivee < sejour.depart, {
    message: 'le départ doit être strictement après l’arrivée',
    path: ['depart'],
  });

function estAnneeBissextile(annee: number): boolean {
  return annee % 4 === 0 && (annee % 100 !== 0 || annee % 400 === 0);
}

function lendemainDateCivile(date: string): string {
  const [anneeTexte, moisTexte, jourTexte] = date.split('-');
  let annee = Number(anneeTexte);
  let mois = Number(moisTexte);
  let jour = Number(jourTexte);
  const joursParMois = [
    31,
    estAnneeBissextile(annee) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  jour += 1;
  if (jour > joursParMois[mois - 1]) {
    jour = 1;
    mois += 1;
  }
  if (mois > 12) {
    mois = 1;
    annee += 1;
  }
  return [
    String(annee).padStart(4, '0'),
    String(mois).padStart(2, '0'),
    String(jour).padStart(2, '0'),
  ].join('-');
}

/**
 * Cohérence civile avec le parcours : l'arrivée commence dans ses jours et
 * le départ peut aller jusqu'au lendemain du dernier jour, comme les autres
 * éléments qui peuvent se terminer après minuit. Aucune conversion de fuseau
 * n'est faite : on compare les dates telles qu'elles ont été exprimées.
 */
export function estSejourHebergementDansDatesParcours(
  sejour: { arrivee: string; depart: string },
  dates: { debut: string; fin: string }
): boolean {
  const premierJour = dates.debut.slice(0, 10);
  const dernierJour = dates.fin.slice(0, 10);
  return (
    sejour.arrivee >= premierJour &&
    sejour.arrivee <= dernierJour &&
    sejour.depart <= lendemainDateCivile(dernierJour)
  );
}

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
  // L'occupation qualifie la demande, jamais la disponibilité d'un hôtel.
  // Optionnelle pour préserver sans interprétation les parcours antérieurs.
  occupationHebergement: OccupationHebergementSchema.optional(),
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

export const NiveauConfianceSchema = z.enum(['verifie', 'estime', 'suggestion']);

/**
 * La confiance qualifie l'identité de l'élément, pas son prix. Un restaurant
 * peut être vérifié tandis que son prix reste estimé (`prixEstime`).
 *
 * La variante `verifie` porte obligatoirement sa preuve : impossible de
 * construire un objet « vérifié » sans dire d'où il vient et quand.
 */
export const ConfianceSchema = z.discriminatedUnion('niveau', [
  z.object({
    niveau: z.literal('verifie'),
    source: z.string().min(1),
    fournisseur: z.string().min(1),
    recupereLe: DateTimeISOSchema,
    identifiantExterne: z.string().min(1).optional(),
    // Métadonnées fournisseur facultatives, remplies uniquement par le chemin
    // serveur qui a observé le candidat externe. Elles ne font partie d'aucun
    // contrat d'entrée client.
    categorieFournisseur: z.string().min(1).optional(),
    identifiantCategorieFournisseur: z.string().min(1).optional(),
    villeConfirmee: z.string().min(1).optional(),
    adresse: z.string().min(1).optional(),
  }),
  z.object({
    niveau: z.literal('estime'),
    source: z.string().min(1).optional(),
    fournisseur: z.string().min(1).optional(),
    recupereLe: DateTimeISOSchema.optional(),
  }),
  z.object({
    niveau: z.literal('suggestion'),
  }),
]);

export const TypeLienExterneSchema = z.enum([
  'officiel',
  'billetterie',
  'reservation',
  'recherche',
  'carte',
]);

export const ReservationSchema = z.object({
  lienExterne: z.url(),
  fournisseur: z.string().min(1),
  typeLien: TypeLienExterneSchema,
});

const URL_RECHERCHE_BOOKING = 'https://www.booking.com/searchresults.html';
const PARAMETRES_RECHERCHE_BOOKING = [
  'ss',
  'checkin',
  'checkout',
  'group_adults',
  'group_children',
  'no_rooms',
] as const;
export const LibelleRechercheHebergementSchema = z.literal(
  'Rechercher des hébergements sur Booking'
);

function estUrlRechercheBookingValide(valeur: string): boolean {
  try {
    const url = new URL(valeur);
    if (
      url.protocol !== 'https:' ||
      `${url.origin}${url.pathname}` !== URL_RECHERCHE_BOOKING ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== ''
    ) {
      return false;
    }

    const cles = [...url.searchParams.keys()];
    if (
      cles.length !== PARAMETRES_RECHERCHE_BOOKING.length ||
      PARAMETRES_RECHERCHE_BOOKING.some(
        (cle) => url.searchParams.getAll(cle).length !== 1
      ) ||
      cles.some(
        (cle) =>
          !PARAMETRES_RECHERCHE_BOOKING.includes(
            cle as (typeof PARAMETRES_RECHERCHE_BOOKING)[number]
          )
      )
    ) {
      return false;
    }

    const terme = url.searchParams.get('ss') ?? '';
    const arrivee = url.searchParams.get('checkin') ?? '';
    const depart = url.searchParams.get('checkout') ?? '';
    const adultes = url.searchParams.get('group_adults') ?? '';
    const enfants = url.searchParams.get('group_children') ?? '';
    const chambres = url.searchParams.get('no_rooms') ?? '';
    if (
      !/^\d+$/.test(adultes) ||
      !/^\d+$/.test(enfants) ||
      !/^\d+$/.test(chambres)
    ) {
      return false;
    }

    return (
      SejourHebergementSchema.safeParse({
        ville: terme,
        arrivee,
        depart,
      }).success &&
      OccupationHebergementDeclareeSchema.safeParse({
        statut: 'declaree',
        adultes: Number(adultes),
        enfants: Number(enfants),
        chambres: Number(chambres),
      }).success
    );
  } catch {
    return false;
  }
}

/**
 * Un raccourci vers une recherche préremplie, jamais une réservation ni une
 * preuve de disponibilité. Le domaine et le chemin sont figés : toutes les
 * données utilisateur restent exclusivement dans les paramètres encodés.
 */
export const LienRechercheHebergementSchema = z
  .object({
    type: z.literal('recherche'),
    fournisseur: z.literal('Booking'),
    url: z
      .url()
      .refine(
        estUrlRechercheBookingValide,
        'le lien doit cibler une recherche HTTPS Booking complète'
      ),
    libelle: LibelleRechercheHebergementSchema,
    genereLe: DateTimeISOSchema,
  })
  .strict();

export function estLienRechercheHebergementCoherent(
  lien: z.infer<typeof LienRechercheHebergementSchema>,
  sejour: z.infer<typeof SejourHebergementSchema>,
  occupation: z.infer<typeof OccupationHebergementDeclareeSchema>
): boolean {
  const resultatLien = LienRechercheHebergementSchema.safeParse(lien);
  if (!resultatLien.success) return false;

  const parametres = new URL(resultatLien.data.url).searchParams;
  return (
    parametres.get('checkin') === sejour.arrivee &&
    parametres.get('checkout') === sejour.depart &&
    parametres.get('group_adults') === String(occupation.adultes) &&
    parametres.get('group_children') === String(occupation.enfants) &&
    parametres.get('no_rooms') === String(occupation.chambres)
  );
}

export const ElementSchema = z.object({
  id: z.string().min(1),
  type: TypeElementSchema,
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  // Les prix produits aujourd'hui par le modèle ne sont pas des disponibilités
  // temps réel. Le défaut honnête est donc « estimé ».
  prixEstime: z.boolean().default(true),
  confiance: ConfianceSchema.default({ niveau: 'suggestion' }),
  justification: z.string().min(1, 'chaque élément porte une justification'),
  statut: StatutElementSchema.default('propose'),
  estAncre: z.boolean().default(false),
  dependDe: z.array(z.string().min(1)).default([]),
  alternatives: z.array(AlternativeSchema).default([]),
  contraintes: z.array(ContrainteSchema).default([]),
  reservation: ReservationSchema.optional(),
  // Recherche locale préremplie : distincte d'une réservation et sans preuve
  // de disponibilité. F3-C2 ne la produit que pour un séjour hôtelier validé.
  lienRechercheHebergement: LienRechercheHebergementSchema.optional(),
  // Propre à cet hôtel : on ne réutilise jamais une plage globale du parcours
  // ni le premier lieu d'un brief multi-ville.
  sejourHebergement: SejourHebergementSchema.optional(),
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

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

const SOURCE_IDENTITE_HOTEL_FOURSQUARE =
  'https://places-api.foursquare.com/places/search';

/**
 * Une identité hôtelière vérifiée est plus stricte que la confiance générique :
 * elle porte l'identifiant et la catégorie réellement observés par le
 * connecteur Foursquare. Les champs facultatifs (ville et adresse) ne sont
 * exigés que lorsque le fournisseur les a effectivement rendus.
 */
export function estConfianceFoursquareHotelValide(
  confiance: unknown
): boolean {
  return (
    estObjet(confiance) &&
    confiance.niveau === 'verifie' &&
    confiance.fournisseur === 'Foursquare' &&
    confiance.source === SOURCE_IDENTITE_HOTEL_FOURSQUARE &&
    typeof confiance.identifiantExterne === 'string' &&
    confiance.identifiantExterne.trim().length > 0 &&
    typeof confiance.categorieFournisseur === 'string' &&
    confiance.categorieFournisseur.trim().length > 0 &&
    DateTimeISOSchema.safeParse(confiance.recupereLe).success &&
    estCategorieFoursquareHebergementCompatible({
      nom: confiance.categorieFournisseur,
      ...(typeof confiance.identifiantCategorieFournisseur ===
      'string'
        ? {
            identifiant:
              confiance.identifiantCategorieFournisseur,
          }
        : {}),
    })
  );
}

/**
 * Compatibilité de lecture avec les agrégats créés avant F1.
 *
 * Une ancienne réservation n'avait pas toujours de fournisseur et ne portait
 * pas de type de lien. On la classe au niveau le moins engageant (`recherche`)
 * et on rend son origine legacy explicite. La fonction ne donne jamais le
 * niveau `verifie` : l'absence de `confiance` reste normalisée par
 * `ElementSchema` vers `suggestion`.
 */
function normaliserParcoursLegacy(valeur: unknown): unknown {
  if (!estObjet(valeur) || !Array.isArray(valeur.timeline)) return valeur;

  return {
    ...valeur,
    timeline: valeur.timeline.map((moment) => {
      if (!estObjet(moment) || !Array.isArray(moment.elements)) return moment;
      return {
        ...moment,
        elements: moment.elements.map((element) => {
          if (!estObjet(element)) return element;

          if (element.type === 'hebergement') {
            const {
              reservation: _reservationAmbigue,
              confiance: confianceLegacy,
              ...hotelSansReservation
            } = element;
            const confiance =
              estObjet(confianceLegacy) &&
              confianceLegacy.niveau === 'verifie' &&
              !estConfianceFoursquareHotelValide(confianceLegacy)
                ? { niveau: 'suggestion' }
                : confianceLegacy;
            return {
              ...hotelSansReservation,
              ...(confiance === undefined ? {} : { confiance }),
            };
          }

          if (!estObjet(element.reservation)) return element;
          const reservation = element.reservation;
          return {
            ...element,
            reservation: {
              ...reservation,
              fournisseur:
                reservation.fournisseur === undefined
                  ? 'Inconnu (legacy)'
                  : reservation.fournisseur,
              typeLien:
                reservation.typeLien === undefined
                  ? 'recherche'
                  : reservation.typeLien,
            },
          };
        }),
      };
    }),
  };
}

export const ParcoursSchema = z
  .object({
    id: z.string().min(1),
    intention: IntentionSchema,
    contexte: ContexteSchema,
    participants: z.array(ParticipantSchema).min(1),
    budget: BudgetSchema,
    ambiance: z.string().optional(),
    visibilite: VisibiliteSchema.default('prive'),
    historique: z.array(ModificationSchema).default([]),
    timeline: z.array(MomentSchema).default([]),
  })
  .superRefine((parcours, contexte) => {
    parcours.timeline.forEach((moment, indexMoment) => {
      moment.elements.forEach((element, indexElement) => {
        if (element.type === 'hebergement' && element.reservation) {
          contexte.addIssue({
            code: 'custom',
            message:
              'un hébergement porte un lien de recherche, jamais une réservation',
            path: [
              'timeline',
              indexMoment,
              'elements',
              indexElement,
              'reservation',
            ],
          });
        }
        if (
          element.type === 'hebergement' &&
          element.confiance.niveau === 'verifie' &&
          !estConfianceFoursquareHotelValide(element.confiance)
        ) {
          contexte.addIssue({
            code: 'custom',
            message:
              'un hébergement vérifié exige une provenance Foursquare complète',
            path: [
              'timeline',
              indexMoment,
              'elements',
              indexElement,
              'confiance',
              'fournisseur',
            ],
          });
        }
        if (element.sejourHebergement && element.type !== 'hebergement') {
          contexte.addIssue({
            code: 'custom',
            message: 'un séjour hôtelier ne peut qualifier qu’un hébergement',
            path: ['timeline', indexMoment, 'elements', indexElement, 'sejourHebergement'],
          });
        }
        if (
          element.sejourHebergement &&
          parcours.contexte.dates &&
          !estSejourHebergementDansDatesParcours(
            element.sejourHebergement,
            parcours.contexte.dates
          )
        ) {
          contexte.addIssue({
            code: 'custom',
            message: 'le séjour hôtelier doit rester cohérent avec les dates du parcours',
            path: ['timeline', indexMoment, 'elements', indexElement, 'sejourHebergement'],
          });
        }
        if (
          element.lienRechercheHebergement &&
          element.type !== 'hebergement'
        ) {
          contexte.addIssue({
            code: 'custom',
            message: 'un lien de recherche hôtelière ne peut qualifier qu’un hébergement',
            path: ['timeline', indexMoment, 'elements', indexElement, 'lienRechercheHebergement'],
          });
        }
        if (
          element.lienRechercheHebergement &&
          !element.sejourHebergement
        ) {
          contexte.addIssue({
            code: 'custom',
            message: 'un lien de recherche hôtelière exige un séjour non ambigu',
            path: ['timeline', indexMoment, 'elements', indexElement, 'lienRechercheHebergement'],
          });
        }
        if (
          element.lienRechercheHebergement &&
          parcours.contexte.occupationHebergement?.statut !== 'declaree'
        ) {
          contexte.addIssue({
            code: 'custom',
            message: 'un lien de recherche hôtelière exige une occupation déclarée',
            path: ['timeline', indexMoment, 'elements', indexElement, 'lienRechercheHebergement'],
          });
        }
        if (
          element.lienRechercheHebergement &&
          element.sejourHebergement &&
          parcours.contexte.occupationHebergement?.statut === 'declaree'
        ) {
          if (
            !estLienRechercheHebergementCoherent(
              element.lienRechercheHebergement,
              element.sejourHebergement,
              parcours.contexte.occupationHebergement
            )
          ) {
            contexte.addIssue({
              code: 'custom',
              message: 'le lien de recherche hôtelière doit reprendre le séjour et l’occupation déclarés',
              path: ['timeline', indexMoment, 'elements', indexElement, 'lienRechercheHebergement'],
            });
          }
        }
      });
    });
  });

/**
 * À utiliser uniquement aux frontières de lecture persistée. Les nouvelles
 * générations et écritures passent par `ParcoursSchema`, qui reste strict.
 */
export const ParcoursLectureSchema = z.preprocess(normaliserParcoursLegacy, ParcoursSchema);

export type Role = z.infer<typeof RoleSchema>;
export type Visibilite = z.infer<typeof VisibiliteSchema>;
export type TypeElement = z.infer<typeof TypeElementSchema>;
export type StatutElement = z.infer<typeof StatutElementSchema>;
export type Intention = z.infer<typeof IntentionSchema>;
export type Contexte = z.infer<typeof ContexteSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type PlageHoraire = z.infer<typeof PlageHoraireSchema>;
export type OccupationHebergement = z.infer<typeof OccupationHebergementSchema>;
export type OccupationHebergementDeclaree = z.infer<
  typeof OccupationHebergementDeclareeSchema
>;
export type SejourHebergement = z.infer<typeof SejourHebergementSchema>;
export type Contrainte = z.infer<typeof ContrainteSchema>;
export type Avis = z.infer<typeof AvisSchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type NiveauConfiance = z.infer<typeof NiveauConfianceSchema>;
export type Confiance = z.infer<typeof ConfianceSchema>;
export type TypeLienExterne = z.infer<typeof TypeLienExterneSchema>;
export type Reservation = z.infer<typeof ReservationSchema>;
export type LienRechercheHebergement = z.infer<
  typeof LienRechercheHebergementSchema
>;
export type Element = z.infer<typeof ElementSchema>;
export type Moment = z.infer<typeof MomentSchema>;
export type Modification = z.infer<typeof ModificationSchema>;
export type Parcours = z.infer<typeof ParcoursSchema>;
