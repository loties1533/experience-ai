import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import AvisGroupe from '../components/AvisGroupe'
import { BadgeConfiance, ProvenanceElement, LienExterneElement, LienRechercheHebergement, LienRechercheTransport } from '../components/ConfianceElement'
import PanneauPartage from '../components/PanneauPartage'
import { Bouton } from '../components/ui/Bouton'
import { BanniereStatutMetier } from '../components/ui/StatutMetier'
import { EtatChargement, EtatErreur } from '../components/ui/Etats'
import {
  chargerParcours, modifierParcours,
  type Parcours, type Element, type DemandeSurElementClient,
} from '../lib/api'
import { statutMetierDepuisErreur } from '../lib/erreurAffichage'

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

const LIBELLES_AVEC_QUI: Record<'solo' | 'couple' | 'famille' | 'amis' | 'groupe', string> = {
  solo: 'Solo', couple: 'En couple', famille: 'En famille', amis: 'Entre amis', groupe: 'En groupe',
}
const UNITE_SINGULIER: Record<'heures' | 'jours' | 'semaines', string> = {
  heures: 'heure', jours: 'jour', semaines: 'semaine',
}

function formaterDuree(d: { valeur: number; unite: 'heures' | 'jours' | 'semaines' }): string {
  return `${d.valeur} ${d.valeur === 1 ? UNITE_SINGULIER[d.unite] : d.unite}`
}

// Formatage déterministe et sans fuseau : on lit la date/heure telles que le
// serveur les a stockées, sans jamais fabriquer ni calculer une valeur absente.
const jourFr = (iso: string) => { const [a, m, j] = iso.slice(0, 10).split('-'); return `${j}/${m}/${a}` }
const heureFr = (iso: string) => iso.slice(11, 16).replace(':', 'h')
const memeJour = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10)

function formaterPlage(p: { debut: string; fin: string }): string {
  return memeJour(p.debut, p.fin)
    ? `le ${jourFr(p.debut)}, ${heureFr(p.debut)}–${heureFr(p.fin)}`
    : `du ${jourFr(p.debut)} au ${jourFr(p.fin)}`
}

// Contexte reformulé : uniquement les champs réellement présents, libellés
// français déterministes, aucune donnée déduite ni ajoutée.
function construireContexte(parcours: Parcours): string[] {
  const segments: string[] = []
  if (parcours.contexte.avecQui) segments.push(LIBELLES_AVEC_QUI[parcours.contexte.avecQui])
  if (parcours.contexte.duree) segments.push(formaterDuree(parcours.contexte.duree))
  if (parcours.contexte.dates) segments.push(`du ${jourFr(parcours.contexte.dates.debut)} au ${jourFr(parcours.contexte.dates.fin)}`)
  if (parcours.contexte.lieux.length > 0) segments.push(parcours.contexte.lieux.join(', '))
  if (parcours.ambiance) segments.push(`ambiance ${parcours.ambiance}`)
  return segments
}

export default function ParcoursDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [phrase, setPhrase] = useState('')
  const [aRegenerer, setARegenerer] = useState<string[]>([])
  const [erreurModification, setErreurModification] = useState<{ statut: 'refus' | 'indisponible'; message: string } | null>(null)
  const [derniereModification, setDerniereModification] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['parcours', id],
    queryFn: () => chargerParcours(id as string),
    enabled: Boolean(id),
  })

  const modification = useMutation({
    mutationFn: (corps: { demande: DemandeSurElementClient } | { phrase: string }) =>
      modifierParcours(id as string, corps),
    onSuccess: (reponse) => {
      queryClient.setQueryData(['parcours', id], { parcours: reponse.parcours })
      queryClient.invalidateQueries({ queryKey: ['parcours'] })
      setARegenerer(reponse.elementsARegenerer)
      setPhrase('')
      setErreurModification(null)
      setDerniereModification(reponse.description)
      toast.success(reponse.description)
    },
    onError: (e) => {
      const statut = statutMetierDepuisErreur(e)
      if (statut) {
        setErreurModification({ statut, message: (e as Error).message })
      } else {
        toast.error((e as Error).message)
      }
    },
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
        <EtatChargement nombre={3} hauteur="h-28" />
      </PageLayout>
    )
  }

  if (error || !data) {
    return (
      <PageLayout>
        <EtatErreur
          titre="Parcours introuvable"
          action={<Link to="/parcours" className="btn-secondaire inline-block">Retour à mes parcours</Link>}
        />
      </PageLayout>
    )
  }

  const parcours: Parcours = data.parcours

  return (
    <PageLayout>
      <Seo title={`${parcours.intention.texte} — Experience AI`} />

      {/* En-tête : l'intention d'abord, toujours */}
      <header className="mb-6">
        <p className="label-champ">Ton parcours</p>
        <h1 className="titre-page mt-1">{parcours.intention.texte}</h1>
        <p className="texte-secondaire mt-2">{construireContexte(parcours).join(' · ')}</p>
      </header>

      <BlocBudget parcours={parcours} />

      {/* Timeline des moments — sections éditoriales, pas des cartes empilées */}
      {parcours.timeline.length === 0 ? (
        <p className="text-sm text-brume italic">Ce parcours n'a pas encore de moment.</p>
      ) : (
        <ol className="space-y-10">
          {parcours.timeline.map((moment, index) => (
            <li key={moment.id}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4 pb-3 border-b border-sable">
                <span className="w-7 h-7 rounded-full bg-laiton/10 text-laiton-dark font-heading font-bold text-sm
                                 flex items-center justify-center shrink-0">{index + 1}</span>
                <h2 className="titre-section">{moment.titre}</h2>
                {moment.plage && <span className="micro-copie">{formaterPlage(moment.plage)}</span>}
              </div>

              {moment.elements.length === 0 ? (
                <p className="text-sm text-brume italic pl-10">Ce moment n'a pas encore d'élément.</p>
              ) : (
                <ul className="space-y-3">
                  {moment.elements.map((element) => {
                    const logistique = element.type === 'transport' || element.type === 'hebergement'
                    const tempsLibre = element.type === 'temps_libre'
                    const aRevoir = aRegenerer.includes(element.id)
                    // Plage d'élément : affichée seulement si présente ET non redondante avec celle du moment.
                    const plageRedondante = !!(moment.plage && element.plage &&
                      moment.plage.debut === element.plage.debut && moment.plage.fin === element.plage.fin)
                    const filet = aRevoir
                      ? 'border-l-terracotta'
                      : logistique ? 'border-l-laiton/70' : tempsLibre ? 'border-l-sable-dark' : 'border-l-terracotta/50'
                    const surface = aRevoir
                      ? 'bg-terracotta/5 border-terracotta/30'
                      : tempsLibre ? 'bg-ivoire border-sable/70' : 'bg-creme border-sable/70'
                    return (
                      <li key={element.id} className={`rounded-xl border border-l-4 p-4 ${filet} ${surface}`}>
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-start gap-2">
                          {/* Identité + statut de confiance — lisible en un coup d'œil */}
                          <div className="w-full sm:w-auto sm:flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-brume">
                                {LIBELLES_TYPE[element.type]}
                              </span>
                              {element.estAncre && <span className="badge-statut bg-laiton/10 text-laiton-dark">Ancre</span>}
                              <BadgeConfiance element={element} />
                              {element.statut === 'accepte' && <span className="badge-accepte">Accepté</span>}
                              {element.statut === 'propose' && <span className="badge-propose">Proposé</span>}
                              {element.statut === 'a_remplacer' && <span className="badge-a-remplacer">À remplacer</span>}
                              {aRevoir && <span className="badge-a-remplacer">À revoir</span>}
                            </div>
                            <p className="font-semibold text-encre mt-1">{element.nom}</p>
                            <p className="text-xs text-brume mt-0.5">
                              {element.type === 'hebergement' && element.sejourHebergement ? (
                                <>{element.sejourHebergement.ville} · du{' '}
                                  {jourFr(element.sejourHebergement.arrivee)} au{' '}
                                  {jourFr(element.sejourHebergement.depart)}</>
                              ) : (
                                element.lieu
                              )}
                              {element.plage && !plageRedondante && <> · {formaterPlage(element.plage)}</>}
                              {element.prix !== undefined && (
                                <> · {element.prix} €{element.prixEstime && ' estimés'}</>
                              )}
                            </p>

                            {/* Détail secondaire, replié par défaut : provenance, liens, justification,
                                avis, et l'action destructive Retirer. Ouvert d'office sur « À revoir ». */}
                            <details className="mt-2" open={aRevoir}>
                              <summary className="text-xs text-laiton-dark cursor-pointer select-none w-fit min-h-[44px] flex items-center">
                                Détails
                              </summary>
                              <div className="mt-1 space-y-2">
                                <ProvenanceElement element={element} />
                                <LienExterneElement element={element} />
                                <LienRechercheHebergement element={element} />
                                <LienRechercheTransport element={element} />
                                <p className="text-sm text-encre-light italic">« {element.justification} »</p>
                                {/* Ce que le groupe en pense — ça éclaire, ça ne décide pas */}
                                <AvisGroupe parcours={parcours} element={element} />
                                <div className="pt-1">
                                  <Bouton variante="danger" className="min-h-[44px] text-xs"
                                    onClick={() => supprimerElement(element)} disabled={modification.isPending}>
                                    Retirer du parcours
                                  </Bouton>
                                </div>
                              </div>
                            </details>
                          </div>

                          {/* L'utilisateur garde le dernier mot (Constitution #6) — Accepter mis en avant,
                              À remplacer plus discret ; Retirer vit dans les détails. */}
                          <div className="flex flex-wrap gap-2 shrink-0" role="group" aria-label={`Actions pour ${element.nom}`}>
                            {element.statut !== 'accepte' && (
                              <Bouton variante="secondaire" className="min-h-[44px] text-xs"
                                onClick={() => changerStatut(element.id, 'accepte')} disabled={modification.isPending}>
                                Accepter
                              </Bouton>
                            )}
                            {element.statut !== 'a_remplacer' && element.type !== 'temps_libre' && (
                              <Bouton variante="discret" className="min-h-[44px] text-xs"
                                onClick={() => changerStatut(element.id, 'a_remplacer')} disabled={modification.isPending}>
                                À remplacer
                              </Bouton>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Ce qui vient d'être modifié — reste affiché tant que l'utilisateur ne l'a pas fermé,
          contrairement au toast qui disparaît seul. */}
      {derniereModification && (
        <div className="mt-8 rounded-2xl border border-laiton/40 bg-creme p-4 flex items-start justify-between gap-3">
          <p className="text-sm text-encre">
            <span className="font-semibold">Dernière modification</span> — {derniereModification}
            {aRegenerer.length > 0 && (
              <span className="block text-brume text-xs mt-1">
                {aRegenerer.length} élément(s) dépendant(s) marqué(s) « À revoir » ci-dessus.
              </span>
            )}
          </p>
          <button
            onClick={() => setDerniereModification(null)}
            aria-label="Fermer cette information"
            className="text-brume hover:text-encre shrink-0 cursor-pointer w-8 h-8 flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Refus (422) ou panne technique (503) sur une modification — reste visible, ne disparaît pas comme un toast. */}
      {erreurModification && (
        <div className="mt-6">
          <BanniereStatutMetier
            statut={erreurModification.statut}
            action={
              <Bouton variante="secondaire" onClick={() => setErreurModification(null)}>
                Fermer
              </Bouton>
            }
          >
            {erreurModification.message}
          </BanniereStatutMetier>
        </div>
      )}

      {/* Modification en langage naturel — ancrée après la timeline (ni sticky ni fixed),
          pour ne rien recouvrir. L'agent traduit, le domaine décide. */}
      <section className="mt-10 pt-6 border-t border-sable">
        <p className="label-champ">Ajuster ce parcours</p>
        <p className="text-sm text-brume mt-1 mb-3">Dis en une phrase ce que tu veux changer — on s'occupe du reste.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (phrase.trim()) modification.mutate({ phrase }) }}
        >
          <label htmlFor="modif" className="sr-only">Demander une modification</label>
          <input
            id="modif"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder='Ex. : « change le resto du moment 2, plutôt italien »'
            className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-sable bg-white text-encre
                       placeholder:text-brume transition-colors
                       focus:border-laiton-dark focus:outline-none focus:ring-2 focus:ring-laiton/30"
            maxLength={500}
          />
          <Bouton type="submit" className="!py-3" disabled={!phrase.trim()}
            chargement={modification.isPending} texteChargement="Modification…">
            Modifier
          </Bouton>
        </form>
      </section>

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

const LIBELLES_MODE_BUDGET: Record<Parcours['budget']['mode'], string> = {
  individuel: 'par personne',
  partage: 'partagé',
}

/**
 * Lecture honnête du budget : le montant visé (saisi côté brief) et
 * l'estimation courante (somme des prix connus, avec le nombre d'éléments
 * réellement chiffrés) — jamais un total qui prétend inclure ce qui n'est
 * pas encore chiffré, jamais un « 0 € » pour dire « inconnu ». Présenté en
 * bandeau à filets, pas en carte.
 */
export function BlocBudget({ parcours }: { parcours: Parcours }) {
  const elements = parcours.timeline.flatMap((m) => m.elements)
  const chiffres = elements.filter((e) => e.prix !== undefined)
  const estimation = chiffres.reduce((total, e) => total + (e.prix ?? 0), 0)
  const nombreEstimes = chiffres.filter((e) => e.prixEstime).length

  return (
    <div className="border-y border-sable py-4 mb-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8">
      <div>
        <p className="label-champ">Budget visé</p>
        <p className="font-heading font-semibold text-encre mt-0.5">
          {parcours.budget.montantTotal !== undefined
            ? `${parcours.budget.montantTotal} ${parcours.budget.devise} · ${LIBELLES_MODE_BUDGET[parcours.budget.mode]}`
            : 'Non précisé'}
        </p>
      </div>
      <div className="h-px w-full sm:h-8 sm:w-px bg-sable" />
      <div>
        <p className="label-champ">Estimation à date</p>
        {chiffres.length > 0 ? (
          <p className="text-sm text-encre mt-0.5">
            ~{estimation} {parcours.budget.devise}
            <span className="text-brume">
              {' '}· {chiffres.length}/{elements.length} élément(s) chiffré(s)
              {nombreEstimes > 0 && `, dont ${nombreEstimes} estimé(s)`}
            </span>
          </p>
        ) : (
          <p className="text-sm text-brume mt-0.5">Aucune estimation disponible pour l'instant.</p>
        )}
      </div>
    </div>
  )
}
