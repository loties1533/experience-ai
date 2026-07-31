import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LienRechercheTransportSchema,
  type DemandeLienRechercheTrain,
  type DemandeLienRechercheTransportLocal,
  type DemandeLienRechercheVol,
} from '../../server/domaine/transport/index.js';
import {
  creerLienRechercheTrain,
  creerLienRechercheTransportLocal,
  creerLienRechercheVol,
} from '../../server/lib/liensTransport.js';

const GENERE_LE = '2026-07-30T09:00:00.000Z';

const VOL_VALIDE: DemandeLienRechercheVol = {
  origineIata: 'CDG',
  destinationIata: 'JFK',
  dateDepart: '2026-08-01',
};

const TRAIN_VALIDE: DemandeLienRechercheTrain = {
  origine: { nom: 'Bordeaux Saint-Jean' },
  destination: { nom: 'Paris Montparnasse' },
};

const LOCAL_VALIDE: DemandeLienRechercheTransportLocal = {
  origine: { nom: 'Gare de Lyon', ville: 'Paris' },
  destination: { nom: 'Tour Eiffel', ville: 'Paris' },
};

// Champs commerciaux ou de réservation qui ne doivent jamais exister.
const CHAMPS_INTERDITS = [
  'prix',
  'price',
  'reservation',
  'booking',
  'disponibilite',
  'available',
  'billet',
  'ticket',
];

function urlDe(lien: { url: string } | null): URL {
  expect(lien).not.toBeNull();
  return new URL((lien as { url: string }).url);
}

describe('F4-D1 — architecture : aucun branchement prématuré', () => {
  const racine = fileURLToPath(new URL('../../', import.meta.url));
  const fichiersActifs = [
    'server/agents/generation.ts',
    'server/agents/brief.ts',
    'server/agents/intake.ts',
    'server/services/liens.ts',
  ];

  it.each(fichiersActifs)(
    'la génération active n’importe pas encore liensTransport (%s)',
    (chemin) => {
      const contenu = readFileSync(`${racine}${chemin}`, 'utf-8');
      expect(contenu).not.toContain('liensTransport');
    }
  );

  it('le module ne dépend d’aucune couche service (Navitia/Amadeus)', () => {
    const contenu = readFileSync(
      `${racine}server/lib/liensTransport.ts`,
      'utf-8'
    );
    expect(contenu).not.toContain('services/');
  });
});

describe('creerLienRechercheVol', () => {
  it('renvoie exactement la page de recherche générique Google Flights', () => {
    const lien = creerLienRechercheVol(VOL_VALIDE, GENERE_LE);
    expect(lien?.url).toBe('https://www.google.com/travel/flights');
    const url = urlDe(lien);
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('');
  });

  it('ne dépend pas des données de la demande : IATA et date sans effet sur l’URL', () => {
    expect(
      creerLienRechercheVol({ ...VOL_VALIDE, destinationIata: 'LHR' }, GENERE_LE)
        ?.url
    ).toBe(creerLienRechercheVol(VOL_VALIDE, GENERE_LE)?.url);
  });

  it('ne contient aucun paramètre `q` ni deep link `tfs`', () => {
    const url = urlDe(creerLienRechercheVol(VOL_VALIDE, GENERE_LE));
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('tfs')).toBe(false);
    expect(url.search).toBe('');
  });

  it('ne produit aucun champ commercial ni de disponibilité', () => {
    const lien = creerLienRechercheVol(VOL_VALIDE, GENERE_LE);
    expect(Object.keys(lien ?? {}).sort()).toEqual([
      'fournisseur',
      'genereLe',
      'libelle',
      'type',
      'url',
    ]);
    const brut = JSON.stringify(lien).toLowerCase();
    for (const champ of CHAMPS_INTERDITS) {
      expect(brut).not.toContain(champ);
    }
  });

  it.each([
    ['un code IATA trop court', { ...VOL_VALIDE, origineIata: 'CD' }],
    ['un code IATA en minuscules', { ...VOL_VALIDE, origineIata: 'cdg' }],
    [
      'une ville sans aéroport confirmé',
      { ...VOL_VALIDE, destinationIata: 'New York' as unknown as string },
    ],
    ['une origine égale à la destination', { ...VOL_VALIDE, destinationIata: 'CDG' }],
    ['une date de départ invalide', { ...VOL_VALIDE, dateDepart: '2026-13-40' }],
    ['une date de départ manquante', { ...VOL_VALIDE, dateDepart: undefined }],
  ])('refuse prudemment %s', (_cas, demande) => {
    expect(
      creerLienRechercheVol(demande as DemandeLienRechercheVol, GENERE_LE)
    ).toBeNull();
  });
});

describe('creerLienRechercheTrain', () => {
  it('construit un itinéraire Google Maps transit entre deux gares', () => {
    const url = urlDe(creerLienRechercheTrain(TRAIN_VALIDE, GENERE_LE));
    expect(url.protocol).toBe('https:');
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://www.google.com/maps/dir/'
    );
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('travelmode')).toBe('transit');
    expect(url.searchParams.get('origin')).toBe('Bordeaux Saint-Jean');
    expect(url.searchParams.get('destination')).toBe('Paris Montparnasse');
  });

  it.each([
    'Gare de l’Est',
    "Saint-Étienne Châteaucreux",
    'Aix-en-Provence TGV',
  ])('conserve espaces, accents et apostrophes dans « %s »', (nom) => {
    const url = urlDe(
      creerLienRechercheTrain(
        { origine: { nom }, destination: { nom: 'Lyon Part-Dieu' } },
        GENERE_LE
      )
    );
    expect(url.searchParams.get('origin')).toBe(nom);
  });

  it('précise la ville sans la dupliquer quand le nom la contient déjà', () => {
    const url = urlDe(
      creerLienRechercheTrain(
        {
          origine: { nom: 'Part-Dieu', ville: 'Lyon' },
          destination: { nom: 'Lyon Perrache', ville: 'Lyon' },
        },
        GENERE_LE
      )
    );
    expect(url.searchParams.get('origin')).toBe('Part-Dieu, Lyon');
    expect(url.searchParams.get('destination')).toBe('Lyon Perrache');
  });

  it('n’injecte jamais un identifiant ou une URL comme nom de gare', () => {
    expect(
      creerLienRechercheTrain(
        {
          origine: { nom: 'https://evil.example/gare' },
          destination: { nom: 'Paris Montparnasse' },
        },
        GENERE_LE
      )
    ).toBeNull();
    expect(
      creerLienRechercheTrain(
        {
          origine: { nom: 'Gare&travelmode=driving' },
          destination: { nom: 'Paris Montparnasse' },
        },
        GENERE_LE
      )
    ).toBeNull();
  });

  it.each([
    [
      'deux gares de même identité',
      {
        origine: { nom: 'Paris Montparnasse' },
        destination: { nom: 'paris montparnasse' },
      },
    ],
    [
      'un nom de gare vide',
      { origine: { nom: '  ' }, destination: { nom: 'Paris Montparnasse' } },
    ],
  ])('refuse prudemment %s', (_cas, demande) => {
    expect(
      creerLienRechercheTrain(
        demande as DemandeLienRechercheTrain,
        GENERE_LE
      )
    ).toBeNull();
  });

  it('ne promet ni billet ni disponibilité', () => {
    const brut = JSON.stringify(
      creerLienRechercheTrain(TRAIN_VALIDE, GENERE_LE)
    ).toLowerCase();
    for (const champ of CHAMPS_INTERDITS) {
      expect(brut).not.toContain(champ);
    }
  });
});

describe('creerLienRechercheTransportLocal', () => {
  it('construit un itinéraire cartographique générique sans mode imposé', () => {
    const url = urlDe(
      creerLienRechercheTransportLocal(LOCAL_VALIDE, GENERE_LE)
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://www.google.com/maps/dir/'
    );
    expect(url.searchParams.get('origin')).toBe('Gare de Lyon, Paris');
    expect(url.searchParams.get('destination')).toBe('Tour Eiffel, Paris');
    // Un lien générique ne contraint aucun mode : aucune durée n'est promise.
    expect(url.searchParams.get('travelmode')).toBeNull();
  });

  it('refuse un itinéraire sans destination exploitable', () => {
    expect(
      creerLienRechercheTransportLocal(
        {
          origine: { nom: 'Gare de Lyon', ville: 'Paris' },
          destination: { nom: '' },
        } as DemandeLienRechercheTransportLocal,
        GENERE_LE
      )
    ).toBeNull();
  });
});

describe('sécurité et robustesse', () => {
  it('encode les caractères spéciaux sans changer d’hôte', () => {
    const url = urlDe(
      creerLienRechercheTransportLocal(
        {
          origine: { nom: "Place d'Aligre" },
          destination: { nom: 'Cœur de Ville' },
        },
        GENERE_LE
      )
    );
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('origin')).toBe("Place d'Aligre");
    expect(url.searchParams.get('destination')).toBe('Cœur de Ville');
  });

  it('est déterministe à entrée et horloge identiques', () => {
    expect(creerLienRechercheVol(VOL_VALIDE, GENERE_LE)).toEqual(
      creerLienRechercheVol(VOL_VALIDE, GENERE_LE)
    );
  });

  it('ne réalise aucun appel réseau (résultat synchrone)', () => {
    expect(creerLienRechercheVol(VOL_VALIDE, GENERE_LE)).not.toBeInstanceOf(
      Promise
    );
  });

  it('refuse un horodatage sans décalage explicite', () => {
    expect(creerLienRechercheVol(VOL_VALIDE, '2026-07-30')).toBeNull();
  });
});

describe('LienRechercheTransportSchema — garde-fous du contrat', () => {
  const lienValide = {
    type: 'recherche_vol' as const,
    fournisseur: 'Google Flights' as const,
    url: 'https://www.google.com/travel/flights',
    libelle: 'Rechercher des vols sur Google Flights',
    genereLe: GENERE_LE,
  };

  it('accepte un lien cohérent', () => {
    expect(LienRechercheTransportSchema.safeParse(lienValide).success).toBe(
      true
    );
  });

  it.each([
    [
      'un protocole non HTTPS',
      { ...lienValide, url: 'http://www.google.com/travel/flights' },
    ],
    [
      'un domaine non autorisé',
      { ...lienValide, url: 'https://evil.example/travel/flights' },
    ],
    [
      'un chemin incohérent avec le fournisseur',
      { ...lienValide, url: 'https://www.google.com/maps/dir/?api=1' },
    ],
    [
      'un fournisseur incohérent avec le type',
      { ...lienValide, fournisseur: 'Google Maps' as const },
    ],
  ])('rejette %s', (_cas, lien) => {
    expect(LienRechercheTransportSchema.safeParse(lien).success).toBe(false);
  });
});
