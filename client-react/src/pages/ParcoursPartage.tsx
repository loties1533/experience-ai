import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import AvisGroupe from '../components/AvisGroupe'
import { BadgeConfiance, LienExterneElement, LienRechercheHebergement, LienRechercheTransport } from '../components/ConfianceElement'
import {
  chargerParcoursPartage, reagirSurElement,
  type Avis, type Element,
} from '../lib/api'

// Le parcours vu par un membre du groupe, sans compte. Il consulte et donne
// son avis — c'est tout : aucune action de modification n'existe ici, et le
// serveur les refuserait de toute façon (un jeton n'est pas un compte).

const LIBELLES_TYPE: Record<Element['type'], string> = {
  activite: 'Activité',
  restaurant: 'Restaurant',
  sortie: 'Sortie',
  transport: 'Transport',
  hebergement: 'Hébergement',
  evenement: 'Événement',
  temps_libre: 'Temps libre',
}

export default function ParcoursPartage() {
  const { jeton } = useParams<{ jeton: string }>()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['partage-consulte', jeton],
    queryFn: () => chargerParcoursPartage(jeton as string),
    enabled: Boolean(jeton),
    retry: false,
  })

  const reaction = useMutation({
    mutationFn: ({ elementId, avis }: { elementId: string; avis: Avis }) =>
      reagirSurElement(jeton as string, elementId, avis),
    onSuccess: (reponse) => {
      queryClient.setQueryData(['partage-consulte', jeton], {
        parcours: reponse.parcours,
        participant: data?.participant,
      })
      toast.success(reponse.description)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  if (isLoading) {
    return (
      <PageLayout>
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>
      </PageLayout>
    )
  }

  // Lien inconnu, révoqué, parcours redevenu privé, ou surprise dont on est le
  // héros : le serveur répond la même chose dans tous les cas, et nous aussi.
  if (error || !data) {
    return (
      <PageLayout>
        <div className="carte p-10 text-center">
          <p className="font-heading font-semibold text-encre">Ce lien n'est plus valide</p>
          <p className="text-brume text-sm mt-2">Demandez-en un nouveau à la personne qui organise.</p>
        </div>
      </PageLayout>
    )
  }

  const { parcours, participant } = data
  const monAvis = (element: Element) =>
    element.reactions.find((r) => r.participantId === participant.id)?.avis

  return (
    <PageLayout>
      <Seo title={`${parcours.intention.texte} — Experience AI`} />

      <header className="mb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-lagon-dark">Le parcours du groupe</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-encre mt-1">{parcours.intention.texte}</h1>
        <p className="text-brume text-sm mt-2">
          {parcours.contexte.avecQui} · {parcours.contexte.duree.valeur} {parcours.contexte.duree.unite}
          {parcours.contexte.dates && (
            <> · du {new Date(parcours.contexte.dates.debut).toLocaleDateString('fr-FR')}
              {' '}au {new Date(parcours.contexte.dates.fin).toLocaleDateString('fr-FR')}</>
          )}
          {parcours.contexte.lieux.length > 0 && <> · {parcours.contexte.lieux.join(', ')}</>}
        </p>
        <p className="text-sm text-encre mt-3 rounded-xl bg-lagon/10 px-4 py-3">
          Vous consultez ce parcours en tant que <strong>{participant.nom}</strong>. Dites ce que vous en pensez :
          c'est {parcours.participants.find((p) => p.role === 'organisateur')?.nom ?? "l'organisateur"} qui tranche.
        </p>
      </header>

      <ol className="space-y-6">
        {parcours.timeline.map((moment, index) => (
          <li key={moment.id} className="carte p-5">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="w-7 h-7 rounded-full bg-lagon/10 text-lagon-dark font-heading font-bold text-sm
                               flex items-center justify-center shrink-0">{index + 1}</span>
              <h2 className="font-heading font-semibold text-lg text-encre">{moment.titre}</h2>
            </div>

            <ul className="space-y-3">
              {moment.elements.map((element) => (
                <li key={element.id} className="rounded-xl border border-encre/10 bg-white p-4">
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-start gap-2">
                    <div className="w-full sm:w-auto sm:flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-brume">
                          {LIBELLES_TYPE[element.type]}
                        </span>
                        <BadgeConfiance element={element} />
                      </div>
                      <p className="font-semibold text-encre mt-1">{element.nom}</p>
                      <p className="text-xs text-brume mt-0.5">
                        {element.lieu}
                        {element.prix !== undefined && (
                          <> · {element.prix} €{element.prixEstime && ' estimés'}</>
                        )}
                      </p>
                      <LienExterneElement element={element} />
                      <LienRechercheHebergement element={element} />
                      <LienRechercheTransport element={element} />
                      <p className="text-sm text-encre-light mt-2 italic">« {element.justification} »</p>
                      <AvisGroupe parcours={parcours} element={element} />
                    </div>

                    <div className="flex gap-2 shrink-0" role="group" aria-label={`Votre avis sur ${element.nom}`}>
                      {(['pour', 'contre'] as const).map((avis) => (
                        <button
                          key={avis}
                          className={`btn-secondaire min-h-[44px] text-xs ${
                            monAvis(element) === avis ? '!border-soleil !text-soleil font-bold' : ''
                          }`}
                          aria-pressed={monAvis(element) === avis}
                          disabled={reaction.isPending}
                          onClick={() => reaction.mutate({ elementId: element.id, avis })}
                        >
                          {avis === 'pour' ? 'Pour' : 'Contre'}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </PageLayout>
  )
}
