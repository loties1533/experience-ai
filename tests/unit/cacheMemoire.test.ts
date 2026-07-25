import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { memoriser, viderCacheMemoire } = await import('../../server/lib/cacheMemoire.js');

// Le cache des appels externes (carte « maîtrise des coûts », R6) est de la
// logique pure : chaque test défend un de ses invariants — mémoriser, partager
// une promesse en vol, ne jamais garder une panne, respecter le temps de vie.
describe('cacheMemoire', () => {
  beforeEach(() => {
    viderCacheMemoire();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne calcule qu\'une fois pour une même clé, puis sert la valeur mémorisée', async () => {
    const calcul = vi.fn().mockResolvedValue('bordeaux');

    const premier = await memoriser('ville:bordeaux', calcul);
    const second = await memoriser('ville:bordeaux', calcul);

    expect(premier).toBe('bordeaux');
    expect(second).toBe('bordeaux');
    expect(calcul).toHaveBeenCalledTimes(1);
  });

  it('deux appels simultanés partagent le même calcul (on mémorise la promesse)', async () => {
    const calcul = vi.fn().mockResolvedValue('lyon');

    const [a, b] = await Promise.all([
      memoriser('ville:lyon', calcul),
      memoriser('ville:lyon', calcul),
    ]);

    expect(a).toBe('lyon');
    expect(b).toBe('lyon');
    expect(calcul).toHaveBeenCalledTimes(1);
  });

  it('ne mémorise pas un échec : le calcul suivant est bien relancé', async () => {
    const calcul = vi
      .fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce('paris');

    await expect(memoriser('ville:paris', calcul)).rejects.toThrow('réseau');
    const rattrapage = await memoriser('ville:paris', calcul);

    expect(rattrapage).toBe('paris');
    expect(calcul).toHaveBeenCalledTimes(2);
  });

  it('recalcule une fois le temps de vie écoulé', async () => {
    const calcul = vi.fn().mockResolvedValueOnce('avant').mockResolvedValueOnce('après');
    const dureeVie = 1000;

    const avant = await memoriser('ville:nice', calcul, dureeVie);
    vi.advanceTimersByTime(dureeVie + 1);
    const apres = await memoriser('ville:nice', calcul, dureeVie);

    expect(avant).toBe('avant');
    expect(apres).toBe('après');
    expect(calcul).toHaveBeenCalledTimes(2);
  });
});
