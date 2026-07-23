import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { useAuthStore } from '../store'
import { getPreferences, savePreferences } from '../lib/api'

const MODES = [
  { value: 'party',    label: 'Fête' },
  { value: 'student',  label: 'Étudiant' },
  { value: 'group',    label: 'Groupe' },
  { value: 'relax',    label: 'Détente' },
  { value: 'surprise', label: 'Surprise' },
]
const INTERESTS  = ['gastronomie', 'culture', 'nightlife', 'nature', 'shopping', 'sport', 'plage', 'histoire']

export default function PreferencesPage() {
  const { user }    = useAuthStore()
  const navigate    = useNavigate()
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement]   = useState(false)

  const [homeCity, setHomeCity]   = useState('')
  const [mode, setMode]           = useState('party')
  const [premium, setPremium]     = useState(false)
  const [interests, setInterests] = useState<string[]>([])

  // Pas connecté → login
  useEffect(() => {
    if (!user) navigate('/login')
  }, [user])

  // Chargement des préférences existantes
  useEffect(() => {
    if (!user) return
    getPreferences()
      .then(({ preferences }) => {
        if (preferences) {
          setHomeCity(preferences.home_city ?? '')
          setMode(preferences.default_mode ?? 'party')
          setPremium(preferences.default_premium ?? false)
          setInterests(preferences.preferred_prefs ?? [])
        }
      })
      .catch(() => {})
      .finally(() => setChargement(false))
  }, [user])

  const basculerInteret = (i: string) =>
    setInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])

  const enregistrer = async () => {
    setEnregistrement(true)
    try {
      await savePreferences({
        home_city:       homeCity,
        default_mode:    mode,
        default_premium: premium,
        preferred_prefs: interests,
      })
      toast.success('Préférences enregistrées')
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de l\'enregistrement')
    } finally {
      setEnregistrement(false)
    }
  }

  const classeInput = `w-full bg-white border border-parchment-dark
    rounded-sm px-4 py-3 text-sm text-ink placeholder:text-muted
    focus:outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/10 transition-all`

  return (
    <PageLayout>
      <Seo title="Préférences" path="/preferences" noindex />
      <div className="max-w-lg mx-auto py-12">
        <div
          className="glass rounded-sm p-8 border border-gold/20 shadow-card-lg">

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-ink">Mes préférences</h1>
          </div>

          {chargement
            ? <div className="py-12 flex justify-center">
                <span className="w-6 h-6 border-2 border-gold/30 border-t-gold-dark rounded-full animate-spin" />
              </div>
            : <div className="space-y-5">
                {/* Ville de départ */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">Ville de départ</label>
                  <input value={homeCity} onChange={e => setHomeCity(e.target.value)}
                    placeholder="Ex : Bordeaux" className={classeInput} />
                </div>

                {/* Mode par défaut */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">Mode de voyage par défaut</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MODES.map(m => (
                      <button key={m.value} onClick={() => setMode(m.value)}
                        className={`py-2.5 rounded-sm text-sm font-medium border transition-all
                          ${mode === m.value
                            ? 'bg-gold text-ink border-gold'
                            : 'bg-ink/5 border-ink/10 text-muted hover:border-gold/40'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Niveau de prix (axe indépendant du mode) */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">Niveau de confort par défaut</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: false, label: 'Classique' },
                      { value: true,  label: 'Premium' },
                    ].map(n => (
                      <button key={String(n.value)} onClick={() => setPremium(n.value)}
                        className={`py-2.5 rounded-sm text-sm font-medium border transition-all
                          ${premium === n.value
                            ? 'bg-gold text-ink border-gold'
                            : 'bg-ink/5 border-ink/10 text-muted hover:border-gold/40'}`}>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Centres d'intérêt */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">Centres d'intérêt</label>
                  <div className="flex flex-wrap gap-2">
                    {INTERESTS.map(i => (
                      <button key={i} onClick={() => basculerInteret(i)}
                        className={`px-3 py-1.5 rounded-sm text-sm font-medium border transition-all capitalize
                          ${interests.includes(i)
                            ? 'bg-sage/30 border-sage text-sage'
                            : 'bg-ink/5 border-ink/10 text-muted hover:border-gold/40'}`}>
                        {i}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={enregistrer} disabled={enregistrement}
                  className="btn-primary w-full mt-2 flex items-center justify-center gap-2">
                  {enregistrement
                    ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
                    : 'Enregistrer mes préférences'}
                </button>
              </div>
          }

          <p className="text-center text-xs text-muted mt-5">
            <Link to="/" className="hover:text-ink transition-colors">
              ← Retour à l'accueil
            </Link>
          </p>
        </div>
      </div>
    </PageLayout>
  )
}
