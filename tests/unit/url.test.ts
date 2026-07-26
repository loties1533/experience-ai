import { describe, it, expect } from 'vitest';
import { construireLienHotel, lienGoogleMaps } from '../../server/lib/url.js';

describe('construireLienHotel — lien Booking.com pré-rempli (repris de TripGenie)', () => {
  it('pose le nom et la ville en terme de recherche quand la ville n’y figure pas déjà', () => {
    const url = new URL(construireLienHotel('Hôtel de la Paix', 'Bordeaux'));
    expect(url.origin + url.pathname).toBe('https://www.booking.com/searchresults.html');
    expect(url.searchParams.get('ss')).toBe('Hôtel de la Paix Bordeaux');
  });

  it('n’ajoute pas la ville en double si le nom la contient déjà', () => {
    const url = new URL(construireLienHotel('Hôtel Bordeaux Centre', 'Bordeaux'));
    expect(url.searchParams.get('ss')).toBe('Hôtel Bordeaux Centre');
  });

  it('pose les dates de séjour (checkin/checkout), tronquées au jour', () => {
    const url = new URL(
      construireLienHotel('Hôtel de la Paix', 'Bordeaux', {
        checkin: '2026-08-15T14:00:00Z',
        checkout: '2026-08-17T10:00:00Z',
      })
    );
    expect(url.searchParams.get('checkin')).toBe('2026-08-15');
    expect(url.searchParams.get('checkout')).toBe('2026-08-17');
  });

  it('omet les dates absentes plutôt que d’en inventer', () => {
    const url = new URL(construireLienHotel('Hôtel de la Paix', 'Bordeaux'));
    expect(url.searchParams.has('checkin')).toBe(false);
    expect(url.searchParams.has('checkout')).toBe(false);
  });

  it('pose le nombre de voyageurs et calcule les chambres nécessaires', () => {
    const url = new URL(
      construireLienHotel('Hôtel de la Paix', 'Bordeaux', { voyageurs: 5 })
    );
    expect(url.searchParams.get('group_adults')).toBe('5');
    expect(url.searchParams.get('no_rooms')).toBe('3');
    expect(url.searchParams.get('group_children')).toBe('0');
  });

  it('n’ajoute aucun paramètre voyageurs à zéro ou absent', () => {
    const url = new URL(construireLienHotel('Hôtel de la Paix', 'Bordeaux', { voyageurs: 0 }));
    expect(url.searchParams.has('group_adults')).toBe(false);
  });
});

describe('lienGoogleMaps', () => {
  it('encode le nom et la ville dans une recherche Maps', () => {
    const url = lienGoogleMaps('Le Point Rouge', 'Bordeaux');
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux');
  });
});
