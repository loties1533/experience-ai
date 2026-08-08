import 'dotenv/config';
import { z } from 'zod';
import type { TravelMode, EventSearchResult } from '../lib/types.js';
import { encoderURL } from '../lib/url.js';
import {
  causeErreurHttp,
  estTimeout,
  rechercheIndisponible,
  resultatVide,
  type CandidatEvenementEventFirst,
  type CandidatEvenementExterne,
  type ResultatRecherche,
} from './rechercheExterne.js';

const URL_BASE_PREDICTHQ = 'https://api.predicthq.com/v1';
const SOURCE_PREDICTHQ = `${URL_BASE_PREDICTHQ}/events/`;
const LIMITE_EVENT_FIRST_DEFAUT = 12;
const LIMITE_EVENT_FIRST_MAX = 12;
const NOMBRE_MAX_PAGES_EVENT_FIRST = 2;

// Catégories PredictHQ selon le mode de voyage
const CATEGORIES_PAR_MODE: Record<TravelMode, string> = {
  party:    'concerts,festivals',
  student:  'concerts,festivals,community,sports',
  group:    'concerts,festivals,sports,community',
  relax:    'performing-arts,community',
  surprise: 'concerts,festivals,performing-arts,community',
};

const ReponseLieuxPredictHQSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      type: z.string().optional(),
    })
  ),
});

const EntitePredictHQSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  formatted_address: z.string().optional(),
});

const AdresseGeoPredictHQSchema = z.object({
  locality: z.string().min(1).optional(),
  country_code: z.string().regex(/^[A-Za-z]{2}$/).optional(),
});

const GeoPredictHQSchema = z.object({
  address: AdresseGeoPredictHQSchema.optional(),
});

const EvenementPredictHQSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.string().min(1),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }).optional(),
    description: z.string().optional(),
    entities: z.array(EntitePredictHQSchema).optional(),
    local_rank: z.number().optional(),
    rank: z.number().optional(),
    geo: GeoPredictHQSchema.optional(),
  })
  .refine(
    (evenement) => !evenement.end || Date.parse(evenement.end) >= Date.parse(evenement.start),
    { message: 'La fin de l’événement doit suivre son début' }
  );

const ReponseEvenementsPredictHQSchema = z.object({
  results: z.array(EvenementPredictHQSchema),
});

export const DemandeRechercheEvenementsEventFirstSchema = z
  .object({
    requete: z.string().trim().min(1),
    dateDebut: z.iso.date(),
    dateFin: z.iso.date(),
    categorie: z.literal('sports').optional(),
    pays: z.string().regex(/^[A-Z]{2}$/).optional(),
    limite: z.number().int().min(1).max(LIMITE_EVENT_FIRST_MAX).optional(),
  })
  .strict()
  .refine((demande) => demande.dateDebut <= demande.dateFin, {
    message: 'La date de début doit précéder ou égaler la date de fin.',
  });

export type DemandeRechercheEvenementsEventFirst = z.infer<
  typeof DemandeRechercheEvenementsEventFirstSchema
>;

interface VillePredictHQ {
  identifiantExterne: string;
  nomConfirme: string;
}

function normaliserVille(ville: string): string {
  return ville
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function texteContientVille(texte: string, villeDemandee: string): boolean {
  const texteNormalise = ` ${normaliserVille(texte)} `;
  const villeNormalisee = ` ${normaliserVille(villeDemandee)} `;
  return texteNormalise.includes(villeNormalisee);
}

function villeConfirmeeParEvenement(
  evenement: z.infer<typeof EvenementPredictHQSchema>,
  villeDemandee: string
): string | undefined {
  const preuvesGeographiques =
    evenement.entities?.flatMap((entite) => {
      const preuves: string[] = [];
      if (entite.formatted_address) preuves.push(entite.formatted_address);
      if (['city', 'locality', 'place'].includes(entite.type.toLowerCase())) {
        preuves.push(entite.name);
      }
      return preuves;
    }) ?? [];
  return preuvesGeographiques.find((preuve) => texteContientVille(preuve, villeDemandee));
}

function evenementDansPeriode(
  dateEvenement: string,
  dateDebut: string,
  dateFin: string
): boolean {
  const jourEvenement = dateEvenement.slice(0, 10);
  return jourEvenement >= dateDebut && jourEvenement <= dateFin;
}

function evenementCorrespondCategorie(
  evenement: z.infer<typeof EvenementPredictHQSchema>,
  categorie: 'sports' | undefined
): boolean {
  return categorie === undefined || evenement.category === categorie;
}

function villeFournieParEvenement(
  evenement: z.infer<typeof EvenementPredictHQSchema>
): { ville: string; codePays?: string } | undefined {
  const adresse = evenement.geo?.address;
  const ville = adresse?.locality?.trim();
  if (!ville) return undefined;
  return {
    ville,
    ...(adresse?.country_code
      ? { codePays: adresse.country_code.toUpperCase() }
      : {}),
  };
}

function salleFournieParEvenement(
  evenement: z.infer<typeof EvenementPredictHQSchema>
): string | undefined {
  return evenement.entities?.find((entite) => entite.type === 'venue')?.name;
}

function evenementCorrespondPays(
  codePays: string | undefined,
  paysDemande: string | undefined
): boolean {
  return paysDemande === undefined || codePays === paysDemande;
}

/**
 * Recherche directe dans Events, sans appel Places ni ville préalable.
 * La fenêtre est stricte : seul le jour de début de l'événement doit être
 * compris dans les dates demandées, même si l'API renvoie un chevauchement.
 */
export async function rechercherEvenementsPredictHQEventFirst(
  demandeRecue: unknown
): Promise<ResultatRecherche<CandidatEvenementEventFirst>> {
  const demande = DemandeRechercheEvenementsEventFirstSchema.parse(demandeRecue);
  const clePredictHQ = process.env.PREDICTHQ_API_KEY;
  if (!clePredictHQ) {
    console.warn('PredictHQ event-first ignoré (PREDICTHQ_API_KEY manquante).');
    return rechercheIndisponible('PredictHQ', 'configuration_absente');
  }

  const limite = demande.limite ?? LIMITE_EVENT_FIRST_DEFAUT;
  const candidats: CandidatEvenementEventFirst[] = [];
  let resultatsFournisseur = 0;
  let recupereLe: string | undefined;

  try {
    for (
      let page = 0;
      page < NOMBRE_MAX_PAGES_EVENT_FIRST && candidats.length < limite;
      page += 1
    ) {
      const parametresRequete = new URLSearchParams({
        q: demande.requete,
        'active.gte': demande.dateDebut,
        'active.lte': demande.dateFin,
        limit: String(limite),
        offset: String(page * limite),
      });
      if (demande.categorie) parametresRequete.set('category', demande.categorie);
      if (demande.pays) parametresRequete.set('country', demande.pays);

      const reponse = await fetch(`${SOURCE_PREDICTHQ}?${parametresRequete}`, {
        headers: { Authorization: `Bearer ${clePredictHQ}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!reponse.ok) {
        console.warn(`[predicthq.event-first] http=${reponse.status}`);
        return rechercheIndisponible('PredictHQ', causeErreurHttp(reponse.status));
      }

      recupereLe ??= new Date().toISOString();
      let contenu: unknown;
      try {
        contenu = await reponse.json();
      } catch {
        return rechercheIndisponible('PredictHQ', 'reponse_invalide');
      }
      const validation = ReponseEvenementsPredictHQSchema.safeParse(contenu);
      if (!validation.success) {
        console.warn('[predicthq.event-first] réponse API invalide.');
        return rechercheIndisponible('PredictHQ', 'reponse_invalide');
      }

      const evenements = validation.data.results;
      resultatsFournisseur += evenements.length;
      for (const evenement of evenements) {
        if (!evenementDansPeriode(evenement.start, demande.dateDebut, demande.dateFin)) continue;
        if (!evenementCorrespondCategorie(evenement, demande.categorie)) continue;
        const localisation = villeFournieParEvenement(evenement);
        if (!localisation) continue;
        if (!evenementCorrespondPays(localisation.codePays, demande.pays)) continue;
        const salle = salleFournieParEvenement(evenement);

        candidats.push({
          identifiantExterne: evenement.id,
          nom: evenement.title,
          ville: localisation.ville,
          ...(localisation.codePays ? { codePays: localisation.codePays } : {}),
          dateDebut: evenement.start,
          ...(evenement.end ? { dateFin: evenement.end } : {}),
          ...(salle ? { salle } : {}),
          fournisseur: 'PredictHQ',
          source: SOURCE_PREDICTHQ,
          recupereLe,
        });
        if (candidats.length === limite) break;
      }

      if (evenements.length < limite) break;
    }
  } catch (erreur) {
    const raison = estTimeout(erreur) ? 'timeout' : 'reseau';
    console.warn('[predicthq.event-first] indisponible :', (erreur as Error).message);
    return rechercheIndisponible('PredictHQ', raison);
  }

  const recupere = recupereLe ?? new Date().toISOString();
  console.info(
    `[predicthq.event-first] query=${demande.requete} dates=${demande.dateDebut}..${demande.dateFin} ` +
      `country=${demande.pays ?? '-'} results=${resultatsFournisseur} usable=${candidats.length}`
  );
  return candidats.length > 0
    ? { statut: 'ok', resultats: candidats, recupereLe: recupere }
    : resultatVide(recupere);
}

/** Étape 1 : récupère l'identifiant PredictHQ de la ville, s'il existe. */
async function obtenirIdentifiantVille(
  villeDemandee: string,
  clePredictHQ: string
): Promise<ResultatRecherche<VillePredictHQ>> {
  try {
    const reponse = await fetch(
      `${URL_BASE_PREDICTHQ}/places/?q=${encoderURL(villeDemandee)}&limit=1`,
      {
        headers: { Authorization: `Bearer ${clePredictHQ}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!reponse.ok) {
      return rechercheIndisponible('PredictHQ', causeErreurHttp(reponse.status));
    }

    const recupereLe = new Date().toISOString();
    let contenu: unknown;
    try {
      contenu = await reponse.json();
    } catch {
      return rechercheIndisponible('PredictHQ', 'reponse_invalide');
    }
    const validation = ReponseLieuxPredictHQSchema.safeParse(contenu);
    if (!validation.success) {
      return rechercheIndisponible('PredictHQ', 'reponse_invalide');
    }
    const ville = validation.data.results.find(
      (resultat) => normaliserVille(resultat.name) === normaliserVille(villeDemandee)
    );
    if (!ville) return resultatVide(recupereLe);
    return {
      statut: 'ok',
      resultats: [{ identifiantExterne: ville.id, nomConfirme: ville.name }],
      recupereLe,
    };
  } catch (erreur) {
    return rechercheIndisponible('PredictHQ', estTimeout(erreur) ? 'timeout' : 'reseau');
  }
}

export async function rechercherEvenementsPredictHQ(
  villeDemandee: string,
  dateDebut: string,
  dateFin: string,
  mode: TravelMode
): Promise<ResultatRecherche<CandidatEvenementExterne>> {
  const clePredictHQ = process.env.PREDICTHQ_API_KEY;
  if (!clePredictHQ) {
    console.warn('PredictHQ ignoré (PREDICTHQ_API_KEY manquante).');
    return rechercheIndisponible('PredictHQ', 'configuration_absente');
  }

  try {
    const rechercheVille = await obtenirIdentifiantVille(villeDemandee, clePredictHQ);
    if (rechercheVille.statut === 'indisponible') return rechercheVille;

    const villeTrouvee =
      rechercheVille.statut === 'ok' ? rechercheVille.resultats[0] : undefined;
    const categories = CATEGORIES_PAR_MODE[mode] ?? 'concerts,festivals';

    const parametresRequete = new URLSearchParams({
      'active.gte':   dateDebut,
      'active.lte':   dateFin || dateDebut,
      category:       categories,
      sort:           'local_rank',
      limit:          '6',
    });

    // Filtre par lieu si trouvé, sinon recherche texte sur la ville
    if (villeTrouvee) {
      parametresRequete.set('place.scope', villeTrouvee.identifiantExterne);
    } else {
      parametresRequete.set('q', villeDemandee);
    }

    const reponse = await fetch(`${SOURCE_PREDICTHQ}?${parametresRequete}`, {
      headers: { Authorization: `Bearer ${clePredictHQ}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!reponse.ok) {
      console.warn(`PredictHQ indisponible : HTTP ${reponse.status}.`);
      return rechercheIndisponible('PredictHQ', causeErreurHttp(reponse.status));
    }

    const recupereLe = new Date().toISOString();
    let contenu: unknown;
    try {
      contenu = await reponse.json();
    } catch {
      return rechercheIndisponible('PredictHQ', 'reponse_invalide');
    }
    const validation = ReponseEvenementsPredictHQSchema.safeParse(contenu);
    if (!validation.success) {
      console.warn('PredictHQ indisponible : réponse API invalide.');
      return rechercheIndisponible('PredictHQ', 'reponse_invalide');
    }

    const evenementsValides = validation.data.results
      .filter((evenement) => evenementDansPeriode(evenement.start, dateDebut, dateFin))
      .map((evenement) => ({
        evenement,
        villeConfirmee:
          villeTrouvee?.nomConfirme ??
          villeConfirmeeParEvenement(evenement, villeDemandee),
      }))
      .filter(
        (
          resultat
        ): resultat is {
          evenement: z.infer<typeof EvenementPredictHQSchema>;
          villeConfirmee: string;
        } => Boolean(resultat.villeConfirmee)
      );

    if (evenementsValides.length === 0) {
      console.warn(
        `PredictHQ: 0 événement pour ${villeDemandee} (${dateDebut} → ${dateFin})`
      );
      return resultatVide(recupereLe);
    }

    console.log(
      `PredictHQ: ${validation.data.results.length} événements trouvés pour ${villeDemandee}`
    );

    return {
      statut: 'ok',
      recupereLe,
      resultats: evenementsValides.slice(0, 6).map(({ evenement, villeConfirmee }) => {
        const salle = evenement.entities?.find((entite) => entite.type === 'venue');
        return {
          identifiantExterne: evenement.id,
          nom: evenement.title,
          villeDemandee,
          villeConfirmee,
          salle: salle
            ? [salle.name, salle.formatted_address].filter(Boolean).join(', ')
            : undefined,
          categorieFournisseur: evenement.category.replace(/-/g, ' '),
          typeMetierRecherche: 'evenement',
          fournisseur: 'PredictHQ',
          source: SOURCE_PREDICTHQ,
          recupereLe,
          dateDebut: evenement.start,
          dateFin: evenement.end,
          description:
            evenement.description ?? `${evenement.category.replace(/-/g, ' ')} à ${villeDemandee}`,
        };
      }),
    };

  } catch (erreur) {
    const raison = estTimeout(erreur) ? 'timeout' : 'reseau';
    console.warn('PredictHQ indisponible :', (erreur as Error).message);
    return rechercheIndisponible('PredictHQ', raison);
  }
}

/**
 * Export public historique conservé pendant la migration F2. Le chemin de
 * génération utilise le contrat discriminé de `rechercherEvenementsPredictHQ`.
 */
export async function predictHQEventsSearch(
  city: string,
  dateFrom: string,
  dateTo: string,
  mode: TravelMode
): Promise<EventSearchResult[]> {
  const recherche = await rechercherEvenementsPredictHQ(city, dateFrom, dateTo, mode);
  if (recherche.statut !== 'ok') return [];
  return recherche.resultats.map((evenement) => ({
    id: evenement.identifiantExterne,
    title: evenement.nom,
    category: evenement.categorieFournisseur,
    start: evenement.dateDebut.slice(0, 10),
    venue: evenement.salle ?? evenement.villeDemandee,
    description: evenement.description,
  }));
}
