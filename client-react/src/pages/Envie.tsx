import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { Bouton } from '../components/ui/Bouton'
import { ImageContextuelle } from '../components/ui/ImageContextuelle'
import { BanniereStatutMetier } from '../components/ui/StatutMetier'
import { useAuthStore, useDialogueStore } from '../store'
import { avancerDialogue, genererParcours, type Brief } from '../lib/api'
import { statutMetierDepuisErreur } from '../lib/erreurAffichage'

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
  const [erreurGeneration, setErreurGeneration] = useState<{ statut: 'refus' | 'indisponible'; message: string } | null>(null)
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
    setErreurGeneration(null)
    try {
      // Le brief est complet (estComplet) : le serveur revalide de toute façon.
      const { parcours } = await genererParcours(brief as Brief)
      reinitialiser()
      toast.success('Votre parcours est prêt')
      navigate(`/parcours/${parcours.id}`)
    } catch (e) {
      const statut = statutMetierDepuisErreur(e)
      if (statut) {
        setErreurGeneration({ statut, message: (e as Error).message })
      } else {
        toast.error((e as Error).message)
      }
      setGenerationEnCours(false)
    }
  }

  return (
    <PageLayout>
      <Seo title="Experience AI — Qu'as-tu envie de vivre ?" />
      <section className="conteneur-etroit pt-6 sm:pt-10">
        {/* Bande éditoriale : pose l'univers voyage avant le premier mot tapé,
            hauteur bornée pour que le formulaire reste visible sans scroll. */}
        <ImageContextuelle
          alt="Bande éditoriale d'ouverture — sera remplacée par une photographie réelle du produit"
          ratio="hero"
          prioritaire
          className="max-h-40 sm:max-h-56"
        />

        <h1 className="text-3xl sm:text-5xl font-bold text-encre text-center leading-tight mt-6 sm:mt-8">
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
        {estComplet && !generationEnCours && !erreurGeneration && (
          <div className="carte mt-4 p-4 flex flex-col sm:flex-row items-center gap-3 border-lagon/40">
            <p className="text-sm text-encre-light flex-1">
              Le brief te convient ? Tu peux encore corriger en écrivant ci-dessous.
            </p>
            <Bouton onClick={generer} className="whitespace-nowrap">
              Construire mon parcours
            </Bouton>
          </div>
        )}

        {/* Le serveur ne renvoie qu'un résultat final (pas d'étapes intermédiaires
            exposées à l'API) : on reste honnête sur ce qu'on sait — le parcours
            se construit — sans mimer une progression par lots qu'on n'observe pas. */}
        {generationEnCours && (
          <div className="carte mt-4 p-6 text-center" role="status" aria-live="polite">
            <span className="inline-flex w-10 h-10 rounded-full bg-soleil/10 items-center justify-center motion-safe:animate-pulse">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-soleil">
                <path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
            <p className="titre-section mt-3">Construction du parcours…</p>
            <p className="texte-secondaire mt-1">
              Moments, justifications, temps libres : quelques secondes, on ne quitte pas la page.
            </p>
          </div>
        )}

        {/* Refus (422) ou panne technique (503) — jamais réduits à un toast qui disparaît. */}
        {erreurGeneration && (
          <div className="mt-4">
            <BanniereStatutMetier
              statut={erreurGeneration.statut}
              action={
                <Bouton variante="secondaire" onClick={() => setErreurGeneration(null)}>
                  {erreurGeneration.statut === 'refus' ? 'Reformuler' : 'Réessayer'}
                </Bouton>
              }
            >
              {erreurGeneration.message}
            </BanniereStatutMetier>
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
                       placeholder:text-brume transition-colors
                       focus:border-soleil focus:outline-none focus:ring-2 focus:ring-soleil/25"
            maxLength={500}
            disabled={generationEnCours}
          />
          <Bouton type="submit" disabled={enCours || generationEnCours || !saisie.trim()}>
            Envoyer
          </Bouton>
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
