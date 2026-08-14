import type {
  Confiance,
  LienExterne,
  TypeElement,
} from '../../domaine/parcours/index.js';
import type { CandidatJournal } from '../../services/claude/outils.js';
import type { ResultatResolutionLien } from '../../services/liens/contrat.js';
import type { ElementGenere } from './contratLLM.js';

// DÉCIDER CE QU'ON PEUT AFFIRMER : la résolution cherche des preuves, la
// confiance transforme ces preuves en affirmation produit. C'est ici que la
// règle « aucun faux parcours présenté comme réel » est portée par le serveur —
// un candidat rapproché devient `verifie`, son absence reste `suggestion`, un
// lien externe n'apparaît qu'avec une résolution suffisante.

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
 * Un résultat Web non résolu ne devient jamais un lien exact. Pour un lieu
 * Foursquare vérifié, le lien carte déjà porté par le candidat reste toutefois
 * une action honnête de type `carte`. F3-B sait vérifier l'identité d'un
 * hébergement, mais ses liens restent volontairement hors de ce sous-lot.
 */
export function tracerLieuReel(
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
  lienExterne?: LienExterne;
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
        lienExterne: {
          url: resolutionLien.url,
          fournisseur: resolutionLien.fournisseurRecherche,
          typeLien: resolutionLien.typeLien,
        },
      };
    }
    if (
      candidat.fournisseur === 'Foursquare' &&
      'lienCarte' in candidat
    ) {
      return {
        nom: candidat.nom,
        lieu,
        confiance,
        lienExterne: {
          url: candidat.lienCarte,
          fournisseur: 'Google Maps',
          typeLien: 'carte',
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
