import {
  evaluerResolutionLieuAerien,
  rechercherLieuxAeriens,
} from '../services/amadeus/index.js';
import {
  evaluerResolutionGareNavitia,
  rechercherGaresNavitia,
} from '../services/navitia/index.js';
import {
  creerLienRechercheTrain,
  creerLienRechercheVol,
} from '../lib/liensTransport.js';
import type {
  DemandeTransport,
  LieuTransportDemande,
  LienRechercheTransport,
  TronconTransportDemande,
} from '../domaine/transport/index.js';
import type { Parcours } from '../domaine/parcours/index.js';

// F4-D2 — brancher dans la génération active les liens de recherche transport
// construits par F4-D1 (`lib/liensTransport.ts`).
//
// L'enrichissement est facultatif et prudent : il ne construit un lien que
// lorsque les DEUX extrémités d'un tronçon se résolvent en une identité unique
// et suffisamment exploitable. Toute ambiguïté, absence, panne fournisseur ou
// mode non éligible produit l'absence de lien, jamais une fausse promesse ni un
// échec de la génération. Les URLs ne sont jamais assemblées ici : seul
// `lib/liensTransport.ts` les fabrique. Aucun niveau de confiance n'est modifié.
//
// Seuls les modes réellement outillés sont couverts : `avion` (Amadeus Airport
// & City Search) et `train` (gares Navitia). Le transport local reste hors de
// ce lot : la demande ne porte que des villes, jamais un lieu observé, et une
// paire de villes ne doit pas être promue en lieux réels.

/**
 * Résout la ville demandée en un unique code IATA d'aéroport. `preference:
 * 'aeroport'` interdit qu'une ville soit rendue à la place d'un aéroport : une
 * ville n'est jamais promue en aéroport. Une résolution ambiguë, vide, sans
 * code IATA ou indisponible rend `null`.
 */
async function resoudreCodeIataAeroport(
  lieu: LieuTransportDemande
): Promise<string | null> {
  let recherche;
  try {
    recherche = await rechercherLieuxAeriens({
      ville: lieu.ville,
      ...(lieu.codePays ? { codePays: lieu.codePays } : {}),
      preference: 'aeroport',
    });
  } catch {
    // Demande interne invalide ou erreur technique : absence prudente de lien.
    return null;
  }
  const resolution = evaluerResolutionLieuAerien(recherche);
  if (resolution.statut !== 'unique') return null;
  return resolution.candidat.codeIata ?? null;
}

/**
 * Résout la ville demandée en une unique gare et rend son nom observé. Jamais un
 * identifiant Navitia ni un code UIC : Google Maps ne les interprète pas et un
 * identifiant fournisseur n'a rien à faire dans un lien de recherche.
 */
async function resoudreNomGare(
  lieu: LieuTransportDemande
): Promise<string | null> {
  let recherche;
  try {
    recherche = await rechercherGaresNavitia({ requete: lieu.ville });
  } catch {
    return null;
  }
  const resolution = evaluerResolutionGareNavitia(recherche);
  if (resolution.statut !== 'unique') return null;
  return resolution.candidat.nom;
}

async function resoudreLienVol(
  troncon: TronconTransportDemande,
  genereLe: string
): Promise<LienRechercheTransport | null> {
  const origineIata = await resoudreCodeIataAeroport(troncon.origine);
  if (origineIata === null) return null;
  const destinationIata = await resoudreCodeIataAeroport(troncon.destination);
  if (destinationIata === null) return null;
  // Le constructeur F4-D1 refuse déjà deux IATA identiques et revalide la date.
  return creerLienRechercheVol(
    {
      origineIata,
      destinationIata,
      dateDepart: troncon.depart.date,
    },
    genereLe
  );
}

async function resoudreLienTrain(
  troncon: TronconTransportDemande,
  genereLe: string
): Promise<LienRechercheTransport | null> {
  const origine = await resoudreNomGare(troncon.origine);
  if (origine === null) return null;
  const destination = await resoudreNomGare(troncon.destination);
  if (destination === null) return null;
  // Le constructeur F4-D1 refuse déjà deux gares au nom identique.
  return creerLienRechercheTrain(
    { origine: { nom: origine }, destination: { nom: destination } },
    genereLe
  );
}

function resoudreLienPourTroncon(
  troncon: TronconTransportDemande,
  genereLe: string
): Promise<LienRechercheTransport | null> {
  if (troncon.modeSouhaite === 'avion') {
    return resoudreLienVol(troncon, genereLe);
  }
  if (troncon.modeSouhaite === 'train') {
    return resoudreLienTrain(troncon, genereLe);
  }
  // bus, ferry, voiture, transport_local, autre ou mode absent : aucun lien.
  return Promise.resolve(null);
}

/**
 * Ajoute, quand c'est honnête, un lien de recherche transport à chaque élément
 * transport du parcours déjà validé.
 *
 * Le k-ième élément transport de la timeline correspond au k-ième tronçon de la
 * demande : `nettoyerMomentsTransport` émet les transports dans l'ordre des
 * tronçons et écarte les surnuméraires. On réutilise donc ce même contrat
 * positionnel plutôt que d'inventer un rapprochement concurrent.
 *
 * La fonction ne touche ni le nom, ni la justification, ni le niveau de
 * confiance de l'élément : le lien s'ajoute à côté, comme un raccourci de
 * recherche, jamais comme une preuve de trajet.
 */
export async function ajouterLiensRechercheTransport(
  parcours: Parcours,
  demandeTransport: DemandeTransport | undefined
): Promise<Parcours> {
  if (!demandeTransport) return parcours;

  const genereLe = new Date().toISOString();
  const liensParElement = new Map<string, LienRechercheTransport>();
  let rangTransport = 0;

  for (const moment of parcours.timeline) {
    for (const element of moment.elements) {
      if (element.type !== 'transport') continue;
      const troncon = demandeTransport.troncons[rangTransport];
      rangTransport += 1;
      if (!troncon) continue;
      const lien = await resoudreLienPourTroncon(troncon, genereLe);
      if (lien) liensParElement.set(element.id, lien);
    }
  }

  if (liensParElement.size === 0) return parcours;

  return {
    ...parcours,
    timeline: parcours.timeline.map((moment) => ({
      ...moment,
      elements: moment.elements.map((element) => {
        const lien = liensParElement.get(element.id);
        return lien ? { ...element, lienRechercheTransport: lien } : element;
      }),
    })),
  };
}
