import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import ChatWidget from '../components/chat/ChatWidget'
import PackResults from '../components/results/PackResults'
import Logo from '../components/ui/Logo'
import { GenerationLoader } from '../components/ui'
import { useSearchStore, useChatStore, useAuthStore } from '../store'
import { getCityPhoto, getPreferences, generatePack } from '../lib/api'

const FALLBACK_PHOTOS = [
  'https://images.unsplash.com/photo-1533105079780-92b9be482077?w=800&q=80',
  'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=800&q=80',
  'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80',
]

function PhotoVille({ city, photo }: { city: string; photo?: string }) {
  const [src, setSrc] = useState(photo || null)
  const fetched = useRef(false)

  useEffect(() => {
    if (src || fetched.current) return
    fetched.current = true
    getCityPhoto(city)
      .then((data: any) => setSrc(data.url || FALLBACK_PHOTOS[0]))
      .catch(() => setSrc(FALLBACK_PHOTOS[Math.floor(Math.random() * FALLBACK_PHOTOS.length)]))
  }, [city])

  return (
    <img
      src={src || FALLBACK_PHOTOS[0]}
      alt={city}
      onError={(e: any) => { e.target.src = FALLBACK_PHOTOS[0] }}
      className="w-full h-full object-cover opacity-80 group-hover:scale-110 group-hover:opacity-100 transition-all duration-700"
    />
  )
}

/* ─────────────── Bandeau compact (visible uniquement sans pack) ─────────────── */
const HERO_SLIDES = [
  { img: 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1920&q=90', city: "Côte d'Azur" },
  { img: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1920&q=90', city: 'Maldives' },
  { img: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=1920&q=90', city: 'Amalfi' },
  { img: 'https://images.unsplash.com/photo-1559494007-9f5847c49d94?auto=format&fit=crop&w=1920&q=90', city: 'Mykonos' },
  { img: 'https://images.unsplash.com/photo-1499856844078-53e0f0c4ee5c?auto=format&fit=crop&w=1920&q=90', city: 'Paris' },
]

function Hero() {
  const [current, setCurrent] = useState(0)
  const [fading, setFading]   = useState(false)

  useEffect(() => {
    const minuterie = setInterval(() => {
      setFading(true)
      setTimeout(() => { setCurrent(p => (p + 1) % HERO_SLIDES.length); setFading(false) }, 600)
    }, 5000)
    return () => clearInterval(minuterie)
  }, [])

  const slide = HERO_SLIDES[current]

  return (
    <section
      className="relative w-screen left-1/2 right-1/2 -translate-x-1/2 -mt-6 mb-10 h-[48vh] min-h-[340px] flex items-center justify-center overflow-hidden">

      <div className="absolute inset-0 z-0 bg-ink">
        <img key={current} src={slide.img} alt={slide.city}
          className={`w-full h-full object-cover scale-105 animate-slow-zoom transition-opacity duration-[600ms] ${fading ? 'opacity-0' : 'opacity-100'}`}
          onError={(e: any) => { e.target.onerror = null; e.target.src = FALLBACK_PHOTOS[0] }}
          style={{ transformOrigin: 'center 40%' }} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-ink/60 z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/40 via-transparent to-ink/40 z-10" />
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-2">
        {HERO_SLIDES.map((_, i) => (
          <button key={i} onClick={() => setCurrent(i)}
            className={`h-0.5 rounded-full transition-all duration-500 ${i === current ? 'w-8 bg-gold' : 'w-3 bg-white/30'}`} />
        ))}
      </div>

      <div className="relative z-20 text-center px-4 max-w-4xl mx-auto">
        <h1
          className="text-4xl sm:text-6xl lg:text-[5.5rem] font-bold text-white leading-[1.0] mb-5 drop-shadow-2xl">
          Votre voyage,
          <br />
          <span className="font-light">on s'occupe du reste.</span>
        </h1>
      </div>
    </section>
  )
}

/* ─────────────── Chat onboarding ─────────────── */
function ChatSection() {
  const { resetChat } = useChatStore()

  return (
    <section
      className="relative z-20 max-w-3xl mx-auto -mt-20" id="chat-section">

      {/* Pitch d'intro — explique le concept 2 valeurs sûres + 1 pépite */}
      <div className="relative mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { n: '1', t: 'Dites ce que vous cherchez', d: 'En une phrase, ou en répondant à quelques questions.' },
          { n: '2', t: 'Trois destinations vous sont proposées', d: 'Deux valeurs sûres et une plus surprenante, dans votre budget.' },
          { n: '3', t: 'Le pack se construit autour', d: 'Vols, hébergement, activités et budget, réunis au même endroit.' },
        ].map(e => (
          <div key={e.n} className="glass rounded-sm p-4 border border-gold/10">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-6 h-6 rounded-full bg-gold/15 text-gold-dark text-xs font-bold flex items-center justify-center flex-shrink-0">{e.n}</span>
              <p className="text-sm font-semibold text-ink leading-tight">{e.t}</p>
            </div>
            <p className="text-xs text-muted leading-relaxed">{e.d}</p>
          </div>
        ))}
      </div>

      <div className="relative glass-premium rounded-sm overflow-hidden shadow-sm border-t border-gold/30"
           style={{ minHeight: 460 }}>
        <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-gold/10
                        bg-gradient-to-b from-white/40 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gold-dark flex items-center justify-center">
              <Logo size={20} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink leading-none">Assistant TripGenie</p>
              <p className="text-xs text-muted mt-1">Là pour préparer votre voyage</p>
            </div>
          </div>
          <button onClick={resetChat}
            className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-gold-dark transition-colors
                       px-3 py-1.5 rounded-sm border border-transparent hover:border-gold/20 hover:bg-gold/5">
            Nouveau
          </button>
        </div>
        <div className="h-[calc(100%-56px)]">
          <ChatWidget />
        </div>
      </div>
    </section>
  )
}

/* ─────────────── Sélection de destination ─────────────── */
function ConceptsVoyage() {
  const { concepts, setField, setLoading, setPack } = useSearchStore()
  const { chatData, addMessage }                    = useChatStore()
  const navigate                                    = useNavigate()

  if (!concepts) return null

  const normaliserDate = (d: string) => {
    if (!d) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    const [day, month, year] = d.split('/')
    if (!day || !month) return null
    const annee = year ? (year.length === 2 ? '20' + year : year) : new Date().getFullYear()
    return `${annee}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const gererSelection = async (dest: any) => {
    setField('concepts', null)
    setField('destination', dest.city)   // le loader affiche la ville en cours, pas une valeur persistée
    setLoading(true)
    addMessage({ role: 'assistant', text: `C'est parti — je prépare votre pack pour **${dest.city}**…` })

    const dateDepart = normaliserDate(chatData.departure as string) || new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10)
    const dateRetour = normaliserDate(chatData.return_date as string) || new Date(new Date(dateDepart).getTime() + 86400000 * ((chatData.duration as number) || 7)).toISOString().slice(0, 10)

    try {
      // CORRECTIF 10 : generatePack() passe par api.ts qui respecte VITE_API_URL
      // et throw automatiquement si !res.ok avec le message d'erreur serveur
      const reponse = await generatePack({
        destination: dest.city,
        origin:      chatData.origin    || 'Paris',
        departure:   dateDepart,
        return_date: dateRetour,
        budget:      chatData.budget    || 5000,
        travelers:   chatData.travelers || 2,
        mode:        chatData.mode      || 'party',
        premium:     chatData.premium   || false,
        profile:     chatData.profile,
        interests:   chatData.interests,
      })
      setPack(reponse.pack, reponse.trip_id, reponse.pack_id)
      if (reponse.trip_id) {
        navigate(`/trip/${reponse.trip_id}`)
      } else {
        setTimeout(() => {
          document.getElementById('pack-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 300)
      }
    } catch (err: any) {
      setLoading(false)
      addMessage({ role: 'bot', text: err?.message || 'Erreur lors de la création du pack. Réessayez.' })
    }
  }

  return (
    <section
      className="relative z-20 max-w-6xl mx-auto -mt-20 px-4 pb-20">

      <div className="text-center mb-8">
        <h2 className="text-3xl text-ink font-bold mb-2">Trois destinations pour vous</h2>
        <p className="text-muted">Choisissez celle qui vous parle, le pack se construit autour.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {concepts.map((c: any, i: number) => (
          <div key={i}
            role="button"
            tabIndex={0}
            onClick={() => gererSelection(c)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && gererSelection(c)}
            className="group cursor-pointer relative h-[320px] sm:h-[420px] rounded-sm overflow-hidden
                       shadow-sm border border-gold/20 hover:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/60
                       transition-colors duration-300">
            <div className="absolute inset-0 bg-ink">
              <PhotoVille city={c.city} photo={c.photo} />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
            </div>
            <div className="absolute inset-0 p-6 flex flex-col justify-end">
              <span className="text-white/70 font-bold tracking-widest uppercase text-[10px] mb-1">{c.country}</span>
              <h3 className="text-3xl text-white font-bold mb-1 leading-none">{c.city}</h3>
              <p className="text-white/80 text-base mb-4 line-clamp-2">{c.tagline || c.reason}</p>
              <div className="flex items-center justify-between pt-4 border-t border-white/20">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/60">Budget estimé</p>
                  <p className="text-white font-bold text-base">
                    {c.budget_estimate || (chatData.budget && chatData.travelers
                      ? `~${Math.round((chatData.budget as number) / (chatData.travelers as number)).toLocaleString('fr-FR')}€/pers`
                      : 'Sur devis')}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white group-hover:bg-gold group-hover:text-ink transition-colors" aria-hidden="true">
                  ↗
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════════════════ */
export default function Home() {
  const { pack, concepts, isLoading, destination, clearPack } = useSearchStore()
  const { user }        = useAuthStore()
  const { seedChatData, resetChat } = useChatStore()
  const seededRef        = useRef(false)
  const hasPack = !!pack && !isLoading

  // Pré-remplissage du chat depuis les préférences utilisateur (Niveau 1).
  // Ville de départ, mode et centres d'intérêt par défaut → l'IA peut ensuite les écraser
  // si l'utilisateur précise autre chose dans la conversation.
  useEffect(() => {
    if (!user || seededRef.current) return
    seededRef.current = true
    getPreferences()
      .then(({ preferences }) => {
        if (!preferences) return
        const seed: Record<string, any> = {}
        if (preferences.home_city)               seed.origin    = preferences.home_city
        if (preferences.default_mode)            seed.mode      = preferences.default_mode
        if (typeof preferences.default_premium === 'boolean') seed.premium = preferences.default_premium
        if (preferences.preferred_prefs?.length) seed.interests = preferences.preferred_prefs
        if (Object.keys(seed).length) seedChatData(seed)
      })
      .catch(() => {})
  }, [user])

  return (
    <PageLayout>
      <Seo path="/" />

      {/* Bandeau d'accueil : visible uniquement sur l'accueil vide */}
      {!pack && !concepts && !isLoading && <Hero />}

      {/* ── Split layout quand le pack est affiché inline (user non connecté) ── */}
      
        {hasPack ? (
          <div
            className="mt-2"
            id="pack-results"
          >
            {/* Bandeau de contexte */}
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { clearPack(); resetChat() }}
                className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-gold-dark
                           px-3 py-1.5 rounded-sm border border-gold/20 hover:border-gold/50 hover:bg-gold/5 transition-all"
              >
                ↻ Recommencer
              </button>
            </div>
            <PackResults />
          </div>
        ) : (
          <div>
            {/* Chat onboarding */}
            {!concepts && !isLoading && <ChatSection />}

            {/* Sélection destination */}
            {concepts && !isLoading && <ConceptsVoyage />}

            {/* Squelette de chargement */}
            {isLoading && (
              <GenerationLoader destination={destination} />
            )}

            {/* Présentation — accueil vide (présentation + SEO) */}
            {!concepts && !isLoading && (
              <section
                className="max-w-5xl mx-auto mt-20 pb-28">

                <div className="text-center max-w-2xl mx-auto mb-12">
                  <h2 className="text-3xl text-ink font-bold mb-5">
                    Vous décrivez l'envie, on trouve la destination
                  </h2>
                  <p className="text-muted leading-relaxed">
                    Pas besoin de savoir où partir : c'est tout l'intérêt. Vous dites ce que vous cherchez — une
                    ambiance, un budget, des dates, avec qui vous voyagez — et TripGenie vous propose trois
                    destinations qui collent à la demande : deux valeurs sûres et une pépite plus confidentielle.
                    Vous choisissez, et le pack complet se construit autour : vols, hébergement, bonnes tables,
                    activités et budget détaillé.
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    {
                      t: 'Des destinations choisies sur des données réelles',
                      d: "Lieux et restaurants réellement fréquentés, météo de la période, événements prévus sur place et prix cohérents avec votre budget : chaque proposition est comparée et notée sur plusieurs critères, pas tirée d'une liste toute faite.",
                    },
                    {
                      t: 'Adapté à votre façon de voyager',
                      d: "Week-end entre amis, vacances en famille, voyage étudiant ou escapade à deux : vous ajustez le ton, le niveau de confort et vos centres d'intérêt, et les propositions suivent.",
                    },
                    {
                      t: 'Rien à installer, rien à payer pour essayer',
                      d: "Décrivez votre voyage et comparez les propositions librement. Vous créez un compte seulement si vous voulez sauvegarder vos packs et les retrouver plus tard.",
                    },
                  ].map((c, i) => (
                    <div key={i}
                      className="glass rounded-sm p-6 border border-gold/10 flex flex-col">
                      <span className="w-8 h-8 rounded-full bg-gold/15 text-gold-dark text-sm font-bold flex items-center justify-center mb-4">
                        {i + 1}
                      </span>
                      <h3 className="text-lg text-ink font-bold mb-2 leading-snug">
                        {c.t}
                      </h3>
                      <p className="text-muted text-sm leading-relaxed">{c.d}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      

    </PageLayout>
  )
}
