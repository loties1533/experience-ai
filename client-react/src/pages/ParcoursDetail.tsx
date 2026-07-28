import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import AvisGroupe from '../components/AvisGroupe'
import { BadgeConfiance, LibelleLien, libelleLien } from '../components/ConfianceElement'
import PanneauPartage from '../components/PanneauPartage'
import {
  chargerParcours, modifierParcours,
  type Parcours, type Element, type DemandeSurElement,
} from '../lib/api'

// La boucle qui fait la valeur (doc 05, étapes 6 ↔ 7) : explorer moment par
// moment, et modifier élément par élément — jamais tout d'un coup.

const LIBELLES_TYPE: Record<Element['type'], string> = {
  activite: 'Activité',
  restaurant: 'Restaurant',
  sortie: 'Sortie',
  transport: 'Transport',
  hebergement: 'Hébergement',
  evenement: 'Événement',
  temps_libre: 'Temps libre',
}

export default function ParcoursDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [phrase, setPhrase] = useState('')
  const [aRegenerer, setARegenerer] = useState<string[]>([])

  const { data, isLoading, error } = useQuery({
    queryKey: ['parcours', id],
    queryFn: () => chargerParcours(id as string),
    enabled: Boolean(id),
  })

  const modification = useMutation({
    mutationFn: (corps: { demande: DemandeSurElement } | { phrase: string }) =>
      modifierParcours(id as string, corps),
    onSuccess: (reponse) => {
      queryClient.setQueryData(['parcours', id], { parcours: reponse.parcours })
      queryClient.invalidateQueries({ queryKey: ['parcours'] })
      setARegenerer(reponse.elementsARegenerer)
      setPhrase('')
      toast.success(reponse.description)
      if (reponse.elementsARegenerer.length > 0) {
        toast.info(`${reponse.elementsARegenerer.length} élément(s) dépendant(s) à revoir`)
      }
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const changerStatut = (elementId: string, statut: 'accepte' | 'a_remplacer') =>
    modification.mutate({ demande: { type: 'changer_statut', elementId, statut } })

  const supprimerElement = (element: Element) => {
    if (window.confirm(`Retirer « ${element.nom} » du parcours ?`)) {
      modification.mutate({ demande: { type: 'supprimer_element', elementId: element.id } })
    }
  }

  if (isLoading) {
    return (
      <PageLayout>
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>
      </PageLayout>
    )
  }

  if (error || !data) {
    return (
      <PageLayout>
        <div className="carte p-10 text-center">
          <p className="font-heading font-semibold text-encre">Parcours introuvable</p>
          <Link to="/parcours" className="btn-secondaire inline-block mt-4">Retour à mes parcours</Link>
        </div>
      </PageLayout>
    )
  }

  const parcours: Parcours = data.parcours

  return (
    <PageLayout>
      <Seo title={`${parcours.intention.texte} — Experience AI`} />

      {/* En-tête : l'intention d'abord, toujours */}
      <header className="mb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-lagon-dark">Ton parcours</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-encre mt-1">{parcours.intention.texte}</h1>
        <p className="text-brume text-sm mt-2">
          {parcours.contexte.avecQui} · {parcours.contexte.duree.valeur} {parcours.contexte.duree.unite}
          {/* Les dates ne s'affichent que si le parcours en a de vraies */}
          {parcours.contexte.dates && (
            <> · du {new Date(parcours.contexte.dates.debut).toLocaleDateString('fr-FR')}
              {' '}au {new Date(parcours.contexte.dates.fin).toLocaleDateString('fr-FR')}</>
          )}
          {parcours.contexte.lieux.length > 0 && <> · {parcours.contexte.lieux.join(', ')}</>}
          {parcours.ambiance && <> · ambiance {parcours.ambiance}</>}
          {parcours.budget.montantTotal !== undefined && <> · ~{parcours.budget.montantTotal} €</>}
        </p>
      </header>

      {/* Timeline des moments */}
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
                <li key={element.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    aRegenerer.includes(element.id) ? 'border-soleil bg-soleil/5' : 'border-encre/10 bg-white'
                  }`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-brume">
                          {LIBELLES_TYPE[element.type]}
                        </span>
                        {element.estAncre && <span className="badge-statut bg-lagon/10 text-lagon-dark">Ancre</span>}
                        <BadgeConfiance element={element} />
                        {element.statut === 'accepte' && <span className="badge-accepte">Accepté</span>}
                        {element.statut === 'propose' && <span className="badge-propose">Proposé</span>}
                        {element.statut === 'a_remplacer' && <span className="badge-a-remplacer">À remplacer</span>}
                        {aRegenerer.includes(element.id) && <span className="badge-a-remplacer">À revoir</span>}
                      </div>
                      <p className="font-semibold text-encre mt-1">{element.nom}</p>
                      <p className="text-xs text-brume mt-0.5">
                        {element.lieu}
                        {element.prix !== undefined && (
                          <> · {element.prix} €{element.prixEstime && ' estimés'}</>
                        )}
                      </p>
                      {/* Un vrai lieu, trouvé pour ce parcours : on y conduit, on ne vend rien */}
                      {element.reservation && (
                        <a href={element.reservation.lienExterne} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center min-h-[44px] text-xs text-lagon-dark underline underline-offset-2 hover:text-lagon"
                          aria-label={`${libelleLien(element)} pour ${element.nom} (nouvel onglet)`}>
                          <LibelleLien element={element} />
                        </a>
                      )}
                      {/* La justification : la cohérence visible (Constitution #4) */}
                      <p className="text-sm text-encre-light mt-2 italic">« {element.justification} »</p>
                      {/* Ce que le groupe en pense — ça éclaire, ça ne décide pas */}
                      <AvisGroupe parcours={parcours} element={element} />
                    </div>

                    {/* L'utilisateur garde le dernier mot (Constitution #6) */}
                    <div className="flex flex-wrap gap-2 shrink-0" role="group" aria-label={`Actions pour ${element.nom}`}>
                      {element.statut !== 'accepte' && (
                        <button className="btn-secondaire min-h-[44px] text-xs"
                          onClick={() => changerStatut(element.id, 'accepte')} disabled={modification.isPending}>
                          Accepter
                        </button>
                      )}
                      {element.statut !== 'a_remplacer' && element.type !== 'temps_libre' && (
                        <button className="btn-secondaire min-h-[44px] text-xs"
                          onClick={() => changerStatut(element.id, 'a_remplacer')} disabled={modification.isPending}>
                          À remplacer
                        </button>
                      )}
                      <button
                        className="btn-secondaire min-h-[44px] text-xs !text-corail hover:!border-corail"
                        onClick={() => supprimerElement(element)} disabled={modification.isPending}>
                        Retirer
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/* Modification en langage naturel — l'agent traduit, le domaine décide */}
      <form
        className="sticky bottom-4 mt-8 carte p-3 flex gap-2 shadow-card-lg"
        onSubmit={(e) => { e.preventDefault(); if (phrase.trim()) modification.mutate({ phrase }) }}
      >
        <label htmlFor="modif" className="sr-only">Demander une modification</label>
        <input
          id="modif"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder='Ex. : « change le resto du moment 2, plutôt italien »'
          className="flex-1 px-4 py-2.5 rounded-xl border border-encre/15 bg-white text-encre
                     placeholder:text-brume transition-colors
                     focus:border-soleil focus:outline-none focus:ring-2 focus:ring-soleil/25"
          maxLength={500}
        />
        <button type="submit" className="btn-primaire !py-2.5" disabled={modification.isPending || !phrase.trim()}>
          {modification.isPending ? 'Modification…' : 'Modifier'}
        </button>
      </form>

      {/* Partager au groupe pour pouvoir décider ensemble (doc 07) */}
      <PanneauPartage parcoursId={parcours.id} />

      {/* Historique */}
      {parcours.historique.length > 0 && (
        <details className="mt-6">
          <summary className="text-sm text-brume cursor-pointer hover:text-encre">
            Historique des modifications ({parcours.historique.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-encre-light">
            {[...parcours.historique].reverse().map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brume shrink-0">{new Date(m.date).toLocaleString('fr-FR')}</span>
                <span>{m.description}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </PageLayout>
  )
}
