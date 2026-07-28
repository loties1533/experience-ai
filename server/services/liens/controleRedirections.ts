import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { parse as analyserDomaine } from 'tldts';
import {
  Agent,
  fetch as requeteUndici,
  type Dispatcher,
} from 'undici';
import type {
  RaisonIndisponibiliteControleLien,
  ResultatControleLien,
} from './contrat.js';
import { validerUrlLien } from './validationUrl.js';

export interface AdresseDns {
  address: string;
  family: 4 | 6;
}

export type ResoudreDns = (
  hote: string,
) => Promise<readonly AdresseDns[]>;

export interface ReponseHttp {
  readonly status: number;
  readonly headers: {
    get(nom: string): string | null;
  };
  readonly body: {
    cancel(): Promise<void>;
  } | null;
}

export type InitialisationRequeteHttp = NonNullable<
  Parameters<typeof requeteUndici>[1]
> & {
  dispatcher: Dispatcher;
};

export type RequeteHttp = (
  url: string,
  initialisation: InitialisationRequeteHttp,
) => Promise<ReponseHttp>;

export interface TransportEpingle {
  dispatcher: Dispatcher;
  lookup: LookupFunction;
  fermer(): Promise<void>;
}

export type FabriquerTransportEpingle = (
  hote: string,
  adressesValidees: readonly AdresseDns[],
) => TransportEpingle;

export interface DependancesControleLien {
  requeteHttp?: RequeteHttp;
  resoudreDns?: ResoudreDns;
  fabriquerTransportEpingle?: FabriquerTransportEpingle;
  maintenant?: () => Date;
  delaiMaximumMs?: number;
}

const DELAI_MAXIMUM_MS = 5_000;
const NOMBRE_MAXIMUM_REDIRECTIONS = 3;
const STATUTS_REDIRECTION = new Set([301, 302, 303, 307, 308]);
const STATUTS_REPLI_GET = new Set([405, 501]);
const EN_TETES_TECHNIQUES = Object.freeze({
  Accept: '*/*',
  'User-Agent': 'ExperienceAI-Link-Checker/1.0',
});

type DestinationValidee =
  | {
      statut: 'valide';
      url: string;
      hote: string;
      adressesValidees: readonly AdresseDns[];
    }
  | Extract<ResultatControleLien, { statut: 'refuse' | 'indisponible' }>;

type ResultatRequete =
  | {
      statut: 'reponse';
      reponse: ReponseHttp;
    }
  | Extract<ResultatControleLien, { statut: 'indisponible' }>;

type ResultatAdressesDns =
  | {
      statut: 'valide';
      adressesValidees: readonly AdresseDns[];
    }
  | Extract<ResultatControleLien, { statut: 'refuse' | 'indisponible' }>;

class DelaiDnsDepasse extends Error {
  constructor() {
    super('Délai DNS dépassé');
    this.name = 'DelaiDnsDepasse';
  }
}

function dateIso(maintenant: () => Date): string {
  return maintenant().toISOString();
}

function resultatIndisponible(
  raison: RaisonIndisponibiliteControleLien,
  maintenant: () => Date,
): Extract<ResultatControleLien, { statut: 'indisponible' }> {
  return {
    statut: 'indisponible',
    raison,
    constateLe: dateIso(maintenant),
  };
}

function ipv4EnEntier(adresse: string): number | null {
  const octets = adresse.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255,
    )
  ) {
    return null;
  }

  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0;
}

function appartientPlageIpv4(
  adresse: number,
  reseau: string,
  prefixe: number,
): boolean {
  const reseauEntier = ipv4EnEntier(reseau);
  if (reseauEntier === null) {
    return false;
  }
  const masque =
    prefixe === 0
      ? 0
      : (0xffffffff << (32 - prefixe)) >>> 0;
  return (adresse & masque) === (reseauEntier & masque);
}

const PLAGES_IPV4_INTERDITES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

function estIpv4Routable(adresse: string): boolean {
  const valeur = ipv4EnEntier(adresse);
  return (
    valeur !== null &&
    !PLAGES_IPV4_INTERDITES.some(([reseau, prefixe]) =>
      appartientPlageIpv4(valeur, reseau, prefixe),
    )
  );
}

function groupesIpv6(adresse: string): number[] | null {
  const sansZone = adresse.toLowerCase().split('%')[0];
  let valeur = sansZone;

  if (valeur.includes('.')) {
    const derniereSeparation = valeur.lastIndexOf(':');
    if (derniereSeparation < 0) {
      return null;
    }
    const ipv4 = ipv4EnEntier(
      valeur.slice(derniereSeparation + 1),
    );
    if (ipv4 === null) {
      return null;
    }
    valeur =
      `${valeur.slice(0, derniereSeparation)}:` +
      `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const separations = valeur.split('::');
  if (separations.length > 2) {
    return null;
  }

  const gauche = separations[0]
    ? separations[0].split(':')
    : [];
  const droite = separations.length === 2 && separations[1]
    ? separations[1].split(':')
    : [];
  const nombreManquant =
    separations.length === 2 ? 8 - gauche.length - droite.length : 0;

  if (
    nombreManquant < 0 ||
    (separations.length === 1 && gauche.length !== 8)
  ) {
    return null;
  }

  const groupes = [
    ...gauche,
    ...Array.from({ length: nombreManquant }, () => '0'),
    ...droite,
  ];
  if (
    groupes.length !== 8 ||
    groupes.some((groupe) => !/^[0-9a-f]{1,4}$/.test(groupe))
  ) {
    return null;
  }
  return groupes.map((groupe) => Number.parseInt(groupe, 16));
}

function ipv6EnEntier(adresse: string): bigint | null {
  const groupes = groupesIpv6(adresse);
  if (!groupes) {
    return null;
  }
  return groupes.reduce(
    (total, groupe) => (total << 16n) | BigInt(groupe),
    0n,
  );
}

function appartientPlageIpv6(
  adresse: bigint,
  reseau: bigint,
  prefixe: number,
): boolean {
  const decalage = BigInt(128 - prefixe);
  return adresse >> decalage === reseau >> decalage;
}

function estIpv6Routable(adresse: string): boolean {
  const valeur = ipv6EnEntier(adresse);
  if (valeur === null) {
    return false;
  }

  const prefixeIpv4Mappee = 0xffffn;
  if (valeur >> 32n === prefixeIpv4Mappee) {
    const ipv4 = Number(valeur & 0xffffffffn);
    const adresseIpv4 = [
      (ipv4 >>> 24) & 255,
      (ipv4 >>> 16) & 255,
      (ipv4 >>> 8) & 255,
      ipv4 & 255,
    ].join('.');
    return estIpv4Routable(adresseIpv4);
  }

  const global = appartientPlageIpv6(
    valeur,
    0x20000000000000000000000000000000n,
    3,
  );
  const plagesReservees = [
    [0x20010000000000000000000000000000n, 23],
    [0x20010db8000000000000000000000000n, 32],
    [0x20020000000000000000000000000000n, 16],
    [0x3fff0000000000000000000000000000n, 20],
  ] as const;

  return (
    global &&
    !plagesReservees.some(([reseau, prefixe]) =>
      appartientPlageIpv6(valeur, reseau, prefixe),
    )
  );
}

function estAdresseRoutable(adresse: AdresseDns): boolean {
  const version = isIP(adresse.address);
  if (version !== adresse.family) {
    return false;
  }
  return version === 4
    ? estIpv4Routable(adresse.address)
    : estIpv6Routable(adresse.address);
}

function aSuffixePublicReconnu(hote: string): boolean {
  const analyse = analyserDomaine(hote, {
    allowPrivateDomains: true,
  });
  return (
    analyse.domain !== null &&
    analyse.publicSuffix !== null &&
    (analyse.isIcann === true || analyse.isPrivate === true)
  );
}

async function resoudreDnsParDefaut(
  hote: string,
): Promise<readonly AdresseDns[]> {
  const adresses = await lookup(hote, {
    all: true,
    verbatim: true,
  });
  return adresses.flatMap(({ address, family }) =>
    family === 4 || family === 6
      ? [{ address, family }]
      : [],
  );
}

async function resoudreDnsAvecDelai(
  hote: string,
  resoudreDns: ResoudreDns,
  delaiMaximumMs: number,
): Promise<readonly AdresseDns[]> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resoudreDns(hote),
      new Promise<never>((_resoudre, rejeter) => {
        minuterie = setTimeout(
          () => rejeter(new DelaiDnsDepasse()),
          delaiMaximumMs,
        );
      }),
    ]);
  } finally {
    if (minuterie) {
      clearTimeout(minuterie);
    }
  }
}

function normaliserAdresse(
  adresse: AdresseDns,
): AdresseDns | null {
  if (adresse.family === 4) {
    const valeur = ipv4EnEntier(adresse.address);
    if (valeur === null) return null;
    return {
      address: [
        (valeur >>> 24) & 255,
        (valeur >>> 16) & 255,
        (valeur >>> 8) & 255,
        valeur & 255,
      ].join('.'),
      family: 4,
    };
  }
  if (ipv6EnEntier(adresse.address) === null) return null;
  try {
    const hote = new URL(
      `https://[${adresse.address}]/`,
    ).hostname;
    return {
      address: hote.slice(1, -1).toLowerCase(),
      family: 6,
    };
  } catch {
    return null;
  }
}

function validerAdressesDns(
  adresses: readonly AdresseDns[],
  maintenant: () => Date,
): ResultatAdressesDns {
  if (adresses.length === 0) {
    return resultatIndisponible(
      'resolution_dns_invalide',
      maintenant,
    );
  }
  if (
    adresses.some((adresse) => {
      const version = isIP(adresse.address);
      return (
        version !== 0 &&
        version === adresse.family &&
        !estAdresseRoutable(adresse)
      );
    })
  ) {
    return {
      statut: 'refuse',
      raison: 'destination_interdite',
      constateLe: dateIso(maintenant),
    };
  }

  const normalisees = adresses.map(normaliserAdresse);
  if (normalisees.some((adresse) => adresse === null)) {
    return resultatIndisponible(
      'resolution_dns_invalide',
      maintenant,
    );
  }

  const uniques = new Map<string, AdresseDns>();
  for (const adresse of normalisees) {
    if (adresse) {
      uniques.set(
        `${adresse.family}:${adresse.address}`,
        adresse,
      );
    }
  }

  return {
    statut: 'valide',
    adressesValidees: [...uniques.values()].sort(
      (gauche, droite) =>
        gauche.family - droite.family ||
        gauche.address.localeCompare(droite.address),
    ),
  };
}

async function validerDestination(
  valeur: string,
  resoudreDns: ResoudreDns,
  delaiMaximumMs: number,
  maintenant: () => Date,
): Promise<DestinationValidee> {
  const validation = validerUrlLien(valeur);
  if (validation.statut === 'invalide') {
    return {
      statut: 'refuse',
      raison:
        validation.raison === 'hote_prive'
          ? 'destination_interdite'
          : 'url_invalide',
      constateLe: dateIso(maintenant),
    };
  }
  if (validation.protocole !== 'https:') {
    return {
      statut: 'refuse',
      raison: 'url_invalide',
      constateLe: dateIso(maintenant),
    };
  }

  const versionIp = isIP(validation.hote);
  if (versionIp !== 0) {
    return {
      statut: 'refuse',
      raison: 'destination_interdite',
      constateLe: dateIso(maintenant),
    };
  }
  if (!aSuffixePublicReconnu(validation.hote)) {
    return {
      statut: 'refuse',
      raison: 'destination_interdite',
      constateLe: dateIso(maintenant),
    };
  }

  let adressesValidees: readonly AdresseDns[];
  try {
    const premiereResolution = await resoudreDnsAvecDelai(
      validation.hote,
      resoudreDns,
      delaiMaximumMs,
    );
    const validationPremiere = validerAdressesDns(
      premiereResolution,
      maintenant,
    );
    if (validationPremiere.statut !== 'valide') {
      return validationPremiere;
    }

    const secondeResolution = await resoudreDnsAvecDelai(
      validation.hote,
      resoudreDns,
      delaiMaximumMs,
    );
    const validationSeconde = validerAdressesDns(
      secondeResolution,
      maintenant,
    );
    if (validationSeconde.statut !== 'valide') {
      return validationSeconde;
    }
    adressesValidees = validationSeconde.adressesValidees;
  } catch (erreur) {
    return resultatIndisponible(
      erreur instanceof DelaiDnsDepasse ? 'timeout' : 'erreur_dns',
      maintenant,
    );
  }

  return {
    statut: 'valide',
    url: validation.url,
    hote: validation.hote,
    adressesValidees,
  };
}

function erreurLookup(code: string): NodeJS.ErrnoException {
  const erreur = new Error(
    'Résolution épinglée impossible',
  ) as NodeJS.ErrnoException;
  erreur.name = 'ErreurLookupEpingle';
  erreur.code = code;
  return erreur;
}

function familleDemandee(
  valeur: number | 'IPv4' | 'IPv6' | undefined,
): 0 | 4 | 6 | null {
  if (valeur === undefined || valeur === 0) return 0;
  if (valeur === 4 || valeur === 'IPv4') return 4;
  if (valeur === 6 || valeur === 'IPv6') return 6;
  return null;
}

export function creerLookupEpingle(
  hoteValide: string,
  adressesValidees: readonly AdresseDns[],
): LookupFunction {
  const hoteAttendu = hoteValide
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  const adresses = [...adressesValidees].sort(
    (gauche, droite) =>
      gauche.family - droite.family ||
      gauche.address.localeCompare(droite.address),
  );

  return (hostname, options, callback) => {
    const hoteRecu = hostname
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');
    if (hoteRecu !== hoteAttendu) {
      callback(erreurLookup('ERR_HOTE_NON_VALIDE'), '', 0);
      return;
    }

    const famille = familleDemandee(options.family);
    const compatibles =
      famille === 0
        ? adresses
        : famille === null
          ? []
          : adresses.filter(
              (adresse) => adresse.family === famille,
            );
    if (compatibles.length === 0) {
      callback(
        erreurLookup('EAI_ADDRFAMILY'),
        options.all ? [] : '',
        0,
      );
      return;
    }

    if (options.all) {
      callback(
        null,
        compatibles.map(({ address, family }) => ({
          address,
          family,
        })),
      );
      return;
    }

    const [adresse] = compatibles;
    callback(null, adresse.address, adresse.family);
  };
}

function fabriquerTransportEpingleParDefaut(
  hote: string,
  adressesValidees: readonly AdresseDns[],
): TransportEpingle {
  const lookupEpingle = creerLookupEpingle(
    hote,
    adressesValidees,
  );
  const agent = new Agent({
    connect: {
      lookup: lookupEpingle,
    },
  });
  return {
    dispatcher: agent,
    lookup: lookupEpingle,
    fermer: () => agent.close(),
  };
}

const requeteHttpParDefaut: RequeteHttp = async (
  url,
  initialisation,
) => requeteUndici(url, initialisation);

function estErreurAbort(erreur: unknown): boolean {
  return (
    erreur instanceof Error &&
    (erreur.name === 'AbortError' ||
      erreur.name === 'TimeoutError')
  );
}

async function executerRequete(
  requeteHttp: RequeteHttp,
  fabriquerTransportEpingle: FabriquerTransportEpingle,
  destination: Extract<
    DestinationValidee,
    { statut: 'valide' }
  >,
  methode: 'HEAD' | 'GET',
  delaiMaximumMs: number,
  maintenant: () => Date,
): Promise<ResultatRequete> {
  let transport: TransportEpingle;
  try {
    transport = fabriquerTransportEpingle(
      destination.hote,
      destination.adressesValidees,
    );
  } catch {
    return resultatIndisponible(
      'erreur_reseau',
      maintenant,
    );
  }

  const controleur = new AbortController();
  let delaiDepasse = false;
  const minuterie = setTimeout(() => {
    delaiDepasse = true;
    controleur.abort();
  }, delaiMaximumMs);

  try {
    const reponse = await requeteHttp(destination.url, {
      method: methode,
      headers: EN_TETES_TECHNIQUES,
      redirect: 'manual',
      signal: controleur.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      dispatcher: transport.dispatcher,
    });
    if (methode === 'GET' && reponse.body) {
      await reponse.body.cancel().catch(() => undefined);
    }
    return {
      statut: 'reponse',
      reponse,
    };
  } catch (erreur) {
    return resultatIndisponible(
      delaiDepasse || estErreurAbort(erreur)
        ? 'timeout'
        : 'erreur_reseau',
      maintenant,
    );
  } finally {
    clearTimeout(minuterie);
    await transport.fermer().catch(() => undefined);
  }
}

export async function controlerAccessibiliteLien(
  urlInitiale: string,
  dependances: DependancesControleLien = {},
): Promise<ResultatControleLien> {
  const requeteHttp =
    dependances.requeteHttp ?? requeteHttpParDefaut;
  const resoudreDns = dependances.resoudreDns ?? resoudreDnsParDefaut;
  const fabriquerTransportEpingle =
    dependances.fabriquerTransportEpingle ??
    fabriquerTransportEpingleParDefaut;
  const maintenant = dependances.maintenant ?? (() => new Date());
  const delaiDemande = dependances.delaiMaximumMs;
  const delaiMaximumMs =
    typeof delaiDemande === 'number' &&
    Number.isFinite(delaiDemande) &&
    delaiDemande > 0
      ? delaiDemande
      : DELAI_MAXIMUM_MS;

  const destinationInitiale = await validerDestination(
    urlInitiale,
    resoudreDns,
    delaiMaximumMs,
    maintenant,
  );
  if (destinationInitiale.statut !== 'valide') {
    return destinationInitiale;
  }

  const urlInitialeValidee = destinationInitiale.url;
  let destinationCourante = destinationInitiale;
  let urlCourante = urlInitialeValidee;
  const redirections: string[] = [];
  const urlsVisitees = new Set([urlCourante]);

  while (true) {
    let resultatRequete = await executerRequete(
      requeteHttp,
      fabriquerTransportEpingle,
      destinationCourante,
      'HEAD',
      delaiMaximumMs,
      maintenant,
    );
    if (resultatRequete.statut !== 'reponse') {
      return resultatRequete;
    }

    if (STATUTS_REPLI_GET.has(resultatRequete.reponse.status)) {
      const destinationAvantGet = await validerDestination(
        urlCourante,
        resoudreDns,
        delaiMaximumMs,
        maintenant,
      );
      if (destinationAvantGet.statut !== 'valide') {
        return destinationAvantGet;
      }
      resultatRequete = await executerRequete(
        requeteHttp,
        fabriquerTransportEpingle,
        destinationAvantGet,
        'GET',
        delaiMaximumMs,
        maintenant,
      );
      if (resultatRequete.statut !== 'reponse') {
        return resultatRequete;
      }
    }

    const { reponse } = resultatRequete;
    if (STATUTS_REDIRECTION.has(reponse.status)) {
      const location = reponse.headers.get('location');
      if (!location) {
        return {
          statut: 'refuse',
          raison: 'location_absente',
          constateLe: dateIso(maintenant),
        };
      }
      if (redirections.length >= NOMBRE_MAXIMUM_REDIRECTIONS) {
        return {
          statut: 'refuse',
          raison: 'trop_de_redirections',
          constateLe: dateIso(maintenant),
        };
      }

      let cible: string;
      try {
        cible = new URL(location, urlCourante).toString();
      } catch {
        return {
          statut: 'refuse',
          raison: 'location_invalide',
          constateLe: dateIso(maintenant),
        };
      }

      const cibleValidee = await validerDestination(
        cible,
        resoudreDns,
        delaiMaximumMs,
        maintenant,
      );
      if (cibleValidee.statut !== 'valide') {
        if (
          new URL(urlCourante).protocol === 'https:' &&
          (() => {
            try {
              return new URL(cible).protocol === 'http:';
            } catch {
              return false;
            }
          })()
        ) {
          return {
            statut: 'refuse',
            raison: 'https_vers_http',
            constateLe: dateIso(maintenant),
          };
        }
        return cibleValidee;
      }
      cible = cibleValidee.url;

      if (urlsVisitees.has(cible)) {
        return {
          statut: 'refuse',
          raison: 'boucle_redirection',
          constateLe: dateIso(maintenant),
        };
      }

      redirections.push(cible);
      urlsVisitees.add(cible);
      destinationCourante = cibleValidee;
      urlCourante = cible;
      continue;
    }

    /*
     * Le contrôle atteste uniquement l'accessibilité technique. Seuls les
     * statuts finaux 2xx sont acceptés ; les 4xx/5xx restent des refus et
     * aucun type métier n'est créé ici.
     */
    if (reponse.status < 200 || reponse.status >= 300) {
      return {
        statut: 'refuse',
        raison: 'statut_http_inacceptable',
        constateLe: dateIso(maintenant),
      };
    }

    return {
      statut: 'accessible',
      urlInitiale: urlInitialeValidee,
      urlFinale: urlCourante,
      statutHttp: reponse.status,
      redirections,
      controleLe: dateIso(maintenant),
    };
  }
}
