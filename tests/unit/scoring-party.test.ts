// =============================================
// TRIPGENIE — tests/unit/scoring-party.test.ts
// Cas spécifiques mode PARTY :
//   - scoring basé sur les activités nightlife (fallback events vides)
//   - prix calculé par personne et non total
// =============================================

import { describe, it, expect } from 'vitest';
import { scorerPack } from '../../server/services/scoring.js';

const BASE_VOL   = { price: 300, duration_min: 120, stops: 0 };
const BASE_HOTEL = { stars: 3, price_per_night: 120, rating: 7.5 };

// ============================================================
// Prix par personne — la clé du fix du 28/05
// ============================================================
describe('scorerPack — prix par personne (fix 28/05)', () => {

  it('2 voyageurs : prix/pers = total / 2', () => {
    const pack = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: [], totalPrice: 4000 };
    const score2 = scorerPack(pack, 'party', 2, 'Ibiza');
    // prix/pers = 2000 → score "prix" non nul
    expect(score2.total).toBeGreaterThan(0);
  });

  it('1 voyageur : prix/pers = totalPrice (pas de division)', () => {
    const pack1 = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: [], totalPrice: 2000 };
    const pack4 = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: [], totalPrice: 8000 };
    const score1 = scorerPack(pack1, 'student', 1, 'Lisbonne');
    const score4 = scorerPack(pack4, 'student', 4, 'Lisbonne');
    // Même budget/pers → scores proches (±0.1)
    expect(Math.abs(score1.total - score4.total)).toBeLessThan(0.15);
  });

  it('groupe de 5 : 35 000€ total → 7 000€/pers → score prix positif', () => {
    const pack = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: [], totalPrice: 35000 };
    const score = scorerPack(pack, 'party', 5, 'Ibiza');
    // Avant le fix : totalPrice=35000 > max 10000 → prix=0 → score ≈ 15%
    // Après fix   : 7000/pers < max 8000 → prix > 0
    expect(score.details.prix).toBeGreaterThan(0);
  });

  it('score party sans events : ne doit PAS être 0', () => {
    const pack = {
      vol:        BASE_VOL,
      hotel:      BASE_HOTEL,
      events:     [],
      activities: [
        { name: 'Sky Club Ibiza', category: 'nightclub', description: '', duration: '4h', price: 50 },
        { name: 'Ushuaia Beach', category: 'beach club', description: '', duration: '5h', price: 80 },
      ],
      totalPrice: 5000
    };
    const score = scorerPack(pack, 'party', 2, 'Ibiza');
    // Avant le fix : events=0 → events_score=0 (40% du total) → score < 20%
    // Après fix   : activités nightlife comptent comme fallback → score > 30%
    expect(score.total).toBeGreaterThan(0.30);
  });

  it('plus il y a d\'activités nightlife, meilleur le score party', () => {
    const baseActivities = [
      { name: 'Beach Club', category: 'beach club', description: '', duration: '4h', price: 60 },
    ];
    const richActivities = [
      { name: 'Beach Club',    category: 'beach club', description: '', duration: '4h', price: 60 },
      { name: 'Nightclub VIP', category: 'nightclub', description: '', duration: '5h', price: 80 },
      { name: 'Bar Rooftop',   category: 'bar', description: '', duration: '3h', price: 40 },
      { name: 'Concert',       category: 'concert', description: '', duration: '3h', price: 70 },
    ];
    const packBase = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: baseActivities,  totalPrice: 3000 };
    const packRich = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: richActivities, totalPrice: 3000 };
    const scoreBase = scorerPack(packBase, 'party', 2, 'Ibiza');
    const scoreRich = scorerPack(packRich, 'party', 2, 'Ibiza');
    expect(scoreRich.total).toBeGreaterThan(scoreBase.total);
  });

  it('activités non-nightlife n\'améliorent pas le score party', () => {
    const actMusee = [
      { name: 'Musée du Louvre',   category: 'culture', description: '', duration: '3h', price: 20 },
      { name: 'Visite Cathédrale', category: 'histoire', description: '', duration: '1h', price: 0 },
    ];
    const actNight = [
      { name: 'Discothèque VIP', category: 'nightclub', description: '', duration: '5h', price: 80 },
      { name: 'Bar Cocktails',   category: 'bar', description: '', duration: '3h', price: 40 },
    ];
    const packMusee = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: actMusee, totalPrice: 3000 };
    const packNight = { vol: BASE_VOL, hotel: BASE_HOTEL, events: [], activities: actNight, totalPrice: 3000 };
    const scoreMusee = scorerPack(packMusee, 'party', 2, 'Paris');
    const scoreNight = scorerPack(packNight, 'party', 2, 'Ibiza');
    expect(scoreNight.total).toBeGreaterThan(scoreMusee.total);
  });
});

// ============================================================
// Regressions — les autres modes ne sont pas impactés
// ============================================================
describe('scorerPack — régression modes non-party', () => {

  it('mode group (non-party) : les activités nightlife ne boostent pas le score', () => {
    const packLuxe = {
      vol:        { price: 1500, duration_min: 90, stops: 0 },
      hotel:      { stars: 5, price_per_night: 600, rating: 9.5 },
      events:     [],
      activities: [
        { name: 'Nightclub', category: 'nightclub', description: '', duration: '4h', price: 100 }
      ],
      totalPrice: 10000
    };
    const packLuxeVrai = {
      vol:        { price: 1500, duration_min: 90, stops: 0 },
      hotel:      { stars: 5, price_per_night: 600, rating: 9.5 },
      events:     [],
      activities: [
        { name: 'Spa Cinq Mondes', category: 'wellness', description: '', duration: '2h', price: 200 }
      ],
      totalPrice: 10000
    };
    // Les deux scores doivent être proches (nightlife ne biaise pas un mode non-party)
    const scoreNight = scorerPack(packLuxe,     'group', 2, 'Monaco');
    const scoreLuxe  = scorerPack(packLuxeVrai, 'group', 2, 'Monaco');
    expect(Math.abs(scoreNight.total - scoreLuxe.total)).toBeLessThan(0.2);
  });

  it('mode student : prix bas reste la priorité absolue', () => {
    const packCheap = { vol: { price: 80, duration_min: 200, stops: 1 }, hotel: { stars: 2, price_per_night: 30, rating: 6 }, events: [], activities: [], totalPrice: 400 };
    const packCheer = { vol: { price: 500, duration_min: 90,  stops: 0 }, hotel: { stars: 4, price_per_night: 200, rating: 9 }, events: [], activities: [], totalPrice: 3000 };
    const scoreCheap = scorerPack(packCheap, 'student', 1, 'Prague');
    const scoreCheer = scorerPack(packCheer, 'student', 1, 'Prague');
    expect(scoreCheap.total).toBeGreaterThan(scoreCheer.total);
  });
});
