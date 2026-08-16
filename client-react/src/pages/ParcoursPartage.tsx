import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import AvisGroupe from '../components/AvisGroupe'
import { EtatChargement } from '../components/ui/Etats'
import { BadgeConfiance, ProvenanceElement, LienExterneElement, LienRechercheHebergement, LienRechercheTransport } from '../components/ConfianceElement'
import {
  chargerParcoursPartage, reagirSurElement,
  type Avis, type Element, type Parcours,
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

// Formateurs LOCAUX (volontairement non mutualisés avec Envie/ParcoursDetail
// pour ne pas rouvrir UI-3/UI-4). Français, déterministes, sans fuseau déduit.
const LIBELLES_AVEC_QUI: Record<'solo' | 'couple' | 'famille' | 'amis' | 'groupe', string> = {
  solo: 'Solo', couple: 'En couple', famille: 'En famille', amis: 'Entre amis', groupe: 'En groupe',
}
const UNITE_SINGULIER: Record<'heures' | 'jours' | 'semaines', string> = {
  heures: 'heure', jours: 'jour', semaines: 'semaine',
}
function formaterDuree(d: { valeur: number; unite: 'heures' | 'jours' | 'semaines' }): string {
  return `${d.valeur} ${d.valeur === 1 ? UNITE_SINGULIER[d.unite] : d.unite}`
}
const jourFr = (iso: string) => { const [a, m, j] = iso.slice(0, 10).split('-'); return `${j}/${m}/${a}` }
const heureFr = (iso: string) => iso.slice(11, 16).replace(':', 'h')
const memeJour = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10)
function formaterPlage(p: { debut: string; fin: string }): string {
  return memeJour(p.debut, p.fin)
    ? `le ${jourFr(p.debut)}, ${heureFr(p.debut)}–${heureFr(p.fin)}`
    : `du ${jourFr(p.debut)} à ${heureFr(p.debut)} au ${jourFr(p.fin)} à ${heureFr(p.fin)}`
}
function construireContexte(parcours: Parcours): string[] {
  const segments: string[] = []
  if (parcours.contexte.avecQui) segments.push(LIBELLES_AVEC_QUI[parcours.contexte.avecQui])
  if (parcours.contexte.duree) segments.push(formaterDuree(parcours.contexte.duree))
  if (parcours.contexte.dates) segments.push(`du ${jourFr(parcours.contexte.dates.debut)} au ${jourFr(parcours.contexte.dates.fin)}`)
  if (parcours.contexte.lieux.length > 0) segments.push(parcours.contexte.lieux.join(', '))
  return segments
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
    // Message fixe : jamais le message technique brut, jamais un faux avis enregistré.
    onError: () => toast.error('Impossible d’enregistrer ton avis. Réessaie dans un instant.'),
  })

  if (isLoading) {
    return (
      <PageLayout>
        <Seo title="Parcours partagé" noindex />
        <EtatChargement nombre={3} hauteur="h-28" />
      </PageLayout>
    )
  }

  // Lien inconnu, révoqué, parcours redevenu privé, ou surprise dont on est le
  // héros : le serveur répond la même chose dans tous les cas, et nous aussi.
  if (error || !data) {
    return (
      <PageLayout>
        <Seo title="Parcours partagé" noindex />
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
  const organisateur = parcours.participants.find((p) => p.role === 'organisateur')?.nom ?? "l'organisateur"

  return (
    <PageLayout>
      <Seo title={`${parcours.intention.texte} — Experience AI`} noindex />

      <header className="mb-8">
        <p className="label-champ">Le parcours du groupe</p>
        <h1 className="titre-page mt-1">{parcours.intention.texte}</h1>
        <p className="texte-secondaire mt-2">{construireContexte(parcours).join(' · ')}</p>
        <p className="text-sm text-encre mt-3 rounded-2xl border border-laiton/30 bg-creme px-4 py-3">
          Vous consultez ce parcours en tant que <strong>{participant.nom}</strong>. Dites ce que vous en pensez :
          c'est {organisateur} qui tranche.
        </p>
      </header>

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
                    const plageRedondante = !!(moment.plage && element.plage &&
                      moment.plage.debut === element.plage.debut && moment.plage.fin === element.plage.fin)
                    const filet = logistique ? 'border-l-laiton/70' : tempsLibre ? 'border-l-sable-dark' : 'border-l-terracotta/50'
                    const surface = tempsLibre ? 'bg-ivoire border-sable/70' : 'bg-creme border-sable/70'
                    return (
                      <li key={element.id} className={`rounded-xl border border-l-4 p-4 ${filet} ${surface}`}>
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-start gap-2">
                          <div className="w-full sm:w-auto sm:flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-brume">
                                {LIBELLES_TYPE[element.type]}
                              </span>
                              {element.estAncre && <span className="badge-statut bg-laiton/10 text-laiton-dark">Ancre</span>}
                              <BadgeConfiance element={element} />
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

                            <details className="mt-2">
                              <summary className="text-xs text-laiton-dark cursor-pointer select-none w-fit min-h-[44px] flex items-center">
                                Détails
                              </summary>
                              <div className="mt-1 space-y-2">
                                <ProvenanceElement element={element} />
                                <LienExterneElement element={element} />
                                <LienRechercheHebergement element={element} />
                                <LienRechercheTransport element={element} />
                                <p className="text-sm text-encre-light italic">« {element.justification} »</p>
                                <AvisGroupe parcours={parcours} element={element} />
                              </div>
                            </details>
                          </div>

                          {/* Consultation seule : donner son avis, jamais modifier */}
                          <div className="flex gap-2 shrink-0" role="group" aria-label={`Votre avis sur ${element.nom}`}>
                            {(['pour', 'contre'] as const).map((avis) => (
                              <button
                                key={avis}
                                className={`btn-secondaire min-h-[44px] text-xs ${
                                  monAvis(element) === avis ? '!border-terracotta !text-terracotta-dark font-bold' : ''
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
                    )
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </PageLayout>
  )
}
