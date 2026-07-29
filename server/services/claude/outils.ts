import { z } from 'zod';
import { memoriser, memoriserSelonResultat } from '../../lib/cacheMemoire.js';
import {
  estCategorieFoursquareCompatible,
  rechercherLieuxFoursquare,
} from '../foursquare.js';
import { rechercherEvenementsPredictHQ } from '../predictHQ.js';
import { rechercheIndisponible } from '../rechercheExterne.js';
import { getRealWeather } from '../weather.js';
import type { BoiteAOutilsLLM } from './core.js';
import type { OutilLLM } from '../providers.js';
import type { TravelMode } from '../../lib/types.js';
import type {
  CandidatEvenementExterne,
  CandidatFoursquareExterne,
  CauseIndisponibilite,
  ResultatRecherche,
  TypeLieuRecherche,
  TypeMetierRecherche,
} from '../rechercheExterne.js';

// LES OUTILS DU MODÈLE — de vrais lieux, pas des souvenirs d'entraînement.
//
// Chaque outil est adossé à un connecteur qui existait déjà et que personne
// n'appelait. Le modèle décide quoi chercher ; nous décidons ce qu'il obtient,
// et nous gardons de côté ce qui est revenu (« le journal ») pour pouvoir
// rattacher ensuite une adresse et un lien de carte à ce qu'il a proposé.
//
// Deux règles tenues ici :
//   1. l'entrée d'un outil vient du modèle → elle est validée par Zod ;
//   2. un outil ne lève JAMAIS — une recherche en panne rend une phrase, et le
//      modèle continue sans données réelles plutôt que de faire tomber la
//      génération.

// Durées de vie : un bar ne déménage pas dans la journée, un événement se
// programme plus vite, la météo change tout le temps.
const DUREE_LIEUX_MS = 24 * 60 * 60 * 1000;
const DUREE_EVENEMENTS_MS = 6 * 60 * 60 * 1000;
const DUREE_RECHERCHE_VIDE_MS = 5 * 60 * 1000;
const DUREE_METEO_MS = 3 * 60 * 60 * 1000;

const AUCUN_RESULTAT =
  "Aucun résultat réel pour cette recherche. Continue sans inventer de nom d'établissement : reste générique et honnête.";
const RECHERCHE_INDISPONIBLE =
  "La recherche externe est momentanément indisponible. Ne présente aucune donnée comme vérifiée et reste générique si elle est facultative.";

export type CandidatJournal =
  | CandidatFoursquareExterne
  | CandidatEvenementExterne;

export interface DemandeRapprochement {
  identifiantExterne?: string;
  nom: string;
  villeDemandee: string;
  typeMetierRecherche: TypeMetierRecherche;
  adresse?: string;
}

export type BesoinEssentielRecherche =
  | {
      typeMetierRecherche: TypeLieuRecherche;
      villeDemandee: string;
      requete: string;
    }
  | {
      typeMetierRecherche: 'evenement';
      villeDemandee: string;
      dateDebut: string;
      dateFin: string;
    };

export interface RechercheTracee {
  typeMetierRecherche: TypeMetierRecherche;
  villeDemandee: string;
  requete?: string;
  dateDebut?: string;
  dateFin?: string;
  statut: ResultatRecherche<unknown>['statut'];
  raison?: CauseIndisponibilite;
}

export interface BoiteAOutils extends BoiteAOutilsLLM {
  /** Rapproche uniquement une identité non ambiguë, dans la bonne ville et le bon type métier. */
  rapprocherCandidat(demande: DemandeRapprochement): CandidatJournal | undefined;
  /** Rend l'état de la recherche exacte désignée comme essentielle par le refus. */
  statutRechercheEssentielle(
    besoin: BesoinEssentielRecherche
  ): RechercheTracee['statut'] | undefined;
  /** Compatibilité temporaire : ne rend un candidat que si le nom exact est unique. */
  trouverLieuReel(nom: string): CandidatJournal | undefined;
}

const EntreeLieuxSchema = z.object({
  ville: z.string().min(1),
  requete: z.string().min(1),
  typeMetierRecherche: z.enum([
    'restaurant',
    'activite',
    'sortie',
    'hebergement',
  ]),
  limite: z.number().int().min(1).max(8).optional(),
});

const EntreeEvenementsSchema = z.object({
  ville: z.string().min(1),
  dateDebut: z.string().min(8),
  dateFin: z.string().min(8).optional(),
  genre: z.enum(['fete', 'sport', 'culture']).optional(),
});

const EntreeMeteoSchema = z.object({
  ville: z.string().min(1),
  date: z.string().min(8).optional(),
});

// Le connecteur PredictHQ raisonne en « mode » (vocabulaire hérité) : on
// traduit le genre demandé par le modèle, sans toucher au connecteur.
const MODE_PAR_GENRE: Record<'fete' | 'sport' | 'culture', TravelMode> = {
  fete: 'party',
  sport: 'group',
  culture: 'relax',
};

const DEFINITIONS: OutilLLM[] = [
  {
    name: 'chercher_lieux',
    description:
      "Cherche de VRAIS lieux dans une ville : bars, clubs, restaurants, cafés, activités et hébergements. À utiliser avant de proposer un établissement — ne jamais citer un nom de mémoire.",
    input_schema: {
      type: 'object',
      properties: {
        ville: { type: 'string', description: 'La ville où chercher, ex. « Bordeaux »' },
        requete: {
          type: 'string',
          description: "Ce que l'on cherche, en mots-clés courts : « bar à cocktails », « restaurant bistronomique », « escape game », « hôtel de charme »",
        },
        typeMetierRecherche: {
          type: 'string',
          enum: [
            'restaurant',
            'activite',
            'sortie',
            'hebergement',
          ],
          description: 'Type métier exact qui sera produit dans le parcours',
        },
        limite: { type: 'number', description: 'Nombre de lieux souhaités (1 à 8, 4 par défaut)' },
      },
      required: ['ville', 'requete', 'typeMetierRecherche'],
    },
  },
  {
    name: 'chercher_evenements',
    description:
      "Cherche de VRAIS événements datés dans une ville sur une période : concerts, festivals, matchs, spectacles. À utiliser dès que le parcours porte des dates.",
    input_schema: {
      type: 'object',
      properties: {
        ville: { type: 'string', description: 'La ville où chercher' },
        dateDebut: { type: 'string', description: 'Premier jour, au format AAAA-MM-JJ' },
        dateFin: { type: 'string', description: 'Dernier jour, au format AAAA-MM-JJ' },
        genre: { type: 'string', enum: ['fete', 'sport', 'culture'], description: 'Oriente la recherche' },
      },
      required: ['ville', 'dateDebut'],
    },
  },
  {
    name: 'consulter_meteo',
    description:
      "Donne la météo attendue dans une ville à une date. Sert à décider ce qui se fait dehors et ce qui se fait à l'abri.",
    input_schema: {
      type: 'object',
      properties: {
        ville: { type: 'string', description: 'La ville concernée' },
        date: { type: 'string', description: 'Le jour concerné, au format AAAA-MM-JJ' },
      },
      required: ['ville'],
    },
  },
];

/** Clé de rapprochement : « Le Petit Commerce » et « le petit commerce » sont le même lieu. */
function cleNom(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function jour(date: string): string {
  return date.slice(0, 10);
}

/**
 * Une boîte à outils par génération : les définitions sont communes, mais le
 * journal des lieux trouvés appartient au parcours en cours de construction.
 * Le CACHE, lui, est partagé entre toutes les générations — c'est tout l'objet
 * de `memoriser`.
 */
export function creerBoiteAOutils(
  options: { villesAutorisees?: string[] } = {}
): BoiteAOutils {
  const journal = new Map<string, CandidatJournal>();
  const recherchesTracees: RechercheTracee[] = [];
  const villesAutorisees = new Set((options.villesAutorisees ?? []).map(cleNom));

  function cleCandidat(candidat: CandidatJournal): string {
    return JSON.stringify([
      candidat.fournisseur,
      candidat.identifiantExterne,
      candidat.typeMetierRecherche,
      cleNom(candidat.villeDemandee),
    ]);
  }

  function retenir(candidat: CandidatJournal): void {
    if (
      candidat.typeMetierRecherche === 'hebergement' &&
      (!estCategorieFoursquareCompatible(
        {
          fsq_category_id:
            candidat.identifiantCategorieFournisseur,
          name: candidat.categorieFournisseur,
        },
        'hebergement'
      ) ||
        (candidat.villeConfirmee !== undefined &&
          cleNom(candidat.villeConfirmee) !==
            cleNom(candidat.villeDemandee)))
    ) {
      return;
    }
    journal.set(cleCandidat(candidat), candidat);
  }

  function estVilleAutorisee(ville: string): boolean {
    return villesAutorisees.size === 0 || villesAutorisees.has(cleNom(ville));
  }

  function dureeCache<T>(
    resultat: ResultatRecherche<T>,
    dureeResultatValideMs: number
  ): number | null {
    if (resultat.statut === 'indisponible') return null;
    if (resultat.statut === 'vide') return DUREE_RECHERCHE_VIDE_MS;
    return dureeResultatValideMs;
  }

  function tracerRecherche<T>(
    recherche: Omit<RechercheTracee, 'statut' | 'raison'>,
    resultat: ResultatRecherche<T>
  ): void {
    recherchesTracees.push({
      ...recherche,
      statut: resultat.statut,
      raison: resultat.statut === 'indisponible' ? resultat.raison : undefined,
    });
  }

  async function rechercherAvecCache<T>(
    cle: string,
    calcul: () => Promise<ResultatRecherche<T>>,
    dureeResultatValideMs: number,
    fournisseur: string
  ): Promise<ResultatRecherche<T>> {
    try {
      return await memoriserSelonResultat(
        cle,
        calcul,
        (resultat) => dureeCache(resultat, dureeResultatValideMs)
      );
    } catch (erreur) {
      console.error(`Recherche ${fournisseur} en échec :`, (erreur as Error).message);
      return rechercheIndisponible(fournisseur, 'fournisseur');
    }
  }

  async function chercherLieux(entree: unknown): Promise<string> {
    const params = EntreeLieuxSchema.safeParse(entree);
    if (!params.success) return "Recherche impossible : il faut une ville et ce que l'on cherche.";

    const { ville, requete, typeMetierRecherche } = params.data;
    if (!estVilleAutorisee(ville)) {
      return "Recherche impossible : la ville demandée ne fait pas partie du brief.";
    }
    const limite = params.data.limite ?? 4;
    const recherche = await rechercherAvecCache(
      `lieux:${cleNom(ville)}:${typeMetierRecherche}:${cleNom(requete)}:${limite}`,
      () => rechercherLieuxFoursquare(ville, requete, typeMetierRecherche, limite),
      DUREE_LIEUX_MS,
      'Foursquare'
    );
    tracerRecherche(
      { villeDemandee: ville, requete, typeMetierRecherche },
      recherche
    );
    if (recherche.statut === 'indisponible') {
      return `${RECHERCHE_INDISPONIBLE} Fournisseur : ${recherche.fournisseur}.`;
    }
    if (recherche.statut === 'vide') return AUCUN_RESULTAT;

    for (const lieu of recherche.resultats) retenir(lieu);
    // On ne transmet pas les liens au modèle : les liens, on les rattache
    // nous-mêmes ensuite. Il ne doit jamais avoir à écrire une URL.
    return JSON.stringify(
      recherche.resultats.map((lieu) => ({
        identifiantExterne: lieu.identifiantExterne,
        nom: lieu.nom,
        ville: lieu.villeDemandee,
        villeConfirmee: lieu.villeConfirmee,
        categorie: lieu.categorieFournisseur,
        typeMetierRecherche: lieu.typeMetierRecherche,
        adresse: lieu.adresse,
      }))
    );
  }

  async function chercherEvenements(entree: unknown): Promise<string> {
    const params = EntreeEvenementsSchema.safeParse(entree);
    if (!params.success) return 'Recherche impossible : il faut une ville et une date de début (AAAA-MM-JJ).';

    const { ville, genre } = params.data;
    if (!estVilleAutorisee(ville)) {
      return "Recherche impossible : la ville demandée ne fait pas partie du brief.";
    }
    const debut = jour(params.data.dateDebut);
    const fin = jour(params.data.dateFin ?? params.data.dateDebut);
    const mode: TravelMode = genre ? MODE_PAR_GENRE[genre] : 'surprise';

    const recherche = await rechercherAvecCache(
      `evenements:${cleNom(ville)}:${debut}:${fin}:${mode}`,
      () => rechercherEvenementsPredictHQ(ville, debut, fin, mode),
      DUREE_EVENEMENTS_MS,
      'PredictHQ'
    );
    tracerRecherche(
      {
        villeDemandee: ville,
        typeMetierRecherche: 'evenement',
        dateDebut: debut,
        dateFin: fin,
      },
      recherche
    );
    if (recherche.statut === 'indisponible') {
      return `${RECHERCHE_INDISPONIBLE} Fournisseur : ${recherche.fournisseur}.`;
    }
    if (recherche.statut === 'vide') return AUCUN_RESULTAT;

    for (const evenement of recherche.resultats) retenir(evenement);
    return JSON.stringify(
      recherche.resultats.map((evenement) => ({
        identifiantExterne: evenement.identifiantExterne,
        nom: evenement.nom,
        ville: evenement.villeDemandee,
        categorie: evenement.categorieFournisseur,
        typeMetierRecherche: evenement.typeMetierRecherche,
        dateDebut: evenement.dateDebut,
        dateFin: evenement.dateFin,
        salle: evenement.salle,
      }))
    );
  }

  async function consulterMeteo(entree: unknown): Promise<string> {
    const params = EntreeMeteoSchema.safeParse(entree);
    if (!params.success) return 'Consultation impossible : il faut une ville.';

    const { ville } = params.data;
    const date = params.data.date ? jour(params.data.date) : undefined;
    const meteo = await memoriser(
      `meteo:${cleNom(ville)}:${date ?? 'maintenant'}`,
      () => getRealWeather(ville, date),
      DUREE_METEO_MS
    );
    if (!meteo) return 'Météo indisponible pour cette ville. Prévois de quoi tenir sous la pluie comme au soleil.';
    return JSON.stringify({ ville, date, temperature: meteo.temp, conditions: meteo.conditions });
  }

  return {
    definitions: DEFINITIONS,

    async executer(nom: string, entree: unknown): Promise<string> {
      try {
        switch (nom) {
          case 'chercher_lieux':
            return await chercherLieux(entree);
          case 'chercher_evenements':
            return await chercherEvenements(entree);
          case 'consulter_meteo':
            return await consulterMeteo(entree);
          default:
            return `Outil inconnu (${nom}). Utilise ceux qui te sont proposés.`;
        }
      } catch (erreur) {
        // Un connecteur qui tombe ne fait pas tomber la génération.
        console.error(`Outil ${nom} en échec :`, (erreur as Error).message);
        return RECHERCHE_INDISPONIBLE;
      }
    },

    rapprocherCandidat(demande: DemandeRapprochement): CandidatJournal | undefined {
      const villeDemandee = cleNom(demande.villeDemandee);
      const nomDemande = cleNom(demande.nom);
      if (!villeDemandee || !nomDemande) return undefined;

      const compatibles = [...journal.values()].filter(
        (candidat) =>
          candidat.typeMetierRecherche === demande.typeMetierRecherche &&
          cleNom(candidat.villeDemandee) === villeDemandee &&
          (candidat.typeMetierRecherche !== 'hebergement' ||
            (estCategorieFoursquareCompatible(
              {
                fsq_category_id:
                  candidat.identifiantCategorieFournisseur,
                name: candidat.categorieFournisseur,
              },
              'hebergement'
            ) &&
              (candidat.villeConfirmee === undefined ||
                cleNom(candidat.villeConfirmee) === villeDemandee)))
      );

      if (demande.identifiantExterne) {
        const parIdentifiant = compatibles.filter(
          (candidat) => candidat.identifiantExterne === demande.identifiantExterne
        );
        return parIdentifiant.length === 1 ? parIdentifiant[0] : undefined;
      }

      const parIdentiteMetier = compatibles.filter(
        (candidat) => cleNom(candidat.nom) === nomDemande
      );
      if (parIdentiteMetier.length === 1) return parIdentiteMetier[0];

      // L'adresse proposée par le modèle ne sert à départager que les hôtels
      // de F3-B. Les règles historiques F2 restent inchangées.
      if (demande.typeMetierRecherche !== 'hebergement') return undefined;
      const adresseDemandee = demande.adresse
        ? cleNom(demande.adresse)
        : '';
      if (!adresseDemandee) return undefined;
      const parAdresse = parIdentiteMetier.filter(
        (candidat) =>
          candidat.typeMetierRecherche !== 'evenement' &&
          candidat.adresse !== undefined &&
          cleNom(candidat.adresse) === adresseDemandee
      );
      return parAdresse.length === 1 ? parAdresse[0] : undefined;
    },

    statutRechercheEssentielle(
      besoin: BesoinEssentielRecherche
    ): RechercheTracee['statut'] | undefined {
      const correspondantes = recherchesTracees.filter((recherche) => {
        if (
          recherche.typeMetierRecherche !== besoin.typeMetierRecherche ||
          cleNom(recherche.villeDemandee) !== cleNom(besoin.villeDemandee)
        ) {
          return false;
        }
        if (besoin.typeMetierRecherche === 'evenement') {
          return (
            recherche.dateDebut === besoin.dateDebut &&
            recherche.dateFin === besoin.dateFin
          );
        }
        return cleNom(recherche.requete ?? '') === cleNom(besoin.requete);
      });
      if (correspondantes.length === 0) return undefined;
      if (correspondantes.some((recherche) => recherche.statut === 'ok')) return 'ok';
      if (correspondantes.some((recherche) => recherche.statut === 'vide')) return 'vide';
      return 'indisponible';
    },

    trouverLieuReel(nom: string): CandidatJournal | undefined {
      const cle = cleNom(nom);
      if (!cle) return undefined;
      const candidats = [...journal.values()].filter(
        (candidat) => cleNom(candidat.nom) === cle
      );
      return candidats.length === 1 ? candidats[0] : undefined;
    },
  };
}
