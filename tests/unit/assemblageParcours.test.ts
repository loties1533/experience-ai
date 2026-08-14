import { describe, expect, it } from 'vitest';
import { dedoublonnerElementsVerifies } from '../../server/agents/generation/assemblage.js';
import type { MomentPrepare } from '../../server/agents/generation/resolution.js';
import type { CandidatJournal } from '../../server/services/claude/outils.js';

const DATE_RECUPERATION = '2026-08-14T08:00:00.000Z';

function candidat(
  identifiantExterne: string,
  nom: string,
  fournisseur: 'Foursquare' | 'PredictHQ' = 'Foursquare'
): CandidatJournal {
  if (fournisseur === 'PredictHQ') {
    return {
      identifiantExterne,
      nom,
      villeDemandee: 'Paris',
      categorieFournisseur: 'concerts',
      typeMetierRecherche: 'evenement',
      fournisseur,
      source: 'https://api.predicthq.com/v1/events/',
      recupereLe: DATE_RECUPERATION,
      dateDebut: '2026-09-01T18:00:00.000Z',
      dateFin: '2026-09-01T20:00:00.000Z',
      description: 'Événement vérifié',
    };
  }

  return {
    identifiantExterne,
    nom,
    villeDemandee: 'Paris',
    categorieFournisseur: 'Museum',
    typeMetierRecherche: 'activite',
    fournisseur,
    source: 'https://places-api.foursquare.com/places/search',
    recupereLe: DATE_RECUPERATION,
    lienCarte: 'https://www.google.com/maps/search/?api=1&query=Paris',
  };
}

function moment(
  ref: string,
  nom: string,
  candidatAssocie?: CandidatJournal
): MomentPrepare {
  return {
    moment: {
      titre: `Moment ${ref}`,
      ville: 'Paris',
      elements: [
        {
          ref,
          type: candidatAssocie?.typeMetierRecherche ?? 'activite',
          identifiantExterne: candidatAssocie?.identifiantExterne,
          nom,
          justification: 'preuve du test',
          dependDe: [],
          estAncre: false,
        },
      ],
    },
    ville: 'Paris',
    elements: [
      {
        element: {
          ref,
          type: candidatAssocie?.typeMetierRecherche ?? 'activite',
          identifiantExterne: candidatAssocie?.identifiantExterne,
          nom,
          justification: 'preuve du test',
          dependDe: [],
          estAncre: false,
        },
        candidat: candidatAssocie,
      },
    ],
  };
}

describe('assemblage global des identités fournisseur', () => {
  it('conserve une seule occurrence du même identifiant Foursquare dans deux lots', () => {
    const preuve = candidat('fsq-partage', 'Musée réel');

    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Musée réel', preuve),
      moment('lot-2', 'Musée réel', preuve),
    ]);

    expect(resultat).toHaveLength(1);
    expect(resultat[0].elements[0].element.ref).toBe('lot-1');
  });

  it('conserve deux lieux de même nom lorsque leurs identifiants diffèrent', () => {
    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Le Central', candidat('fsq-paris', 'Le Central')),
      moment('lot-2', 'Le Central', candidat('fsq-lyon', 'Le Central')),
    ]);

    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(2);
  });

  it('conserve le même identifiant lorsqu’il appartient à deux fournisseurs distincts', () => {
    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Le Central', candidat('identite-partagee', 'Le Central')),
      moment(
        'lot-2',
        'Le Central',
        candidat('identite-partagee', 'Le Central', 'PredictHQ')
      ),
    ]);

    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(2);
  });

  it('conserve seulement la première occurrence du même identifiant dans trois lots', () => {
    const preuve = candidat('fsq-triplement', 'Lieu vérifié');

    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Lieu vérifié', preuve),
      moment('lot-2', 'Lieu vérifié', preuve),
      moment('lot-3', 'Lieu vérifié', preuve),
    ]);

    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(1);
    expect(resultat[0].elements[0].element.ref).toBe('lot-1');
  });

  it('retire le doublon sans créer de remplacement ni de moment vide', () => {
    const preuve = candidat('fsq-sans-remplacement', 'Lieu vérifié');
    const entree = [
      moment('lot-1', 'Lieu vérifié', preuve),
      moment('lot-2', 'Lieu vérifié', preuve),
    ];

    const resultat = dedoublonnerElementsVerifies(entree);

    expect(resultat).toHaveLength(1);
    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(1);
    expect(resultat[0].elements[0].element.ref).toBe('lot-1');
    expect(
      resultat.flatMap(({ elements }) =>
        elements.map(({ element }) => element.nom)
      )
    ).toEqual(['Lieu vérifié']);
  });

  it('préserve tous les éléments vérifiés dont les identités sont uniques', () => {
    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Musée', candidat('fsq-musee', 'Musée')),
      moment(
        'lot-2',
        'Concert',
        candidat('phq-concert', 'Concert', 'PredictHQ')
      ),
    ]);

    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(2);
  });

  it('ne déduplique jamais deux suggestions sur la seule égalité de leur nom', () => {
    const resultat = dedoublonnerElementsVerifies([
      moment('lot-1', 'Une activité locale'),
      moment('lot-2', 'Une activité locale'),
    ]);

    expect(resultat.flatMap(({ elements }) => elements)).toHaveLength(2);
  });
});
