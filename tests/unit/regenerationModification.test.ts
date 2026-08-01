import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element, Parcours } from '../../server/domaine/parcours/index.js';

// On ne mocke QUE les frontières réseau/IA : Foursquare (hôtel), la
// résolution de liens transport, et l'agent LLM générique. Le reste
// (domaine, F8-A) reste réel — c'est justement ce qu'on veut prouver
// intégré.
const { rechercherLieuxFoursquare } = vi.hoisted(() => ({
  rechercherLieuxFoursquare: vi.fn(),
}));
vi.mock('../../server/services/foursquare.js', () => ({
  rechercherLieuxFoursquare,
}));

const { ajouterLiensRechercheTransport } = vi.hoisted(() => ({
  ajouterLiensRechercheTransport: vi.fn(),
}));
vi.mock('../../server/agents/enrichissementLiensTransport.js', () => ({
  ajouterLiensRechercheTransport,
}));

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn() };
});

const depotParcours = vi.hoisted(() => ({
  chargerParcours: vi.fn(),
  sauvegarderParcours: vi.fn(),
}));
vi.mock('../../server/depots/depotParcours.js', () => depotParcours);

const { callAI } = await import('../../server/services/claude/core.js');
const { ElementSchema, ParcoursSchema } = await import('../../server/domaine/parcours/index.js');
const {
  JUSTIFICATION_TRANSPORT_GENERIQUE,
  LIBELLE_TRANSPORT_GENERIQUE,
} = await import('../../server/domaine/transport/invariants.js');
const { regenererModificationSurCopie } = await import(
  '../../server/agents/regenerationModification.js'
);

const HORODATAGE = '2026-08-01T10:00:00.000Z';
const CONTEXTE = { auteurId: 'u1', horodatage: HORODATAGE };

function element(id: string, surcharge: Partial<Parameters<typeof ElementSchema.parse>[0]> = {}) {
  return ElementSchema.parse({
    id,
    type: 'activite',
    nom: `Élément ${id}`,
    justification: 'cohérent avec l’intention',
    ...surcharge,
  });
}

// hotel <- resto <- bar (chaîne de dépendances) ; transport1 indépendant.
// hotel porte une confiance VÉRIFIÉE pour prouver qu'un indépendant la garde.
function parcoursDeTest(): Parcours {
  return ParcoursSchema.parse({
    id: 'p1',
    intention: { texte: 'vivre la NBA' },
    contexte: {
      avecQui: 'amis',
      duree: { valeur: 5, unite: 'jours' },
      lieux: ['Boston'],
    },
    participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Soirée à Boston',
        elements: [
          element('hotel', {
            type: 'hebergement',
            prix: 200,
            confiance: {
              niveau: 'verifie',
              source: 'https://places-api.foursquare.com/places/search',
              fournisseur: 'Foursquare',
              recupereLe: '2026-07-20T10:00:00.000Z',
              identifiantExterne: 'fsq-hotel',
              categorieFournisseur: 'Hotel',
              identifiantCategorieFournisseur: '19014',
            },
          }),
          element('resto', { type: 'restaurant', dependDe: ['hotel'], prix: 40 }),
          element('bar', { dependDe: ['resto'] }),
        ],
      },
      {
        id: 'm2',
        titre: 'Transports à organiser',
        elements: [
          element('transport1', {
            type: 'transport',
            nom: LIBELLE_TRANSPORT_GENERIQUE,
            justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
            confiance: { niveau: 'suggestion' },
          }),
        ],
      },
    ],
  });
}

function regenererElementFactice(): Element {
  throw new Error('regenererElement ne doit pas être appelé ici');
}

beforeEach(() => {
  vi.clearAllMocks();
  rechercherLieuxFoursquare.mockResolvedValue({ statut: 'vide', resultats: [], recupereLe: HORODATAGE });
  ajouterLiensRechercheTransport.mockImplementation(async (parcours: Parcours) => parcours);
});

describe('regenererModificationSurCopie — remplacements et suppressions', () => {
  it('1. remplace un élément sans dépendants sans jamais appeler la régénération', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(regenererElementFactice);
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'bar', remplacement: { type: 'activite', nom: 'Nouveau bar', justification: 'plus calme' } },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres).toEqual([]);
    expect(regenererElement).not.toHaveBeenCalled();
    const bar = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'bar')!;
    expect(bar.nom).toBe('Nouveau bar');
  });

  it('2. remplace un élément avec dépendants : « resto » (dépendant de hotel, parent de bar) — bar seul est réellement régénéré', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { nom: `${elementId}-regenere` })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      {
        type: 'remplacer_element',
        elementId: 'resto',
        remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'plus proche du stade' },
      },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres).toEqual(['bar']);
    expect(regenererElement).toHaveBeenCalledTimes(1);
    const bar = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'bar')!;
    expect(bar.nom).toBe('bar-regenere');
    expect(bar.confiance.niveau).toBe('suggestion');
  });

  it('3. suppression avec dépendants : la cible disparaît, ses dépendants sont régénérés, aucune référence orpheline', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { nom: `${elementId}-reconstruit` })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const ids = resultat.parcours.timeline.flatMap((m) => m.elements.map((e) => e.id));
    expect(ids).not.toContain('resto');
    expect(resultat.elementsRegeneres).toEqual(['bar']);
    const bar = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'bar')!;
    expect(bar.dependDe).not.toContain('resto');
  });

  it('3bis. suppression de la RACINE (hotel) : resto survit sans dépendance restante, reconstruit, aucune référence orpheline', async () => {
    // hotel supprimé → resto (qui n'en dépendait QUE de lui) doit survivre en
    // suggestion autonome, jamais rester avec un dependDe pointant vers un
    // id qui n'existe plus dans le parcours.
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { nom: `${elementId}-reconstruit-sans-hotel` })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'hotel' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const tousLesIds = new Set(resultat.parcours.timeline.flatMap((m) => m.elements.map((e) => e.id)));
    expect(tousLesIds.has('hotel')).toBe(false);
    expect(tousLesIds.has('resto')).toBe(true);
    expect(resultat.elementsRegeneres).toContain('resto');
    const resto = resultat.parcours.timeline
      .flatMap((m) => m.elements)
      .find((e) => e.id === 'resto')!;
    // Aucune référence orpheline : chaque id dans dependDe existe encore.
    for (const dependanceId of resto.dependDe) {
      expect(tousLesIds.has(dependanceId)).toBe(true);
    }
    // La validation finale (domaine) est passée : le test le prouve déjà en
    // atteignant `ok: true`, mais on le vérifie explicitement ici aussi.
    expect(resto.dependDe).not.toContain('hotel');
  });

  it('4. ajout sans régénération inutile : aucun élément existant ne dépend d’un ajout', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(regenererElementFactice);
    const resultat = await regenererModificationSurCopie(
      parcours,
      {
        type: 'ajouter_element',
        momentId: 'm1',
        element: { type: 'activite', nom: 'Balade', justification: 'complète la soirée' },
      },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres).toEqual([]);
    expect(regenererElement).not.toHaveBeenCalled();
  });

  it('5. modifier_justification : aucun appel IA, aucune régénération', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(regenererElementFactice);
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'modifier_justification', elementId: 'bar', justification: 'ambiance plus calme' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    expect(callAI).not.toHaveBeenCalled();
    expect(regenererElement).not.toHaveBeenCalled();
  });

  it('6. changer_statut : aucun appel IA, aucune régénération', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(regenererElementFactice);
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'changer_statut', elementId: 'bar', statut: 'accepte' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    expect(callAI).not.toHaveBeenCalled();
    expect(regenererElement).not.toHaveBeenCalled();
  });
});

describe('regenererModificationSurCopie — hébergement et transport', () => {
  function parcoursHotelier(): Parcours {
    return ParcoursSchema.parse({
      id: 'p-hotel',
      intention: { texte: 'découvrir Boston' },
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: { debut: '2026-08-10T08:00:00.000Z', fin: '2026-08-13T20:00:00.000Z' },
        lieux: ['Boston'],
      },
      participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
      budget: { mode: 'individuel' },
      timeline: [
        {
          id: 'm1',
          titre: 'Séjour',
          elements: [
            element('hotel', {
              type: 'hebergement',
              sejourHebergement: { ville: 'Boston', arrivee: '2026-08-10', depart: '2026-08-13' },
            }),
            element('petit-dej', { type: 'restaurant', dependDe: ['hotel'] }),
          ],
        },
      ],
    });
  }

  it('7. modification hôtel ciblée (remplacer_hotel) : le dépendant est régénéré, l’indépendant du reste du parcours n’est jamais sollicité', async () => {
    const parcours = parcoursHotelier();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { type: 'restaurant', nom: 'petit-dej-reconstruit' })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_hotel', elementId: 'hotel', villeDemandee: 'Boston', requete: 'hôtel' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres).toEqual(['petit-dej']);
    expect(regenererElement).toHaveBeenCalledTimes(1);
    const petitDej = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'petit-dej')!;
    expect(petitDej.nom).toBe('petit-dej-reconstruit');
  });

  function parcoursTransport(): Parcours {
    return ParcoursSchema.parse({
      id: 'p-transport',
      intention: { texte: 'rejoindre Boston' },
      contexte: {
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'jours' },
        lieux: ['Boston'],
        demandeTransport: {
          troncons: [{ origine: { ville: 'Paris' }, destination: { ville: 'Boston' }, depart: { date: '2026-08-10' } }],
          occupation: { statut: 'declaree', adultes: 1, enfants: 0 },
        },
      },
      participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
      budget: { mode: 'individuel' },
      timeline: [
        {
          id: 'm1',
          titre: 'Transports à organiser',
          elements: [
            element('transport1', {
              type: 'transport',
              nom: LIBELLE_TRANSPORT_GENERIQUE,
              justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
              confiance: { niveau: 'suggestion' },
              dependDe: [],
            }),
          ],
        },
        {
          id: 'm2',
          titre: 'Arrivée à Boston',
          elements: [element('accueil', { dependDe: ['transport1'] })],
        },
      ],
    });
  }

  it('8. modification transport ciblée (modifier_demande_transport) : le dépendant est régénéré', async () => {
    const parcours = parcoursTransport();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { nom: 'accueil-reconstruit' })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      {
        type: 'modifier_demande_transport',
        demandeTransport: {
          troncons: [{ origine: { ville: 'Lyon' }, destination: { ville: 'Boston' }, depart: { date: '2026-08-10' } }],
          occupation: { statut: 'declaree', adultes: 1, enfants: 0 },
        },
      },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres).toEqual(['accueil']);
    const accueil = resultat.parcours.timeline
      .flatMap((m) => m.elements)
      .find((e) => e.id === 'accueil')!;
    expect(accueil.nom).toBe('accueil-reconstruit');
  });
});

describe('regenererModificationSurCopie — échecs', () => {
  it('9. échec de régénération d’un dépendant : aucune copie valide n’est retournée', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string): Promise<Element> => {
      if (elementId === 'bar') throw new Error('panne réseau simulée');
      return element(elementId);
    });
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toBeTruthy();
  });

  it("9bis. la régénération générique par défaut échoue proprement quand l'IA renvoie une sortie inexploitable", async () => {
    const parcours = parcoursDeTest();
    vi.mocked(callAI).mockResolvedValue('ceci n’est pas du JSON');
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.statutHttp).toBe(502);
  });

  it('10. validation finale échoue (dépendance orpheline injectée) : l’opération entière est rejetée', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { dependDe: ['inconnu'] })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/incohérent/);
  });
});

describe('regenererModificationSurCopie — ordre de régénération (A → B → C)', () => {
  it('régénère B avant C : C voit le NOUVEAU B, jamais l’ancien (hotel=A remplacé, resto=B, bar=C)', async () => {
    const observationsDeC: string[] = [];
    const regenererElement = vi.fn(async (parcoursCourant: Parcours, elementId: string) => {
      if (elementId === 'bar') {
        // Au moment où C (bar) est régénéré, B (resto) doit déjà porter son
        // nouveau contenu dans la copie de travail passée en paramètre —
        // jamais l'ancien resto.
        const restoVu = parcoursCourant.timeline
          .flatMap((m) => m.elements)
          .find((e) => e.id === 'resto')!;
        observationsDeC.push(restoVu.nom);
      }
      return element(elementId, { nom: `${elementId}-v2` });
    });
    // La suppression de « hotel » (A) marque resto (B) ET bar (C) à
    // régénérer : B ne dépend plus que de rien (A a disparu), C dépend de B.
    const resultat = await regenererModificationSurCopie(
      parcoursDeTest(),
      { type: 'supprimer_element', elementId: 'hotel' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    expect(observationsDeC).toEqual(['resto-v2']);
  });

  it('détecte un cycle de dépendances entre éléments à régénérer et refuse explicitement (pas de boucle infinie, pas de données obsolètes)', async () => {
    // Cycle impossible en usage normal (validerParcours le refuse déjà en
    // sortie) mais qui doit être détecté AVANT toute tentative de
    // régénération, pas seulement constaté après coup. x et y dépendent
    // l'un de l'autre ; les deux dépendent aussi de « racine », remplacée.
    const parcoursCyclique: Parcours = {
      ...parcoursDeTest(),
      timeline: [
        {
          id: 'm1',
          titre: 'Cycle',
          elements: [
            element('racine'),
            element('x', { dependDe: ['racine', 'y'] }),
            element('y', { dependDe: ['x'] }),
          ],
        },
      ],
    };
    const regenererElement = vi.fn(regenererElementFactice);
    const resultat = await regenererModificationSurCopie(
      parcoursCyclique,
      {
        type: 'remplacer_element',
        elementId: 'racine',
        remplacement: { type: 'activite', nom: 'Nouvelle racine', justification: 'x' },
      },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toMatch(/boucle/);
    // Le cycle est détecté AVANT toute régénération : aucune donnée obsolète
    // n'a pu être lue par un dépendant.
    expect(regenererElement).not.toHaveBeenCalled();
  });
});

describe('regenererModificationSurCopie — garanties transverses', () => {
  it('11. ne mute jamais le parcours reçu', async () => {
    const parcours = parcoursDeTest();
    const copie = JSON.parse(JSON.stringify(parcours));
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) => element(elementId));
    await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(parcours).toEqual(copie);
  });

  it('12. un élément indépendant est conservé structurellement (bit-à-bit) et garde sa confiance', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) => element(elementId));
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'resto', remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'x' } },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const transport1 = resultat.parcours.timeline[1]!.elements.find((e) => e.id === 'transport1')!;
    expect(transport1).toEqual(parcours.timeline[1]!.elements[0]);
  });

  it('13. impact intégral supporté (injecté) : la régénération intégrale déléguée est utilisée', async () => {
    const parcours = parcoursDeTest();
    const parcoursRegenere = { ...parcours, ambiance: 'régénéré intégralement' };
    const regenererIntegralement = vi.fn(async () => parcoursRegenere);
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'changer_dates' },
      CONTEXTE,
      undefined,
      { regenererIntegralement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(regenererIntegralement).toHaveBeenCalledTimes(1);
    expect(resultat.elementsRegeneres).toEqual([]);
    expect(resultat.parcours.ambiance).toBe('régénéré intégralement');
  });

  it('14. impact intégral non supporté (aucune régénération intégrale injectée) : refus explicite', async () => {
    const parcours = parcoursDeTest();
    const resultat = await regenererModificationSurCopie(parcours, { type: 'changer_dates' }, CONTEXTE);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.statutHttp).toBe(422);
    expect(resultat.erreur).toMatch(/non supportée/);
  });

  it('14bis. changer_duree AVEC dates (impact F8-A sans régénération) reste refusé : aucune mutation réelle n’existe pour ce champ', async () => {
    const avecDates = ParcoursSchema.parse({
      ...parcoursDeTest(),
      contexte: { ...parcoursDeTest().contexte, dates: { debut: '2026-08-01T00:00:00Z', fin: '2026-08-05T00:00:00Z' } },
    });
    const resultat = await regenererModificationSurCopie(avecDates, { type: 'changer_duree' }, CONTEXTE);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.statutHttp).toBe(422);
    expect(resultat.erreur).toMatch(/non supportée/);
  });

  it('15. aucun accès DB : ni chargement ni sauvegarde ne sont sollicités', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) => element(elementId));
    await regenererModificationSurCopie(
      parcours,
      { type: 'supprimer_element', elementId: 'resto' },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(depotParcours.chargerParcours).not.toHaveBeenCalled();
    expect(depotParcours.sauvegarderParcours).not.toHaveBeenCalled();
  });

  it('16. plusieurs dépendants sans doublon : chaque id n’est régénéré qu’une seule fois', async () => {
    // diamant : bar dépend à la fois de hotel et de resto.
    const parcours = ParcoursSchema.parse({
      id: 'p-diamant',
      intention: { texte: 'vivre la NBA' },
      contexte: { avecQui: 'amis', duree: { valeur: 5, unite: 'jours' }, lieux: ['Boston'] },
      participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
      budget: { mode: 'individuel' },
      timeline: [
        {
          id: 'm1',
          titre: 'Soirée',
          elements: [
            element('hotel', { type: 'hebergement' }),
            element('resto', { type: 'restaurant', dependDe: ['hotel'] }),
            element('bar', { dependDe: ['hotel', 'resto'] }),
          ],
        },
      ],
    });
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) => element(elementId, { nom: `${elementId}-ok` }));
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'resto', remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'x' } },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.elementsRegeneres.sort()).toEqual(['bar']);
    expect(regenererElement).toHaveBeenCalledTimes(1);
  });

  it('17. les statuts de confiance verifie/estime/suggestion sont préservés correctement', async () => {
    const parcours = parcoursDeTest();
    const regenererElement = vi.fn(async (_p: Parcours, elementId: string) =>
      element(elementId, { nom: `${elementId}-nouveau` })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'resto', remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'x' } },
      CONTEXTE,
      undefined,
      { regenererElement }
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    // hotel : indépendant, jamais touché, reste VÉRIFIÉ.
    const hotel = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'hotel')!;
    expect(hotel.confiance.niveau).toBe('verifie');
    // bar : régénéré, ne peut jamais redevenir vérifié sans preuve — la
    // fonction injectée rend explicitement `suggestion` par défaut du helper `element()`.
    const bar = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'bar')!;
    expect(bar.confiance.niveau).toBe('suggestion');
  });

  it('utilise réellement callAI par défaut (chemin non injecté), et IGNORE tout nom/adresse que le LLM tenterait d’inventer', async () => {
    const parcours = parcoursDeTest();
    // Un modèle non conforme au prompt qui inventerait quand même une
    // identité (nom propre + adresse) : le module doit l'ignorer purement et
    // simplement — aucune information fournisseur ne peut en sortir.
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        nom: 'Restaurant Chez Marcel',
        lieu: '12 rue Invention',
        justification: 'cohérent avec le nouveau resto',
      })
    );
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'resto', remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'x' } },
      CONTEXTE
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(callAI).toHaveBeenCalledTimes(1);
    const bar = resultat.parcours.timeline[0]!.elements.find((e) => e.id === 'bar')!;
    // Jamais le nom propre inventé par le modèle : une idée générique, sans
    // identité réelle (même formule que `nomSuggestion` en génération).
    expect(bar.nom).not.toBe('Restaurant Chez Marcel');
    expect(bar.nom).toMatch(/^Une activité/);
    expect(bar.lieu).toBeUndefined();
    expect(bar.confiance.niveau).toBe('suggestion');
    expect(bar.justification).toBe('cohérent avec le nouveau resto');
  });

  it('refuse de régénérer automatiquement un dépendant hébergement ou transport (identité protégée)', async () => {
    const parcours = ParcoursSchema.parse({
      id: 'p-garde',
      intention: { texte: 'vivre la NBA' },
      contexte: { avecQui: 'amis', duree: { valeur: 5, unite: 'jours' }, lieux: ['Boston'] },
      participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
      budget: { mode: 'individuel' },
      timeline: [
        {
          id: 'm1',
          titre: 'Soirée',
          elements: [
            element('base', { type: 'activite' }),
            element('hotel-dependant', { type: 'hebergement', dependDe: ['base'] }),
          ],
        },
      ],
    });
    const resultat = await regenererModificationSurCopie(
      parcours,
      { type: 'remplacer_element', elementId: 'base', remplacement: { type: 'activite', nom: 'Nouvelle base', justification: 'x' } },
      CONTEXTE
    );
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.statutHttp).toBe(422);
    expect(callAI).not.toHaveBeenCalled();
  });
});
