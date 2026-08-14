import {
  ParcoursSchema,
  estSejourHebergementDansDatesParcours,
  validerParcours,
  verifierResponsabilite,
  type Confiance,
  type ContexteModification,
  type DemandeModificationHotelClient,
  type Element,
  type OccupationHebergementDeclaree,
  type Parcours,
  type ResultatModification,
  type SejourHebergement,
} from '../domaine/parcours/index.js';
import { AppError } from '../lib/AppError.js';
import { creerLienRechercheHebergement } from '../lib/url.js';
import { rechercherLieuxFoursquare } from './foursquare.js';
import type { CandidatHotelExterne } from './rechercheExterne.js';

function cleTexte(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trouverElement(
  parcours: Parcours,
  elementId: string
): Element | undefined {
  return parcours.timeline
    .flatMap((moment) => moment.elements)
    .find((element) => element.id === elementId);
}

function erreur(
  message: string,
  statutHttp?: 403 | 404 | 422
): ResultatModification {
  return {
    ok: false,
    erreur: message,
    ...(statutHttp === undefined ? {} : { statutHttp }),
  };
}

function villeAutorisee(
  parcours: Parcours,
  villeDemandee: string
): boolean {
  // Les agrégats legacy peuvent ne porter aucune liste de lieux. Une liste
  // présente reste en revanche une frontière : la modification ne déplace pas
  // silencieusement tout le parcours vers une nouvelle ville.
  return (
    parcours.contexte.lieux.length === 0 ||
    parcours.contexte.lieux.some(
      (ville) => cleTexte(ville) === cleTexte(villeDemandee)
    )
  );
}

function sejourDansParcours(
  parcours: Parcours,
  sejour: SejourHebergement
): boolean {
  return (
    !parcours.contexte.dates ||
    estSejourHebergementDansDatesParcours(
      sejour,
      parcours.contexte.dates
    )
  );
}

function confianceFoursquare(
  candidat: CandidatHotelExterne
): Confiance {
  return {
    niveau: 'verifie',
    fournisseur: candidat.fournisseur,
    source: candidat.source,
    recupereLe: candidat.recupereLe,
    identifiantExterne: candidat.identifiantExterne,
    categorieFournisseur: candidat.categorieFournisseur,
    identifiantCategorieFournisseur:
      candidat.identifiantCategorieFournisseur,
    villeConfirmee: candidat.villeConfirmee,
    adresse: candidat.adresse,
  };
}

function selectionnerCandidat(
  candidats: CandidatHotelExterne[],
  requete: string
): CandidatHotelExterne | undefined {
  const nomDemande = cleTexte(requete);
  const correspondancesExactes = candidats.filter(
    (candidat) => cleTexte(candidat.nom) === nomDemande
  );
  if (correspondancesExactes.length === 1) {
    return correspondancesExactes[0];
  }
  // Même seul, un résultat dont le nom diffère de la demande n'est pas une
  // preuve d'identité. Les faux négatifs restent préférables à un hôtel réel
  // mais différent présenté comme le choix de l'utilisateur.
  return undefined;
}

function reconstruireLien(
  element: Element,
  sejour: SejourHebergement,
  occupation: OccupationHebergementDeclaree | undefined,
  genereLe: string
): Element {
  const {
    lienRechercheHebergement: _ancienLien,
    lienExterne: _ancienLienExterne,
    ...sansDerives
  } = element;
  const avecSejour: Element = {
    ...sansDerives,
    sejourHebergement: sejour,
  };
  if (!occupation) return avecSejour;

  const nomHotel =
    avecSejour.confiance.niveau === 'verifie' &&
    avecSejour.confiance.fournisseur === 'Foursquare'
      ? avecSejour.nom
      : undefined;
  return {
    ...avecSejour,
    lienRechercheHebergement: creerLienRechercheHebergement(
      { sejour, occupation, nomHotel },
      genereLe
    ),
  };
}

function elementHotelRemplace(
  cible: Element,
  sejour: SejourHebergement,
  occupation: OccupationHebergementDeclaree | undefined,
  candidat: CandidatHotelExterne | undefined,
  genereLe: string
): Element {
  const base: Element = {
    id: cible.id,
    type: 'hebergement',
    nom: candidat
      ? candidat.nom
      : `Un hébergement à choisir à ${sejour.ville}`,
    ...(candidat?.adresse ? { lieu: candidat.adresse } : {}),
    ...(cible.plage ? { plage: cible.plage } : {}),
    ...(cible.prix !== undefined ? { prix: cible.prix } : {}),
    prixEstime: true,
    confiance: candidat
      ? confianceFoursquare(candidat)
      : { niveau: 'suggestion' },
    justification: cible.justification,
    statut: 'propose',
    estAncre: false,
    dependDe: [...cible.dependDe],
    alternatives: [],
    contraintes: [...cible.contraintes],
    sejourHebergement: sejour,
    reactions: [],
  };
  return reconstruireLien(base, sejour, occupation, genereLe);
}

function validerEtHistoriser(
  parcours: Parcours,
  args: {
    description: string;
    horodatage: string;
    elementId?: string;
  }
): ResultatModification {
  const avecHistorique = {
    ...parcours,
    historique: [
      ...parcours.historique,
      {
        date: args.horodatage,
        description: args.description,
        elementId: args.elementId,
      },
    ],
  };
  const validation = ParcoursSchema.safeParse(avecHistorique);
  if (!validation.success) {
    return erreur(
      `Cette modification rendrait le parcours incohérent : ${validation.error.issues[0]?.message ?? 'contrat invalide'}`
    );
  }
  const erreurs = validerParcours(validation.data);
  if (erreurs.length > 0) {
    return erreur(
      `Cette modification rendrait le parcours incohérent : ${erreurs[0]}`
    );
  }
  return {
    ok: true,
    parcours: validation.data,
    elementsARegenerer: [],
    description: args.description,
  };
}

async function rechercherHotel(
  villeDemandee: string,
  requete: string
): Promise<CandidatHotelExterne | undefined> {
  const recherche = await rechercherLieuxFoursquare(
    villeDemandee,
    requete,
    'hebergement',
    4
  );
  if (recherche.statut === 'indisponible') {
    throw new AppError(
      'Foursquare est momentanément indisponible pour remplacer cet hébergement.',
      503
    );
  }
  if (recherche.statut === 'vide') return undefined;
  const candidats = recherche.resultats.filter(
    (candidat): candidat is CandidatHotelExterne =>
      candidat.typeMetierRecherche === 'hebergement'
  );
  return selectionnerCandidat(candidats, requete);
}

async function remplacerHotel(
  parcours: Parcours,
  demande: Extract<
    DemandeModificationHotelClient,
    { type: 'remplacer_hotel' }
  >,
  contexte: ContexteModification
): Promise<ResultatModification> {
  const cible = trouverElement(parcours, demande.elementId);
  if (!cible) {
    return erreur(
      `Aucun élément « ${demande.elementId} » dans ce parcours`,
      404
    );
  }
  if (cible.type !== 'hebergement') {
    return erreur(
      `Aucun hébergement « ${demande.elementId} » dans ce parcours`
    );
  }
  const sejour = demande.sejour ?? cible.sejourHebergement;
  if (!sejour) {
    return erreur(
      'Le séjour doit être déclaré avant de remplacer cet hébergement.'
    );
  }
  if (cleTexte(sejour.ville) !== cleTexte(demande.villeDemandee)) {
    return erreur(
      'La ville du séjour doit correspondre à la ville demandée.'
    );
  }
  if (
    !villeAutorisee(parcours, sejour.ville) ||
    !sejourDansParcours(parcours, sejour)
  ) {
    return erreur(
      'Le séjour demandé ne correspond pas aux villes et dates du parcours.'
    );
  }

  const candidat = await rechercherHotel(
    demande.villeDemandee,
    demande.requete
  );
  const occupation =
    parcours.contexte.occupationHebergement?.statut === 'declaree'
      ? parcours.contexte.occupationHebergement
      : undefined;
  const remplacant = elementHotelRemplace(
    cible,
    sejour,
    occupation,
    candidat,
    contexte.horodatage
  );
  const nouveau: Parcours = {
    ...parcours,
    timeline: parcours.timeline.map((moment) => ({
      ...moment,
      elements: moment.elements.map((element) =>
        element.id === cible.id ? remplacant : element
      ),
    })),
  };
  return validerEtHistoriser(nouveau, {
    description: candidat
      ? `« ${cible.nom} » remplacé par « ${candidat.nom} »`
      : `« ${cible.nom} » remplacé par une suggestion à confirmer`,
    horodatage: contexte.horodatage,
    elementId: cible.id,
  });
}

export async function appliquerModificationHotel(
  parcours: Parcours,
  demande: DemandeModificationHotelClient,
  contexte: ContexteModification
): Promise<ResultatModification> {
  const refus = verifierResponsabilite(
    parcours,
    contexte.auteurId,
    'ajuster'
  );
  if (refus) return erreur(refus, 403);

  if (demande.type === 'remplacer_hotel') {
    return remplacerHotel(parcours, demande, contexte);
  }

  if (demande.type === 'modifier_occupation_hebergement') {
    const contientHotel = parcours.timeline.some((moment) =>
      moment.elements.some((element) => element.type === 'hebergement')
    );
    if (!contientHotel) {
      return erreur(
        'Aucun hébergement ne peut recevoir cette occupation.'
      );
    }
    try {
      const nouveau: Parcours = {
        ...parcours,
        contexte: {
          ...parcours.contexte,
          occupationHebergement: demande.occupation,
        },
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((element) => {
            if (element.type !== 'hebergement') return element;
            const {
              lienRechercheHebergement: _ancienLien,
              ...sansLien
            } = element;
            return element.sejourHebergement
              ? reconstruireLien(
                  sansLien,
                  element.sejourHebergement,
                  demande.occupation,
                  contexte.horodatage
                )
              : sansLien;
          }),
        })),
      };
      return validerEtHistoriser(nouveau, {
        description: 'Occupation hôtelière mise à jour',
        horodatage: contexte.horodatage,
      });
    } catch {
      return erreur(
        'L’occupation déclarée ne permet pas de reconstruire les liens hôteliers.'
      );
    }
  }

  const cible = trouverElement(parcours, demande.elementId);
  if (!cible) {
    return erreur(
      `Aucun élément « ${demande.elementId} » dans ce parcours`,
      404
    );
  }
  if (cible.type !== 'hebergement') {
    return erreur(
      `Aucun hébergement « ${demande.elementId} » dans ce parcours`
    );
  }
  if (
    !villeAutorisee(parcours, demande.sejour.ville) ||
    !sejourDansParcours(parcours, demande.sejour)
  ) {
    return erreur(
      'Le séjour demandé ne correspond pas aux villes et dates du parcours.'
    );
  }

  if (
    cible.sejourHebergement &&
    cleTexte(cible.sejourHebergement.ville) !==
      cleTexte(demande.sejour.ville)
  ) {
    return remplacerHotel(
      parcours,
      {
        type: 'remplacer_hotel',
        elementId: cible.id,
        villeDemandee: demande.sejour.ville,
        requete:
          cible.confiance.niveau === 'verifie' &&
          cible.confiance.fournisseur === 'Foursquare'
            ? cible.nom
            : 'hôtel',
        sejour: demande.sejour,
      },
      contexte
    );
  }

  try {
    const occupation =
      parcours.contexte.occupationHebergement?.statut === 'declaree'
        ? parcours.contexte.occupationHebergement
        : undefined;
    const hotel = reconstruireLien(
      cible,
      demande.sejour,
      occupation,
      contexte.horodatage
    );
    const nouveau: Parcours = {
      ...parcours,
      timeline: parcours.timeline.map((moment) => ({
        ...moment,
        elements: moment.elements.map((element) =>
          element.id === cible.id ? hotel : element
        ),
      })),
    };
    return validerEtHistoriser(nouveau, {
      description: `Séjour de « ${cible.nom} » mis à jour`,
      horodatage: contexte.horodatage,
      elementId: cible.id,
    });
  } catch {
    return erreur(
      'Le séjour déclaré ne permet pas de reconstruire le lien hôtelier.'
    );
  }
}
