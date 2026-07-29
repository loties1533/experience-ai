import { describe, expect, it } from 'vitest';
import {
  construireUrlRechercheHotel,
  creerLienRechercheHebergement,
  lienGoogleMaps,
  type DemandeRechercheHotel,
} from '../../server/lib/url.js';

const demandeValide: DemandeRechercheHotel = {
  sejour: {
    ville: 'Bordeaux',
    arrivee: '2026-08-15',
    depart: '2026-08-17',
  },
  occupation: {
    statut: 'declaree',
    adultes: 2,
    enfants: 0,
    chambres: 1,
  },
};

function analyserRecherche(
  demande: DemandeRechercheHotel = demandeValide
): URL {
  return new URL(construireUrlRechercheHotel(demande));
}

describe('construireUrlRechercheHotel', () => {
  it('construit une recherche Booking HTTPS avec la ville seule', () => {
    const url = analyserRecherche();

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://www.booking.com/searchresults.html'
    );
    expect(url.searchParams.get('ss')).toBe('Bordeaux');
  });

  it.each([
    'La Rochelle',
    'Évian-les-Bains',
    "L'Haÿ-les-Roses",
  ])('conserve espaces, accents et apostrophes dans « %s »', (ville) => {
    const url = analyserRecherche({
      ...demandeValide,
      sejour: {
        ...demandeValide.sejour,
        ville,
      },
    });

    expect(url.searchParams.get('ss')).toBe(ville);
  });

  it('ajoute le nom réel Foursquare à la ville sans dupliquer celle-ci', () => {
    expect(
      analyserRecherche({
        ...demandeValide,
        nomHotel: 'Hôtel de la Paix',
      }).searchParams.get('ss')
    ).toBe('Hôtel de la Paix Bordeaux');

    expect(
      analyserRecherche({
        ...demandeValide,
        nomHotel: 'Hôtel Bordeaux Centre',
      }).searchParams.get('ss')
    ).toBe('Hôtel Bordeaux Centre');
  });

  it('reprend exactement le séjour et l’occupation déclarés', () => {
    const url = analyserRecherche({
      sejour: {
        ville: 'Lyon',
        arrivee: '2026-09-03',
        depart: '2026-09-08',
      },
      occupation: {
        statut: 'declaree',
        adultes: 4,
        enfants: 2,
        chambres: 3,
      },
    });

    expect(Object.fromEntries(url.searchParams)).toEqual({
      ss: 'Lyon',
      checkin: '2026-09-03',
      checkout: '2026-09-08',
      group_adults: '4',
      group_children: '2',
      no_rooms: '3',
    });
  });

  it('reste déterministe pour une même demande', () => {
    expect(construireUrlRechercheHotel(demandeValide)).toBe(
      construireUrlRechercheHotel(demandeValide)
    );
  });

  it('ne produit que les six paramètres attendus, chacun une seule fois', () => {
    const url = analyserRecherche();
    const cles = [...url.searchParams.keys()];

    expect(cles).toEqual([
      'ss',
      'checkin',
      'checkout',
      'group_adults',
      'group_children',
      'no_rooms',
    ]);
    for (const cle of cles) {
      expect(url.searchParams.getAll(cle)).toHaveLength(1);
    }
  });

  it('encode les entrées sans leur permettre de modifier l’hôte ou les paramètres', () => {
    const url = analyserRecherche({
      ...demandeValide,
      sejour: {
        ...demandeValide.sejour,
        ville: 'Bordeaux&checkout=2030-01-01',
      },
      nomHotel: 'https://evil.test/?group_adults=20#fragment',
    });

    expect(url.origin).toBe('https://www.booking.com');
    expect(url.pathname).toBe('/searchresults.html');
    expect(url.hash).toBe('');
    expect(url.searchParams.get('checkout')).toBe('2026-08-17');
    expect(url.searchParams.get('group_adults')).toBe('2');
    expect(url.searchParams.get('ss')).toContain(
      'https://evil.test/?group_adults=20#fragment'
    );
    expect(url.searchParams.get('ss')).toContain(
      'Bordeaux&checkout=2030-01-01'
    );
  });

  it('crée un contrat honnête de recherche avec son horodatage', () => {
    const lien = creerLienRechercheHebergement(
      demandeValide,
      '2026-07-29T12:34:56.000Z'
    );

    expect(lien).toEqual({
      type: 'recherche',
      fournisseur: 'Booking',
      url: construireUrlRechercheHotel(demandeValide),
      libelle: 'Rechercher des hébergements sur Booking',
      genereLe: '2026-07-29T12:34:56.000Z',
    });
    expect(lien).not.toHaveProperty('disponibilite');
    expect(lien).not.toHaveProperty('reservation');
    expect(lien).not.toHaveProperty('prix');
  });

  it.each([
    ['ville vide', { ...demandeValide, sejour: { ...demandeValide.sejour, ville: '   ' } }],
    [
      'dates égales',
      {
        ...demandeValide,
        sejour: { ...demandeValide.sejour, depart: '2026-08-15' },
      },
    ],
    [
      'départ avant arrivée',
      {
        ...demandeValide,
        sejour: { ...demandeValide.sejour, depart: '2026-08-14' },
      },
    ],
    [
      'date civile impossible',
      {
        ...demandeValide,
        sejour: { ...demandeValide.sejour, arrivee: '2026-02-30' },
      },
    ],
    [
      'date-heure à la place d’une date civile',
      {
        ...demandeValide,
        sejour: {
          ...demandeValide.sejour,
          arrivee: '2026-08-15T10:00:00Z',
        },
      },
    ],
    [
      'aucun adulte',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, adultes: 0 },
      },
    ],
    [
      'adultes décimaux',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, adultes: 1.5 },
      },
    ],
    [
      'trop d’adultes',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, adultes: 21 },
      },
    ],
    [
      'nombre d’enfants négatif',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, enfants: -1 },
      },
    ],
    [
      'trop d’enfants',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, enfants: 21 },
      },
    ],
    [
      'aucune chambre',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, chambres: 0 },
      },
    ],
    [
      'trop de chambres',
      {
        ...demandeValide,
        occupation: { ...demandeValide.occupation, chambres: 11 },
      },
    ],
    [
      'date vide',
      {
        ...demandeValide,
        sejour: { ...demandeValide.sejour, arrivee: '' },
      },
    ],
    [
      'occupation à confirmer',
      {
        ...demandeValide,
        occupation: { statut: 'a_confirmer' },
      },
    ],
    [
      'occupation partielle',
      {
        ...demandeValide,
        occupation: { statut: 'declaree', adultes: 2 },
      },
    ],
  ])('refuse une demande invalide : %s', (_cas, demande) => {
    expect(() =>
      construireUrlRechercheHotel(
        demande as unknown as DemandeRechercheHotel
      )
    ).toThrow();
  });

  it('n’invente aucune valeur absente', () => {
    const sansEnfants = {
      ...demandeValide,
      occupation: {
        statut: 'declaree',
        adultes: 2,
        chambres: 1,
      },
    } as unknown as DemandeRechercheHotel;

    expect(() => construireUrlRechercheHotel(sansEnfants)).toThrow();
  });
});

describe('lienGoogleMaps', () => {
  it('encode le nom et la ville dans une recherche Maps', () => {
    const url = lienGoogleMaps('Le Point Rouge', 'Bordeaux');
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux'
    );
  });
});
