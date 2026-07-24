import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { useAuthStore, useDialogueStore } from '../store'
import { avancerDialogue, genererParcours, type Brief } from '../lib/api'

// La page d'entrée : « Qu'as-tu envie de vivre ? » (doc 05, étapes 1→5).
// Dialogue de cadrage → brief reformulé → confirmation → génération.

const SUGGESTIONS = [
  'Vivre la NBA pendant 3 semaines',
  'Un week-end surprise en amoureux',
  'Une soirée sympa ce soir avec 2 potes',
  'Un festival techno entre amis',
]

/** L'envie écrite avant connexion, gardée le temps de l'aller-retour. */
const ENVIE_EN_ATTENTE = 'experience-ai:envie-en-attente'

export default function Envie() {
  const { user } = useAuthStore()
  const { messages, brief, estComplet, ajouterMessage, mettreAJourBrief, reinitialiser } = useDialogueStore()
  const [saisie, setSaisie] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [generationEnCours, setGenerationEnCours] = useState(false)
  const navigate = useNavigate()
  const finListe = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finListe.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, enCours])

  // Retour de connexion : l'envie mise de côté revient dans le champ, prête à
  // partir. On ne l'envoie pas d'office — c'est à l'utilisateur de décider.
  useEffect(() => {
    if (!user) return
    const enAttente = sessionStorage.getItem(ENVIE_EN_ATTENTE)
    if (!enAttente) return
    sessionStorage.removeItem(ENVIE_EN_ATTENTE)
    setSaisie(enAttente)
  }, [user])

  const envoyer = async (texte: string) => {
    if (!texte.trim() || enCours) return
    // Une envie ne se perd pas parce qu'il faut se connecter : on la met de
    // côté et on la remet dans le champ au retour. Sinon le tout premier geste
    // du produit — écrire ce qu'on veut vivre — s'efface sans un mot.
    if (!user) {
      sessionStorage.setItem(ENVIE_EN_ATTENTE, texte)
      toast('Connecte-toi pour continuer — on garde ton envie de côté.')
      navigate('/login')
      return
    }

    ajouterMessage('utilisateur', texte)
    setSaisie('')
    setEnCours(true)
    try {
      const etape = await avancerDialogue(brief, texte)
      mettreAJourBrief(etape.brief, etape.estComplet)
      ajouterMessage('produit', etape.reponse)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnCours(false)
    }
  }

  const generer = async () => {
    setGenerationEnCours(true)
    try {
      // Le brief est complet (estComplet) : le serveur revalide de toute façon.
      const { parcours } = await genererParcours(brief as Brief)
      reinitialiser()
      toast.success('Votre parcours est prêt')
      navigate(`/parcours/${parcours.id}`)
    } catch (e) {
      toast.error((e as Error).message)
      setGenerationEnCours(false)
    }
  }

  return (
    <PageLayout>
      <Seo title="Experience AI — Qu'as-tu envie de vivre ?" />
      <section className="max-w-2xl mx-auto pt-8 sm:pt-16">
        <h1 className="text-3xl sm:text-5xl font-bold text-encre text-center leading-tight">
          Qu'as-tu envie de <span className="text-soleil">vivre</span> ?
        </h1>
        <p className="text-brume text-center mt-4 max-w-lg mx-auto">
          Décris ton envie — pas une destination. On construit ensemble un parcours
          de moments cohérents, que tu pourras ajuster élément par élément.
        </p>

        {/* Suggestions au premier contact */}
        {messages.length === 0 && (
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => envoyer(s)}>{s}</button>
            ))}
          </div>
        )}

        {/* Fil du dialogue */}
        {messages.length > 0 && (
          <div className="carte mt-8 p-4 sm:p-6 space-y-3 max-h-[50vh] overflow-y-auto" role="log" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={`msg-enter flex ${m.de === 'utilisateur' ? 'justify-end' : 'justify-start'}`}>
                <div className={m.de === 'utilisateur' ? 'bulle-utilisateur max-w-[85%]' : 'bulle-produit max-w-[85%]'}>
                  {m.texte}
                </div>
              </div>
            ))}
            {enCours && (
              <div className="flex justify-start">
                <div className="bulle-produit inline-flex gap-1.5" aria-label="Le produit réfléchit">
                  <span className="typing-dot w-2 h-2 rounded-full bg-brume inline-block" />
                  <span className="typing-dot w-2 h-2 rounded-full bg-brume inline-block" />
                  <span className="typing-dot w-2 h-2 rounded-full bg-brume inline-block" />
                </div>
              </div>
            )}
            <div ref={finListe} />
          </div>
        )}

        {/* Confirmation du brief (doc 05, étape 4 : rien ne se génère sans accord) */}
        {estComplet && !generationEnCours && (
          <div className="carte mt-4 p-4 flex flex-col sm:flex-row items-center gap-3 border-lagon/40">
            <p className="text-sm text-encre-light flex-1">
              Le brief te convient ? Tu peux encore corriger en écrivant ci-dessous.
            </p>
            <button className="btn-primaire whitespace-nowrap" onClick={generer}>
              Construire mon parcours
            </button>
          </div>
        )}

        {generationEnCours && (
          <div className="carte mt-4 p-6 text-center">
            <p className="font-heading font-semibold text-encre">Construction du parcours…</p>
            <p className="text-sm text-brume mt-1">Moments, justifications, temps libres : quelques secondes.</p>
            <div className="mt-4 space-y-2">
              <div className="skeleton h-4 w-3/4 mx-auto" />
              <div className="skeleton h-4 w-2/3 mx-auto" />
              <div className="skeleton h-4 w-1/2 mx-auto" />
            </div>
          </div>
        )}

        {/* Saisie */}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); envoyer(saisie) }}
        >
          <label htmlFor="envie" className="sr-only">Décris ton envie</label>
          <input
            id="envie"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={messages.length === 0 ? 'Ex. : revoir les lieux de mon enfance avec ma sœur…' : 'Réponds ou corrige ici…'}
            className="flex-1 px-4 py-3 rounded-xl border border-encre/15 bg-white text-encre
                       placeholder:text-brume focus:border-soleil focus:outline-none"
            maxLength={500}
            disabled={generationEnCours}
          />
          <button type="submit" className="btn-primaire" disabled={enCours || generationEnCours || !saisie.trim()}>
            Envoyer
          </button>
        </form>

        {messages.length > 0 && !generationEnCours && (
          <button className="text-xs text-brume hover:text-encre mt-3 underline cursor-pointer" onClick={reinitialiser}>
            Repartir d'une nouvelle envie
          </button>
        )}
      </section>
    </PageLayout>
  )
}
