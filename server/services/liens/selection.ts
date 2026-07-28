import type {
  ResultatRechercheWeb,
  ResultatWeb,
} from '../tools/webSearch.js';
import type {
  CandidatLien,
  DemandeResolutionLien,
  LienResolu,
  PreuveLien,
  TypeLienProuve,
} from './contrat.js';
import {
  estHoteDansDomaine,
  estUrlRechercheGenerique,
  validerUrlLien,
} from './validationUrl.js';

const DOMAINES_RESEAUX_SOCIAUX = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
] as const;

const DOMAINES_ANNUAIRES = [
  'foursquare.com',
  'mappy.com',
  'pagesjaunes.fr',
  'petitfute.com',
  'tripadvisor.com',
  'tripadvisor.fr',
  'wikipedia.org',
  'yelp.com',
  'yelp.fr',
] as const;

const DOMAINES_ARTICLES = [
  '20minutes.fr',
  'actu.fr',
  'bfmtv.com',
  'francebleu.fr',
  'lefigaro.fr',
  'lemonde.fr',
  'liberation.fr',
  'sudouest.fr',
] as const;

const DOMAINES_AGREGATEURS = [
  'allevents.in',
  'bandsintown.com',
  'songkick.com',
  'sortiraparis.com',
  'timeout.com',
] as const;

const DOMAINES_RESERVATION = [
  'getyourguide.com',
  'opentable.com',
  'thefork.com',
  'thefork.fr',
  'viator.com',
] as const;

const DOMAINES_BILLETTERIE = [
  'billetweb.fr',
  'dice.fm',
  'eventbrite.com',
  'eventbrite.fr',
  'fnacspectacles.com',
  'francebillet.com',
  'seetickets.com',
  'seetickets.fr',
  'shotgun.live',
  'ticketmaster.com',
  'ticketmaster.fr',
  'weezevent.com',
] as const;

const SEGMENT_ARTICLE =
  /(?:^|\/)(?:actualite|article|blog|magazine|news|presse)(?:\/|$)/i;
const SEGMENT_ACCUEIL =
  /^\/(?:(?:accueil|home|index)(?:\.html?)?|[a-z]{2})?\/?$/i;

const MOIS_FRANCAIS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
] as const;

const MOIS_ANGLAIS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const NOMS_TROP_GENERIQUES = new Set([
  'activite',
  'bar',
  'cafe',
  'lieu',
  'restaurant',
  'sortie',
]);

const SIGNAUX_BILLETTERIE_NEGATIFS = [
  'billetterie fermee',
  'vente terminee',
  'billets indisponibles',
  'aucun billet',
  'aucun billet requis',
  'sold out',
  'no tickets',
  'tickets unavailable',
  'complet',
] as const;

const SIGNAUX_BILLETTERIE_POSITIFS = [
  'acheter billet',
  'acheter des billets',
  'billetterie',
  'book tickets',
  'buy tickets',
  'reserver billet',
  'reserver des billets',
  'reserver vos billets',
  'ticket',
  'tickets',
] as const;

const SIGNAUX_RESERVATION_NEGATIFS = [
  'reservation indisponible',
  'reservations fermees',
  'complet',
  'no availability',
] as const;

const SIGNAUX_RESERVATION_POSITIFS = [
  'reserver',
  'reservation',
  'reserver une table',
  'book now',
  'book a table',
  'availability',
  'disponibilite',
  'disponibilites',
] as const;

interface ContexteSelection {
  nom: string;
  villeDemandee: string;
  adresseOuSalle?: string;
  typeMetierRecherche: DemandeResolutionLien['typeMetierRecherche'];
  dateDebut?: string;
  identifiantExterne?: string;
}

export function normaliserNomLien(valeur: string): string {
  return valeur
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decoderPrudemment(valeur: string): string {
  try {
    return decodeURIComponent(valeur);
  } catch {
    return valeur;
  }
}

function contientExpression(texte: string, expression: string): boolean {
  const texteNormalise = normaliserNomLien(texte);
  const expressionNormalisee = normaliserNomLien(expression);
  if (!expressionNormalisee) return false;
  return ` ${texteNormalise} `.includes(` ${expressionNormalisee} `);
}

function texteCandidat(candidat: ResultatWeb): string {
  return [
    candidat.titre,
    candidat.extrait ?? '',
    decoderPrudemment(candidat.url),
  ].join(' ');
}

function textePageSansHote(candidat: ResultatWeb): string {
  const url = new URL(candidat.url);
  return [
    candidat.titre,
    candidat.extrait ?? '',
    decoderPrudemment(`${url.pathname}${url.search}`),
  ].join(' ');
}

export function nomsCorrespondent(
  nomDemande: string,
  candidat: Pick<ResultatWeb, 'titre' | 'url'>,
): boolean {
  const nomNormalise = normaliserNomLien(nomDemande);
  const nomCompact = nomNormalise.replace(/\s/g, '');
  if (
    nomCompact.length < 4 ||
    NOMS_TROP_GENERIQUES.has(nomNormalise)
  ) {
    return false;
  }
  if (contientExpression(candidat.titre, nomNormalise)) return true;

  const validationUrl = validerUrlLien(candidat.url);
  if (validationUrl.statut === 'invalide') return false;
  const url = new URL(validationUrl.url);
  const cheminNormalise = normaliserNomLien(
    decoderPrudemment(url.pathname),
  );
  return contientExpression(cheminNormalise, nomNormalise);
}

function hoteDansListe(hote: string, domaines: readonly string[]): boolean {
  return domaines.some((domaine) => estHoteDansDomaine(hote, domaine));
}

export function estSourceExclue(candidat: ResultatWeb): boolean {
  const validation = validerUrlLien(candidat.url);
  if (validation.statut === 'invalide') return true;

  if (
    hoteDansListe(validation.hote, DOMAINES_RESEAUX_SOCIAUX) ||
    hoteDansListe(validation.hote, DOMAINES_ANNUAIRES) ||
    hoteDansListe(validation.hote, DOMAINES_ARTICLES) ||
    hoteDansListe(validation.hote, DOMAINES_AGREGATEURS)
  ) {
    return true;
  }

  return SEGMENT_ARTICLE.test(new URL(validation.url).pathname);
}

export function estPageGenerique(candidat: ResultatWeb): boolean {
  const validation = validerUrlLien(candidat.url);
  if (validation.statut === 'invalide') return true;
  if (estUrlRechercheGenerique(validation.url)) return true;
  return SEGMENT_ACCUEIL.test(new URL(validation.url).pathname);
}

function pageExacte(
  demande: ContexteSelection,
  candidat: ResultatWeb,
): boolean {
  if (estPageGenerique(candidat)) return false;

  const url = new URL(candidat.url);
  const chemin = decoderPrudemment(url.pathname);
  if (contientExpression(chemin, demande.nom)) {
    return true;
  }

  const segmentsSpecifiques = chemin
    .split('/')
    .map(normaliserNomLien)
    .filter((segment) => segment.length >= 4);

  return (
    contientExpression(candidat.titre, demande.nom) &&
    segmentsSpecifiques.length > 0
  );
}

function correspondanceAdresseOuSalle(
  adresseOuSalle: string,
  villeDemandee: string,
  texteObserve: string,
): boolean {
  const villeNormalisee = normaliserNomLien(villeDemandee);
  const variantes = [
    adresseOuSalle,
    ...adresseOuSalle.split(',').map((partie) => partie.trim()),
  ]
    .map(normaliserNomLien)
    .filter(
      (variante) =>
        variante.length >= 4 && variante !== villeNormalisee,
    );

  return variantes.some((variante) =>
    contientExpression(texteObserve, variante),
  );
}

export function comparerVilleEtAdresse(
  demande: {
    villeDemandee: string;
    adresseOuSalle?: string;
    typeMetierRecherche: DemandeResolutionLien['typeMetierRecherche'];
  },
  candidat: ResultatWeb,
): PreuveLien[] {
  const texteObserve = texteCandidat(candidat);
  const preuves: PreuveLien[] = [];

  if (contientExpression(texteObserve, demande.villeDemandee)) {
    preuves.push({ nature: 'ville', valeur: demande.villeDemandee });
  }

  if (
    demande.adresseOuSalle &&
    correspondanceAdresseOuSalle(
      demande.adresseOuSalle,
      demande.villeDemandee,
      texteObserve,
    )
  ) {
    preuves.push({
      nature:
        demande.typeMetierRecherche === 'evenement' ? 'salle' : 'adresse',
      valeur: demande.adresseOuSalle,
    });
  }

  return preuves;
}

function localisationSuffisante(
  demande: ContexteSelection,
  preuves: PreuveLien[],
): boolean {
  if (demande.adresseOuSalle) {
    const natureAttendue =
      demande.typeMetierRecherche === 'evenement' ? 'salle' : 'adresse';
    return preuves.some((preuve) => preuve.nature === natureAttendue);
  }
  return preuves.some((preuve) => preuve.nature === 'ville');
}

function formesDate(dateIso: string): string[] {
  const jourIso = dateIso.slice(0, 10);
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jourIso);
  if (!correspondance) return [];

  const [, annee, mois, jour] = correspondance;
  const indexMois = Number(mois) - 1;
  const jourSansZero = String(Number(jour));
  if (indexMois < 0 || indexMois > 11 || jourSansZero === 'NaN') return [];

  return [
    `${annee}-${mois}-${jour}`,
    `${annee}/${mois}/${jour}`,
    `${jour}/${mois}/${annee}`,
    `${jour}-${mois}-${annee}`,
    `${jourSansZero} ${MOIS_FRANCAIS[indexMois]} ${annee}`,
    `${jourSansZero} ${MOIS_ANGLAIS[indexMois]} ${annee}`,
  ];
}

function dateEvenementObservee(
  dateDebut: string | undefined,
  candidat: ResultatWeb,
): boolean {
  if (!dateDebut) return false;
  const texteObserve = texteCandidat(candidat);
  return formesDate(dateDebut).some((forme) =>
    contientExpression(texteObserve, forme),
  );
}

function contientSignalBilletterie(candidat: ResultatWeb): boolean {
  const texte = normaliserNomLien(textePageSansHote(candidat));
  if (
    SIGNAUX_BILLETTERIE_NEGATIFS.some((signal) =>
      contientExpression(texte, signal),
    )
  ) {
    return false;
  }
  return SIGNAUX_BILLETTERIE_POSITIFS.some((signal) =>
    contientExpression(texte, signal),
  );
}

function contientSignalReservation(candidat: ResultatWeb): boolean {
  const texte = normaliserNomLien(textePageSansHote(candidat));
  if (
    SIGNAUX_RESERVATION_NEGATIFS.some((signal) =>
      contientExpression(texte, signal),
    )
  ) {
    return false;
  }
  return SIGNAUX_RESERVATION_POSITIFS.some((signal) =>
    contientExpression(texte, signal),
  );
}

function contientIdentifiantBorne(
  texte: string,
  identifiantExterne: string,
): boolean {
  const identifiant = identifiantExterne.trim();
  if (!identifiant) return false;
  const echappe = identifiant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${echappe}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(texte);
}

function preuveIdentifiantExterne(
  identifiantExterne: string | undefined,
  candidat: ResultatWeb,
): PreuveLien | undefined {
  if (!identifiantExterne) return undefined;
  const url = new URL(candidat.url);
  const cheminObserve = decoderPrudemment(url.pathname);
  const parametresObserves = [...url.searchParams.entries()].flatMap(
    ([cle, valeur]) => [decoderPrudemment(cle), decoderPrudemment(valeur)],
  );
  const extraitObserve = normaliserNomLien(candidat.extrait ?? '');
  const identifiantNormalise = normaliserNomLien(identifiantExterne);
  if (
    !contientIdentifiantBorne(cheminObserve, identifiantExterne) &&
    !parametresObserves.some((valeur) =>
      contientIdentifiantBorne(valeur, identifiantExterne),
    ) &&
    !contientIdentifiantBorne(extraitObserve, identifiantNormalise)
  ) {
    return undefined;
  }
  return {
    nature: 'identifiant_externe',
    valeur: identifiantExterne,
  };
}

function determinerTypeLien(
  demande: ContexteSelection,
  candidat: ResultatWeb,
  hote: string,
  dateObservee: boolean,
): TypeLienProuve | undefined {
  if (demande.typeMetierRecherche === 'evenement') {
    if (!dateObservee) return undefined;
    if (
      contientSignalBilletterie(candidat) &&
      hoteDansListe(hote, DOMAINES_BILLETTERIE)
    ) {
      return 'billetterie';
    }
    return undefined;
  }

  if (
    hoteDansListe(hote, DOMAINES_RESERVATION) &&
    contientSignalReservation(candidat)
  ) {
    return 'reservation';
  }
  return undefined;
}

export function classifierCandidatLien(
  demande: DemandeResolutionLien,
  candidat: ResultatWeb,
  recupereLe: string,
): CandidatLien | undefined {
  return classifierCandidat(
    {
      nom: demande.nom,
      villeDemandee: demande.villeDemandee,
      adresseOuSalle: demande.adresseOuSalle,
      typeMetierRecherche: demande.typeMetierRecherche,
      dateDebut: demande.dateDebut,
      identifiantExterne: demande.identifiantExterne,
    },
    candidat,
    recupereLe,
  );
}

function classifierCandidat(
  demande: ContexteSelection,
  candidat: ResultatWeb,
  recupereLe: string,
): CandidatLien | undefined {
  const validationUrl = validerUrlLien(candidat.url);
  if (
    validationUrl.statut === 'invalide' ||
    validationUrl.protocole !== 'https:' ||
    estSourceExclue(candidat) ||
    estPageGenerique(candidat) ||
    !nomsCorrespondent(demande.nom, candidat)
  ) {
    return undefined;
  }

  const preuvesLocalisation = comparerVilleEtAdresse(
    {
      villeDemandee: demande.villeDemandee,
      adresseOuSalle: demande.adresseOuSalle,
      typeMetierRecherche: demande.typeMetierRecherche,
    },
    candidat,
  );
  if (!localisationSuffisante(demande, preuvesLocalisation)) {
    return undefined;
  }

  const estPageExacte = pageExacte(demande, candidat);
  if (!estPageExacte) return undefined;

  const dateObservee =
    demande.typeMetierRecherche === 'evenement' &&
    dateEvenementObservee(demande.dateDebut, candidat);
  const typeLienPossible = determinerTypeLien(
    demande,
    candidat,
    validationUrl.hote,
    dateObservee,
  );
  if (!typeLienPossible) return undefined;

  const preuves: PreuveLien[] = [
    { nature: 'nom_exact', valeur: demande.nom },
    ...preuvesLocalisation,
    { nature: 'page_exacte', valeur: validationUrl.url },
  ];
  if (dateObservee && demande.dateDebut) {
    preuves.push({
      nature: 'date_evenement',
      valeur: demande.dateDebut,
    });
  }
  const preuveIdentifiant = preuveIdentifiantExterne(
    demande.identifiantExterne,
    candidat,
  );
  if (preuveIdentifiant) preuves.push(preuveIdentifiant);

  return {
    url: validationUrl.url,
    domaine: validationUrl.domaine,
    typeLienPossible,
    rang: candidat.rang,
    fournisseurRecherche: 'Tavily',
    recupereLe,
    preuves,
  };
}

function candidatsAdmissibles(
  demande: ContexteSelection,
  recherche: Extract<ResultatRechercheWeb, { statut: 'ok' }>,
): CandidatLien[] {
  const urlsVues = new Set<string>();
  return recherche.resultats.flatMap((candidat) => {
    if (urlsVues.has(candidat.url)) return [];
    urlsVues.add(candidat.url);
    const resultat = classifierCandidat(demande, candidat, recherche.recupereLe);
    return resultat ? [resultat] : [];
  });
}

export type ChampDemandeResolutionLien =
  | 'fournisseurMetier'
  | 'identifiantExterne'
  | 'typeMetierRecherche'
  | 'villeDemandee'
  | 'nom';

export class DemandeResolutionLienInvalide extends Error {
  constructor(public readonly champ: ChampDemandeResolutionLien) {
    super(`Demande de résolution de lien invalide : ${champ} vide`);
    this.name = 'DemandeResolutionLienInvalide';
  }
}

export function cleDemandeResolutionLien(
  demande: DemandeResolutionLien,
): string {
  const nettoyerComposant = (valeur: unknown): string =>
    typeof valeur === 'string' ? valeur.trim() : '';
  const normaliserComposant = (valeur: unknown): string =>
    normaliserNomLien(nettoyerComposant(valeur)).replace(/\s+/g, '-');

  const composants: ReadonlyArray<
    readonly [ChampDemandeResolutionLien, string]
  > = [
    [
      'fournisseurMetier',
      nettoyerComposant(demande.fournisseurMetier),
    ],
    [
      'identifiantExterne',
      nettoyerComposant(demande.identifiantExterne),
    ],
    [
      'typeMetierRecherche',
      nettoyerComposant(demande.typeMetierRecherche),
    ],
    ['villeDemandee', normaliserComposant(demande.villeDemandee)],
    ['nom', normaliserComposant(demande.nom)],
  ];

  for (const [champ, valeur] of composants) {
    if (!valeur) {
      throw new DemandeResolutionLienInvalide(champ);
    }
  }

  return composants
    .map(([, valeur]) => encodeURIComponent(valeur))
    .join(':');
}

export function selectionnerLien(
  demande: DemandeResolutionLien,
  recherche: ResultatRechercheWeb,
): LienResolu {
  const cleDemande = cleDemandeResolutionLien(demande);
  if (recherche.statut === 'indisponible') {
    return {
      statut: 'indisponible',
      cleDemande,
      fournisseurRecherche: 'Tavily',
      raison: recherche.raison,
      constateLe: recherche.constateLe,
    };
  }
  if (recherche.statut === 'vide') {
    return {
      statut: 'introuvable',
      cleDemande,
      fournisseurRecherche: 'Tavily',
      recupereLe: recherche.recupereLe,
    };
  }

  const candidats = candidatsAdmissibles(
    {
      nom: demande.nom,
      villeDemandee: demande.villeDemandee,
      adresseOuSalle: demande.adresseOuSalle,
      typeMetierRecherche: demande.typeMetierRecherche,
      dateDebut: demande.dateDebut,
      identifiantExterne: demande.identifiantExterne,
    },
    recherche,
  );

  if (candidats.length === 0) {
    return {
      statut: 'introuvable',
      cleDemande,
      fournisseurRecherche: 'Tavily',
      recupereLe: recherche.recupereLe,
    };
  }
  if (candidats.length > 1) {
    return {
      statut: 'ambigu',
      cleDemande,
      candidats,
      fournisseurRecherche: 'Tavily',
      recupereLe: recherche.recupereLe,
    };
  }

  const [candidat] = candidats;
  return {
    statut: 'resolu',
    cleDemande,
    url: candidat.url,
    typeLien: candidat.typeLienPossible,
    domaine: candidat.domaine,
    rang: candidat.rang,
    fournisseurRecherche: candidat.fournisseurRecherche,
    recupereLe: candidat.recupereLe,
    preuves: candidat.preuves,
    redirections: [],
  };
}
