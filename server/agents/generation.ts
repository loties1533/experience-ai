import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callAIAvecOutils, parseJSON } from '../services/claude/core.js';
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
  PlageHoraireSchema,
  TypeElementSchema,
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
  justificationTransportDemande,
  libelleTransportDemande,
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
import type { PreferencesParcours } from '../domaine/preferences.js';
import type { TypeMetierRecherche } from '../services/rechercheExterne.js';
import type {
  DemandeResolutionLien,
  ResultatResolutionLien,
} from '../services/liens/contrat.js';

const CONCURRENCE_MAX_RESOLUTION_LIENS = 3;

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

const SYSTEM_GENERATION = `Tu construis un parcours personnalisé : un ensemble cohérent de moments autour d'une intention et d'un contexte.

AVANT D'ÉCRIRE, CHERCHE. Tu disposes d'outils qui rendent de vrais lieux, de vrais événements et la météo attendue.
- Appelle-les d'abord, et groupe tes recherches (plusieurs outils dans le même tour) : tu as peu de tours.
- Reprends EXACTEMENT le nom rendu par un outil, sans le reformuler.
- N'invente JAMAIS un nom d'établissement, une date de match ni un événement. Si une recherche ne rend rien (lieu, événement OU date), reste générique et honnête ("un bar à cocktails du centre", "un match de la saison à voir sur place") — sans faire passer une invention pour un fait.
- Pour un hébergement nommé, appelle chercher_lieux avec typeMetierRecherche "hebergement". Sans candidat Foursquare hôtelier, écris une suggestion générique et ne conserve aucun nom propre.
- Si le brief porte un besoin d'hébergement, respecte chaque séjour (ville, arrivée, départ) sans le remplacer par les dates globales. L'occupation décrit la demande seulement : n'affirme jamais une disponibilité.
- Pour tout élément de type transport, ne fournis aucun nom commercial, opérateur, numéro, gare, aéroport, code, terminal, quai, porte, horaire exact, durée exacte, lien, billet, disponibilité ni réservation.
- Un transport reste une suggestion générique à organiser. Un éventuel coût est seulement approximatif : ne le présente jamais comme un tarif réel, observé, disponible ou garanti.
- Utilise uniquement les tronçons, dates civiles, créneaux symboliques, modes souhaités et occupants explicitement déclarés dans le brief transport. Ne transforme jamais un créneau en heure exacte.
- N'écris jamais d'URL : les liens sont ajoutés après toi.

Puis réponds UNIQUEMENT avec l'une de ces deux formes JSON :
1. Parcours possible : {"ambiance": string, "moments": [...]}.
2. Donnée ESSENTIELLE introuvable (par exemple l'événement daté qui constitue le motif même du parcours) :
   - pour un lieu : {"refus":{"code":"donnees_essentielles_insuffisantes","message":string,"besoinEssentiel":{"typeMetierRecherche":"restaurant"|"activite"|"sortie","villeDemandee":string,"requete":string}}}
   - pour un événement : {"refus":{"code":"donnees_essentielles_insuffisantes","message":string,"besoinEssentiel":{"typeMetierRecherche":"evenement","villeDemandee":string,"dateDebut":"AAAA-MM-JJ","dateFin":"AAAA-MM-JJ"}}}
Le besoin essentiel doit reprendre exactement la recherche qui n'a pas permis de confirmer la donnée.
Une donnée facultative absente ne justifie jamais un refus : reste générique DANS le parcours. N'écris JAMAIS de phrase d'explication hors du JSON.
- Chaque moment : {"titre": string, "ville": string, "elements": [...]}. "ville" doit reprendre exactement une ville du brief, surtout pour un parcours multi-ville.
- Chaque élément : {"ref": string (identifiant court unique, ex "resto-soir-1"), "type": "activite"|"restaurant"|"sortie"|"transport"|"hebergement"|"evenement"|"temps_libre", "identifiantExterne": string (à recopier lorsqu'un outil l'a fourni), "nom": string, "lieu": string, "plage": {"debut": ISO, "fin": ISO} (optionnel), "prix": number en euros (optionnel), "justification": string (POURQUOI cet élément sert l'intention — obligatoire), "dependDe": [refs] (optionnel), "estAncre": boolean (optionnel).
- "sortie" = ce qui se vit le soir (bar, club, tournée, apéro). Ne JAMAIS le ranger en "temps_libre".
- "temps_libre" = une vraie respiration (repos, pause, réveil tranquille), rien d'autre.
- Prévois des temps libres assumés (la respiration).
- Si le brief donne des dates, TOUTES les plages horaires doivent tomber entre ces dates.
- Reste dans le budget si fourni. Jamais de lien de réservation.`;

const ElementGenereSchema = z.object({
  ref: z.string().min(1),
  type: TypeElementSchema,
  identifiantExterne: z.string().min(1).optional(),
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  justification: z.string().min(1),
  dependDe: z.array(z.string()).default([]),
  estAncre: z.boolean().default(false),
});

const SortieGenerationSchema = z.object({
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

const RefusGenerationSchema = z.object({
  refus: z.object({
    code: z.literal('donnees_essentielles_insuffisantes'),
    message: z.string().min(1),
    besoinEssentiel: BesoinEssentielSchema.optional(),
  }),
});

type ElementGenere = z.infer<typeof ElementGenereSchema>;
type MomentGenere = z.infer<
  typeof SortieGenerationSchema
>['moments'][number];

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

/**
 * Le prompt réduit les hallucinations ; cette frontière les rend inoffensives.
 *
 * Sans demande validée, un transport ajouté spontanément par le modèle
 * disparaît. Avec une demande validée, seuls le prix numérique (toujours
 * marqué estimé plus bas), les dépendances techniques et la référence locale
 * survivent. Toute phrase, identité, localisation ou heure vient du serveur et
 * de la demande utilisateur, jamais du modèle.
 *
 * Un moment mixte est séparé : les horaires légitimes de ses autres éléments
 * restent intacts, tandis que le transport rejoint un wrapper sans plage.
 */
export function nettoyerMomentsTransport(
  moments: MomentGenere[],
  demandeTransport: DemandeTransport | undefined
): MomentGenere[] {
  let indexTroncon = 0;
  const nettoyes: MomentGenere[] = [];
  const refsTransport = new Set(
    moments.flatMap((moment) =>
      moment.elements
        .filter((element) => element.type === 'transport')
        .map((element) => element.ref)
    )
  );

  for (const moment of moments) {
    const autresElements = moment.elements
      .filter((element) => element.type !== 'transport')
      .map((element) => ({
        ...element,
        dependDe: element.dependDe.filter(
          (ref) => !refsTransport.has(ref)
        ),
      }));
    const transports: ElementGenere[] = [];

    for (const element of moment.elements) {
      if (element.type !== 'transport') continue;
      const troncon = demandeTransport?.troncons[indexTroncon];
      indexTroncon += 1;
      if (!troncon) continue;

      transports.push({
        ref: element.ref,
        type: 'transport',
        nom: libelleTransportDemande(troncon),
        ...(element.prix === undefined ? {} : { prix: element.prix }),
        justification: justificationTransportDemande(troncon),
        // Sans preuve F4, aucune relation fonctionnelle proposée par le LLM
        // ne qualifie un transport ou un autre élément.
        dependDe: [],
        estAncre: false,
      });
    }

    if (autresElements.length > 0) {
      nettoyes.push({
        ...moment,
        // Dès qu'un wrapper contenait un transport, son titre libre peut
        // contenir un vol, une gare ou une heure. On le reconstruit depuis
        // les éléments non transport au lieu d'essayer de filtrer sa prose.
        titre:
          refsTransport.size > 0 &&
          moment.elements.some(
            (element) => element.type === 'transport'
          )
            ? autresElements.length === 1
              ? autresElements[0].nom
              : 'Moment du parcours'
            : moment.titre,
        elements: autresElements,
      });
    }
    if (transports.length > 0) {
      nettoyes.push({
        titre:
          transports.length === 1
            ? transports[0].nom
            : 'Transports à organiser',
        elements: transports,
      });
    }
  }

  return nettoyes;
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
function nomSuggestion(type: TypeElement, ville?: string): string {
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

export async function genererParcours(
  briefRecu: Brief,
  preferences: PreferencesParcours | null = null
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
  const prompt = `Construis un parcours pour ce brief :
${JSON.stringify(brief, null, 2)}${blocPreferences}`;

  // Une boîte par génération : le journal des lieux trouvés appartient à CE
  // parcours (le cache des appels, lui, est partagé — cf. lib/cacheMemoire).
  const boite = creerBoiteAOutils({ villesAutorisees: brief.lieux });
  const brut = await callAIAvecOutils(prompt, SYSTEM_GENERATION, boite, 'pack');
  // Un modèle outillé peut conclure en prose ou tronquer son JSON : c'est une
  // sortie inexploitable, pas une panne du serveur.
  let contenu: unknown;
  try {
    contenu = parseJSON(brut);
  } catch {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502);
  }
  // Aucun fournisseur d'IA n'a répondu (clé à sec, quotas, panne) : le mode
  // secours renvoie ce signal explicite. On le distingue d'un vrai « charabia »
  // — ici réessayer tout de suite ne sert à rien, d'où un 503 (service
  // indisponible) et un message honnête, plutôt qu'un 502 « réessaie ».
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
    const statutRecherche = refus.data.refus.besoinEssentiel
      ? boite.statutRechercheEssentielle(refus.data.refus.besoinEssentiel)
      : undefined;
    if (statutRecherche === 'indisponible') {
      throw new AppError(
        'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
        503
      );
    }
    throw new AppError(refus.data.refus.message, 422);
  }
  const sortie = SortieGenerationSchema.safeParse(contenu);
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502);
  }
  const momentsNettoyes = nettoyerMomentsTransport(
    sortie.data.moments,
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
    boite,
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
    ambiance: sortie.data.ambiance ?? brief.ambiance,
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
    throw new AppError('La génération a produit un parcours incohérent, réessaie', 502);
  }
  return parcours;
}
