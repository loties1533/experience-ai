// =============================================
// EXPERIENCE AI — tests/unit/partage.test.ts
// Le partage au groupe, côté domaine (sprint R8) : qui peut voir, qui peut
// convier, et ce que valent les avis. Deux histoires en tête (doc 04) :
// l'EVG de Max (Hugo organise, Max ne doit pas tout savoir) et la surprise de
// Sam pour Léa.
// =============================================

import { describe, it, expect } from 'vitest';
import {
  ParcoursSchema,
  appliquerModification,
  avisDuGroupe,
  participantsPartageables,
  validerParcours,
  verifierAccesPartage,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

const HUGO = 'p-hugo';
const MAX = 'p-max';
const LEO = 'p-leo';
const QUAND = '2026-07-24T10:00:00.000Z';

function evg(visibilite: 'prive' | 'partage' | 'surprise'): Parcours {
  return ParcoursSchema.parse({
    id: 'evg-max',
    intention: { texte: "fêter l'enterrement de vie de garçon de Max" },
    contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
    participants: [
      { id: HUGO, nom: 'Hugo', role: 'organisateur' },
      { id: MAX, nom: 'Max', role: 'heros' },
      { id: LEO, nom: 'Léo', role: 'participant' },
    ],
    budget: { mode: 'partage', montantTotal: 1600 },
    visibilite,
    timeline: [
      {
        id: 'm1',
        titre: 'Samedi après-midi',
        elements: [
          { id: 'e1', type: 'activite', nom: 'Karting', justification: 'Max adore la vitesse' },
          { id: 'e2', type: 'restaurant', nom: 'Chez Rose', justification: 'la table qui met tout le monde d’accord' },
        ],
      },
    ],
  });
}

const contexte = (auteurId: string) => ({ auteurId, horodatage: QUAND });

// ============================================================
// LA VISIBILITÉ — qui peut consulter par le lien
// ============================================================
describe('verifierAccesPartage — la visibilité décide, pas le lien', () => {

  it('« privé » : personne ne consulte, même un participant', () => {
    const parcours = evg('prive');
    expect(verifierAccesPartage(parcours, HUGO)).toMatch(/pas partagé/);
    expect(verifierAccesPartage(parcours, LEO)).toMatch(/pas partagé/);
  });

  it('« partagé » : tous les participants consultent, y compris le héros', () => {
    const parcours = evg('partage');
    expect(verifierAccesPartage(parcours, HUGO)).toBeNull();
    expect(verifierAccesPartage(parcours, LEO)).toBeNull();
    expect(verifierAccesPartage(parcours, MAX)).toBeNull();
  });

  it('« surprise » : le héros est le seul à ne pas voir (histoire de Max, de Léa)', () => {
    const parcours = evg('surprise');
    expect(verifierAccesPartage(parcours, HUGO)).toBeNull();
    expect(verifierAccesPartage(parcours, LEO)).toBeNull();
    expect(verifierAccesPartage(parcours, MAX)).toMatch(/surprise/);
  });

  it('qui n’est pas du parcours n’y accède jamais, quelle que soit la visibilité', () => {
    expect(verifierAccesPartage(evg('partage'), 'un-inconnu')).toMatch(/ne faites pas partie/);
    expect(verifierAccesPartage(evg('surprise'), 'un-inconnu')).toMatch(/ne faites pas partie/);
  });

  it('aucun lien n’est émissible pour le héros d’une surprise', () => {
    expect(participantsPartageables(evg('surprise')).map((p) => p.id)).toEqual([HUGO, LEO]);
    expect(participantsPartageables(evg('partage')).map((p) => p.id)).toEqual([HUGO, MAX, LEO]);
    expect(participantsPartageables(evg('prive'))).toEqual([]);
  });
});

// ============================================================
// CONVIER — constituer le groupe et décider ce qu'il voit
// ============================================================
describe('convier — la responsabilité de l’organisateur (invariant 8)', () => {

  it('l’organisateur ajoute un participant', () => {
    const resultat = appliquerModification(
      evg('prive'),
      { type: 'ajouter_participant', participant: { id: 'p-sam', nom: 'Sam', role: 'participant' } },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.participants.map((p) => p.nom)).toContain('Sam');
    // Constituer le groupe est une vraie modification : elle se journalise.
    expect(resultat.parcours.historique.at(-1)?.description).toMatch(/Sam/);
  });

  it('un participant ne convie personne — ça revient à l’organisateur', () => {
    const resultat = appliquerModification(
      evg('prive'),
      { type: 'ajouter_participant', participant: { id: 'p-sam', nom: 'Sam', role: 'participant' } },
      contexte(LEO)
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/organisateur/);
  });

  it('le héros ne change pas la visibilité de sa propre surprise', () => {
    const resultat = appliquerModification(
      evg('surprise'),
      { type: 'changer_visibilite', visibilite: 'partage' },
      contexte(MAX)
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/héros/);
  });

  it('l’organisateur passe le parcours en surprise', () => {
    const resultat = appliquerModification(
      evg('prive'),
      { type: 'changer_visibilite', visibilite: 'surprise' },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.visibilite).toBe('surprise');
  });

  it('repasser en privé se dit clairement : les liens ne valent plus rien', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'changer_visibilite', visibilite: 'prive' },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.description).toMatch(/liens/);
  });

  it('changer pour la visibilité déjà en cours est refusé, pas appliqué à moitié', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'changer_visibilite', visibilite: 'partage' },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(false);
  });

  it('un parcours surprise sans organisateur est refusé par les invariants', () => {
    const solitaire = ParcoursSchema.parse({
      ...evg('prive'),
      participants: [{ id: MAX, nom: 'Max', role: 'heros' }],
    });
    const resultat = appliquerModification(
      solitaire,
      { type: 'changer_visibilite', visibilite: 'surprise' },
      contexte(MAX)
    );
    expect(resultat.ok).toBe(false);
  });

  it('l’organisateur ne se retire pas lui-même du parcours', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'retirer_participant', participantId: HUGO },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/organise/);
  });

  it('retirer quelqu’un emporte ses avis — un avis sans auteur ne veut plus rien dire', () => {
    const avecAvis = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'contre' },
      contexte(LEO)
    );
    expect(avecAvis.ok).toBe(true);
    if (!avecAvis.ok) return;

    const resultat = appliquerModification(
      avecAvis.parcours,
      { type: 'retirer_participant', participantId: LEO },
      contexte(HUGO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.participants.map((p) => p.id)).not.toContain(LEO);
    expect(resultat.parcours.timeline[0].elements[0].reactions).toEqual([]);
    expect(validerParcours(resultat.parcours)).toEqual([]);
  });
});

// ============================================================
// RÉAGIR — l'avis qui éclaire, pas le vote qui décide
// ============================================================
describe('reagir_element — l’avis du groupe', () => {

  it('un participant donne son avis, signé de son identité', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'pour' },
      contexte(LEO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.timeline[0].elements[0].reactions).toEqual([
      { participantId: LEO, avis: 'pour', le: QUAND },
    ]);
    expect(resultat.description).toMatch(/Léo est pour/);
  });

  it('un avis ne s’inscrit pas dans l’historique : ce n’est pas une modification du parcours', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'pour' },
      contexte(LEO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.historique).toEqual([]);
  });

  it('changer d’avis remplace le précédent, il ne s’empile pas', () => {
    const premier = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'pour' },
      contexte(LEO)
    );
    expect(premier.ok).toBe(true);
    if (!premier.ok) return;

    const second = appliquerModification(
      premier.parcours,
      { type: 'reagir_element', elementId: 'e1', avis: 'contre' },
      contexte(LEO)
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.parcours.timeline[0].elements[0].reactions).toEqual([
      { participantId: LEO, avis: 'contre', le: QUAND },
    ]);
  });

  it('le héros peut donner son avis : donner son avis n’est pas décider', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e2', avis: 'pour' },
      contexte(MAX)
    );
    expect(resultat.ok).toBe(true);
  });

  it('qui n’est pas du parcours n’a aucun avis à donner', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'pour' },
      contexte('un-inconnu')
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/ne faites pas partie/);
  });

  it('réagir sur un élément qui n’existe pas est refusé', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'fantome', avis: 'pour' },
      contexte(LEO)
    );
    expect(resultat.ok).toBe(false);
  });

  it('un avis ne décide rien : le statut de l’élément ne bouge pas (invariant 8)', () => {
    const resultat = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'contre' },
      contexte(LEO)
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.parcours.timeline[0].elements[0].statut).toBe('propose');
  });

  it('avisDuGroupe résout les noms pour l’organisateur', () => {
    const pour = appliquerModification(
      evg('partage'),
      { type: 'reagir_element', elementId: 'e1', avis: 'pour' },
      contexte(LEO)
    );
    expect(pour.ok).toBe(true);
    if (!pour.ok) return;
    const contre = appliquerModification(
      pour.parcours,
      { type: 'reagir_element', elementId: 'e1', avis: 'contre' },
      contexte(MAX)
    );
    expect(contre.ok).toBe(true);
    if (!contre.ok) return;

    expect(avisDuGroupe(contre.parcours, contre.parcours.timeline[0].elements[0])).toEqual({
      pour: ['Léo'],
      contre: ['Max'],
    });
  });
});

// ============================================================
// COHÉRENCE — ce que les invariants refusent
// ============================================================
describe('validerParcours — les avis restent cohérents', () => {

  it('refuse un avis venu de quelqu’un qui n’est pas dans le parcours', () => {
    const parcours = evg('partage');
    parcours.timeline[0].elements[0].reactions = [{ participantId: 'inconnu', avis: 'pour', le: QUAND }];
    expect(validerParcours(parcours).join(' ')).toMatch(/n'est pas dans le parcours/);
  });

  it('refuse deux avis du même participant sur le même élément', () => {
    const parcours = evg('partage');
    parcours.timeline[0].elements[0].reactions = [
      { participantId: LEO, avis: 'pour', le: QUAND },
      { participantId: LEO, avis: 'contre', le: QUAND },
    ];
    expect(validerParcours(parcours).join(' ')).toMatch(/plusieurs avis/);
  });

  it('refuse deux participants portant le même id', () => {
    const parcours = evg('partage');
    parcours.participants = [...parcours.participants, { id: LEO, nom: 'Léo bis', role: 'participant' }];
    expect(validerParcours(parcours).join(' ')).toMatch(/ids distincts/);
  });
});
