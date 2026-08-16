import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { EtatChargement, EtatErreur, EtatVide } from '../components/ui/Etats'
import { Bouton } from '../components/ui/Bouton'
import { listerParcours, supprimerParcours } from '../lib/api'

// Visibilité : texte explicite + petite icône. L'accent reste NEUTRE (surface
// sable), pour ne pas se confondre avec les couleurs de confiance
// (vérifié/estimé/suggestion). La distinction se fait par le mot et l'icône.
type Visibilite = 'prive' | 'partage' | 'surprise'
type PresentationVisibilite = { libelle: string; icone: (p: { className?: string }) => JSX.Element }
const VISIBILITE: Record<Visibilite, PresentationVisibilite> = {
  prive: { libelle: 'Privé', icone: IconeCadenas },
  partage: { libelle: 'Partagé', icone: IconeGroupe },
  surprise: { libelle: 'Surprise', icone: IconeCadeau },
}
// Une visibilité inconnue n'est JAMAIS présentée comme « Privé » : on l'annonce
// honnêtement, sans exposer la valeur interne ni afficher le cadenas.
const VISIBILITE_INCONNUE: PresentationVisibilite = { libelle: 'Visibilité inconnue', icone: IconeInconnu }

export default function MesParcours() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['parcours'], queryFn: listerParcours })

  const suppression = useMutation({
    mutationFn: supprimerParcours,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parcours'] })
      toast.success('Parcours supprimé')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const liste = data?.parcours ?? []

  return (
    <PageLayout>
      <Seo title="Mes parcours — Experience AI" />
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="label-champ">Ta bibliothèque</p>
          <h1 className="titre-page mt-1">Mes parcours</h1>
        </div>
        <Link to="/" className="btn-primaire text-sm whitespace-nowrap">Nouvelle envie</Link>
      </div>

      {isLoading && <EtatChargement nombre={3} hauteur="h-16" />}

      {/* Une panne de chargement n'est jamais présentée comme une liste vide. */}
      {isError && (
        <EtatErreur
          titre="Impossible de charger tes parcours"
          description="Un souci technique passager. Réessaie dans un instant."
          action={<Bouton variante="secondaire" onClick={() => refetch()}>Réessayer</Bouton>}
        />
      )}

      {/* L'état vide n'apparaît qu'après une réponse réussie réellement vide. */}
      {!isLoading && !isError && liste.length === 0 && (
        <EtatVide
          titre="Aucun parcours pour l'instant"
          description="Dis-nous ce que tu as envie de vivre, on construit le reste."
          action={<Link to="/" className="btn-primaire inline-block">Commencer</Link>}
        />
      )}

      {!isError && liste.length > 0 && (
        <ul className="border-y border-sable divide-y divide-sable">
          {liste.map((p) => {
            const visibilite = VISIBILITE[(p.visibilite as Visibilite)] ?? VISIBILITE_INCONNUE
            return (
              <li key={p.id} className="py-4 flex items-start gap-4 group">
                <Link to={`/parcours/${p.id}`} className="flex-1 min-w-0 cursor-pointer">
                  {/* Intention en entier — c'est l'information n°1, jamais tronquée */}
                  <p className="font-heading font-semibold text-encre text-[15px] leading-snug group-hover:text-terracotta-dark transition-colors">
                    {p.intention}
                  </p>
                  <p className="text-xs text-brume mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sable/60 text-encre px-2 py-0.5 font-medium">
                      <visibilite.icone className="shrink-0" />
                      {visibilite.libelle}
                    </span>
                    <span>mis à jour le {new Date(p.misAJourLe).toLocaleDateString('fr-FR')}</span>
                  </p>
                </Link>

                <Link
                  to={`/parcours/${p.id}`}
                  className="btn-secondaire text-sm whitespace-nowrap shrink-0 self-center"
                >
                  Ouvrir
                </Link>
                <button
                  onClick={() => { if (window.confirm('Supprimer ce parcours ?')) suppression.mutate(p.id) }}
                  aria-label={`Supprimer le parcours ${p.intention}`}
                  className="w-11 h-11 rounded-xl text-brume hover:text-corail hover:bg-corail/5
                             transition-colors flex items-center justify-center cursor-pointer shrink-0 self-center"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </PageLayout>
  )
}

function IconeCadenas({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function IconeGroupe({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function IconeInconnu({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" /><line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  )
}
function IconeCadeau({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  )
}
