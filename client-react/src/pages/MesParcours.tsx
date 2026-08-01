import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { EtatChargement, EtatVide } from '../components/ui/Etats'
import { ImageContextuelle } from '../components/ui/ImageContextuelle'
import { listerParcours, supprimerParcours } from '../lib/api'

const LIBELLES_VISIBILITE: Record<string, string> = {
  prive: 'Privé',
  partage: 'Partagé',
  surprise: 'Surprise',
}

export default function MesParcours() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['parcours'], queryFn: listerParcours })

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-encre">Mes parcours</h1>
        <Link to="/" className="btn-primaire text-sm">Nouvelle envie</Link>
      </div>

      {isLoading && <EtatChargement nombre={3} hauteur="h-20" />}

      {!isLoading && liste.length === 0 && (
        <EtatVide
          titre="Aucun parcours pour l'instant"
          description="Dis-nous ce que tu as envie de vivre, on construit le reste."
          action={<Link to="/" className="btn-primaire inline-block">Commencer</Link>}
        />
      )}

      <ul className="space-y-3">
        {liste.map((p) => (
          <li key={p.id} className="carte p-3 sm:p-4 flex items-center gap-4 hover:shadow-card-lg transition-shadow">
            <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20" aria-hidden="true">
              <ImageContextuelle alt="" ratio="vignette" className="w-full h-full" />
            </div>
            <Link to={`/parcours/${p.id}`} className="flex-1 min-w-0 cursor-pointer">
              <p className="font-heading font-semibold text-encre truncate text-[15px]">{p.intention}</p>
              <p className="text-xs text-brume mt-1.5 flex items-center gap-2">
                <span className="badge-statut bg-encre/5 text-brume">
                  {LIBELLES_VISIBILITE[p.visibilite] ?? p.visibilite}
                </span>
                <span>mis à jour le {new Date(p.misAJourLe).toLocaleDateString('fr-FR')}</span>
              </p>
            </Link>
            <Link
              to={`/parcours/${p.id}`}
              className="hidden sm:inline-flex btn-secondaire text-sm whitespace-nowrap"
            >
              Ouvrir
            </Link>
            <button
              onClick={() => { if (window.confirm('Supprimer ce parcours ?')) suppression.mutate(p.id) }}
              aria-label={`Supprimer le parcours ${p.intention}`}
              className="w-11 h-11 rounded-xl text-corail bg-corail/10 border border-corail/20
                         hover:bg-corail hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </PageLayout>
  )
}
