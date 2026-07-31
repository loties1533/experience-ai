import {
  DemandeLienRechercheTrainSchema,
  DemandeLienRechercheTransportLocalSchema,
  DemandeLienRechercheVolSchema,
  LienRechercheTransportSchema,
  URL_ITINERAIRE_GOOGLE_MAPS,
  URL_RECHERCHE_VOLS_GOOGLE,
  type DemandeLienRechercheTrain,
  type DemandeLienRechercheTransportLocal,
  type DemandeLienRechercheVol,
  type LienRechercheTransport,
} from '../domaine/transport/index.js';

// F4-D1 — construction déterministe de liens de recherche transport.
//
// Chaque fonction est pure (hors `genereLe`, injectable) : aucun appel réseau,
// aucun secret, aucune horloge implicite. Une donnée essentielle absente ou
// contradictoire ne produit pas d'erreur mais l'absence prudente de lien
// (`null`) — jamais un faux identifiant ni une fausse promesse commerciale.

const LIBELLE_RECHERCHE_VOL =
  'Rechercher des vols sur Google Flights' as const;
const LIBELLE_RECHERCHE_TRAIN =
  'Rechercher un itinéraire entre gares sur Google Maps' as const;
const LIBELLE_RECHERCHE_TRANSPORT_LOCAL =
  'Rechercher un itinéraire local sur Google Maps' as const;

function normaliserTerme(valeur: string): string {
  return valeur
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Le nom seul, ou « nom, ville » quand la ville précise une gare ambiguë. */
function termeLieu(nom: string, ville?: string): string {
  if (ville === undefined) return nom;
  return normaliserTerme(nom).includes(normaliserTerme(ville))
    ? nom
    : `${nom}, ${ville}`;
}

/**
 * Recherche de vols Google Flights en texte libre. On évite volontairement le
 * paramètre `tfs` (deep link encodé, non documenté et fragile) : la requête
 * reste une recherche honnête, construite à partir de codes IATA confirmés et
 * de dates ISO. Elle ne prétend ni prix, ni disponibilité, ni billet.
 */
function requeteVolGoogle(demande: DemandeLienRechercheVol): string {
  const parties = [
    `Flights from ${demande.origineIata} to ${demande.destinationIata}`,
    `on ${demande.dateDepart}`,
  ];
  if (demande.dateRetour !== undefined) {
    parties.push(`returning ${demande.dateRetour}`);
  }
  if (demande.adultes !== undefined) {
    const voyageurs = demande.adultes + (demande.enfants ?? 0);
    parties.push(
      voyageurs > 1 ? `for ${voyageurs} passengers` : 'for 1 passenger'
    );
  }
  return parties.join(' ');
}

function construireUrlRechercheVol(demande: DemandeLienRechercheVol): string {
  const url = new URL(URL_RECHERCHE_VOLS_GOOGLE);
  url.searchParams.set('q', requeteVolGoogle(demande));
  return url.toString();
}

/**
 * Itinéraire Google Maps via l'API officielle « Maps URLs ». `travelmode`
 * n'est posé que lorsqu'on veut réellement le contraindre (transit pour le
 * ferroviaire). Origine et destination sont des libellés observés, jamais des
 * identifiants Navitia ou UIC que Maps n'interprète pas.
 */
function construireUrlItineraireMaps(
  origine: string,
  destination: string,
  travelmode?: 'transit'
): string {
  const url = new URL(URL_ITINERAIRE_GOOGLE_MAPS);
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', origine);
  url.searchParams.set('destination', destination);
  if (travelmode !== undefined) {
    url.searchParams.set('travelmode', travelmode);
  }
  return url.toString();
}

function finaliserLien(
  candidat: unknown
): LienRechercheTransport | null {
  const resultat = LienRechercheTransportSchema.safeParse(candidat);
  return resultat.success ? resultat.data : null;
}

export function creerLienRechercheVol(
  demandeBrute: DemandeLienRechercheVol,
  genereLe: string = new Date().toISOString()
): LienRechercheTransport | null {
  const demande = DemandeLienRechercheVolSchema.safeParse(demandeBrute);
  if (!demande.success) return null;
  return finaliserLien({
    type: 'recherche_vol',
    fournisseur: 'Google Flights',
    url: construireUrlRechercheVol(demande.data),
    libelle: LIBELLE_RECHERCHE_VOL,
    genereLe,
  });
}

export function creerLienRechercheTrain(
  demandeBrute: DemandeLienRechercheTrain,
  genereLe: string = new Date().toISOString()
): LienRechercheTransport | null {
  const demande = DemandeLienRechercheTrainSchema.safeParse(demandeBrute);
  if (!demande.success) return null;
  return finaliserLien({
    type: 'recherche_train',
    fournisseur: 'Google Maps',
    url: construireUrlItineraireMaps(
      termeLieu(demande.data.origine.nom, demande.data.origine.ville),
      termeLieu(
        demande.data.destination.nom,
        demande.data.destination.ville
      ),
      'transit'
    ),
    libelle: LIBELLE_RECHERCHE_TRAIN,
    genereLe,
  });
}

export function creerLienRechercheTransportLocal(
  demandeBrute: DemandeLienRechercheTransportLocal,
  genereLe: string = new Date().toISOString()
): LienRechercheTransport | null {
  const demande =
    DemandeLienRechercheTransportLocalSchema.safeParse(demandeBrute);
  if (!demande.success) return null;
  return finaliserLien({
    type: 'recherche_transport_local',
    fournisseur: 'Google Maps',
    url: construireUrlItineraireMaps(
      termeLieu(demande.data.origine.nom, demande.data.origine.ville),
      termeLieu(demande.data.destination.nom, demande.data.destination.ville)
    ),
    libelle: LIBELLE_RECHERCHE_TRANSPORT_LOCAL,
    genereLe,
  });
}
