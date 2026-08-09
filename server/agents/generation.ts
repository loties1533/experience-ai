import { randomUUID } from 'node:crypto';
import {
  creerBoiteAOutils,
  type BoiteAOutils,
  type CandidatJournal,
} from '../services/claude/outils.js';
import { adapterEvenementEventFirstPourJournal } from '../services/rechercheExterne.js';
import { AppError } from '../lib/AppError.js';
import {
  ParcoursSchema,
  estSejourHebergementDansDatesParcours,
  validerParcours,
  type Parcours,
  type SejourHebergement,
  type TypeElement,
} from '../domaine/parcours/index.js';
import {
  estVilleTransportDemandeePrudente,
  type DemandeTransport,
} from '../domaine/transport/index.js';
import { creerLienRechercheHebergement } from '../lib/url.js';
import { ajouterLiensRechercheTransport } from './enrichissementLiensTransport.js';
import {
  BriefSchema,
  demandeTransportComplete,
  estParcoursMultiVille,
  normaliserDatesBrief,
  villesDeclarees,
  type Brief,
} from './brief.js';
import { deriverPlan } from './generation/plan.js';
import {
  construireContextePlanifiable,
  villesPlanifiees,
} from './generation/preparation.js';
import {
  ContextePlanifiableSchema,
  type ContextePlanifiable,
} from './generation/contratPreparation.js';
import { estDemandeNBAEvenementielle } from './generation/demandeNBA.js';
import { destinationsResoluesParPreparation } from './generation/resolutionDestinations.js';
import type { MomentGenere } from './generation/contratLLM.js';
import {
  momentDeTransition,
  momentDeTransitionSansDemande,
  nettoyerMomentsTransport,
} from './generation/transport.js';
import {
  cleTexte,
  preparerMomentsPourResolution,
  resoudreDemandesLien,
  type MomentPrepare,
} from './generation/resolution.js';
import { tracerLieuReel } from './generation/confiance.js';
import {
  briefPourLot,
  genererLot,
  integrerAncresLot,
  namespacerLot,
  validerScopeLot,
  TENTATIVES_MAX_PAR_LOT,
  type OptionsGenerationParcours,
} from './generation/lot.js';
import type { PreferencesParcours } from '../domaine/preferences.js';

// Surface publique historique : `generation.ts` reste le point d'entrée
// canonique du produit. Les symboles extraits vers ./generation/* y sont
// ré-exportés pour ne pas casser les importateurs existants.
export { deriverPlan } from './generation/plan.js';
export type { PlanGeneration } from './generation/plan.js';
export { nettoyerMomentsTransport } from './generation/transport.js';
export { nomSuggestion } from './generation/confiance.js';
export type { OptionsGenerationParcours } from './generation/lot.js';

// L'ORCHESTRATEUR (IA n°1) : brief confirmé → parcours complet.
// À ne pas confondre avec l'agent Modification (IA n°2, modification.ts) qui
// n'agit qu'à l'intérieur d'un parcours existant, jamais sur l'ensemble.
//
// Il CHERCHE avant d'écrire : des outils lui donnent de vrais lieux et de vrais
// événements (services/claude/outils.ts). Sans eux, il puisait dans sa mémoire
// d'entraînement et sortait des « Bar à cocktails réputé du centre » — sur un
// produit dont la valeur est la cohérence avec un thème, un lieu faux ruine la
// confiance. Depuis F1, une boucle d'outils réellement indisponible provoque
// une erreur technique explicite ; une recherche exécutée mais vide produit
// une suggestion générique si la donnée est facultative, ou un refus métier
// si elle est essentielle.
//
// Ne jamais faire confiance au LLM : sa sortie est revalidée champ par champ,
// les ids sont attribués ICI (jamais par le modèle), les dépendances vers des
// refs inconnues sont écartées, les liens externes ne viennent PAS de lui mais
// des connecteurs, et le parcours final repasse par les invariants du domaine
// avant de sortir.

function destinationsResoluesPourGeneration(
  brief: Brief,
  contextePlanifiable: ContextePlanifiable
): boolean {
  if (!destinationsResoluesParPreparation(contextePlanifiable)) return false;
  // Le contexte événementiel reste le vertical NBA validé par PR4 : un appel
  // direct à la génération ne doit pas pouvoir le greffer à un autre Brief.
  return (
    contextePlanifiable.strategie !== 'decouverte_evenementielle' ||
    estDemandeNBAEvenementielle(brief)
  );
}

function validerDonneesHotelieresEssentielles(
  brief: Brief,
  contextePlanifiable: ContextePlanifiable
): void {
  if (brief.hebergement?.necessaire !== true) return;

  if (brief.hebergement.occupation.statut !== 'declaree') {
    throw new AppError(
      'L’occupation de l’hébergement doit être confirmée avant la génération.',
      422
    );
  }
  if (brief.hebergement.sejours.length === 0) {
    if (destinationsResoluesPourGeneration(brief, contextePlanifiable)) return;
    throw new AppError(
      'La ville et les dates du séjour hôtelier doivent être confirmées avant la génération.',
      422
    );
  }

  const villesAutorisees = new Set(
    (destinationsResoluesPourGeneration(brief, contextePlanifiable)
      ? villesPlanifiees(contextePlanifiable)
      : villesDeclarees(brief).map((ville) => ville.nom)
    ).map(cleTexte)
  );
  if (
    brief.hebergement.sejours.some(
      (sejour) => !villesAutorisees.has(cleTexte(sejour.ville))
    )
  ) {
    throw new AppError(
      'Chaque séjour hôtelier doit correspondre à une ville planifiée.',
      422
    );
  }
  if (
    brief.dates &&
    brief.hebergement.sejours.some(
      (sejour) =>
        !estSejourHebergementDansDatesParcours(sejour, brief.dates as {
          debut: string;
          fin: string;
        })
    )
  ) {
    throw new AppError(
      'Chaque séjour hôtelier doit rester cohérent avec les dates du parcours.',
      422
    );
  }
}

function validerDonneesTransportEssentielles(
  brief: Brief,
  contextePlanifiable: ContextePlanifiable
): DemandeTransport | undefined {
  if (!brief.transport) {
    if (
      estParcoursMultiVille(brief) &&
      contextePlanifiable.strategie !== 'decouverte_evenementielle'
    ) {
      throw new AppError(
        'Le besoin de transport entre les villes doit être confirmé avant la génération.',
        422
      );
    }
    return undefined;
  }
  if (!brief.transport.necessaire) return undefined;

  const demande = demandeTransportComplete(brief);
  if (!demande) {
    throw new AppError(
      'Chaque tronçon et l’occupation du transport doivent être confirmés avant la génération.',
      422
    );
  }
  if (
    demande.troncons.some(
      (troncon) =>
        !estVilleTransportDemandeePrudente(troncon.origine.ville) ||
        !estVilleTransportDemandeePrudente(
          troncon.destination.ville
        )
    )
  ) {
    throw new AppError(
      'Les tronçons doivent désigner des villes, sans gare, aéroport, terminal ni code fournisseur.',
      422
    );
  }
  return demande;
}

function compterHebergementsParVille(
  moments: MomentPrepare[]
): Map<string, number> {
  const nombres = new Map<string, number>();
  for (const moment of moments) {
    if (!moment.ville) continue;
    const nombre = moment.elements.filter(
      ({ element }) => element.type === 'hebergement'
    ).length;
    if (nombre === 0) continue;
    const cleVille = cleTexte(moment.ville);
    nombres.set(cleVille, (nombres.get(cleVille) ?? 0) + nombre);
  }
  return nombres;
}

/**
 * Un séjour n'est rattaché que lorsque la ville du moment désigne un candidat
 * unique et un seul hôtel destinataire. Aucun repli vers la première ville, le
 * premier séjour ou le premier hôtel n'est permis.
 */
function sejourHotelierDuMoment(
  typeElement: TypeElement,
  ville: string | undefined,
  brief: Brief,
  nombresHebergementsParVille: Map<string, number>
): SejourHebergement | undefined {
  if (
    typeElement !== 'hebergement' ||
    !ville ||
    brief.hebergement?.necessaire !== true
  ) {
    return undefined;
  }
  const cleVille = cleTexte(ville);
  if (nombresHebergementsParVille.get(cleVille) !== 1) {
    return undefined;
  }
  const sejours = brief.hebergement.sejours.filter(
    (sejour) => cleTexte(sejour.ville) === cleVille
  );
  return sejours.length === 1 ? sejours[0] : undefined;
}

/**
 * F3-C2 : ajoute un raccourci de recherche Booking uniquement à partir d'un
 * séjour déjà rattaché sans ambiguïté et d'une occupation explicitement
 * déclarée. La première validation du parcours a donc déjà eu lieu.
 *
 * Le nom n'est repris que lorsqu'il constitue une identité Foursquare
 * vérifiée. Une suggestion générique recherche seulement la ville. Une erreur
 * locale reste facultative : elle omet le lien sans dégrader le parcours et
 * sans être transformée en panne fournisseur.
 */
function ajouterLiensRechercheHebergement(parcours: Parcours): Parcours {
  const occupation = parcours.contexte.occupationHebergement;
  if (occupation?.statut !== 'declaree') return parcours;

  const genereLe = new Date().toISOString();
  return {
    ...parcours,
    timeline: parcours.timeline.map((moment) => ({
      ...moment,
      elements: moment.elements.map((element) => {
        if (
          element.type !== 'hebergement' ||
          !element.sejourHebergement
        ) {
          return element;
        }

        const nomHotel =
          element.confiance.niveau === 'verifie' &&
          element.confiance.fournisseur === 'Foursquare'
            ? element.nom
            : undefined;
        try {
          return {
            ...element,
            lienRechercheHebergement: creerLienRechercheHebergement(
              {
                sejour: element.sejourHebergement,
                occupation,
                nomHotel,
              },
              genereLe
            ),
          };
        } catch {
          console.warn(
            'Lien de recherche hôtelière omis après une erreur locale.'
          );
          return element;
        }
      }),
    })),
  };
}

/**
 * Génère chaque lot dans l'ordre du plan, avec reprise ciblée sur la seule
 * indisponibilité technique (503) et sans jamais régénérer un lot déjà validé.
 * Chaque TENTATIVE reçoit sa propre boîte à outils, restreinte à la seule
 * ville du lot (jamais aux autres villes du contexte) : ni un échec ni une
 * réussite précédente ne laissent de journal résiduel fuiter dans la
 * suivante. Seuls les candidats d'une tentative VALIDÉE rejoignent la boîte
 * d'agrégat utilisée pour la résolution finale des liens.
 */
async function genererEtAssemblerLots(
  brief: Brief,
  contextePlanifiable: ContextePlanifiable,
  blocPreferences: string,
  demandeTransport: DemandeTransport | undefined,
  options: OptionsGenerationParcours = {}
): Promise<{ moments: MomentGenere[]; ambiance?: string; boiteAgregat: BoiteAOutils }> {
  const plan = deriverPlan(contextePlanifiable);
  console.info(
    `[plan] strategy=${contextePlanifiable.strategie} steps=${contextePlanifiable.etapes.length} lots=${plan.lots.length}`
  );
  const villesDuContexte = villesPlanifiees(contextePlanifiable);
  const momentsParLot: MomentGenere[][] = [];
  const candidatsValides: CandidatJournal[] = [];
  let ambiance: string | undefined;
  const destinationsResoluesApresIntake =
    destinationsResoluesPourGeneration(brief, contextePlanifiable);

  for (let index = 0; index < plan.lots.length; index += 1) {
    const lot = plan.lots[index];
    const consigneAncres =
      lot.ancres.length > 0
        ? '\nLes ancres fournies dans le brief sont des événements vérifiés : conserve leurs identifiants, noms, villes et dates ; ne les remplace jamais.'
        : '';
    const prompt = `Construis un parcours pour ce brief :
${JSON.stringify(
  briefPourLot(
    brief,
    lot,
    plan.lots.length === 1,
    destinationsResoluesApresIntake
  ),
  null,
  2
)}${consigneAncres}${blocPreferences}`;
    const villesAutoriseesDuLot = lot.ville ? [lot.ville] : villesDuContexte;

    let tentative = 0;
    for (;;) {
      // Boîte neuve à chaque tentative : le journal d'un essai en échec ne
      // doit jamais réapparaître au suivant, et une recherche du modèle ne
      // peut techniquement porter que sur la ville de CE lot.
      const boiteLot = creerBoiteAOutils({
        villesAutorisees: villesAutoriseesDuLot,
        candidatsInitiaux: lot.ancres.map(adapterEvenementEventFirstPourJournal),
      });
      const debut = Date.now();
      try {
        const sortie = await genererLot(prompt, boiteLot, options);
        const moments = namespacerLot(
          lot,
          integrerAncresLot(lot, sortie.moments)
        );
        validerScopeLot(lot, moments);
        // La première ambiance proposée par le modèle habille l'ensemble ; à
        // défaut, celle du brief prend le relais plus loin.
        ambiance ??= sortie.ambiance;
        console.info(
          `[génération] lot ${index + 1}/${plan.lots.length} ` +
            `(${lot.ville ?? 'sans ville'}${lot.plage ? ` ${lot.plage.debut}→${lot.plage.fin}` : ''}) ` +
            `— ${moments.length} moment(s), ${Date.now() - debut} ms, tentative ${tentative + 1}`
        );
        momentsParLot.push(moments);
        // Seule une tentative validée alimente la résolution finale des liens.
        candidatsValides.push(...boiteLot.exporterJournal());
        break;
      } catch (erreur) {
        const rejouable =
          erreur instanceof AppError &&
          erreur.statusCode === 503 &&
          tentative < TENTATIVES_MAX_PAR_LOT;
        if (!rejouable) throw erreur;
        tentative += 1;
        console.warn(
          `[génération] lot ${index + 1}/${plan.lots.length} indisponible, ` +
            `nouvelle tentative ${tentative + 1}/${TENTATIVES_MAX_PAR_LOT + 1}.`
        );
      }
    }
  }

  const momentsAssembles: MomentGenere[] = [];
  for (let index = 0; index < plan.lots.length; index += 1) {
    momentsAssembles.push(...momentsParLot[index]);
    const suivant = plan.lots[index + 1];
    const villeCourante = plan.lots[index].ville;
    if (
      (demandeTransport || destinationsResoluesApresIntake) &&
      suivant?.ville &&
      villeCourante &&
      plan.transitions.some(
        (transition) =>
          cleTexte(transition.origine) === cleTexte(villeCourante) &&
          cleTexte(transition.destination) === cleTexte(suivant.ville as string)
      )
    ) {
      momentsAssembles.push(
        demandeTransport
          ? momentDeTransition(index)
          : momentDeTransitionSansDemande(index)
      );
    }
  }

  // Boîte d'agrégat : les villes autorisées couvrent tout le contexte (la
  // résolution finale travaille sur l'ensemble des moments assemblés), mais
  // son journal ne contient QUE les candidats de tentatives déjà validées.
  const boiteAgregat = creerBoiteAOutils({
    villesAutorisees: villesDuContexte,
    candidatsInitiaux: candidatsValides,
  });

  return { moments: momentsAssembles, ambiance, boiteAgregat };
}

// Le pipeline de bout en bout, une étape par bloc lisible ci-dessous :
//   brief → validation pré-IA (refus 422 déterministes)
//         → plan déterministe (generation/plan)
//         → génération des lots outillés (generation/lot) et assemblage
//         → transport déterministe (generation/transport)
//         → résolution des preuves (generation/resolution)
//         → confiance / anti-hallucination (generation/confiance)
//         → construction du Parcours + attribution des ids serveur
//         → enrichissements (liens hébergement puis transport)
//         → validation finale du domaine → retour.
export async function genererParcours(
  briefRecu: Brief,
  preferences: PreferencesParcours | null = null,
  options: OptionsGenerationParcours = {},
  contextePlanifiableRecu?: ContextePlanifiable
): Promise<Parcours> {
  const resultatBrief = BriefSchema.safeParse(briefRecu);
  if (!resultatBrief.success) {
    throw new AppError('Le brief fourni est invalide.', 400);
  }
  // Une fin de journée posée à minuit exclurait tout le dernier jour : on la
  // ramène au sens courant (« du 4 au 6 » comprend le 6 en entier). Fait ici
  // aussi, et pas seulement à l'intake, car un brief peut arriver directement
  // par l'API sans être passé par le dialogue.
  const brief = normaliserDatesBrief(resultatBrief.data);
  // Compatibilité temporaire des appels internes directs : la route publique
  // transmet le contexte issu de préparerGeneration(). Dans les tests et les
  // usages internes hérités, on dérive la même projection déterministe ici.
  const contextePlanifiable = contextePlanifiableRecu
    ? ContextePlanifiableSchema.parse(contextePlanifiableRecu)
    : construireContextePlanifiable(brief);
  // Un refus métier local précède tout appel à l'IA ou à un fournisseur :
  // une occupation manquante n'est jamais une panne technique (503).
  validerDonneesHotelieresEssentielles(brief, contextePlanifiable);
  const demandeTransport = validerDonneesTransportEssentielles(
    brief,
    contextePlanifiable
  );

  // Mémoire simple (sprint R5) : les préférences orientent, le brief prime.
  const blocPreferences = preferences
    ? `\nPréférences connues de l'utilisateur (souples — le brief prime toujours) :
${JSON.stringify(preferences, null, 2)}`
    : '';

  // Génération progressive : un appel IA par lot du plan, chaque tentative
  // dans sa propre boîte à outils restreinte à sa seule ville (le cache des
  // appels, lui, reste partagé entre générations — cf. lib/cacheMemoire), avec
  // reprise ciblée sur la seule indisponibilité technique, puis assemblage
  // dans l'ordre du plan. La boîte d'agrégat rendue ne porte que les candidats
  // des tentatives validées ; la suite (transport déterministe, ids, liens,
  // enrichissements, validation) ne s'exécute qu'une fois, sur l'agrégat.
  const {
    moments: momentsAssembles,
    ambiance: ambianceGeneree,
    boiteAgregat,
  } = await genererEtAssemblerLots(
    brief,
    contextePlanifiable,
    blocPreferences,
    demandeTransport,
    options
  );
  const momentsNettoyes = nettoyerMomentsTransport(
    momentsAssembles,
    demandeTransport
  );

  // Attribution des ids côté serveur : les refs du LLM ne sortent pas d'ici.
  const idParRef = new Map<string, string>();
  for (const moment of momentsNettoyes) {
    for (const element of moment.elements) {
      if (!idParRef.has(element.ref)) idParRef.set(element.ref, randomUUID());
    }
  }

  // F2-B5 : seules les identités structurées réellement rapprochées sont
  // résolues. Les demandes identiques sont dédupliquées, puis exécutées avec
  // une concurrence bornée ; aucune recherche par nom brut n'est autorisée.
  const preparation = preparerMomentsPourResolution(
    momentsNettoyes,
    boiteAgregat,
    villesPlanifiees(contextePlanifiable),
  );
  const resolutionsLien = await resoudreDemandesLien(
    preparation.demandes,
  );
  const nombresHebergementsParVille = compterHebergementsParVille(
    preparation.moments
  );

  const parcoursSansLiensHotel = ParcoursSchema.parse({
    id: randomUUID(),
    intention: { texte: brief.intention },
    contexte: {
      avecQui: brief.avecQui,
      duree: brief.duree,
      dates: brief.dates,
      // Le Brief reste la déclaration utilisateur ; le contexte du Parcours
      // reflète les villes effectivement retenues par la préparation.
      lieux: villesPlanifiees(contextePlanifiable),
      occupationHebergement:
        brief.hebergement?.necessaire === true
          ? brief.hebergement.occupation
          : undefined,
      demandeTransport,
    },
    participants: [{ id: randomUUID(), nom: 'Organisateur', role: 'organisateur' }],
    budget: { mode: 'individuel', montantTotal: brief.budgetTotal },
    ambiance: ambianceGeneree ?? brief.ambiance,
    timeline: preparation.moments.map(({ moment, ville, elements }) => {
      return {
        id: randomUUID(),
        titre: moment.titre,
        ...(moment.plage ? { plage: moment.plage } : {}),
        elements: elements.map(({ element, candidat, cleDemandeLien }) => {
          const resolutionLien = cleDemandeLien
            ? resolutionsLien.get(cleDemandeLien)
            : undefined;
          const sejourHebergement = sejourHotelierDuMoment(
            element.type,
            ville,
            brief,
            nombresHebergementsParVille
          );
          return {
            id: idParRef.get(element.ref) as string,
            type: element.type,
            ...tracerLieuReel(element, candidat, resolutionLien, {
              ville,
            }),
            ...(element.plage ? { plage: element.plage } : {}),
            ...(element.prix === undefined
              ? {}
              : { prix: element.prix }),
            prixEstime: element.prix !== undefined,
            ...(sejourHebergement
              ? { sejourHebergement }
              : {}),
            justification: element.justification,
            // Une suggestion ne peut jamais devenir une ancre datée.
            estAncre: element.estAncre && candidat !== undefined,
            // Une dépendance vers une ref inventée est écartée, pas propagée.
            dependDe: element.dependDe
              .filter((ref) => idParRef.has(ref) && ref !== element.ref)
              .map((ref) => idParRef.get(ref) as string),
          };
        }),
      };
    }),
  });

  // Les liens de recherche (hébergement puis transport) sont ajoutés après une
  // première validation complète, puis le domaine revalide l'agrégat enrichi
  // avant toute persistance. L'enrichissement transport est facultatif : une
  // extrémité non résolue ou une panne fournisseur laisse simplement le
  // transport sans lien, sans faire échouer la génération.
  const parcoursAvecHebergement = ajouterLiensRechercheHebergement(
    parcoursSansLiensHotel
  );
  const parcoursEnrichi = await ajouterLiensRechercheTransport(
    parcoursAvecHebergement,
    demandeTransport
  );
  const parcours = ParcoursSchema.parse(parcoursEnrichi);
  const erreurs = validerParcours(parcours);
  if (erreurs.length > 0) {
    throw new AppError('La génération a produit un parcours incohérent, réessaie', 502, 'validation_parcours_invalide');
  }
  return parcours;
}
