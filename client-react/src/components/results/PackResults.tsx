import { useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Cell, ResponsiveContainer, PieChart, Pie, Tooltip } from 'recharts'
import { useSearchStore } from '../../store'
import { TabBar, SectionTitle, ModeBadge } from '../ui'
import PackSkeleton from './PackSkeleton'
import TripMap from './TripMap'
import VoteButtons from './VoteButtons'

// ---- Composants internes ----
const TagBadge = ({ text }: { text?: string }) => {
  if (!text) return null
  return (
    <span className="bg-sage/10 text-sage text-[10px] px-2 py-0.5 rounded-sm border border-sage/20 whitespace-nowrap">
      {text}
    </span>
  )
}

// ---- Lien de réservation UNIQUE (events + activités) ----
// Source unique de vérité côté front : la vraie URL posée par le résolveur
// serveur (services/liens.ts), sinon repli recherche Google. Un seul endroit,
// un seul fallback — remplace les 2 anciennes cascades booking_url/reserve_url/links.
function lienReservation(item: any, destination: string): string {
  if (item?.reservation_url) return item.reservation_url
  const q = encodeURIComponent(`${item?.name || item?.title || ''} ${destination || ''} réservation`)
  return `https://www.google.com/search?q=${q}`
}

// ---- Carte vol ----
function FlightCard({ flight, packId, destination }: { flight: any; packId: string; destination: string }) {
  const isReturn  = flight.type === 'return'
  // Skyscanner pré-rempli (route IATA + dates + voyageurs) = le lien qui ouvre le
  // VRAI prix. Repli google (recherche fiable) pour les anciens packs en base.
  const bookingUrl = flight.links?.skyscanner || flight.links?.google
    || `https://www.google.com/search?q=${encodeURIComponent(`vols ${flight.from_city || 'Paris'} ${flight.to_city || destination}`)}`
  const kayakUrl = flight.links?.kayak

  return (
    <div
      className="glass rounded-sm p-4 group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-gold/10 text-gold-dark rounded-sm border border-gold/20">
            {isReturn ? 'Retour' : 'Aller'}
          </span>
          <span className="text-xs text-muted font-medium">{flight.airline}</span>
        </div>
        <div className="flex items-center gap-3">
          <VoteButtons packId={packId} itemId={`flight-${flight.type}-${flight.airline}`} />
          <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-tighter ${flight.stops === 'Direct' ? 'bg-sage/10 text-sage border border-sage/20' : 'bg-coral/10 text-coral border border-coral/20'}`}>
            {flight.stops}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-center flex-1">
          <p className="text-2xl font-bold text-ink leading-none">{flight.departure_time}</p>
          <p className="text-[10px] font-bold text-muted mt-1 uppercase tracking-tighter">{flight.from} · {flight.from_city}</p>
        </div>
        <div className="flex-[0.5] flex flex-col items-center gap-1 opacity-50">
          <p className="text-[9px] font-bold text-muted uppercase">{flight.duration}</p>
          <div className="w-full flex items-center gap-1">
            <div className="h-px flex-1 bg-muted/30" />
            <span className="text-muted text-[10px]">✈</span>
            <div className="h-px flex-1 bg-muted/30" />
          </div>
        </div>
        <div className="text-center flex-1">
          <p className="text-2xl font-bold text-ink leading-none">{flight.arrival_time}</p>
          <p className="text-[10px] font-bold text-muted mt-1 uppercase tracking-tighter">{flight.to} · {flight.to_city}</p>
        </div>
        <div className="pl-4 border-l border-white/5 flex flex-col items-end gap-1">
          <p className="text-lg font-bold text-gold-dark leading-none">{flight.price_per_person}</p>
          <p className="text-[9px] text-muted/60 italic">estimatif</p>
          <div className="flex items-center gap-2">
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold text-sage hover:underline flex items-center gap-0.5"
            >
              Vrai prix ↗
            </a>
            {kayakUrl && (
              <a
                href={kayakUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-bold text-muted hover:text-gold-dark hover:underline flex items-center gap-0.5"
              >
                Kayak ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Jour d'itinéraire ----
function ItineraryDay({ day, destination }: { day: any; destination: string }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="glass rounded-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gold/5 transition-colors">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-gold/15 text-gold-dark font-bold text-sm flex items-center justify-center">
            {day.day}
          </span>
          <div className="text-left">
            <p className="font-semibold text-ink text-sm">{day.title}</p>
            <p className="text-xs text-muted">{day.subtitle}</p>
          </div>
        </div>
        <span className="text-muted text-sm">▼</span>
      </button>
      
        {open && (
          <div
            className="px-5 pb-4 space-y-3 border-t border-parchment-dark">
            {day.items?.map((item: any, i: number) => (
              <div key={i} className="flex gap-3 pt-3"
>
                <div className="flex-shrink-0 w-14 pt-0.5">
                  <p className="text-xs font-semibold text-gold-dark">{item.time}</p>
                </div>
                <div className="flex-1">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((item.title || '') + ' ' + destination)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-medium text-sm text-ink hover:text-gold-dark transition-colors"
                  >
                    {item.title}
                  </a>
                  {item.description && (
                    <p className="text-xs text-muted mt-0.5 leading-relaxed">{item.description}</p>
                  )}
                  <div className="flex gap-3 mt-1.5">
                    {item.price && <span className="text-xs text-sage font-medium">{item.price}</span>}
                    {item.duration && <span className="text-xs text-muted">{item.duration}</span>}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Autre option pour la journée */}
            {day.plan_b && (
              <div className="mt-4 pl-3 border-l-2 border-gold/40">
                <p className="text-[10px] font-bold text-gold-dark uppercase tracking-wider mb-0.5">Autre option</p>
                <p className="text-xs text-muted leading-relaxed">{day.plan_b}</p>
              </div>
            )}
          </div>
        )}
      
    </div>
  )
}

// ---- Camembert de répartition du budget ----
function BudgetChart({ breakdown }: { breakdown: any }) {
  if (!breakdown) return null
  const totalNum = parseInt(breakdown.total as string) || 0
  // On masque les postes négligeables (< 1% du budget) : évite les lignes absurdes
  // type « Divers : 1€ » issues des arrondis de répartition.
  const seuil   = Math.max(1, totalNum * 0.01)
  const entries = Object.entries(breakdown)
    .filter(([k]) => k !== 'total')
    .filter(([, v]) => (parseInt(v as string) || 0) >= seuil)
  // Dégradé d'une seule couleur (terracotta) : les parts se distinguent sans virer à l'arc-en-ciel
  const colors  = ['#E3A72C', '#EFC97B', '#916312', '#D9B24E', '#F6E4B8', '#5E3F0A']
  // « divers » = budget non affecté aux postes réalistes → libellé « Marge / imprévus ».
  const labels: Record<string, string> = { divers: 'Marge / imprévus' }
  // Tri décroissant : le donut se lit du plus gros au plus petit poste,
  // et la légende (avec %) correspond visuellement aux arcs.
  const data    = entries
    .map(([k, v], i) => ({
      name:  labels[k] ?? k.charAt(0).toUpperCase() + k.slice(1),
      value: parseInt(v as string) || 0,
      color: colors[i % colors.length]
    }))
    .sort((a, b) => b.value - a.value)
  const total = breakdown.total || '—'

  return (
    <div className="glass rounded-sm p-5">
      <SectionTitle sub={`Répartition indicative · Total : ${total}`}>Budget</SectionTitle>
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-44 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={72}
                   dataKey="value" paddingAngle={2} isAnimationActive={false}>
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v) => `${v}€`} contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                <span className="text-sm text-muted capitalize">{d.name}</span>
              </div>
              <span className="text-sm font-medium text-ink">
                {d.value.toLocaleString('fr-FR')}€
                {totalNum > 0 && <span className="text-muted font-normal"> · {Math.round((d.value / totalNum) * 100)}%</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Carte événement ----
function EventCard({ event, destination }: { event: any; destination: string }) {
  const bookingUrl = lienReservation(event, destination)

  return (
    <div className="p-3 glass rounded-sm">
      <div className="min-w-0">
        <p className="font-medium text-sm text-ink truncate">{event.title}</p>
        <p className="text-xs text-muted mt-0.5">{event.start} · {event.venue}</p>
        {event.description && <p className="text-xs text-muted mt-1 line-clamp-2">{event.description}</p>}
        <a href={bookingUrl} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-2 text-[10px] font-bold text-sage hover:underline">
          Réserver / Infos ↗
        </a>
      </div>
    </div>
  )
}

// ---- Carte activité ----
// COMPOSANT PRINCIPAL DU PACK
const TABS = [
  { id: 'overview',    label: 'Aperçu' },
  { id: 'hotels',      label: 'Hôtels' },
  { id: 'flights',     label: 'Vols' },
  { id: 'itinerary',   label: 'Temps forts' },
  { id: 'activities',  label: 'Activités' },
  { id: 'budget',      label: 'Budget' },
]

export default function PackResults() {
  const { pack, tripId, packId, isLoading, mode, departure, returnDate, travelers } = useSearchStore()
  const [activeTab, setActiveTab]       = useState('overview')
  const [focusedLocation, setFocusedLocation] = useState<[number, number] | null>(null)

  if (isLoading) {
    return <PackSkeleton />
  }

  if (!pack) return null

  const donneesPack = pack

  // Score TripGenie (algo déterministe) — rendu visible dans le bandeau.
  const valeurScore      = typeof donneesPack.score === 'number' ? donneesPack.score : (donneesPack.score?.total ?? 0)
  const scorePourcentage      = Math.round(valeurScore * 100)

  // Bandeau Mode Survie — affiché quand toutes les IA ont échoué et que le pack
  // est un fallback statique. Important pour la transparence envers l'utilisateur.
  const MockBanner = donneesPack.isMock ? (
    <div className="mx-4 mb-4 px-4 py-3 rounded-sm bg-amber-500/10 border border-amber-500/30">
      <div>
        <p className="text-sm font-bold text-amber-600">Données de démonstration</p>
        <p className="text-xs text-amber-600/80 mt-0.5">
          Les services IA sont temporairement indisponibles. Ce pack est un exemple générique — réessayez dans quelques minutes pour un vrai résultat personnalisé.
        </p>
      </div>
    </div>
  ) : null

  // Centre la carte sur un élément
  const gererLocalisation = async (name: string) => {
    setActiveTab('overview')
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name + ' ' + donneesPack.destination)}&limit=1`)
      const data = await res.json()
      if (data && data.length > 0) {
        setFocusedLocation([parseFloat(data[0].lat), parseFloat(data[0].lon)])
        // Remonte en haut pour voir la carte
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      console.error("Locate error:", err)
    }
  }

  // Partage via WhatsApp
  const handleShare = () => {
    const url = window.location.href
    // Formate une date ISO (2026-08-15T00:00:00.000Z) en date lisible (15/08/2026).
    const formaterDate = (d?: string) => {
      if (!d) return '?'
      const date = new Date(d)
      return isNaN(date.getTime()) ? d : format(date, 'dd/MM/yyyy', { locale: fr })
    }
    const text = `TripGenie — Voyage à ${donneesPack.destination}\n\n` +
                 `Dates : du ${formaterDate(departure)} au ${formaterDate(returnDate)}\n` +
                 `Hôtel : ${donneesPack.hotels?.[0]?.name || 'À choisir'}\n` +
                 `Budget : ${donneesPack.summary?.total_budget || 'À définir'}\n\n` +
                 `Le programme complet ici : ${url}`

    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(waUrl, '_blank')
  }

  // ---- Cartes internes avec bouton Localiser + Vote ----
  const LocalHotelCard = ({ hotel }: { hotel: any }) => (
    <div className="glass rounded-sm p-4 flex flex-col gap-3 group hover:border-gold/30 transition-colors">
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="font-semibold text-sm text-ink">{hotel.name}</p>
          <p className="text-xs text-muted mt-0.5">{hotel.location} · {hotel.stars}★</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => gererLocalisation(hotel.name)}
              className="text-[10px] uppercase tracking-wider font-bold text-gold-dark hover:text-gold-dark/80 flex items-center gap-1 transition-colors"
            >
              Carte
            </button>
            <a
              href={hotel.booking_url || hotel.links?.booking || `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotel.name + ' ' + donneesPack.destination)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-wider font-bold text-sage hover:text-sage/80 flex items-center gap-1 transition-colors"
            >
              Réserver ↗
            </a>
            {hotel.links?.google && (
              <a href={hotel.links.google} target="_blank" rel="noopener noreferrer"
                className="text-[10px] uppercase tracking-wider font-bold text-muted hover:text-gold-dark flex items-center gap-1 transition-colors">
                Google ↗
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-parchment-dark">
        <span className="text-xs font-bold text-gold-dark">
          {hotel.price_per_night}<span className="font-normal text-muted"> /nuit · estim.</span>
        </span>
        <div className="flex items-center gap-3">
          <VoteButtons packId={packId ?? ''} itemId={hotel.name} />
          <TagBadge text={hotel.match_reason} />
        </div>
      </div>
    </div>
  )

  const LocalActivityCard = ({ activity }: { activity: any }) => (
    <div className="glass rounded-sm p-5 flex flex-col gap-4 hover:border-gold/40 transition-colors shadow-sm">
      <div>
        <p className="font-bold text-lg text-ink leading-tight">{activity.name}</p>
        <p className="text-xs text-gold-dark font-semibold uppercase tracking-widest mt-1">{activity.category || 'Expérience'}</p>
        <p className="text-sm text-muted/90 mt-2 leading-relaxed">{activity.desc || activity.description}</p>
        {activity.plan_b && (
          <div className="mt-3 pl-3 border-l-2 border-gold/40">
            <p className="text-[10px] text-gold-dark font-bold uppercase tracking-wider mb-0.5">Autre option</p>
            <p className="text-xs text-muted leading-tight">{activity.plan_b}</p>
          </div>
        )}
      </div>
      <div className="flex justify-between items-center pt-3 border-t border-parchment-dark mt-auto">
        <div className="flex gap-2">
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(activity.name + ' ' + donneesPack.destination)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-ink bg-parchment-dark hover:bg-gold hover:text-ink px-3 py-1.5 rounded-sm transition-colors"
          >
            Carte
          </a>
          <a
            href={lienReservation(activity, donneesPack.destination)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-ink bg-gold hover:bg-gold-dark px-4 py-1.5 rounded-sm transition-colors hover:shadow-none flex items-center gap-1.5"
          >
            Réserver ↗
          </a>
        </div>
        <VoteButtons packId={packId ?? ''} itemId={activity.name || activity.title} />
      </div>
    </div>
  )


  return (
    <div id="pack-results" className="mt-10 space-y-5">

      {/* Bandeau Mode Survie — visible uniquement quand isMock: true */}
      {MockBanner}

      {/* Bandeau d'accueil */}
      <div className="glass-premium rounded-sm p-4 sm:p-6 relative overflow-hidden min-h-[220px] sm:min-h-[260px] flex items-end">
        {/* Image de fond */}
        <div className="absolute inset-0 z-0">
          <img
            src={donneesPack.photo_url || `https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80`}
            alt={donneesPack.destination}
            className="w-full h-full object-cover opacity-40 transition-transform duration-[20s]"
            onError={e => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-parchment via-parchment/85 to-parchment/30" />
        </div>

        <div className="relative z-10 w-full">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ModeBadge mode={mode} />
                {tripId && (
                  <span
                    className="bg-sage/10 text-sage text-[10px] px-2 py-0.5 rounded-sm border border-sage/20 font-bold uppercase tracking-widest"
                  >
                    Sauvegardé
                  </span>
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-ink flex flex-wrap items-center gap-2">
                {donneesPack.destination}
                <span className="text-muted text-lg sm:text-xl font-normal">{donneesPack.country}</span>
                <button
                  onClick={handleShare}
                  className="bg-sage/10 hover:bg-sage/20 text-sage px-3 py-1 rounded-sm text-xs font-bold transition-colors border border-sage/20"
                >
                  Partager
                </button>
              </h2>
              <p className="text-ink/80 mt-1">{donneesPack.tagline}</p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {/* Score TripGenie — visible dès l'apparition du pack + détail de l'algo par critère */}
              {donneesPack.score != null && (
                <div className="glass-premium rounded-sm px-4 py-2 border border-gold/30">
                  <div className="flex items-baseline gap-1 justify-center">
                    <span className="text-2xl font-bold text-gold-dark leading-none">{scorePourcentage}</span>
                    <span className="text-xs text-muted">/100</span>
                  </div>
                  <span className="text-[9px] uppercase tracking-widest text-muted block text-center">
                    {scorePourcentage >= 80 ? 'Excellent' : scorePourcentage >= 65 ? 'Très bon' : scorePourcentage >= 50 ? 'Bon' : 'Correct'}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <div className="glass rounded-sm px-3 py-1.5 flex items-center gap-1.5">
                  <span className="text-gold-dark font-bold text-base">{travelers ?? '—'}</span>
                  <span className="text-[10px] text-muted uppercase tracking-tighter">voy.</span>
                </div>
                <div className="glass rounded-sm px-3 py-1.5 flex items-center gap-1.5">
                  <span className="text-gold-dark font-bold text-base">{donneesPack.summary?.nights}</span>
                  <span className="text-[10px] text-muted uppercase tracking-tighter">nuits</span>
                </div>
                <div className="glass rounded-sm px-3 py-1.5 flex items-center gap-1.5">
                  <span className="text-gold-dark font-bold text-base">{donneesPack.summary?.total_budget}</span>
                  <span className="text-[10px] text-muted uppercase tracking-tighter">budget</span>
                </div>
              </div>
            </div>
          </div>

          {/* Météo — température et temps qu'il fait, sans détails superflus */}
          {donneesPack.weather && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="font-medium text-ink">{donneesPack.weather.avg_temp}</span>
              <span>·</span>
              <span>{donneesPack.weather.conditions}</span>
            </div>
          )}

          {/* Aperçu */}
          {donneesPack.overview && (
            <p className="mt-4 text-sm leading-relaxed text-muted border-l-2 border-gold/40 pl-4">
              {donneesPack.overview}
            </p>
          )}

          {/* Conseils */}
          {(donneesPack.tips?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1">
              {donneesPack.tips?.map((tip, i) => (
                <p key={i} className="text-xs">
                  <span className="font-semibold text-ink">{tip.title} · </span>
                  <span className="text-muted">{tip.content}</span>
                </p>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Onglets */}
      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* Contenu de l'onglet */}
      
        <div key={activeTab}
>

          {activeTab === 'overview' && (
            <div className="space-y-4">
              <TripMap
                destination={donneesPack.destination}
                hotels={donneesPack.hotels}
                focusedLocation={focusedLocation}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {donneesPack.hotels?.slice(0, 2).map((h, i) => <LocalHotelCard key={i} hotel={h} />)}
                {donneesPack.flights?.slice(0, 2).map((f, i) => <FlightCard key={i} flight={f} packId={packId ?? ''} destination={donneesPack.destination} />)}
                {donneesPack.events?.slice(0, 3).map((e, i) => <EventCard key={i} event={e} destination={donneesPack.destination} />)}
              </div>
            </div>
          )}

          {activeTab === 'hotels' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {donneesPack.hotels?.map((h, i) => <LocalHotelCard key={i} hotel={h} />)}
            </div>
          )}

          {activeTab === 'flights' && (
            <div className="space-y-3">
              {donneesPack.flights?.map((f, i) => <FlightCard key={i} flight={f} packId={packId ?? ''} destination={donneesPack.destination} />)}
            </div>
          )}

          {activeTab === 'itinerary' && (
            <div className="space-y-3">
              {donneesPack.itinerary?.map((day, i) => <ItineraryDay key={i} day={day} destination={donneesPack.destination} />)}
            </div>
          )}

          {activeTab === 'activities' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {donneesPack.activities?.map((a, i) => <LocalActivityCard key={i} activity={a} />)}
            </div>
          )}

          {activeTab === 'budget' && <BudgetChart breakdown={donneesPack.budget_breakdown} />}
        </div>
      
    </div>
  )
}
