import { z } from 'zod';
import { memoriser } from '../../lib/cacheMemoire.js';
import { foursquareRechercheLieux } from '../foursquare.js';
import { predictHQEventsSearch } from '../predictHQ.js';
import { getRealWeather } from '../weather.js';
import type { BoiteAOutilsLLM } from './core.js';
import type { OutilLLM } from '../providers.js';
import type { TravelMode } from '../../lib/types.js';

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
const DUREE_METEO_MS = 3 * 60 * 60 * 1000;

const AUCUN_RESULTAT =
  "Aucun résultat réel pour cette recherche. Continue sans inventer de nom d'établissement : reste générique et honnête.";

/** Ce qu'on retient d'un vrai lieu pour le rattacher au parcours ensuite. */
export interface TraceLieu {
  nom: string;
  lieu?: string;
  lienCarte?: string;
  source: string;
}

export interface BoiteAOutils extends BoiteAOutilsLLM {
  /** Le vrai lieu derrière un nom proposé par le modèle, s'il vient bien d'une recherche. */
  trouverLieuReel(nom: string): TraceLieu | undefined;
}

const EntreeLieuxSchema = z.object({
  ville: z.string().min(1),
  requete: z.string().min(1),
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
      "Cherche de VRAIS lieux dans une ville : bars, clubs, restaurants, cafés, activités. À utiliser avant de proposer un établissement — ne jamais citer un nom de mémoire.",
    input_schema: {
      type: 'object',
      properties: {
        ville: { type: 'string', description: 'La ville où chercher, ex. « Bordeaux »' },
        requete: {
          type: 'string',
          description: "Ce que l'on cherche, en mots-clés courts : « bar à cocktails », « restaurant bistronomique », « escape game »",
        },
        limite: { type: 'number', description: 'Nombre de lieux souhaités (1 à 8, 4 par défaut)' },
      },
      required: ['ville', 'requete'],
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
export function creerBoiteAOutils(): BoiteAOutils {
  const journal = new Map<string, TraceLieu>();

  function retenir(trace: TraceLieu): void {
    journal.set(cleNom(trace.nom), trace);
  }

  async function chercherLieux(entree: unknown): Promise<string> {
    const params = EntreeLieuxSchema.safeParse(entree);
    if (!params.success) return "Recherche impossible : il faut une ville et ce que l'on cherche.";

    const { ville, requete } = params.data;
    const limite = params.data.limite ?? 4;
    const lieux = await memoriser(
      `lieux:${cleNom(ville)}:${cleNom(requete)}:${limite}`,
      () => foursquareRechercheLieux(ville, requete, limite),
      DUREE_LIEUX_MS
    );
    if (lieux.length === 0) return AUCUN_RESULTAT;

    for (const lieu of lieux) {
      retenir({ nom: lieu.nom, lieu: lieu.adresse, lienCarte: lieu.lienCarte, source: 'Foursquare' });
    }
    // On ne transmet pas les liens au modèle : les liens, on les rattache
    // nous-mêmes ensuite. Il ne doit jamais avoir à écrire une URL.
    return JSON.stringify(
      lieux.map((lieu) => ({ nom: lieu.nom, categorie: lieu.categorie, adresse: lieu.adresse }))
    );
  }

  async function chercherEvenements(entree: unknown): Promise<string> {
    const params = EntreeEvenementsSchema.safeParse(entree);
    if (!params.success) return 'Recherche impossible : il faut une ville et une date de début (AAAA-MM-JJ).';

    const { ville, genre } = params.data;
    const debut = jour(params.data.dateDebut);
    const fin = jour(params.data.dateFin ?? params.data.dateDebut);
    const mode: TravelMode = genre ? MODE_PAR_GENRE[genre] : 'surprise';

    const evenements = await memoriser(
      `evenements:${cleNom(ville)}:${debut}:${fin}:${mode}`,
      () => predictHQEventsSearch(ville, debut, fin, mode),
      DUREE_EVENEMENTS_MS
    );
    if (evenements.length === 0) return AUCUN_RESULTAT;

    for (const evenement of evenements) {
      retenir({ nom: evenement.title, lieu: evenement.venue, source: 'PredictHQ' });
    }
    return JSON.stringify(
      evenements.map((e) => ({ nom: e.title, categorie: e.category, jour: e.start, lieu: e.venue }))
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
        return AUCUN_RESULTAT;
      }
    },

    trouverLieuReel(nom: string): TraceLieu | undefined {
      const cle = cleNom(nom);
      if (!cle) return undefined;
      const exact = journal.get(cle);
      if (exact) return exact;
      // Le modèle rallonge parfois le nom (« Dîner au Petit Commerce ») : on
      // accepte l'inclusion, mais jamais sur un fragment trop court, qui
      // rapprocherait n'importe quoi de n'importe quoi.
      if (cle.length < 5) return undefined;
      for (const [cleConnue, trace] of journal) {
        if (cleConnue.length >= 5 && (cle.includes(cleConnue) || cleConnue.includes(cle))) return trace;
      }
      return undefined;
    },
  };
}
