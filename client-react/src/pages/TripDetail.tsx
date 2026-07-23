import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import PackResults from '../components/results/PackResults'
import ModifyChat from '../components/chat/ModifyChat'
import Logo from '../components/ui/Logo'
import { SkeletonCard } from '../components/ui'
import { getPublicTrip, updateTrip } from '../lib/api'
import { useSearchStore } from '../store'

export default function TripDetail() {
  const { id }                        = useParams()
  const { setPack, setField, tripId } = useSearchStore()
  const [chatOpen, setChatOpen]       = useState(false)
  const [status, setStatus]           = useState<string | null>(null)
  const [statutEnChargement, setStatutEnChargement] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', id],
    queryFn:  () => getPublicTrip(id as string),
    enabled:  !!id,
  })

  useEffect(() => {
    if (data?.trip?.pack_data && tripId !== data.trip.id) {
      setPack(data.trip.pack_data, data.trip.id, data.trip.pack_id ?? null)
    }
    // Toujours hydrater le store depuis la BDD (source de vérité), même sur un voyage
    // fraîchement généré : le store top-level garde sinon ses défauts (2 voyageurs, dates vides).
    if (data?.trip) {
      setField('mode', data.trip.mode || 'party')
      if (data.trip.travelers != null)   setField('travelers', data.trip.travelers)
      if (data.trip.departure)           setField('departure', data.trip.departure)
      if (data.trip.return_date)         setField('returnDate', data.trip.return_date)
    }
    if (data?.trip?.status) setStatus(data.trip.status)
  }, [data])

  const gererStatut = async (newStatus: string) => {
    if (!id || statutEnChargement) return
    setStatutEnChargement(true)
    try {
      await updateTrip(id, { status: newStatus })
      setStatus(newStatus)
    } catch {
      /* silencieux */
    } finally {
      setStatutEnChargement(false)
    }
  }

  /* ---- Chargement ---- */
  if (isLoading) {
    return (
      <PageLayout>
      <Seo title="Votre voyage" noindex />
        <div className="space-y-4 mt-6">
          <SkeletonCard />
          <div className="grid grid-cols-2 gap-4">
            <SkeletonCard /><SkeletonCard />
          </div>
        </div>
      </PageLayout>
    )
  }

  /* ---- Erreur ---- */
  if (error) {
    return (
      <PageLayout>
      <Seo title="Votre voyage" noindex />
        <div className="text-center py-24">
          <h2 className="text-2xl font-bold text-ink mb-2">
            Voyage introuvable
          </h2>
          <p className="text-muted mb-6">Ce lien de partage est invalide ou expiré.</p>
          <Link to="/" className="btn-primary">Créer un voyage</Link>
        </div>
      </PageLayout>
    )
  }

  /* ---- Contenu ---- */
  return (
    <PageLayout>
      <Seo title="Votre voyage" noindex />
      {data?.trip && (
        <>
          <div className="flex gap-5 items-start">

            {/* ── Gauche : Pack ── */}
            <div className="flex-1 min-w-0">

              {/* Barre d'actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <p className="text-sm text-muted truncate max-w-[200px] sm:max-w-none">
                  <span className="font-semibold text-ink">
                    {data.trip.destination}
                  </span>
                  {' · '}{data.trip.travelers} pers.
                  {data.trip.budget ? ` · ${data.trip.budget}` : ''}
                </p>

                <div className="flex gap-2">
                  {/* Bouton Modifier : visible partout, mais sur mobile ouvre le panneau du bas */}
                  <button
                    onClick={() => setChatOpen(v => !v)}
                    className={`text-sm px-4 py-2 rounded-sm font-bold transition-all border flex items-center gap-1.5 ${
                      chatOpen
                        ? 'bg-gold text-ink border-gold'
                        : 'border-gold/30 text-gold-dark hover:bg-gold/10'
                    }`}
                  >
                    {chatOpen ? 'Fermer' : 'Modifier'}
                  </button>
                </div>
              </div>

              {/* Suivi du statut */}
              {status && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">Statut :</span>
                  {[
                    { key: 'draft',     label: 'Brouillon', dot: 'bg-amber-400', desc: 'Pack généré, non validé' },
                    { key: 'confirmed', label: 'Confirmé',  dot: 'bg-sage',      desc: 'Je pars !' },
                    { key: 'archived',  label: 'Archivé',   dot: 'bg-ink/40',    desc: 'Voyage terminé' },
                  ].map(s => (
                    <button key={s.key}
                      onClick={() => gererStatut(s.key)}
                      disabled={statutEnChargement || status === s.key}
                      title={s.desc}
                      className={`text-xs px-3 py-1.5 rounded-sm border font-semibold transition-all inline-flex items-center gap-1.5 ${
                        status === s.key
                          ? 'bg-gold text-ink border-gold'
                          : 'border-gold/20 text-muted hover:border-gold/50 hover:text-ink'
                      } disabled:opacity-50`}
                    >
                      <span className={`w-2 h-2 rounded-full ${status === s.key ? 'bg-white' : s.dot}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <PackResults />
            </div>

            {/* ── Droite : chat de modification (bureau uniquement, lg+) ── */}
            
              {chatOpen && (
                <div
                  className="hidden lg:flex flex-col flex-shrink-0 sticky top-20"
                  style={{ width: 340, height: 'calc(100vh - 6rem)' }}
                >
                  <div className="glass-premium rounded-sm overflow-hidden h-full flex flex-col border border-gold/20">

                    {/* En-tête du panneau */}
                    <div className="px-4 py-3 border-b border-gold/10 flex items-center justify-between
                                    bg-gradient-to-r from-gold/5 to-transparent">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gold-dark
                                        flex items-center justify-center">
                          <Logo size={17} className="text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-ink leading-none">
                            Modifier le pack
                          </p>
                          <p className="text-[11px] text-muted mt-0.5">{data.trip.destination}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setChatOpen(false)}
                        className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center
                                   text-muted hover:text-ink transition-colors text-base"
                      >
                        ×
                      </button>
                    </div>

                    {/* Résumé rapide du pack actuel */}
                    <div className="px-4 py-2.5 border-b border-gold/10 bg-gold/3">
                      <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1.5">Pack actuel</p>
                      <div className="space-y-0.5 text-xs text-muted">
                        {data.trip.pack_data?.flights?.[0] && (
                          <p>Vol · {data.trip.pack_data.flights[0].airline || 'Vol'} · {data.trip.pack_data.flights[0].price_per_person || '–'}/pers</p>
                        )}
                        {data.trip.pack_data?.hotels?.[0] && (
                          <p>Hôtel · {data.trip.pack_data.hotels[0].name} · {data.trip.pack_data.hotels[0].price_per_night || '–'}/nuit</p>
                        )}
                        {data.trip.pack_data?.summary && (
                          <p>Séjour · {data.trip.pack_data.summary.nights} nuits · {data.trip.pack_data.summary.activities_count || '–'} activités</p>
                        )}
                      </div>
                    </div>

                    {/* Chat */}
                    <ModifyChat tripId={id} mode={data.trip.mode} />
                  </div>
                </div>
              )}
            

          </div>

          {/* ── Mobile : panneau du bas (< lg uniquement) ── */}
          
            {chatOpen && (
              <>
                {/* Fond sombre */}
                <div
                  className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                  onClick={() => setChatOpen(false)}
                />

                {/* Panneau qui monte du bas */}
                <div
                  key="mobile-chat-sheet"
                  className="fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-sm overflow-hidden"
                  style={{ height: '88vh' }}
                >
                  <div className="glass-premium h-full flex flex-col border-t border-x border-gold/20 rounded-t-sm">

                    {/* Barre de glissement */}
                    <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                      <div className="w-10 h-1 rounded-sm bg-white/20" />
                    </div>

                    {/* En-tête */}
                    <div className="px-4 py-3 border-b border-gold/10 flex items-center justify-between
                                    bg-gradient-to-r from-gold/5 to-transparent flex-shrink-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gold-dark
                                        flex items-center justify-center">
                          <Logo size={17} className="text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-ink leading-none">
                            Modifier le pack
                          </p>
                          <p className="text-[11px] text-muted mt-0.5">{data.trip.destination}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setChatOpen(false)}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center
                                   text-muted hover:text-ink transition-colors text-lg"
                      >
                        ×
                      </button>
                    </div>

                    {/* Résumé pack */}
                    <div className="px-4 py-2.5 border-b border-gold/10 flex-shrink-0">
                      <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1.5">Pack actuel</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                        {data.trip.pack_data?.flights?.[0] && (
                          <span>Vol · {data.trip.pack_data.flights[0].airline || 'Vol'} · {data.trip.pack_data.flights[0].price_per_person || '–'}/pers</span>
                        )}
                        {data.trip.pack_data?.hotels?.[0] && (
                          <span>Hôtel · {data.trip.pack_data.hotels[0].name} · {data.trip.pack_data.hotels[0].price_per_night || '–'}/nuit</span>
                        )}
                        {data.trip.pack_data?.summary && (
                          <span>Séjour · {data.trip.pack_data.summary.nights} nuits · {data.trip.pack_data.summary.activities_count || '–'} activités</span>
                        )}
                      </div>
                    </div>

                    {/* Chat (flex-1 pour prendre toute la hauteur restante) */}
                    <div className="flex-1 min-h-0">
                      <ModifyChat tripId={id} mode={data.trip.mode} />
                    </div>
                  </div>
                </div>
              </>
            )}
          

          {/* ── Mobile FAB flottant (< lg) — visible quand chat fermé ── */}
          
            {!chatOpen && (
              <button
                key="mobile-fab"
                onClick={() => setChatOpen(true)}
                className="fixed bottom-20 right-4 z-40 lg:hidden w-14 h-14 rounded-full
                           bg-gold hover:bg-gold-dark text-ink
                           shadow-sm flex items-center justify-center
                           active:scale-95 transition-transform"
                aria-label="Modifier le pack"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
          
        </>
      )}
    </PageLayout>
  )
}
