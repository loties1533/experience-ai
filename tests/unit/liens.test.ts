// ============================================================
// TESTS UNITAIRES — server/services/liens.ts
// Résolveur UNIQUE de liens de réservation :
//   extraireUrlsContexte    → URLs du contexte web (dédupliquées)
//   validerUrlReservation   → filet anti-hallucination (URL ∈ contexte)
//   resoudreLiensReservation→ matching LLM + validation + dégradation propre
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// callAI mocké : aucun appel réseau dans les tests unitaires.
vi.mock('../../server/services/claude/index.js', () => ({
  callAI: vi.fn(),
  parseJSON: (raw: string) => JSON.parse(raw),
}));

import { callAI } from '../../server/services/claude/index.js';
import {
  extraireUrlsContexte,
  validerUrlReservation,
  resoudreLiensReservation,
} from '../../server/services/liens.js';

const CONTEXTE = `==== CONTEXTE WEB RECENT ====
[Source 1: Kalypso Club Novalja] (URL: https://mandalatickets.com/en/tulum/disco/Vagalume) : billetterie officielle
[Source 2: Confessions Tulum] (URL: https://www.confessions.com.mx/en/clubs-tulum-bars) : clubs et bars
[Source 3: Nightlife guide] (URL: https://www.ticketfairy.com/tulum-nightlife/) : agenda soirées
=============================
`;

// ⚠️ Les accolades sont OBLIGATOIRES : mockClear() retourne le mock (chaînable),
// et une fonction retournée par beforeEach est traitée par Vitest comme un
// CLEANUP exécuté après le test → il rappellerait callAI() hors try/catch.
beforeEach(() => { vi.mocked(callAI).mockClear(); });

// ============================================================
// 1. extraireUrlsContexte
// ============================================================
describe('extraireUrlsContexte — extraction des URLs du contexte', () => {

  it('extrait toutes les URLs du contexte', () => {
    const urls = extraireUrlsContexte(CONTEXTE);
    expect(urls).toHaveLength(3);
    expect(urls).toContain('https://mandalatickets.com/en/tulum/disco/Vagalume');
  });

  it('déduplique les URLs répétées', () => {
    const urls = extraireUrlsContexte('voir https://a.com/x puis https://a.com/x encore');
    expect(urls).toHaveLength(1);
  });

  it('contexte vide → aucun résultat', () => {
    expect(extraireUrlsContexte('')).toHaveLength(0);
  });
});

// ============================================================
// 2. validerUrlReservation — le filet anti-hallucination
// ============================================================
describe('validerUrlReservation — anti-hallucination', () => {

  const urlsContexte = extraireUrlsContexte(CONTEXTE);

  it('URL présente dans le contexte → gardée', () => {
    expect(validerUrlReservation('https://www.confessions.com.mx/en/clubs-tulum-bars', urlsContexte))
      .toBe('https://www.confessions.com.mx/en/clubs-tulum-bars');
  });

  it('URL inventée par le LLM → rejetée (null)', () => {
    expect(validerUrlReservation('https://kalypso-club-officiel.com/tickets', urlsContexte)).toBeNull();
  });

  it('tolère le slash final : renvoie l\'URL ORIGINALE du contexte', () => {
    // le LLM répond sans le slash final, le contexte l'a avec
    expect(validerUrlReservation('https://www.ticketfairy.com/tulum-nightlife', urlsContexte))
      .toBe('https://www.ticketfairy.com/tulum-nightlife/');
  });

  it('tolère http vs https', () => {
    expect(validerUrlReservation('http://www.confessions.com.mx/en/clubs-tulum-bars', urlsContexte))
      .toBe('https://www.confessions.com.mx/en/clubs-tulum-bars');
  });

  it('null / undefined / non-string → null', () => {
    expect(validerUrlReservation(null, urlsContexte)).toBeNull();
    expect(validerUrlReservation(undefined, urlsContexte)).toBeNull();
    expect(validerUrlReservation(123 as unknown as string, urlsContexte)).toBeNull();
  });
});

// ============================================================
// 3. resoudreLiensReservation — matching complet
// ============================================================
describe('resoudreLiensReservation — matching LLM + garanties', () => {

  it('associe les lieux aux vraies URLs, rejette les inventées', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({
      'Vagalume Club':  'https://mandalatickets.com/en/tulum/disco/Vagalume', // vraie
      'Confessions':    'https://confessions-invente.com/faux',               // inventée
      'Full Moon Party': null,                                                // pas trouvée
    }));

    const liens = await resoudreLiensReservation(['Vagalume Club', 'Confessions', 'Full Moon Party'], CONTEXTE);

    expect(liens.get('Vagalume Club')).toBe('https://mandalatickets.com/en/tulum/disco/Vagalume');
    expect(liens.get('Confessions')).toBeNull();     // filet anti-404
    expect(liens.get('Full Moon Party')).toBeNull();
  });

  it('LLM en panne → dégradation propre (tous null, pas de throw)', async () => {
    // mockImplementation (pas mockRejectedValue) : évite le faux positif
    // « unhandled rejection » de Vitest — le rejet naît à l'APPEL, pas au setup.
    vi.mocked(callAI).mockImplementation(async () => { throw new Error('provider down') });
    const liens = await resoudreLiensReservation(['Vagalume Club'], CONTEXTE);
    expect(liens.get('Vagalume Club')).toBeNull();
  });

  it('JSON invalide du LLM → dégradation propre (tous null)', async () => {
    vi.mocked(callAI).mockResolvedValue('pas du json');
    const liens = await resoudreLiensReservation(['Vagalume Club'], CONTEXTE);
    expect(liens.get('Vagalume Club')).toBeNull();
  });

  it('contexte vide → aucun appel LLM, tous null', async () => {
    const liens = await resoudreLiensReservation(['Vagalume Club'], '');
    expect(liens.get('Vagalume Club')).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('aucun item → aucun appel LLM', async () => {
    const liens = await resoudreLiensReservation([], CONTEXTE);
    expect(liens.size).toBe(0);
    expect(callAI).not.toHaveBeenCalled();
  });
});
