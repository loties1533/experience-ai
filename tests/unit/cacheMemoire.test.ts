import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { memoriser, memoriserSelonResultat, viderCacheMemoire } = await import(
  '../../server/lib/cacheMemoire.js'
);

type ResultatCache =
  | { statut: 'ok'; valeur: string }
  | { statut: 'vide' }
  | { statut: 'indisponible' };

function dureeSelonStatut(resultat: ResultatCache): number | null {
  if (resultat.statut === 'indisponible') return null;
  if (resultat.statut === 'vide') return 5 * 60 * 1000;
  return 60 * 60 * 1000;
}

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

describe('memoriserSelonResultat', () => {
  beforeEach(() => {
    viderCacheMemoire();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('conserve un résultat valide selon sa durée normale', async () => {
    const calcul = vi.fn().mockResolvedValue({ statut: 'ok', valeur: 'Bordeaux' });

    const premier = await memoriserSelonResultat('recherche:valide', calcul, dureeSelonStatut);
    const second = await memoriserSelonResultat('recherche:valide', calcul, dureeSelonStatut);

    expect(premier).toEqual({ statut: 'ok', valeur: 'Bordeaux' });
    expect(second).toBe(premier);
    expect(calcul).toHaveBeenCalledOnce();
  });

  it('conserve une recherche vide pendant cinq minutes seulement', async () => {
    const calcul = vi.fn().mockResolvedValue({ statut: 'vide' });

    await memoriserSelonResultat('recherche:vide', calcul, dureeSelonStatut);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await memoriserSelonResultat('recherche:vide', calcul, dureeSelonStatut);
    expect(calcul).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(2);
    await memoriserSelonResultat('recherche:vide', calcul, dureeSelonStatut);
    expect(calcul).toHaveBeenCalledTimes(2);
  });

  it('ne conserve jamais une indisponibilité après sa résolution', async () => {
    const calcul = vi.fn().mockResolvedValue({ statut: 'indisponible' });

    await memoriserSelonResultat('recherche:indisponible', calcul, dureeSelonStatut);
    await memoriserSelonResultat('recherche:indisponible', calcul, dureeSelonStatut);

    expect(calcul).toHaveBeenCalledTimes(2);
  });

  it('recalcule un résultat valide après expiration', async () => {
    const calcul = vi
      .fn()
      .mockResolvedValueOnce({ statut: 'ok', valeur: 'avant' })
      .mockResolvedValueOnce({ statut: 'ok', valeur: 'après' });
    const dureeCourte = () => 1000;

    const avant = await memoriserSelonResultat('recherche:expiree', calcul, dureeCourte);
    vi.advanceTimersByTime(1001);
    const apres = await memoriserSelonResultat('recherche:expiree', calcul, dureeCourte);

    expect(avant).toEqual({ statut: 'ok', valeur: 'avant' });
    expect(apres).toEqual({ statut: 'ok', valeur: 'après' });
    expect(calcul).toHaveBeenCalledTimes(2);
  });

  it('supprime une promesse rejetée et permet un nouveau calcul', async () => {
    const calcul = vi
      .fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce({ statut: 'ok', valeur: 'rattrapage' });

    await expect(
      memoriserSelonResultat('recherche:rejetee', calcul, dureeSelonStatut)
    ).rejects.toThrow('réseau');
    await expect(
      memoriserSelonResultat('recherche:rejetee', calcul, dureeSelonStatut)
    ).resolves.toEqual({ statut: 'ok', valeur: 'rattrapage' });
    expect(calcul).toHaveBeenCalledTimes(2);
  });

  it('empêche une ancienne promesse rejetée de supprimer une entrée plus récente', async () => {
    let rejeterAncienne!: (erreur: Error) => void;
    const ancienne = memoriserSelonResultat(
      'recherche:concurrente',
      () =>
        new Promise<ResultatCache>((_resoudre, rejeter) => {
          rejeterAncienne = rejeter;
        }),
      dureeSelonStatut
    );
    const attenteAncienne = expect(ancienne).rejects.toThrow('ancienne panne');

    viderCacheMemoire();
    const calculRecent = vi
      .fn()
      .mockResolvedValue({ statut: 'ok', valeur: 'résultat récent' });
    await memoriserSelonResultat('recherche:concurrente', calculRecent, dureeSelonStatut);

    rejeterAncienne(new Error('ancienne panne'));
    await attenteAncienne;

    const calculDeSecours = vi
      .fn()
      .mockResolvedValue({ statut: 'ok', valeur: 'ne doit pas servir' });
    const lecture = await memoriserSelonResultat(
      'recherche:concurrente',
      calculDeSecours,
      dureeSelonStatut
    );
    expect(lecture).toEqual({ statut: 'ok', valeur: 'résultat récent' });
    expect(calculDeSecours).not.toHaveBeenCalled();
  });
});
