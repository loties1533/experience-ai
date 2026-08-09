import { z } from 'zod';

export type CauseIndisponibilite =
  | 'configuration_absente'
  | 'authentification'
  | 'quota'
  | 'timeout'
  | 'reseau'
  | 'fournisseur'
  | 'reponse_invalide';

export type ResultatRecherche<T> =
  | {
      statut: 'ok';
      resultats: T[];
      recupereLe: string;
    }
  | {
      statut: 'vide';
      resultats: [];
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseur: string;
      raison: CauseIndisponibilite;
    };

export type TypeLieuRecherche =
  | 'restaurant'
  | 'activite'
  | 'sortie'
  | 'hebergement';
export type TypeMetierRecherche = TypeLieuRecherche | 'evenement';

export interface CandidatExterne {
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  villeConfirmee?: string;
  categorieFournisseur: string;
  typeMetierRecherche: TypeMetierRecherche;
  fournisseur: 'Foursquare' | 'PredictHQ';
  source: string;
  recupereLe: string;
}

interface CandidatLieuFoursquareBase extends CandidatExterne {
  identifiantCategorieFournisseur?: string;
  adresse?: string;
  fournisseur: 'Foursquare';
}

export interface CandidatLieuExterne
  extends CandidatLieuFoursquareBase {
  typeMetierRecherche: Exclude<
    TypeLieuRecherche,
    'hebergement'
  >;
  lienCarte: string;
}

/**
 * Identité hôtelière réellement rendue par Foursquare.
 *
 * Aucun champ de prix, de capacité ou de disponibilité : le connecteur Places
 * ne les prouve pas dans le chemin utilisé par Experience AI.
 */
export interface CandidatHotelExterne
  extends CandidatLieuFoursquareBase {
  typeMetierRecherche: 'hebergement';
}

export type CandidatFoursquareExterne =
  | CandidatLieuExterne
  | CandidatHotelExterne;

export interface CandidatEvenementExterne extends CandidatExterne {
  typeMetierRecherche: 'evenement';
  salle?: string;
  dateDebut: string;
  dateFin?: string;
  description: string;
}

const DateEvenementPlanifiableSchema = z.iso.datetime({ offset: true });

export function estPlageEvenementiellePlanifiable(
  dateDebut: string,
  dateFin: string | undefined
): dateFin is string {
  if (!dateFin) return false;
  if (
    !DateEvenementPlanifiableSchema.safeParse(dateDebut).success ||
    !DateEvenementPlanifiableSchema.safeParse(dateFin).success
  ) {
    return false;
  }
  const debut = Date.parse(dateDebut);
  const fin = Date.parse(dateFin);
  return fin > debut;
}

/**
 * Événement trouvé sans ville demandée au préalable. Sa plage stricte est un
 * invariant du contexte planifiable : aucune fin absente ou synthétique ne
 * peut être propagée comme ancre.
 */
export const CandidatEvenementEventFirstSchema = z
  .object({
    identifiantExterne: z.string().min(1),
    nom: z.string().min(1),
    ville: z.string().min(1),
    codePays: z.string().regex(/^[A-Z]{2}$/).optional(),
    dateDebut: z.iso.datetime({ offset: true }),
    dateFin: z.iso.datetime({ offset: true }),
    salle: z.string().min(1).optional(),
    categorieFournisseur: z.string().min(1),
    fournisseur: z.literal('PredictHQ'),
    source: z.string().url(),
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (candidat) =>
      estPlageEvenementiellePlanifiable(candidat.dateDebut, candidat.dateFin),
    { message: 'La fin de l’événement doit être strictement postérieure à son début' }
  );

/**
 * Observation PredictHQ sans ville demandée au préalable. Sa ville est une
 * donnée fournisseur : elle ne remonte jamais dans `Brief.lieux`.
 */
export type CandidatEvenementEventFirst = z.infer<
  typeof CandidatEvenementEventFirstSchema
>;

/** Adapte une ancre event-first au journal historique de résolution. */
export function adapterEvenementEventFirstPourJournal(
  candidat: CandidatEvenementEventFirst
): CandidatEvenementExterne {
  return {
    identifiantExterne: candidat.identifiantExterne,
    nom: candidat.nom,
    villeDemandee: candidat.ville,
    villeConfirmee: candidat.ville,
    categorieFournisseur: candidat.categorieFournisseur,
    typeMetierRecherche: 'evenement',
    fournisseur: 'PredictHQ',
    source: candidat.source,
    recupereLe: candidat.recupereLe,
    dateDebut: candidat.dateDebut,
    dateFin: candidat.dateFin,
    ...(candidat.salle ? { salle: candidat.salle } : {}),
    description: candidat.nom,
  };
}

export function resultatVide<T>(recupereLe: string): ResultatRecherche<T> {
  return { statut: 'vide', resultats: [], recupereLe };
}

export function rechercheIndisponible<T>(
  fournisseur: string,
  raison: CauseIndisponibilite
): ResultatRecherche<T> {
  return { statut: 'indisponible', fournisseur, raison };
}

export function causeErreurHttp(statut: number): CauseIndisponibilite {
  if (statut === 401 || statut === 403) return 'authentification';
  if (statut === 429) return 'quota';
  return 'fournisseur';
}

export function estTimeout(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) return false;
  return (
    erreur.name === 'AbortError' ||
    erreur.name === 'TimeoutError' ||
    /abort|timeout|délai/i.test(erreur.message)
  );
}
