// Cache des appels externes (carte « maîtrise des coûts » du sprint R6).
//
// Deux générations lancées sur la même ville ne doivent pas repayer les mêmes
// recherches : Foursquare et PredictHQ sont facturés à l'appel, et un bar ne
// déménage pas entre deux briefs. En mémoire suffit — le produit tourne sur une
// instance, et une dépendance de plus (Redis) coûterait plus cher que le
// problème qu'elle règle. Le cache est volontairement ANONYME : on n'y met que
// des résultats de recherche publique, jamais rien qui appartienne à quelqu'un.

const DUREE_VIE_PAR_DEFAUT_MS = 60 * 60 * 1000; // 1 h
// Borne mémoire : au-delà, on sacrifie les entrées les plus anciennes.
const NOMBRE_MAX_ENTREES = 300;

interface EntreeCache {
  valeur: Promise<unknown>;
  expireA: number;
}

const cache = new Map<string, EntreeCache>();

function purger(maintenant: number): void {
  for (const [cle, entree] of cache) {
    if (entree.expireA <= maintenant) cache.delete(cle);
  }
  // Toujours trop d'entrées : les plus anciennes partent (une Map conserve
  // l'ordre d'insertion).
  for (const cle of cache.keys()) {
    if (cache.size <= NOMBRE_MAX_ENTREES) break;
    cache.delete(cle);
  }
}

/**
 * Rend le résultat mémorisé pour cette clé, ou lance le calcul et le mémorise.
 *
 * On mémorise la PROMESSE, pas la valeur : deux générations simultanées sur la
 * même ville partagent le même appel réseau au lieu d'en payer deux. Un calcul
 * qui échoue n'est pas mémorisé — on ne veut pas garder une panne pendant une
 * heure.
 */
export function memoriser<T>(
  cle: string,
  calcul: () => Promise<T>,
  dureeVieMs: number = DUREE_VIE_PAR_DEFAUT_MS
): Promise<T> {
  const maintenant = Date.now();
  const connue = cache.get(cle);
  if (connue && connue.expireA > maintenant) return connue.valeur as Promise<T>;

  const valeur = calcul().catch((erreur: unknown) => {
    cache.delete(cle);
    throw erreur;
  });
  cache.set(cle, { valeur, expireA: maintenant + dureeVieMs });
  if (cache.size > NOMBRE_MAX_ENTREES) purger(maintenant);
  return valeur;
}

/**
 * Variante pour les appels dont la durée de cache dépend du résultat.
 *
 * Une durée `null` signifie que la valeur ne doit jamais rester en cache
 * (indisponibilité technique, par exemple). La promesse reste partagée pendant
 * l'appel en cours, puis elle est retirée dès que son résultat est connu.
 */
export function memoriserSelonResultat<T>(
  cle: string,
  calcul: () => Promise<T>,
  dureeViePour: (resultat: T) => number | null
): Promise<T> {
  const maintenant = Date.now();
  const connue = cache.get(cle);
  if (connue && connue.expireA > maintenant) return connue.valeur as Promise<T>;

  const valeur = calcul()
    .then((resultat) => {
      const entree = cache.get(cle);
      if (entree?.valeur !== valeur) return resultat;

      const dureeVieMs = dureeViePour(resultat);
      if (dureeVieMs === null) {
        cache.delete(cle);
      } else {
        entree.expireA = Date.now() + dureeVieMs;
      }
      return resultat;
    })
    .catch((erreur: unknown) => {
      if (cache.get(cle)?.valeur === valeur) cache.delete(cle);
      throw erreur;
    });

  // L'entrée partage l'appel en cours. Son expiration réelle sera fixée à la
  // résolution selon le statut obtenu.
  cache.set(cle, { valeur, expireA: Number.POSITIVE_INFINITY });
  if (cache.size > NOMBRE_MAX_ENTREES) purger(maintenant);
  return valeur;
}

/** Vide le cache — utilisé par les tests, qui doivent partir d'une page blanche. */
export function viderCacheMemoire(): void {
  cache.clear();
}
