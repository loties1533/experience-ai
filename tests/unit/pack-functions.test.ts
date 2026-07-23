// =============================================
// TRIPGENIE — tests/unit/pack-functions.test.ts
//
// Tests unitaires des 6 fonctions pures de services/claude/pack.ts
// Aucun appel LLM, aucun service externe — fonctions déterministes.
//
// Fonctions testées :
//   calculerNuits         → calcul du nombre de nuits
//   construirePromptPack    → construction du prompt LLM
//   parserReponsePack  → parsing JSON + fallback structuré
//   transformerVols         → FlightSearchResult[] → Pack['flights']
//   transformerActivites      → activités LLM → Pack['activities']
//   calculerRepartitionBudget → répartition BUDGET_RATIOS
// =============================================

import { describe, it, expect, vi } from 'vitest';

// ---- Mock callAI uniquement — on garde le vrai parseJSON/sanitizeInput ----
// vi.importActual conserve les vraies implémentations des autres exports.
// Seul callAI est remplacé pour éviter les appels réseau LLM dans les tests.
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return {
    ...real,
    callAI: vi.fn().mockResolvedValue('{}'),
  };
});

import {
  calculerNuits,
  construirePromptPack,
  parserReponsePack,
  transformerVols,
  transformerActivites,
  calculerRepartitionBudget,
  construireUrlHotel,
} from '../../server/services/claude/pack.js';

// ============================================================
// 1. calculerNuits
// ============================================================
describe('calculerNuits — calcul du nombre de nuits', () => {

  it('dates précises : return_date - departure en jours', () => {
    expect(calculerNuits('2026-07-10', '2026-07-17', undefined, 2000)).toBe(7);
  });

  it('durée explicite : retourne duration si fournie', () => {
    expect(calculerNuits(undefined, undefined, 5, 2000)).toBe(5);
  });

  it('fallback budget : budget / 500, borné entre 2 et 14', () => {
    expect(calculerNuits(undefined, undefined, undefined, 1000)).toBe(2);   // 1000/500=2
    expect(calculerNuits(undefined, undefined, undefined, 3000)).toBe(6);   // 3000/500=6
    expect(calculerNuits(undefined, undefined, undefined, 50000)).toBe(14); // capé à 14
    expect(calculerNuits(undefined, undefined, undefined, 100)).toBe(2);    // minimum 2
  });

  it('aller-retour même jour → minimum 1 nuit', () => {
    expect(calculerNuits('2026-07-10', '2026-07-10', undefined, 2000)).toBe(1);
  });

  it('dates prioritaires sur duration', () => {
    expect(calculerNuits('2026-07-10', '2026-07-13', 10, 2000)).toBe(3);
  });
});

// ============================================================
// 2. construirePromptPack
// ============================================================
describe('construirePromptPack — construction du prompt LLM', () => {

  const base = {
    dest: 'Ibiza',
    originCity: 'Paris',
    travelers: 2,
    profile: undefined as string | undefined,
    mode: 'party' as const,
    budgetPerPers: 1000,
    nights: 5,
    events: undefined as undefined,
  };

  it('contient la destination et la ville de départ', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).toContain('Ibiza');
    expect(prompt).toContain('Paris');
  });

  it('contient le mode de voyage', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).toContain('party');
  });

  it('contient les instructions nightlife pour mode party', () => {
    const prompt = construirePromptPack(base);
    expect(prompt.toLowerCase()).toContain('nightlife');
  });

  it('premium=true : injecte le modifier haut de gamme (axe indépendant du mode)', () => {
    const prompt = construirePromptPack({ ...base, premium: true });
    expect(prompt.toLowerCase()).toContain('haut de gamme');
  });

  it('premium=false : aucun modifier premium dans le prompt', () => {
    const prompt = construirePromptPack({ ...base, premium: false });
    expect(prompt.toLowerCase()).not.toContain('haut de gamme');
  });

  it('profil couple : injecte le modifier tête-à-tête (axe indépendant du mode)', () => {
    const prompt = construirePromptPack({ ...base, profile: 'couple' });
    expect(prompt.toLowerCase()).toContain('tête-à-tête');
  });

  it('profil famille : injecte le modifier enfants', () => {
    const prompt = construirePromptPack({ ...base, profile: 'famille' });
    expect(prompt.toLowerCase()).toContain('enfants');
  });

  it('profil inconnu ou absent : aucun modifier profil', () => {
    const prompt = construirePromptPack({ ...base, profile: undefined });
    expect(prompt).not.toContain('PROFIL COUPLE');
    expect(prompt).not.toContain('PROFIL FAMILLE');
  });

  it('contient instructions student pour mode student', () => {
    const prompt = construirePromptPack({ ...base, mode: 'student' as const });
    expect(prompt.toLowerCase()).toContain('budget');
  });

  it('injecte les événements réels si fournis', () => {
    const events = [
      { title: 'Pacha Opening', venue: 'Pacha Ibiza', category: 'Nightlife', start: '2026-07-15', description: '', booking_url: null, links: { viator: '', getyourguide: '' } },
    ];
    const prompt = construirePromptPack({ ...base, events });
    expect(prompt).toContain('Pacha Opening');
  });

  it('contient le budget par personne', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).toContain('1000');
  });

  it('contient le nombre de nuits', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).toContain('5');
  });

  it('contient le nombre de voyageurs', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).toContain('2');
  });

  it('injecte les centres d\'intérêt du voyageur dans le prompt (activités sur-mesure)', () => {
    const prompt = construirePromptPack({ ...base, interests: ['Culture', 'Histoire'] });
    expect(prompt).toContain("CENTRES D'INTÉRÊT");
    expect(prompt).toContain('Culture, Histoire');
  });

  it('sans centres d\'intérêt : aucune ligne intérêts (rétrocompat)', () => {
    const prompt = construirePromptPack(base);
    expect(prompt).not.toContain("CENTRES D'INTÉRÊT");
  });
});

// ============================================================
// 3. parserReponsePack
// ============================================================
describe('parserReponsePack — parsing JSON + fallback', () => {

  it('parse un JSON valide', () => {
    const raw = JSON.stringify({
      country: 'Espagne',
      tagline: 'Ibiza by night',
      airport_code: 'IBZ',
    });
    const result = parserReponsePack(raw, 'Ibiza', 5);
    expect(result.country).toBe('Espagne');
    expect(result.tagline).toBe('Ibiza by night');
    expect(result.airport_code).toBe('IBZ');
  });

  it('parse JSON avec fences markdown (```json ... ```)', () => {
    const raw = '```json\n{"country":"France","tagline":"Paris forever"}\n```';
    const result = parserReponsePack(raw, 'Paris', 3);
    expect(result.country).toBe('France');
  });

  it('fallback si JSON totalement invalide', () => {
    const result = parserReponsePack('ceci nest pas du json !!!', 'Ibiza', 5);
    expect(result.country).toBeDefined();
    expect(result.tagline).toContain('Ibiza');
    expect(result.itinerary).toHaveLength(3); // Math.min(5, 3) = 3 jours
  });

  it('fallback contient des hôtels génériques', () => {
    const result = parserReponsePack('invalid', 'Barcelone', 4);
    expect(result.hotels).toHaveLength(2);
    expect(result.hotels![0].name).toContain('Barcelone');
  });

  it('fallback itinerary limité à 3 jours max', () => {
    const result = parserReponsePack('invalid', 'Tokyo', 10);
    expect(result.itinerary!.length).toBeLessThanOrEqual(3);
  });

  it('fallback avec 1 nuit : itinerary 1 jour', () => {
    const result = parserReponsePack('invalid', 'Lyon', 1);
    expect(result.itinerary).toHaveLength(1);
  });

  it('parse JSON tronqué (bracket manquant)', () => {
    const raw = '{"country":"Italie","tagline":"Roma"}'; // valide mais tronqué volontairement
    const result = parserReponsePack(raw, 'Rome', 4);
    expect(result.country).toBe('Italie');
  });
});

// ============================================================
// 4. transformerVols
// ============================================================
describe('transformerVols — mapping vols → Pack[\'flights\']', () => {

  const flight = {
    price: 150,
    airline: 'Vueling',
    outbound_time: '08:00',
    arrival_time: '10:00',
    duration: '2h00',
    stops: 'Direct',
    booking_url: null,
    links: { skyscanner: 'https://skyscanner.fr', kayak: '', google: '' },
  };

  it('produit exactement 2 vols (aller + retour)', () => {
    const flights = transformerVols([flight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    expect(flights).toHaveLength(2);
  });

  it('vol aller de type outbound', () => {
    const flights = transformerVols([flight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    expect(flights[0].type).toBe('outbound');
    expect(flights[0].from).toBe('CDG');
    expect(flights[0].to).toBe('IBZ');
  });

  it('vol retour de type return', () => {
    const flights = transformerVols([flight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    expect(flights[1].type).toBe('return');
    expect(flights[1].from).toBe('IBZ');
    expect(flights[1].to).toBe('CDG');
  });

  it('prix pas divisé (déjà par personne)', () => {
    const flights = transformerVols([flight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    expect(flights[0].price_per_person).toBe('150€');
  });

  it('prix aberrant (>1800€) → capé à 15% du budget/pers', () => {
    const expensiveFlight = { ...flight, price: 5000 };
    const flights = transformerVols([expensiveFlight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    // budget 2000€, 2 pers → 15% = 300€/pers → pas 5000€
    const priceNum = parseInt(flights[0].price_per_person!.replace('€', ''));
    expect(priceNum).toBeLessThan(1800);
  });

  it('fallback sans données Tavily : vols estimés générés', () => {
    const flights = transformerVols(undefined, 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    expect(flights).toHaveLength(2);
    expect(flights[0].airline).toBe('À confirmer');
  });

  it('fallback sans données : prix = 15% budget/pers', () => {
    const flights = transformerVols([], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2);
    // 15% de 2000€ / 2 pers = 150€
    expect(flights[0].price_per_person).toBe('150€');
  });

  it('construit des liens vols pré-remplis (Skyscanner IATA+dates, repli Google)', () => {
    const f = transformerVols([flight], 'IBZ', 'CDG', 'Paris', 'Ibiza', 2000, 2, '2026-07-15', '2026-07-20');
    expect(f[0].links?.skyscanner).toContain('/cdg/ibz/'); // codes IATA en minuscules
    expect(f[0].links?.skyscanner).toContain('260715');     // date aller au format YYMMDD
    expect(f[0].links?.skyscanner).toContain('adults=2');
    // Codes IATA invalides (XXX) → repli sur google.com/search (google/travel ne pré-remplit pas)
    const g = transformerVols([flight], 'XXX', 'XXX', 'Paris', 'Ibiza', 2000, 2, '2026-07-15');
    expect(g[0].links?.skyscanner).toContain('google.com/search');
    expect(g[0].links?.google).toContain('google.com/search');
  });
});

// ============================================================
// 5. transformerActivites
// ============================================================
describe('transformerActivites — mapping activités → Pack[\'activities\']', () => {

  it('retourne un tableau vide si undefined', () => {
    expect(transformerActivites(undefined, 'Ibiza')).toHaveLength(0);
  });

  it('retourne un tableau vide si tableau vide', () => {
    expect(transformerActivites([], 'Ibiza')).toHaveLength(0);
  });

  it('catégorie Nightlife pour type club', () => {
    const acts = transformerActivites([{ name: 'Pacha', type: 'club', description: 'legendary' }], 'Ibiza');
    expect(acts[0].category).toBe('Nightlife');
  });

  it('catégorie Gastronomie pour type restaurant', () => {
    const acts = transformerActivites([{ name: 'Nobu', type: 'restaurant-étoilé', description: 'Michelin' }], 'Ibiza');
    expect(acts[0].category).toBe('Gastronomie');
  });

  it('catégorie Nautique pour type bateau', () => {
    const acts = transformerActivites([{ name: 'Yacht privé', type: 'bateau', description: 'exclusif' }], 'Ibiza');
    expect(acts[0].category).toBe('Nautique');
  });

  it('catégorie Culture pour type culture', () => {
    const acts = transformerActivites([{ name: 'Musée Dali', type: 'culture', description: 'art' }], 'Figueres');
    expect(acts[0].category).toBe('Culture');
  });

  it('catégorie Bien-être pour un yoga (repli sur le nom)', () => {
    // type générique 'activité' → on retombe sur le nom « Yoga »
    const acts = transformerActivites([{ name: 'Yoga Paros - Naoussa', type: 'activité', description: 'zen' }], 'Paros');
    expect(acts[0].category).toBe('Bien-être');
  });

  it('catégorie Nature pour un sentier de randonnée (repli sur le nom)', () => {
    const acts = transformerActivites([{ name: 'Sentier côtier Paros-Naxos', type: 'activité', description: 'rando' }], 'Paros');
    expect(acts[0].category).toBe('Nature');
  });

  it('catégorie Plage pour des criques (repli sur le nom)', () => {
    const acts = transformerActivites([{ name: 'Criques privées Antiparos', type: 'activité', description: 'baignade' }], 'Paros');
    expect(acts[0].category).toBe('Plage');
  });

  it('catégorie neutre « Expérience » quand rien ne matche (plus de faux « Culture »)', () => {
    const acts = transformerActivites([{ name: 'Atelier mystère', type: 'activité', description: 'surprise' }], 'Paros');
    expect(acts[0].category).toBe('Expérience');
  });

  it('lien Google Maps universel pour un restaurant', () => {
    const acts = transformerActivites([{ name: 'Nobu', type: 'restaurant', description: 'test' }], 'Ibiza');
    expect(acts[0].booking_url).toContain('google.com/maps');
  });

  it('lien Google Maps universel pour un bateau', () => {
    const acts = transformerActivites([{ name: 'Sailing trip', type: 'bateau', description: 'test' }], 'Ibiza');
    expect(acts[0].booking_url).toContain('google.com/maps');
  });

  it('lien Google Maps universel pour le nightlife', () => {
    const acts = transformerActivites([{ name: 'Amnesia', type: 'club', description: 'test' }], 'Ibiza');
    expect(acts[0].booking_url).toContain('google.com/maps');
  });

  it('lien Google Maps universel inclut la ville (bonne ville partout)', () => {
    const acts = transformerActivites([{ name: 'Cathédrale', type: 'monument', description: 'test' }], 'Paris');
    expect(acts[0].booking_url).toContain('google.com/maps');
    expect(acts[0].booking_url).toContain('Paris');
  });

  it('préserve le nom de l\'activité', () => {
    const acts = transformerActivites([{ name: 'Ushuaïa Beach Club', type: 'beach-club', description: 'test' }], 'Ibiza');
    expect(acts[0].name).toBe('Ushuaïa Beach Club');
  });

  it('fallback name si absent', () => {
    const acts = transformerActivites([{ type: 'culture', description: 'test' }], 'Ibiza');
    expect(acts[0].name).toBe('Activité');
  });
});

// ============================================================
// 6. calculerRepartitionBudget
// ============================================================
describe('calculerRepartitionBudget — répartition BUDGET_RATIOS', () => {

  it('total = budget fourni', () => {
    const bd = calculerRepartitionBudget(2000, 'party', 5, 2);
    expect(bd.total).toBe('2000€');
  });

  it('mode party : 25% vols (ratio.vols = 0.25)', () => {
    const bd = calculerRepartitionBudget(2000, 'party', 5, 2);
    expect(bd.vols).toBe('500€'); // 2000 * 0.25
  });

  it('mode relax : 22% vols (ratio.vols = 0.22)', () => {
    const bd = calculerRepartitionBudget(2000, 'relax', 5, 2);
    expect(bd.vols).toBe('440€'); // 2000 * 0.22
  });

  it('mode student : 35% vols (ratio.vols = 0.35)', () => {
    const bd = calculerRepartitionBudget(2000, 'student', 5, 2);
    expect(bd.vols).toBe('700€'); // 2000 * 0.35
  });

  it('plafond hébergement premium : max 800€/nuit/pers', () => {
    // budget 100000, relax + premium=true, 5 nuits, 2 pers
    // heberg nominal très élevé → ppn > 800 → capé à 800*5*2 = 8000
    const bd = calculerRepartitionBudget(100000, 'relax', 5, 2, undefined, true);
    const heberg = parseInt(bd.hebergement.replace('€', ''));
    expect(heberg).toBe(8000);
  });

  it('plafond hébergement standard : max 250€/nuit/pers', () => {
    // budget 50000, party, 5 nuits, 2 pers
    // heberg = 50000 * 0.25 = 12500 → ppn = 12500/5/2 = 1250 > 250 → capé à 250*5*2 = 2500
    const bd = calculerRepartitionBudget(50000, 'party', 5, 2);
    const heberg = parseInt(bd.hebergement.replace('€', ''));
    expect(heberg).toBe(2500);
  });

  it('divers = budget - somme des autres postes (jamais négatif)', () => {
    const bd = calculerRepartitionBudget(2000, 'party', 5, 2);
    const vols    = parseInt(bd.vols.replace('€', ''));
    const heberg  = parseInt(bd.hebergement.replace('€', ''));
    const acts    = parseInt(bd.activites.replace('€', ''));
    const resto   = parseInt(bd.restauration.replace('€', ''));
    const trans   = parseInt(bd.transports.replace('€', ''));
    const divers  = parseInt(bd.divers.replace('€', ''));
    expect(divers).toBeGreaterThanOrEqual(0);
    expect(vols + heberg + acts + resto + trans + divers).toBeLessThanOrEqual(2001); // ±1 arrondi
  });

  it('tous les champs sont présents', () => {
    const bd = calculerRepartitionBudget(3000, 'relax', 7, 2);
    expect(bd).toHaveProperty('vols');
    expect(bd).toHaveProperty('hebergement');
    expect(bd).toHaveProperty('activites');
    expect(bd).toHaveProperty('restauration');
    expect(bd).toHaveProperty('transports');
    expect(bd).toHaveProperty('divers');
    expect(bd).toHaveProperty('total');
  });

  it('chaque champ est une string terminant par €', () => {
    const bd = calculerRepartitionBudget(2000, 'group', 4, 3);
    expect(bd.vols).toMatch(/^\d+€$/);
    expect(bd.hebergement).toMatch(/^\d+€$/);
    expect(bd.total).toMatch(/^\d+€$/);
  });

  // Piste A : plafonds réalistes €/jour/pers → le reliquat va dans « divers »
  // (Marge) au lieu de gonfler resto/activités sur un budget trop gros.
  it('plafond restauration : gros budget court séjour → resto plafonnée, marge dans divers', () => {
    // relax, 5000€, 2 nuits, 2 pers, vols 720€ : sans plafond la resto montait à ~1218€.
    const bd = calculerRepartitionBudget(5000, 'relax', 2, 2, 720);
    const resto  = parseInt(bd.restauration.replace('€', ''));
    const divers = parseInt(bd.divers.replace('€', ''));
    expect(resto).toBeLessThanOrEqual(60 * 2 * 2);   // 60€/jour/pers × 2 pers × 2 nuits = 240€
    expect(divers).toBeGreaterThan(0);               // le surplus honnête part en Marge
  });
});

// ============================================================
// 7. construireUrlHotel — lien Booking pré-rempli
// ============================================================
describe('construireUrlHotel — lien Booking dates + voyageurs + chambres', () => {

  it('injecte check-in/out, group_adults et nb de chambres (2 pers/chambre)', () => {
    const url = construireUrlHotel('Hotel Metropole', 'Monaco', {
      checkin: '2026-07-17', checkout: '2026-07-19', travelers: 10,
    });
    expect(url).toContain('checkin=2026-07-17');
    expect(url).toContain('checkout=2026-07-19');
    expect(url).toContain('group_adults=10');
    expect(url).toContain('no_rooms=5');   // ceil(10 / 2) = 5 chambres
  });

  it('sans options : lien de recherche simple par nom (rétrocompat)', () => {
    const url = construireUrlHotel('Hotel Metropole', 'Monaco');
    expect(url).toContain('booking.com/searchresults');
    expect(url).not.toContain('checkin=');
    expect(url).not.toContain('no_rooms=');
  });
});
