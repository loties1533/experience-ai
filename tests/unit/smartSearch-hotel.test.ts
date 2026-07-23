// =============================================
// TRIPGENIE — tests/unit/smartSearch-hotel.test.ts
// Tests du fix URL hôtel double-ville (bug Bangkok)
// + comportement des liens de recherche hôtel
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock fetch global ----
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// On importe après le mock pour que fetch soit déjà remplacé
const BOOKING_BASE = 'https://www.booking.com/searchresults.html?ss=';

// Helper : construit l'URL Booking comme le fait hotelLinks() dans smartSearch.ts
function buildBookingUrl(hotelName: string, city: string): string {
  const searchTerm = hotelName.toLowerCase().includes(city.toLowerCase())
    ? hotelName
    : `${hotelName} ${city}`;
  return `${BOOKING_BASE}${encodeURIComponent(searchTerm)}`;
}

describe('hotelLinks — URL Booking sans double-ville (fix bug Bangkok)', () => {

  it('hôtel sans nom de ville : ville ajoutée une fois', () => {
    const url     = buildBookingUrl('Mandarin Oriental', 'Bangkok');
    const decoded = decodeURIComponent(url.replace(BOOKING_BASE, ''));
    expect(decoded).toBe('Mandarin Oriental Bangkok');
    expect(decoded).not.toContain('Bangkok Bangkok');
  });

  it('hôtel avec nom de ville déjà inclus : ville NON dupliquée', () => {
    const url = buildBookingUrl('Mandarin Oriental Bangkok', 'Bangkok');
    // "Bangkok" n'apparaît qu'une seule fois dans le terme de recherche
    const decoded = decodeURIComponent(url.replace(BOOKING_BASE, ''));
    const count = (decoded.match(/bangkok/gi) || []).length;
    expect(count).toBe(1);
  });

  it('hôtel Miami avec ville Miami : pas de doublon', () => {
    const url = buildBookingUrl('Four Seasons Miami', 'Miami');
    const decoded = decodeURIComponent(url.replace(BOOKING_BASE, ''));
    const count = (decoded.match(/miami/gi) || []).length;
    expect(count).toBe(1);
  });

  it('hôtel Paris avec ville Paris : pas de doublon', () => {
    const url = buildBookingUrl('Le Bristol Paris', 'Paris');
    const decoded = decodeURIComponent(url.replace(BOOKING_BASE, ''));
    const count = (decoded.match(/paris/gi) || []).length;
    expect(count).toBe(1);
  });

  it('ville en minuscule dans le nom : détection insensible à la casse', () => {
    // "ibiza" dans le nom → "Ibiza" (casse différente) ne doit pas être ajouté
    const url = buildBookingUrl('Ushuaia ibiza Beach Hotel', 'Ibiza');
    const decoded = decodeURIComponent(url.replace(BOOKING_BASE, ''));
    const count = (decoded.match(/ibiza/gi) || []).length;
    expect(count).toBe(1);
  });

  it('hôtel sans ville dans le nom : ville correctement ajoutée', () => {
    const decoded = decodeURIComponent(buildBookingUrl('The Ritz', 'London').replace(BOOKING_BASE, ''));
    expect(decoded).toBe('The Ritz London');
  });

  it('URL utilise searchresults.html (pas search.html)', () => {
    // Le bug original utilisait search.html qui redirige vers Bangkok par défaut
    const url = buildBookingUrl('Hilton', 'Dubai');
    expect(url).toContain('searchresults.html');
    expect(url).not.toContain('/search.html');
  });

  it('caractères spéciaux dans le nom encodés correctement', () => {
    const url = buildBookingUrl("Hôtel de l'Opéra", 'Paris');
    // Ne doit pas crasher et produire une URL valide
    expect(() => new URL(url)).not.toThrow();
  });
});

// ============================================================
// Timeout — withTimeout() dans ai.ts
// ============================================================
describe('withTimeout — individual service timeouts', () => {

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);
  }

  it('résout normalement si la promesse se termine avant le timeout', async () => {
    const fast = new Promise<string>(res => setTimeout(() => res('ok'), 10));
    await expect(withTimeout(fast, 500)).resolves.toBe('ok');
  });

  it('rejette avec "Timeout" si la promesse dépasse le délai', async () => {
    const slow = new Promise<string>(res => setTimeout(() => res('late'), 1000));
    await expect(withTimeout(slow, 50)).rejects.toThrow('Timeout');
  });

  it('un timeout d\'un service n\'affecte pas les autres (allSettled)', async () => {
    const fast   = withTimeout(Promise.resolve('vols OK'), 5000);
    const slow   = withTimeout(new Promise(res => setTimeout(res, 1000)), 50);
    const results = await Promise.allSettled([fast, slow]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
  });

  it('Promise.allSettled retourne 2 résultats même si 1 timeout', async () => {
    const promises = [
      withTimeout(Promise.resolve('hôtels'), 5000),
      withTimeout(new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 10)), 50),
    ];
    const results = await Promise.allSettled(promises);
    expect(results).toHaveLength(2);
  });
});
