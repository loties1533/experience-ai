import { searchWeb } from '../tools/webSearch.js';
import * as Mocks from '../mocks.js';
import { callAI, parseJSON, sanitizeInput } from './core.js';
import { getDestinationPhoto } from '../photo.js';
import type { ElementDestination } from '../../lib/types.js';

export async function analyzeRequest(userInput: string): Promise<unknown> {
  const reponseIABrute = await callAI(
    `Analyse cette demande: "${sanitizeInput(userInput)}"
JSON: {"destination":"ville ou null","origin":"Paris","mode":"party|student|group|relax|surprise","premium":false,"travelers":2,"duration_days":3,"budget_total":null,"preferences":[],"confidence":0.9}`,
    undefined,
    'onboarding'
  );
  return parseJSON(reponseIABrute);
}

interface ParamsSuggestionDestinations {
  mode?: string;
  premium?: boolean;
  profile?: string;
  interests?: string[];
  budget?: number;
  travelers?: number;
  duration?: number;
  origin?: string;
  departure?: string;
}

interface ResultatDestinations {
  destinations: ElementDestination[];
  isMock?: boolean;
}

// Description courte de la « vibe » de chaque mode → injectée dans la requête
// web ET le prompt pour cadrer l'ambiance recherchée.
const VIBE_PAR_MODE: Record<string, string> = {
  party:    'Destinations reconnues pour la fête : beach clubs, clubs, festivals, vie nocturne intense.',
  relax:    'Destinations calmes et ressourçantes : nature, plages tranquilles, bien-être.',
  student:  'Destinations abordables et animées : bon rapport qualité-prix, ambiance jeune.',
  group:    'Destinations conviviales pour un groupe : accessibles, variées, faciles à organiser.',
  surprise: 'Destinations originales et méconnues qui sortent des sentiers battus.',
};

// Vivier LARGE par mode = EXEMPLES de NIVEAU (pas une liste figée de 3). On en
// tire 8 au sort à chaque génération → le LLM voit un sous-ensemble différent
// à chaque fois → variété réelle, tout en garantissant que le canon du mode
// (ex : Monaco/Marbella en luxe) puisse remonter. Le prompt lui demande
// explicitement de S'EN INSPIRER pour le niveau, sans les recopier, et d'en sortir.
const VIVIER_PAR_MODE: Record<string, string[]> = {
  party: [
    'Ibiza', 'Mykonos', 'Ayia Napa', 'Bodrum', 'Novalja (Zrće)', 'Hvar',
    'Tel-Aviv', 'Berlin', 'Amsterdam', 'Bangkok', 'Koh Phangan', 'Cancún',
    'Tulum', 'Miami', 'Rio de Janeiro', 'Barcelone', 'Malte', 'Split',
  ],
  relax: [
    'Bali (Ubud)', 'Maldives', 'Seychelles', 'Algarve', 'Crète', 'Madère',
    'Açores', 'Zanzibar', 'Toscane', 'Provence', 'Kerala', 'Sri Lanka',
    'Île Maurice', 'Corfou', 'Formentera', 'Costa Rica', 'Amalfi', 'Bali',
  ],
  student: [
    'Lisbonne', 'Budapest', 'Prague', 'Cracovie', 'Valence', 'Split',
    'Tbilissi', 'Sofia', 'Bucarest', 'Naples', 'Porto', 'Thessalonique',
    'Belgrade', 'Kotor', 'Tirana', 'Athènes', 'Marrakech', 'Barcelone',
  ],
  group: [
    'Barcelone', 'Lisbonne', 'Amsterdam', 'Berlin', 'Split', 'Crète',
    'Malte', 'Palma de Majorque', 'Ténérife', 'Athènes', 'Budapest',
    'Naples', 'Valence', 'Porto', 'Dubrovnik', 'Nice', 'Séville', 'Prague',
  ],
  surprise: [
    'Tbilissi', 'Erevan', 'Tirana', 'Kotor', 'Ohrid', 'Matera',
    'Gjirokastër', 'Sarajevo', 'Plovdiv', 'Oaxaca', 'Luang Prabang',
    'Kochi', 'Salvador de Bahia', 'Zanzibar', 'Tromsø', 'Îles Féroé',
    'Batoumi', 'León (Nicaragua)',
  ],
};

// Booster PREMIUM (critère prix, indépendant du mode). Quand `premium` est actif, on
// injecte quelques-unes de ces destinations haut de gamme dans les exemples de
// référence — quelle que soit la vibe — pour tirer le standing vers le haut.
// (Ancien vivier « luxury », désormais découplé du mode.)
const VIVIER_PREMIUM: string[] = [
  'Monaco', 'Marbella', 'Saint-Tropez', 'Courchevel', 'Portofino',
  'Lac de Côme', 'Capri', 'Positano', 'Dubaï', 'Abu Dhabi', 'Maldives',
  'Bora-Bora', 'Saint-Barthélemy', 'Aspen', 'Gstaad', 'Costa Smeralda',
  'Seychelles', 'Santorin',
];

/** Mélange (Fisher-Yates) — variété réelle d'une génération à l'autre. */
function melanger<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function suggestDestinations({
  mode, premium = false, profile, interests, budget, travelers, origin, departure,
}: ParamsSuggestionDestinations): Promise<ResultatDestinations> {
  try {
    const interetsStr = interests?.join(', ') ?? 'voyage';
    const dateDepart  = departure ? new Date(departure) : null;
    const moisDepart  = dateDepart && !isNaN(dateDepart.getTime())
      ? new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(dateDepart)
      : 'actuellement';

    // Le MODE oriente en premier. On tire au sort 8 exemples du vivier du mode
    // → un sous-ensemble différent à chaque génération (variété) que le LLM
    // utilise comme REPÈRE DE NIVEAU sans les recopier (cf. prompt).
    const cleMode = mode ?? '';
    // En premium, on remplace 3 des 8 exemples par des destinations haut de gamme
    // → le standing monte quelle que soit la vibe, sans écraser le mode.
    const exemplesMode = premium
      ? [...melanger(VIVIER_PREMIUM).slice(0, 3), ...melanger(VIVIER_PAR_MODE[cleMode] ?? []).slice(0, 5)]
      : melanger(VIVIER_PAR_MODE[cleMode] ?? []).slice(0, 8);
    let query = `Meilleures destinations ${mode}${premium ? ' haut de gamme' : ''} pour ${profile} en ${moisDepart}. `;
    query += (VIBE_PAR_MODE[cleMode] ?? '') + ' ';
    query += `Budget total ${budget}€ pour ${travelers} personnes. Intérêts: ${interetsStr}.`;

    const contexteWeb = await searchWeb(query);
    const budgetParPersonne = budget && travelers ? Math.round(budget / travelers) : 0;

    const trancheBudget = budgetParPersonne >= 3000
      ? `BUDGET PREMIUM (${budgetParPersonne}€/pers) : le budget permet des vols long-courrier + hôtels haut de gamme. Propose des destinations qui correspondent à CE NIVEAU DE BUDGET — raisonne par rapport au coût réel de la vie, du vol et de l'hébergement dans chaque destination. Varie les continents.`
      : budgetParPersonne >= 1500
      ? `BUDGET CONFORTABLE (${budgetParPersonne}€/pers) : le budget couvre un vol moyen-courrier + bon hébergement, ou un long-courrier accessible. Adapte tes suggestions au coût réel de chaque destination.`
      : `BUDGET SERRÉ (${budgetParPersonne}€/pers) : privilégie des destinations où ce budget est suffisant pour bien vivre — raisonne par rapport au coût de la vie local et au prix des vols depuis ${origin ?? 'France'}.`;

    const reponseIABrute = await callAI(
      `CONTEXTE WEB RÉCENT : ${contexteWeb}
      MISSION : Suggère 3 destinations parfaites pour un voyage en ${moisDepart}.
      PROFIL : ${profile ?? 'voyageur'}, MODE : ${mode}.
      INTÉRÊTS DU VOYAGEUR : ${interetsStr} — chaque destination doit permettre de les vivre RÉELLEMENT (ex. « plage » cochée → destination balnéaire, pas une ville sans littoral).
      BUDGET TOTAL : ${budget}€ pour ${travelers ?? 2} personne(s) = ${budgetParPersonne}€/personne.

      ${trancheBudget}
      ${premium ? 'GAMME PREMIUM demandée : oriente vers des destinations au standing élevé (adresses réputées, exclusivité), en cohérence avec la vibe et le budget.' : ''}
      NIVEAU / VIBE DE RÉFÉRENCE pour le mode ${mode} (exemples NON exhaustifs, juste pour caler le bon standing — tu PEUX et DOIS proposer d'autres lieux équivalents, ne recopie pas cette liste bêtement) : ${exemplesMode.join(', ')}.
      STRATÉGIE : propose des destinations RECONNUES pour ce mode, au niveau des exemples ci-dessus, cohérentes avec le budget et les intérêts. Varie d'une génération à l'autre : ne retombe pas toujours sur les 2 mêmes évidences.

      RÈGLE DE DIVERSITÉ (obligatoire) : les 3 destinations doivent être dans 3 PAYS DIFFÉRENTS. INTERDIT de proposer 3 villes du même pays (ex : Bangkok + Phuket + Koh Samui = REFUSÉ).

      STRUCTURE DES 3 DESTINATIONS (à respecter dans TOUS les budgets et TOUS les modes) :
      - Destinations 1 et 2 = des valeurs sûres, évidentes et reconnues, au niveau des exemples de référence, cohérentes avec le mode ${mode} et le budget.
      - Destination 3 = une PÉPITE : une destination que la plupart des voyageurs ne citeraient PAS spontanément, et qui NE figure PAS dans les exemples de référence ci-dessus. INTERDIT pour cette 3ème : capitales mondiales et lieux iconiques archi-célèbres (Paris, Rome, Bali, Mykonos, Saint-Tropez, lac de Côme… = REFUSÉS ici, ils sont trop évidents). Cherche la scène qui MONTE : le spot émergent dont parlent les initiés, encore abordable ou préservé — cohérent avec le mode ${mode}, les intérêts et le budget. Donne-lui un match_score légèrement plus bas que les 2 premières.

      FORMAT JSON STRICT :
      {"destinations": [{"city": "Nom", "country": "Pays", "tagline": "Accroche courte", "reason": "Raison MAX 8 mots", "budget_estimate": "~${budgetParPersonne}€/pers", "match_score": 95}]}
      "tagline", "reason" ET "country" DOIVENT être EN FRANÇAIS (ex : "Chypre", "Espagne", "États-Unis"). Seul "city" garde son nom d'origine.`,
      undefined,
      'destinations'
    );
    const destinationsSuggérees = parseJSON(reponseIABrute) as ResultatDestinations;

    if (destinationsSuggérees?.destinations?.length) {
      const promessesPhotos = await Promise.allSettled(
        destinationsSuggérees.destinations.map(d => getDestinationPhoto(d.city))
      );
      destinationsSuggérees.destinations = destinationsSuggérees.destinations.map((d, i) => ({
        ...d,
        photo: promessesPhotos[i].status === 'fulfilled' ? promessesPhotos[i].value : null,
        budget_estimate: budgetParPersonne
          ? `~${budgetParPersonne.toLocaleString('fr-FR')}€/pers`
          : d.budget_estimate,
      }));
    }

    return destinationsSuggérees;
  } catch (err) {
    console.error('SuggestDestinations échoué, activation du mode survie :', (err as Error).message);
    return Mocks.MOCK_DESTINATIONS;
  }
}
