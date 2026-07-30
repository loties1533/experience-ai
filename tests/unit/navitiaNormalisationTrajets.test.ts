import { describe, expect, it } from 'vitest';
import {
  candidatDepuisJourney,
  CandidatTrajetFerroviaireNavitiaSchema,
  DateHeureLocaleNavitiaSchema,
  JourneyNavitiaSchema,
  modeTransportDepuisModePhysiqueNavitia,
  ReponseJourneysNavitiaSchema,
  type JourneyNavitia,
} from '../../server/services/navitia/index.js';

const SOURCE = 'https://api.navitia.io/v1/journeys?from=A&to=B';
const RECUPERE_LE = '2026-07-30T09:15:00.000Z';
const CONTEXTE = {
  source: SOURCE,
  recupereLe: RECUPERE_LE,
  fraicheur: 'base_schedule' as const,
  fuseauIana: 'Europe/Paris',
};

function extremite(
  id: string,
  nom: string,
  timezone = 'Europe/Paris'
): Record<string, unknown> {
  return {
    embedded_type: 'stop_point',
    stop_point: { stop_area: { id, name: nom, timezone } },
  };
}

function sectionTrain(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'public_transport',
    duration: 7_500,
    from: extremite('stop_area:SNCF:87581009', 'Bordeaux Saint-Jean'),
    to: extremite('stop_area:SNCF:87686006', 'Paris Montparnasse'),
    departure_date_time: '20260801T080000',
    arrival_date_time: '20260801T100500',
    display_informations: {
      network: 'SNCF',
      physical_mode: 'physical_mode:LongDistanceTrain',
      commercial_mode: 'TGV INOUI',
      code: '8412',
      direction: 'Paris Montparnasse',
    },
    ...complement,
  };
}

function sectionMarche(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'street_network',
    mode: 'Walking',
    duration: 300,
    ...complement,
  };
}

function journeyBrut(
  sections: unknown[] = [sectionTrain()],
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    duration: 7_800,
    nb_transfers: 0,
    departure_date_time: '20260801T080000',
    arrival_date_time: '20260801T101000',
    sections,
    ...complement,
  };
}

function journey(
  sections: unknown[] = [sectionTrain()],
  complement: Record<string, unknown> = {}
): JourneyNavitia {
  return JourneyNavitiaSchema.parse(journeyBrut(sections, complement));
}

describe('DateHeureLocaleNavitiaSchema', () => {
  it('reponctue une heure locale compacte sans y ajouter de décalage', () => {
    const locale = DateHeureLocaleNavitiaSchema.parse('20260801T080000');

    expect(locale).toBe('2026-08-01T08:00:00');
    expect(locale).not.toMatch(/Z|[+-]\d{2}:\d{2}$/u);
  });

  it('accepte un 29 février réel', () => {
    expect(DateHeureLocaleNavitiaSchema.parse('20280229T235959')).toBe(
      '2028-02-29T23:59:59'
    );
  });

  it.each([
    ['un format incomplet', '20260801T0800'],
    ['un format ISO déjà ponctué', '2026-08-01T08:00:00'],
    ['une chaîne portant un décalage', '20260801T080000+02:00'],
    ['une chaîne portant un Z', '20260801T080000Z'],
    ['une date inexistante', '20260231T080000'],
    ['un 29 février hors année bissextile', '20260229T080000'],
    ['une heure impossible', '20260801T250000'],
    ['une minute impossible', '20260801T086000'],
    ['une chaîne vide', ''],
  ])('refuse %s', (_libelle, valeur) => {
    expect(DateHeureLocaleNavitiaSchema.safeParse(valeur).success).toBe(false);
  });
});

describe('modeTransportDepuisModePhysiqueNavitia', () => {
  it.each([
    ['physical_mode:Train', 'train'],
    ['physical_mode:LongDistanceTrain', 'train'],
    ['physical_mode:LocalTrain', 'train'],
    ['physical_mode:RailShuttle', 'train'],
    ['physical_mode:Bus', 'bus'],
    ['physical_mode:Ferry', 'ferry'],
    ['physical_mode:Metro', 'transport_local'],
    ['physical_mode:Tramway', 'transport_local'],
    ['physical_mode:RapidTransit', 'transport_local'],
  ])('associe %s au mode %s', (modePhysique, attendu) => {
    expect(modeTransportDepuisModePhysiqueNavitia(modePhysique)).toBe(attendu);
  });

  it.each([
    ['un mode inconnu', 'physical_mode:Funicular'],
    ['un identifiant vide', ''],
    ['un libellé commercial', 'TGV INOUI'],
    ['une sous-chaîne trompeuse', 'physical_mode:BusTrainReplacement'],
    ['une casse différente', 'physical_mode:train'],
  ])('classe %s en autre sans deviner', (_libelle, modePhysique) => {
    expect(modeTransportDepuisModePhysiqueNavitia(modePhysique)).toBe('autre');
  });
});

describe('candidatDepuisJourney — itinéraires ferroviaires', () => {
  it('normalise un trajet direct en train', () => {
    const candidat = candidatDepuisJourney(journey(), CONTEXTE);

    expect(candidat).toEqual({
      fournisseur: 'Navitia',
      signature: expect.any(String),
      origine: {
        identifiantExterne: 'stop_area:SNCF:87581009',
        nom: 'Bordeaux Saint-Jean',
        fuseauIana: 'Europe/Paris',
      },
      destination: {
        identifiantExterne: 'stop_area:SNCF:87686006',
        nom: 'Paris Montparnasse',
        fuseauIana: 'Europe/Paris',
      },
      departLocal: '2026-08-01T08:00:00',
      arriveeLocale: '2026-08-01T10:10:00',
      dureeSecondes: 7_800,
      nombreCorrespondancesFournisseur: 0,
      sections: [
        {
          nature: 'transport_public',
          mode: 'train',
          modePhysique: 'physical_mode:LongDistanceTrain',
          modeCommercial: 'TGV INOUI',
          reseau: 'SNCF',
          codeLigne: '8412',
          direction: 'Paris Montparnasse',
          origine: {
            identifiantExterne: 'stop_area:SNCF:87581009',
            nom: 'Bordeaux Saint-Jean',
            fuseauIana: 'Europe/Paris',
          },
          destination: {
            identifiantExterne: 'stop_area:SNCF:87686006',
            nom: 'Paris Montparnasse',
            fuseauIana: 'Europe/Paris',
          },
          departLocal: '2026-08-01T08:00:00',
          arriveeLocale: '2026-08-01T10:05:00',
          dureeSecondes: 7_500,
        },
      ],
      fraicheur: 'base_schedule',
      source: SOURCE,
      recupereLe: RECUPERE_LE,
    });
  });

  it('conserve la marche autour du train sans la confondre avec lui', () => {
    const candidat = candidatDepuisJourney(
      journey([sectionMarche(), sectionTrain(), sectionMarche()]),
      CONTEXTE
    );

    expect(candidat?.sections).toHaveLength(3);
    expect(candidat?.sections.map((section) => section.nature)).toEqual([
      'hors_transport_public',
      'transport_public',
      'hors_transport_public',
    ]);
  });

  it('distingue les extrémités ferroviaires des bornes de l’itinéraire entier', () => {
    const candidat = candidatDepuisJourney(
      journey(
        [sectionMarche(), sectionTrain(), sectionMarche()],
        {
          departure_date_time: '20260801T075000',
          arrival_date_time: '20260801T101500',
        }
      ),
      CONTEXTE
    );

    // Les bornes couvrent la marche ; les extrémités désignent les gares.
    expect(candidat?.departLocal).toBe('2026-08-01T07:50:00');
    expect(candidat?.arriveeLocale).toBe('2026-08-01T10:15:00');
    expect(candidat?.origine.nom).toBe('Bordeaux Saint-Jean');
    expect(candidat?.destination.nom).toBe('Paris Montparnasse');
  });

  it('accepte un trajet avec correspondance entre deux trains', () => {
    const candidat = candidatDepuisJourney(
      journey(
        [
          sectionTrain(),
          { type: 'transfer', duration: 600 },
          { type: 'waiting', duration: 900 },
          sectionTrain({
            from: extremite('stop_area:SNCF:87686006', 'Paris Montparnasse'),
            to: extremite('stop_area:SNCF:87271007', 'Paris Nord'),
            departure_date_time: '20260801T110000',
            arrival_date_time: '20260801T113000',
          }),
        ],
        { nb_transfers: 1, arrival_date_time: '20260801T113500' }
      ),
      CONTEXTE
    );

    expect(candidat?.nombreCorrespondancesFournisseur).toBe(1);
    expect(candidat?.origine.identifiantExterne).toBe(
      'stop_area:SNCF:87581009'
    );
    expect(candidat?.destination.identifiantExterne).toBe(
      'stop_area:SNCF:87271007'
    );
  });

  it('accepte un trajet mixte train puis bus en gardant des modes honnêtes', () => {
    const candidat = candidatDepuisJourney(
      journey([
        sectionTrain(),
        sectionTrain({
          display_informations: {
            network: 'Réseau local',
            physical_mode: 'physical_mode:Bus',
          },
        }),
      ]),
      CONTEXTE
    );

    expect(
      candidat?.sections.map((section) =>
        section.nature === 'transport_public' ? section.mode : section.nature
      )
    ).toEqual(['train', 'bus']);
  });

  it('conserve un trajet qui passe minuit avec ses dates locales complètes', () => {
    const candidat = candidatDepuisJourney(
      journey(
        [
          sectionTrain({
            departure_date_time: '20260801T233000',
            arrival_date_time: '20260802T011500',
          }),
        ],
        {
          departure_date_time: '20260801T233000',
          arrival_date_time: '20260802T011500',
        }
      ),
      CONTEXTE
    );

    expect(candidat?.departLocal).toBe('2026-08-01T23:30:00');
    expect(candidat?.arriveeLocale).toBe('2026-08-02T01:15:00');
  });

  it('applique le fuseau de contexte aux deux extrémités sans en déduire un instant', () => {
    const candidat = candidatDepuisJourney(
      journey([
        sectionTrain({
          to: extremite('stop_area:SNCF:8727100', 'Londres', 'Europe/London'),
        }),
      ]),
      { ...CONTEXTE, fuseauIana: 'Europe/Paris' }
    );

    // Le fuseau imbriqué (Europe/London) est ignoré : seul context.timezone fait foi.
    expect(candidat?.origine.fuseauIana).toBe('Europe/Paris');
    expect(candidat?.destination.fuseauIana).toBe('Europe/Paris');
    expect(candidat?.departLocal).not.toMatch(/Z|[+-]\d{2}:\d{2}$/u);
    expect(candidat?.arriveeLocale).not.toMatch(/Z|[+-]\d{2}:\d{2}$/u);
  });

  it('reflète le fuseau de contexte demandé, quel que soit celui imbriqué', () => {
    const candidat = candidatDepuisJourney(journey(), {
      ...CONTEXTE,
      fuseauIana: 'UTC',
    });

    expect(candidat?.origine.fuseauIana).toBe('UTC');
    expect(candidat?.destination.fuseauIana).toBe('UTC');
  });

  it('conserve la fraîcheur temps réel telle qu’elle a été demandée', () => {
    const candidat = candidatDepuisJourney(journey(), {
      ...CONTEXTE,
      fraicheur: 'realtime',
    });

    expect(candidat?.fraicheur).toBe('realtime');
  });

  it('rend une signature déterministe et distincte selon la fraîcheur', () => {
    const theorique = candidatDepuisJourney(journey(), CONTEXTE);
    const memeTheorique = candidatDepuisJourney(journey(), CONTEXTE);
    const tempsReel = candidatDepuisJourney(journey(), {
      ...CONTEXTE,
      fraicheur: 'realtime',
    });

    expect(theorique?.signature).toBe(memeTheorique?.signature);
    expect(theorique?.signature).not.toBe(tempsReel?.signature);
  });

  it('distingue deux itinéraires par leur séquence de sections', () => {
    const direct = candidatDepuisJourney(journey(), CONTEXTE);
    const autreLigne = candidatDepuisJourney(
      journey([
        sectionTrain({
          display_informations: {
            network: 'SNCF',
            physical_mode: 'physical_mode:LongDistanceTrain',
            code: '8420',
          },
        }),
      ]),
      CONTEXTE
    );

    expect(direct?.signature).not.toBe(autreLigne?.signature);
  });
});

describe('candidatDepuisJourney — hors cible et refus', () => {
  it.each([
    ['physical_mode:Bus'],
    ['physical_mode:Metro'],
    ['physical_mode:Tramway'],
  ])('ignore un itinéraire sans train (%s)', (modePhysique) => {
    const resultat = candidatDepuisJourney(
      journey([
        sectionTrain({
          display_informations: { physical_mode: modePhysique },
        }),
      ]),
      CONTEXTE
    );

    expect(resultat).toBeUndefined();
  });

  it('ignore un itinéraire entièrement à pied', () => {
    expect(
      candidatDepuisJourney(journey([sectionMarche()]), CONTEXTE)
    ).toBeUndefined();
  });

  it('ne transforme jamais un transfert ou une attente en train', () => {
    expect(
      candidatDepuisJourney(
        journey([
          { type: 'transfer', duration: 600 },
          { type: 'waiting', duration: 300 },
        ]),
        CONTEXTE
      )
    ).toBeUndefined();
  });

  it.each([
    [
      'un stop_point sans stop_area',
      { from: { embedded_type: 'stop_point', stop_point: {} } },
    ],
    ['une extrémité absente', { to: undefined }],
    ['un mode physique absent', { display_informations: { network: 'SNCF' } }],
    ['des informations d’affichage absentes', { display_informations: undefined }],
    ['un départ de section absent', { departure_date_time: undefined }],
    ['une arrivée de section absente', { arrival_date_time: undefined }],
  ])('refuse une section ferroviaire avec %s', (_libelle, complement) => {
    const brut = journeyBrut([sectionTrain(complement)]);
    const valide = JourneyNavitiaSchema.safeParse(brut);

    const resultat = valide.success
      ? candidatDepuisJourney(valide.data, CONTEXTE)
      : null;

    expect(resultat).toBeNull();
  });

  it('accepte une extrémité dont le stop_area n’expose aucun fuseau imbriqué', () => {
    // Le fuseau vient de context.timezone, pas de l'extrémité : son absence
    // ici n'est plus un défaut.
    const candidat = candidatDepuisJourney(
      journey([
        sectionTrain({
          from: {
            embedded_type: 'stop_point',
            stop_point: {
              stop_area: { id: 'stop_area:X', name: 'Sans fuseau imbriqué' },
            },
          },
        }),
      ]),
      CONTEXTE
    );

    expect(candidat?.origine.fuseauIana).toBe('Europe/Paris');
  });

  it('refuse le candidat quand le fuseau de contexte transmis est invalide', () => {
    expect(
      candidatDepuisJourney(journey(), { ...CONTEXTE, fuseauIana: '+02:00' })
    ).toBeNull();
  });
});

describe('CandidatTrajetFerroviaireNavitiaSchema — ce qu’un candidat ne porte pas', () => {
  const candidatValide = () =>
    CandidatTrajetFerroviaireNavitiaSchema.parse(
      candidatDepuisJourney(journey(), CONTEXTE)
    );

  it('accepte le candidat de référence', () => {
    expect(candidatValide().fournisseur).toBe('Navitia');
  });

  it.each([
    ['un prix', { prix: 59 }],
    ['une devise', { devise: 'EUR' }],
    ['une disponibilité', { disponible: true }],
    ['une réservation', { reservation: { lienExterne: 'https://x.test' } }],
    ['un lien', { lienExterne: 'https://x.test' }],
    ['un niveau de confiance', { niveau: 'verifie' }],
    ['un score', { score: 0.9 }],
    ['un statut commercial', { statutCommercial: 'vendable' }],
    ['un instant absolu', { departInstant: '2026-08-01T06:00:00Z' }],
  ])('refuse un candidat portant %s', (_libelle, complement) => {
    expect(
      CandidatTrajetFerroviaireNavitiaSchema.safeParse({
        ...candidatValide(),
        ...complement,
      }).success
    ).toBe(false);
  });

  it.each([
    ['un départ avec Z', '2026-08-01T08:00:00Z'],
    ['un départ avec décalage', '2026-08-01T08:00:00+02:00'],
    ['un départ au format compact', '20260801T080000'],
  ])('refuse %s dans le candidat', (_libelle, departLocal) => {
    expect(
      CandidatTrajetFerroviaireNavitiaSchema.safeParse({
        ...candidatValide(),
        departLocal,
      }).success
    ).toBe(false);
  });
});

describe('ReponseJourneysNavitiaSchema — enveloppe', () => {
  it('accepte une réponse minimale valide', () => {
    expect(
      ReponseJourneysNavitiaSchema.safeParse({ journeys: [journeyBrut()] })
        .success
    ).toBe(true);
  });

  it('accepte une absence de solution déclarée par le fournisseur', () => {
    const valide = ReponseJourneysNavitiaSchema.safeParse({
      error: { id: 'no_solution', message: 'no solution found' },
    });

    expect(valide.success && valide.data.error?.id).toBe('no_solution');
  });

  it.each([
    ['Europe/Paris', 'Europe/Paris'],
    ['UTC', 'UTC'],
    ['un alias canonisé', 'Etc/UTC'],
  ])('accepte un contexte de fuseau %s', (_libelle, timezone) => {
    expect(
      ReponseJourneysNavitiaSchema.safeParse({
        journeys: [journeyBrut()],
        context: { timezone },
      }).success
    ).toBe(true);
  });

  it.each([
    ['un décalage seul', '+02:00'],
    ['une zone inconnue', 'Zone/Inconnue'],
    ['un fuseau vide', ''],
  ])('refuse un contexte de fuseau %s', (_libelle, timezone) => {
    expect(
      ReponseJourneysNavitiaSchema.safeParse({
        journeys: [journeyBrut()],
        context: { timezone },
      }).success
    ).toBe(false);
  });

  it('ignore les champs Navitia non consommés sans les rendre', () => {
    const valide = ReponseJourneysNavitiaSchema.safeParse({
      journeys: [{ ...journeyBrut(), type: 'best', tags: ['ecologic'] }],
      links: [],
    });

    expect(valide.success).toBe(true);
    expect(valide.success && 'type' in valide.data.journeys![0]).toBe(false);
    expect(valide.success && 'links' in valide.data).toBe(false);
  });

  it.each([
    ['des journeys non listés', { journeys: {} }],
    ['un journey sans sections', { journeys: [{ ...journeyBrut(), sections: [] }] }],
    [
      'une durée non entière',
      { journeys: [{ ...journeyBrut(), duration: 12.5 }] },
    ],
    [
      'une durée négative',
      { journeys: [{ ...journeyBrut(), duration: -1 }] },
    ],
    [
      'un nombre de correspondances négatif',
      { journeys: [{ ...journeyBrut(), nb_transfers: -1 }] },
    ],
    [
      'une date de départ invalide',
      { journeys: [{ ...journeyBrut(), departure_date_time: '2026-08-01' }] },
    ],
    [
      'une section sans type',
      { journeys: [journeyBrut([{ duration: 60 }])] },
    ],
  ])('refuse %s', (_libelle, contenu) => {
    expect(ReponseJourneysNavitiaSchema.safeParse(contenu).success).toBe(false);
  });
});
