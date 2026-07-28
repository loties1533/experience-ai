import { isIP } from 'node:net';

export type ProtocoleLien = 'https:' | 'http:';

export type RaisonUrlInvalide =
  | 'url_invalide'
  | 'protocole_interdit'
  | 'identifiants_interdits'
  | 'hote_absent'
  | 'hote_prive'
  | 'port_interdit';

export type ResultatValidationUrl =
  | {
      statut: 'valide';
      url: string;
      protocole: ProtocoleLien;
      hote: string;
      /**
       * Domaine observé dans l'URL, normalisé. Il ne constitue pas à lui seul
       * une preuve que le domaine appartient au candidat métier.
       */
      domaine: string;
    }
  | {
      statut: 'invalide';
      raison: RaisonUrlInvalide;
    };

const PROTOCOLES_AUTORISES = new Set<ProtocoleLien>(['https:', 'http:']);

const DOMAINES_MOTEURS_RECHERCHE = [
  'bing.com',
  'duckduckgo.com',
  'google.com',
  'google.fr',
  'search.yahoo.com',
] as const;

const SEGMENT_RECHERCHE_GENERIQUE =
  /(?:^|\/)(?:find|recherche|results|search|search-results|searchresults)(?:\/|$)/i;

function retirerCrochetsIpv6(hote: string): string {
  return hote.startsWith('[') && hote.endsWith(']')
    ? hote.slice(1, -1)
    : hote;
}

function normaliserHote(hote: string): string {
  return retirerCrochetsIpv6(hote.trim().toLowerCase()).replace(/\.+$/, '');
}

function estIpv4PriveeOuLocale(hote: string): boolean {
  const octets = hote.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }

  const [premier, deuxieme] = octets;

  return (
    premier === 0 ||
    premier === 10 ||
    premier === 127 ||
    (premier === 100 && deuxieme >= 64 && deuxieme <= 127) ||
    (premier === 169 && deuxieme === 254) ||
    (premier === 172 && deuxieme >= 16 && deuxieme <= 31) ||
    (premier === 192 && deuxieme === 168) ||
    premier >= 224
  );
}

function estIpv6PriveeOuLocale(hote: string): boolean {
  const hoteMinuscule = hote.toLowerCase();

  return (
    hoteMinuscule === '::' ||
    hoteMinuscule === '::1' ||
    hoteMinuscule.startsWith('fc') ||
    hoteMinuscule.startsWith('fd') ||
    /^fe[89ab]/.test(hoteMinuscule) ||
    hoteMinuscule.startsWith('::ffff:')
  );
}

function estHotePriveOuLocal(hote: string): boolean {
  if (
    hote === 'localhost' ||
    hote.endsWith('.localhost') ||
    hote.endsWith('.local') ||
    (!hote.includes('.') && isIP(hote) === 0)
  ) {
    return true;
  }

  const versionIp = isIP(hote);
  if (versionIp === 4) {
    return estIpv4PriveeOuLocale(hote);
  }
  if (versionIp === 6) {
    return estIpv6PriveeOuLocale(hote);
  }

  return false;
}

function construireUrlNormalisee(url: URL, hote: string): string {
  url.hostname = isIP(hote) === 6 ? `[${hote}]` : hote;
  return url.toString();
}

export function validerUrlLien(valeur: string): ResultatValidationUrl {
  let url: URL;
  try {
    url = new URL(valeur.trim());
  } catch {
    return { statut: 'invalide', raison: 'url_invalide' };
  }

  if (!PROTOCOLES_AUTORISES.has(url.protocol as ProtocoleLien)) {
    return { statut: 'invalide', raison: 'protocole_interdit' };
  }

  if (url.username || url.password) {
    return { statut: 'invalide', raison: 'identifiants_interdits' };
  }

  const hote = normaliserHote(url.hostname);
  if (!hote) {
    return { statut: 'invalide', raison: 'hote_absent' };
  }

  if (estHotePriveOuLocal(hote)) {
    return { statut: 'invalide', raison: 'hote_prive' };
  }

  /*
   * URL retire déjà les ports standards explicites (80 pour HTTP et 443 pour
   * HTTPS). Tout port restant est inhabituel et refusé à cette frontière.
   */
  if (url.port) {
    return { statut: 'invalide', raison: 'port_interdit' };
  }

  const protocole = url.protocol as ProtocoleLien;

  return {
    statut: 'valide',
    url: construireUrlNormalisee(url, hote),
    protocole,
    hote,
    domaine: hote,
  };
}

export function extraireHote(valeur: string): string | null {
  const resultat = validerUrlLien(valeur);
  return resultat.statut === 'valide' ? resultat.hote : null;
}

export function extraireDomaine(valeur: string): string | null {
  const resultat = validerUrlLien(valeur);
  return resultat.statut === 'valide' ? resultat.domaine : null;
}

export function estHoteDansDomaine(
  hoteObserve: string,
  domaineAttendu: string,
): boolean {
  const hote = normaliserHote(hoteObserve);
  const domaine = normaliserHote(domaineAttendu);

  if (!hote || !domaine) {
    return false;
  }

  return hote === domaine || hote.endsWith(`.${domaine}`);
}

export function estUrlRechercheGenerique(valeur: string): boolean {
  const resultat = validerUrlLien(valeur);
  if (resultat.statut === 'invalide') {
    return false;
  }

  const url = new URL(resultat.url);
  if (SEGMENT_RECHERCHE_GENERIQUE.test(url.pathname)) {
    return true;
  }

  const moteurRecherche = DOMAINES_MOTEURS_RECHERCHE.some((domaine) =>
    estHoteDansDomaine(resultat.hote, domaine),
  );

  return moteurRecherche && url.searchParams.has('q');
}

export function retirerParametresTracking(valeur: string): string | null {
  const resultat = validerUrlLien(valeur);
  if (resultat.statut === 'invalide') {
    return null;
  }

  const url = new URL(resultat.url);
  const cles = [...new Set(url.searchParams.keys())];

  for (const cle of cles) {
    const cleMinuscule = cle.toLowerCase();
    if (
      cleMinuscule.startsWith('utm_') ||
      cleMinuscule === 'gclid' ||
      cleMinuscule === 'fbclid'
    ) {
      url.searchParams.delete(cle);
    }
  }

  return url.toString();
}
