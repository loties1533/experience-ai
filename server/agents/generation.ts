import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  callAIAvecOutils,
  parseJSON,
  type MetriquesAppelOutils,
} from '../services/claude/core.js';
import {
  creerBoiteAOutils,
  type BoiteAOutils,
  type CandidatJournal,
} from '../services/claude/outils.js';
import {
  cleDemandeResolutionLien,
  estNomTropGenerique,
  resoudreLien,
} from '../services/liens.js';
import { AppError } from '../lib/AppError.js';
import {
  ParcoursSchema,
  estSejourHebergementDansDatesParcours,
  validerParcours,
  type Confiance,
  type Parcours,
  type Reservation,
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
  type Brief,
} from './brief.js';
import {
  deriverPlan,
  numeroDeJour,
  type LotPrevu,
} from './generation/plan.js';
import {
  MESSAGE_PUBLIC_REFUS_HORS_PERIMETRE,
  RefusGenerationSchema,
  SortieGenerationSchema,
  SYSTEM_GENERATION,
  type ElementGenere,
  type MomentGenere,
} from './generation/contratLLM.js';
import {
  momentDeTransition,
  nettoyerMomentsTransport,
} from './generation/transport.js';
import type { PreferencesParcours } from '../domaine/preferences.js';
import type { TypeMetierRecherche } from '../services/rechercheExterne.js';
import type {
  DemandeResolutionLien,
  ResultatResolutionLien,
} from '../services/liens/contrat.js';

// Surface publique historique : `generation.ts` reste le point d'entrée
// canonique du produit. Les symboles extraits vers ./generation/* y sont
// ré-exportés pour ne pas casser les importateurs existants.
export { deriverPlan } from './generation/plan.js';
export type { PlanGeneration } from './generation/plan.js';
export { nettoyerMomentsTransport } from './generation/transport.js';

const CONCURRENCE_MAX_RESOLUTION_LIENS = 3;

// Un lot techniquement indisponible (503) est rejoué seul, sans toucher aux
// lots déjà validés. Au-delà de cette borne, la génération échoue sans exposer
// de parcours partiel. Un refus métier (422) ou une sortie inexploitable (502)
// ne se rejoue pas : ce ne sont pas des indisponibilités techniques.
const TENTATIVES_MAX_PAR_LOT = 2;

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

interface ElementPrepare {
  element: ElementGenere;
  candidat?: CandidatJournal;
  cleDemandeLien?: string;
}

interface MomentPrepare {
  moment: z.infer<typeof SortieGenerationSchema>['moments'][number];
  ville?: string;
  elements: ElementPrepare[];
}

function cleTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function villeDuMoment(villeProposee: string | undefined, villesDuBrief: string[]): string | undefined {
  if (villeProposee) {
    const cleVille = cleTexte(villeProposee);
    const villeValidee = villesDuBrief.find((ville) => cleTexte(ville) === cleVille);
    if (villeValidee) return villeValidee;
  }
  return villesDuBrief.length === 1 ? villesDuBrief[0] : undefined;
}

function typeRecherchePour(typeElement: TypeElement): TypeMetierRecherche | undefined {
  if (
    typeElement === 'restaurant' ||
    typeElement === 'activite' ||
    typeElement === 'sortie' ||
    typeElement === 'hebergement' ||
    typeElement === 'evenement'
  ) {
    return typeElement;
  }
  return undefined;
}

function texteNonVide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && valeur.trim().length > 0;
}

function construireDemandeResolutionLien(
  candidat: CandidatJournal,
): DemandeResolutionLien | undefined {
  if (
    !texteNonVide(candidat.identifiantExterne) ||
    !texteNonVide(candidat.nom) ||
    !texteNonVide(candidat.villeDemandee) ||
    !texteNonVide(candidat.source) ||
    !texteNonVide(candidat.recupereLe) ||
    Number.isNaN(Date.parse(candidat.recupereLe))
  ) {
    return undefined;
  }

  // Le chemin hôtelier F3-C2 reste local. Un hôtel Foursquare vérifié ne doit
  // jamais déclencher Tavily ni produire une réservation.
  if (candidat.typeMetierRecherche === 'hebergement') {
    return undefined;
  }

  const adresseOuSalle =
    candidat.typeMetierRecherche === 'evenement'
      ? candidat.salle
      : candidat.adresse;
  const commun = {
    identifiantExterne: candidat.identifiantExterne.trim(),
    nom: candidat.nom.trim(),
    villeDemandee: candidat.villeDemandee.trim(),
    adresseOuSalle: texteNonVide(adresseOuSalle)
      ? adresseOuSalle.trim()
      : undefined,
    sourceMetier: candidat.source.trim(),
  };

  if (candidat.typeMetierRecherche === 'evenement') {
    if (
      candidat.fournisseur !== 'PredictHQ' ||
      !texteNonVide(candidat.dateDebut)
    ) {
      return undefined;
    }
    return {
      ...commun,
      typeMetierRecherche: 'evenement',
      fournisseurMetier: 'PredictHQ',
      dateDebut: candidat.dateDebut.trim(),
      dateFin: texteNonVide(candidat.dateFin)
        ? candidat.dateFin.trim()
        : undefined,
    };
  }

  if (candidat.fournisseur !== 'Foursquare') {
    return undefined;
  }
  return {
    ...commun,
    typeMetierRecherche: candidat.typeMetierRecherche,
    fournisseurMetier: 'Foursquare',
  };
}

function preparerMomentsPourResolution(
  moments: z.infer<typeof SortieGenerationSchema>['moments'],
  boite: BoiteAOutils,
  villesDuBrief: string[],
): {
  moments: MomentPrepare[];
  demandes: Map<string, DemandeResolutionLien>;
} {
  const demandes = new Map<string, DemandeResolutionLien>();
  const momentsPrepares = moments.map((moment) => {
    const ville = villeDuMoment(moment.ville, villesDuBrief);
    const elements = moment.elements.map((element): ElementPrepare => {
      const typeMetierRecherche = typeRecherchePour(element.type);
      const candidat =
        typeMetierRecherche && ville
          ? boite.rapprocherCandidat({
              identifiantExterne: element.identifiantExterne,
              nom: element.nom,
              villeDemandee: ville,
              typeMetierRecherche,
              adresse:
                typeMetierRecherche === 'hebergement'
                  ? element.lieu
                  : undefined,
            })
          : undefined;
      if (!candidat) return { element };

      if (candidat.typeMetierRecherche === 'hebergement') {
        return { element, candidat };
      }

      const demande = construireDemandeResolutionLien(candidat);
      if (!demande) return { element };
      if (estNomTropGenerique(candidat.nom)) {
        return { element, candidat };
      }

      const cleDemandeLien = cleDemandeResolutionLien(demande);
      if (!demandes.has(cleDemandeLien)) {
        demandes.set(cleDemandeLien, demande);
      }
      return { element, candidat, cleDemandeLien };
    });
    return { moment, ville, elements };
  });

  return { moments: momentsPrepares, demandes };
}

async function resoudreDemandesLien(
  demandes: Map<string, DemandeResolutionLien>,
): Promise<Map<string, ResultatResolutionLien>> {
  const entrees = [...demandes.entries()];
  const resultats = new Map<string, ResultatResolutionLien>();
  let prochainIndex = 0;

  async function executerFile(): Promise<void> {
    while (prochainIndex < entrees.length) {
      const index = prochainIndex;
      prochainIndex += 1;
      const [cleDemande, demande] = entrees[index];
      try {
        const resultat = await resoudreLien(demande);
        resultats.set(cleDemande, resultat);
      } catch {
        // Le lien est facultatif : une exception inattendue reste une
        // indisponibilité technique locale, sans interrompre les autres
        // résolutions et sans produire de repli.
        console.warn(
          'Résolution facultative de lien indisponible après une erreur technique inattendue.',
        );
      }
    }
  }

  const nombreExecutants = Math.min(
    CONCURRENCE_MAX_RESOLUTION_LIENS,
    entrees.length,
  );
  await Promise.all(
    Array.from({ length: nombreExecutants }, () => executerFile()),
  );
  return resultats;
}

function confianceVerifiee(args: {
  source: string;
  fournisseur: string;
  recupereLe: string;
  identifiantExterne: string;
  categorieFournisseur?: string;
  identifiantCategorieFournisseur?: string;
  villeConfirmee?: string;
  adresse?: string;
}): Confiance {
  return {
    niveau: 'verifie',
    source: args.source,
    fournisseur: args.fournisseur,
    recupereLe: args.recupereLe,
    identifiantExterne: args.identifiantExterne,
    categorieFournisseur: args.categorieFournisseur,
    identifiantCategorieFournisseur:
      args.identifiantCategorieFournisseur,
    villeConfirmee: args.villeConfirmee,
    adresse: args.adresse,
  };
}

/** Un résultat sans preuve reste une idée générique, jamais un faux nom propre. */
export function nomSuggestion(type: TypeElement, ville?: string): string {
  const endroit = ville ? ` à ${ville}` : '';
  const noms: Record<TypeElement, string> = {
    activite: `Une activité adaptée à l’intention${endroit}`,
    restaurant: `Un restaurant à choisir${endroit}`,
    sortie: `Une sortie à choisir${endroit}`,
    transport: `Un transport à organiser${endroit}`,
    hebergement: `Un hébergement à choisir${endroit}`,
    evenement: `Un événement à confirmer${endroit}`,
    temps_libre: 'Un temps libre',
  };
  return noms[type];
}

/**
 * Ce qui, dans un élément, vient d'une recherche réelle et non du modèle.
 *
 * Quand le nom proposé correspond à un candidat Foursquare ou PredictHQ, on
 * conserve son identité et sa provenance. Un lien externe n'est ajouté que
 * lorsque le pipeline F2-B retourne `resolu` après sélection, validation URL,
 * contrôle DNS/SSRF et redirections.
 *
 * Aucun résultat ambigu, refusé, introuvable ou indisponible ne déclenche de
 * repli par nom ou par carte. F3-B sait vérifier l'identité d'un hébergement,
 * mais ses liens restent volontairement hors de ce sous-lot.
 */
function tracerLieuReel(
  element: ElementGenere,
  candidat: CandidatJournal | undefined,
  resolutionLien: ResultatResolutionLien | undefined,
  options: {
    ville?: string;
  }
): {
  nom: string;
  lieu?: string;
  confiance: Confiance;
  reservation?: Reservation;
} {
  if (element.type === 'transport') {
    return {
      nom: element.nom,
      confiance: { niveau: 'suggestion' },
    };
  }

  const lieuReel = candidat
    ? candidat.typeMetierRecherche === 'evenement'
      ? candidat.salle
      : candidat.adresse
    : undefined;
  // Une identité hôtelière vérifiée ne récupère jamais l'adresse proposée par
  // le modèle : si Foursquare n'en donne pas, le champ reste absent. Les autres
  // types conservent leur comportement F2 existant.
  const lieu =
    candidat?.typeMetierRecherche === 'hebergement'
      ? lieuReel
      : lieuReel ?? element.lieu;

  // Un temps libre ne se réserve pas (invariant 4) : rien à y rattacher.
  if (element.type === 'temps_libre') {
    return {
      nom: nomSuggestion(element.type, options.ville),
      lieu,
      confiance: { niveau: 'suggestion' },
    };
  }

  if (candidat) {
    const confiance = confianceVerifiee({
      source: candidat.source,
      fournisseur: candidat.fournisseur,
      recupereLe: candidat.recupereLe,
      identifiantExterne: candidat.identifiantExterne,
      categorieFournisseur: candidat.categorieFournisseur,
      identifiantCategorieFournisseur:
        'identifiantCategorieFournisseur' in candidat
          ? candidat.identifiantCategorieFournisseur
          : undefined,
      villeConfirmee: candidat.villeConfirmee,
      adresse:
        candidat.typeMetierRecherche === 'evenement'
          ? undefined
          : candidat.adresse,
    });
    if (resolutionLien?.statut === 'resolu') {
      return {
        nom: candidat.nom,
        lieu,
        confiance,
        reservation: {
          lienExterne: resolutionLien.url,
          fournisseur: resolutionLien.fournisseurRecherche,
          typeLien: resolutionLien.typeLien,
        },
      };
    }
    return { nom: candidat.nom, lieu, confiance };
  }

  return {
    nom: nomSuggestion(element.type, options.ville),
    // Le lieu écrit par le modèle n'est pas conservé : il ferait passer une
    // localisation non vérifiée pour une adresse.
    confiance: { niveau: 'suggestion' },
  };
}

function validerDonneesHotelieresEssentielles(brief: Brief): void {
  if (brief.hebergement?.necessaire !== true) return;

  if (brief.hebergement.occupation.statut !== 'declaree') {
    throw new AppError(
      'L’occupation de l’hébergement doit être confirmée avant la génération.',
      422
    );
  }
  if (brief.hebergement.sejours.length === 0) {
    throw new AppError(
      'La ville et les dates du séjour hôtelier doivent être confirmées avant la génération.',
      422
    );
  }

  const villesAutorisees = new Set(brief.lieux.map(cleTexte));
  if (
    brief.hebergement.sejours.some(
      (sejour) => !villesAutorisees.has(cleTexte(sejour.ville))
    )
  ) {
    throw new AppError(
      'Chaque séjour hôtelier doit correspondre à une ville du brief.',
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
  brief: Brief
): DemandeTransport | undefined {
  if (!brief.transport) {
    if (estParcoursMultiVille(brief)) {
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
 * Le brief remis au modèle pour UN lot : restreint à sa ville et à sa plage de
 * jours. Le transport est retiré (il est synthétisé de façon déterministe après
 * assemblage, jamais par le LLM) et l'hébergement n'est transmis que pour les
 * séjours de cette ville. La durée globale est masquée dès qu'une plage précise
 * la remplace, pour ne pas inviter le modèle à couvrir tout le parcours.
 *
 * F6-F — un lot qui couvre À LUI SEUL tout le plan (mono-ville, mono-bloc)
 * garde les heures précises du brief (ex. une soirée 18h-23h59) plutôt que de
 * les reconstruire en jour civil plein (00:00-23:59:59.999) : cette fenêtre
 * plus large que celle demandée invitait le modèle à raisonner en heure
 * locale et à écrire une plage franchissant minuit UTC, hors du seul jour que
 * couvre le lot. Un plan à plusieurs lots garde la reconstruction : chaque
 * lot n'y couvre qu'une sous-plage de jours du brief, dont le brief ne porte
 * pas les heures.
 */
function briefPourLot(brief: Brief, lot: LotPrevu, lotUniqueDuPlan: boolean): Record<string, unknown> {
  const lieux = lot.ville ? [lot.ville] : brief.lieux;
  const dates =
    lot.plage && !lotUniqueDuPlan
      ? { debut: `${lot.plage.debut}T00:00:00.000Z`, fin: `${lot.plage.fin}T23:59:59.999Z` }
      : brief.dates;

  const sejoursDuLot =
    brief.hebergement?.necessaire === true && lot.ville
      ? brief.hebergement.sejours.filter(
          (sejour) => cleTexte(sejour.ville) === cleTexte(lot.ville as string)
        )
      : [];
  const hebergement =
    brief.hebergement?.necessaire === true && sejoursDuLot.length > 0
      ? { ...brief.hebergement, sejours: sejoursDuLot }
      : undefined;

  return {
    intention: brief.intention,
    avecQui: brief.avecQui,
    ...(lot.plage ? {} : { duree: brief.duree }),
    ...(dates ? { dates } : {}),
    lieux,
    ...(brief.budgetTotal === undefined ? {} : { budgetTotal: brief.budgetTotal }),
    ...(brief.ambiance ? { ambiance: brief.ambiance } : {}),
    contraintes: brief.contraintes,
    ...(hebergement ? { hebergement } : {}),
  };
}

/**
 * Génère un lot : un appel IA outillé, puis la même frontière de méfiance que
 * l'ancien appel unique. Rend les moments bruts validés, ou lève une AppError
 * dont le code porte la politique d'erreur existante (503 technique rejouable,
 * 422 refus métier, 502 sortie inexploitable).
 */
/**
 * F6-B : point d'injection du modèle Anthropic et de récupération des
 * métriques d'appel, réservé au benchmark manuel. Absent (comportement des
 * routes), le modèle par défaut de `callAIAvecOutils` reste inchangé.
 */
export interface OptionsGenerationParcours {
  modele?: string;
  onMetriques?: (metriques: MetriquesAppelOutils) => void;
}

async function genererLot(
  prompt: string,
  boite: BoiteAOutils,
  options: OptionsGenerationParcours = {}
): Promise<z.infer<typeof SortieGenerationSchema>> {
  const brut = await callAIAvecOutils(prompt, SYSTEM_GENERATION, boite, 'pack', options);
  let contenu: unknown;
  try {
    contenu = parseJSON(brut);
  } catch {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'json_invalide');
  }
  if (
    typeof contenu === 'object' &&
    contenu !== null &&
    (contenu as { indisponible?: unknown }).indisponible === true
  ) {
    throw new AppError('Service IA momentanément indisponible, réessaie dans un instant', 503);
  }
  if (
    typeof contenu === 'object' &&
    contenu !== null &&
    (contenu as { outilsIndisponibles?: unknown }).outilsIndisponibles === true
  ) {
    throw new AppError(
      'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
      503
    );
  }
  const refus = RefusGenerationSchema.safeParse(contenu);
  if (refus.success) {
    const { refus: donneesRefus } = refus.data;
    // Refus hors périmètre : aucune recherche associée, donc jamais
    // requalifiable en indisponibilité technique. Le message public est fixe
    // et choisi par le serveur — le contrat ne laisse même pas le modèle
    // fournir de champ "message" pour ce code (cf. RefusHorsPerimetreSchema).
    if (donneesRefus.code === 'hors_perimetre_produit') {
      throw new AppError(MESSAGE_PUBLIC_REFUS_HORS_PERIMETRE, 422);
    }
    // Donnée essentielle introuvable : une recherche vérifiable existe, une
    // panne technique déguisée en refus reste distinguée ici. Comportement
    // inchangé — le message public reste celui fourni par le modèle.
    const statutRecherche = donneesRefus.besoinEssentiel
      ? boite.statutRechercheEssentielle(donneesRefus.besoinEssentiel)
      : undefined;
    if (statutRecherche === 'indisponible') {
      throw new AppError(
        'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
        503
      );
    }
    throw new AppError(donneesRefus.message, 422);
  }
  const sortie = SortieGenerationSchema.safeParse(contenu);
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'schema_generation_invalide');
  }
  return sortie.data;
}

/**
 * Namespace les refs d'un lot pour qu'elles ne puissent jamais entrer en
 * collision avec celles d'un autre lot, et réécrit simultanément tous les
 * `dependDe`. Un `dependDe` qui ne cible pas une ref du même lot fait échouer le
 * lot (jamais supprimé silencieusement) : une dépendance inter-lots ou inconnue
 * révèle une sortie incohérente, pas un manque à combler discrètement.
 */
function namespacerLot(lot: LotPrevu, moments: MomentGenere[]): MomentGenere[] {
  const prefixe = `${lot.id}:`;
  const refs = moments.flatMap((moment) =>
    moment.elements.map((element) => element.ref)
  );
  const refsDuLot = new Set(refs);
  if (refsDuLot.size !== refs.length) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'ref_dupliquee');
  }
  for (const moment of moments) {
    for (const element of moment.elements) {
      for (const dependance of element.dependDe) {
        if (!refsDuLot.has(dependance)) {
          throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'dependance_hors_lot');
        }
      }
    }
  }
  return moments.map((moment) => ({
    ...moment,
    elements: moment.elements.map((element) => ({
      ...element,
      ref: prefixe + element.ref,
      dependDe: element.dependDe.map((dependance) => prefixe + dependance),
    })),
  }));
}

/**
 * Frontière technique, pas seulement textuelle : un moment qui déclare une
 * ville hors du lot, ou un élément dont la plage déborde de celle du lot, fait
 * échouer le lot. Peu importe que ce débordement vienne d'une recherche
 * cross-ville laissée passer ou d'une pure invention du modèle — ni le prompt
 * ni la restriction des outils ne suffisent seuls à le garantir.
 */
function villeHorsLot(ville: string | undefined, lot: LotPrevu): boolean {
  return (
    lot.ville !== undefined &&
    ville !== undefined &&
    cleTexte(ville) !== cleTexte(lot.ville)
  );
}

function plageHorsLot(
  plage: { debut: string; fin: string } | undefined,
  lot: LotPrevu
): boolean {
  if (!lot.plage || !plage) return false;
  const jourDebut = numeroDeJour(plage.debut.slice(0, 10));
  const jourFin = numeroDeJour(plage.fin.slice(0, 10));
  return (
    jourDebut < numeroDeJour(lot.plage.debut) ||
    jourFin > numeroDeJour(lot.plage.fin)
  );
}

function validerScopeLot(lot: LotPrevu, moments: MomentGenere[]): void {
  for (const moment of moments) {
    // Un moment exclusivement transport est un placeholder synthétique dont
    // seule la POSITION compte : `nettoyerMomentsTransport` jette ensuite son
    // contenu (ville, plage, nom) pour le remplacer par le tronçon réel de la
    // demande. Le valider ici rejetterait un lot pour un contenu déjà destiné
    // à disparaître.
    const exclusivementTransport =
      moment.elements.length > 0 &&
      moment.elements.every((element) => element.type === 'transport');
    if (exclusivementTransport) continue;

    if (villeHorsLot(moment.ville, lot)) {
      throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'ville_hors_lot');
    }
    if (plageHorsLot(moment.plage, lot)) {
      throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'plage_hors_lot');
    }
    for (const element of moment.elements) {
      if (element.type === 'transport') continue;
      if (plageHorsLot(element.plage, lot)) {
        throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'plage_hors_lot');
      }
    }
  }
}

/**
 * Génère chaque lot dans l'ordre du plan, avec reprise ciblée sur la seule
 * indisponibilité technique (503) et sans jamais régénérer un lot déjà validé.
 * Chaque TENTATIVE reçoit sa propre boîte à outils, restreinte à la seule
 * ville du lot (jamais aux autres villes du brief) : ni un échec ni une
 * réussite précédente ne laissent de journal résiduel fuiter dans la
 * suivante. Seuls les candidats d'une tentative VALIDÉE rejoignent la boîte
 * d'agrégat utilisée pour la résolution finale des liens.
 */
async function genererEtAssemblerLots(
  brief: Brief,
  blocPreferences: string,
  demandeTransport: DemandeTransport | undefined,
  options: OptionsGenerationParcours = {}
): Promise<{ moments: MomentGenere[]; ambiance?: string; boiteAgregat: BoiteAOutils }> {
  const plan = deriverPlan(brief);
  const momentsParLot: MomentGenere[][] = [];
  const candidatsValides: CandidatJournal[] = [];
  let ambiance: string | undefined;

  for (let index = 0; index < plan.lots.length; index += 1) {
    const lot = plan.lots[index];
    const prompt = `Construis un parcours pour ce brief :
${JSON.stringify(briefPourLot(brief, lot, plan.lots.length === 1), null, 2)}${blocPreferences}`;
    const villesAutoriseesDuLot = lot.ville ? [lot.ville] : brief.lieux;

    let tentative = 0;
    for (;;) {
      // Boîte neuve à chaque tentative : le journal d'un essai en échec ne
      // doit jamais réapparaître au suivant, et une recherche du modèle ne
      // peut techniquement porter que sur la ville de CE lot.
      const boiteLot = creerBoiteAOutils({
        villesAutorisees: villesAutoriseesDuLot,
      });
      const debut = Date.now();
      try {
        const sortie = await genererLot(prompt, boiteLot, options);
        const moments = namespacerLot(lot, sortie.moments);
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
      demandeTransport &&
      suivant?.ville &&
      villeCourante &&
      cleTexte(villeCourante) !== cleTexte(suivant.ville)
    ) {
      momentsAssembles.push(momentDeTransition(index));
    }
  }

  // Boîte d'agrégat : les villes autorisées couvrent tout le brief (la
  // résolution finale travaille sur l'ensemble des moments assemblés), mais
  // son journal ne contient QUE les candidats de tentatives déjà validées.
  const boiteAgregat = creerBoiteAOutils({
    villesAutorisees: brief.lieux,
    candidatsInitiaux: candidatsValides,
  });

  return { moments: momentsAssembles, ambiance, boiteAgregat };
}

export async function genererParcours(
  briefRecu: Brief,
  preferences: PreferencesParcours | null = null,
  options: OptionsGenerationParcours = {}
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
  // Un refus métier local précède tout appel à l'IA ou à un fournisseur :
  // une occupation manquante n'est jamais une panne technique (503).
  validerDonneesHotelieresEssentielles(brief);
  const demandeTransport = validerDonneesTransportEssentielles(brief);

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
  } = await genererEtAssemblerLots(brief, blocPreferences, demandeTransport, options);
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
    brief.lieux,
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
      lieux: brief.lieux,
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
