import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { Bouton } from '../components/ui/Bouton'
import { Hero, type AmbianceHero } from '../components/ui/Hero'
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

// Ambiances du hero — plusieurs expériences derrière une question stable. Les
// `alt` décrivent une émotion, jamais un lieu présenté comme réel (loi produit).
// Provenance et licences : public/assets/hero/PROVENANCE.md.
const AMBIANCES_HERO: AmbianceHero[] = [
  { nom: 'hero-1-sport',      alt: "L'énergie d'une salle comble, lumières en mouvement", focusDesktop: 'center',       focusMobile: 'center',     largeur: 1280, hauteur: 853 },
  { nom: 'hero-2-amis',       alt: 'Des amis réunis sur un toit, en fin de journée',       focusDesktop: 'center 40%', focusMobile: 'center 45%', largeur: 1280, hauteur: 720 },
  { nom: 'hero-3-concert',    alt: 'Une foule, mains levées, sous les lumières',           focusDesktop: 'center 42%', focusMobile: 'center 40%', largeur: 1280, hauteur: 853 },
  { nom: 'hero-4-romantisme', alt: 'Deux personnes se tiennent la main pendant un dîner',  focusDesktop: 'center 60%', focusMobile: 'center 58%', largeur: 1280, hauteur: 1920 },
  { nom: 'hero-5-aventure',   alt: 'Des amis autour d’un feu de camp, à la tombée du soir',focusDesktop: 'center 55%', focusMobile: 'center 52%', largeur: 1280, hauteur: 720 },
  { nom: 'hero-6-culture',    alt: 'Une personne face à une grande installation',          focusDesktop: 'center 42%', focusMobile: 'left 42%',   largeur: 1280, hauteur: 853 },
  { nom: 'hero-7-evasion',    alt: 'Des falaises et l’océan à perte de vue',               focusDesktop: 'center 42%', focusMobile: 'center 45%', largeur: 1280, hauteur: 1707 },
]

/** L'envie écrite avant connexion, gardée le temps de l'aller-retour. */
const ENVIE_EN_ATTENTE = 'experience-ai:envie-en-attente'

export default function Envie() {
  const { user } = useAuthStore()
  const { messages, brief, estComplet, etatDialogue, ajouterMessage, mettreAJourBrief, reinitialiser } = useDialogueStore()
  const [saisie, setSaisie] = useState(() => {
    if (!user) return ''
    const enAttente = sessionStorage.getItem(ENVIE_EN_ATTENTE)
    if (!enAttente) return ''
    sessionStorage.removeItem(ENVIE_EN_ATTENTE)
    return enAttente
  })
  const [enCours, setEnCours] = useState(false)
  const [generationEnCours, setGenerationEnCours] = useState(false)
  const [erreurGeneration, setErreurGeneration] = useState<{ statut: 'refus' | 'indisponible'; message: string } | null>(null)
  const navigate = useNavigate()
  const finListe = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finListe.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, enCours])

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
      const etape = await avancerDialogue(brief, texte, etatDialogue)
      mettreAJourBrief(etape.brief, etape.estComplet, etape.etatDialogue)
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
      const resultat = await genererParcours(brief as Brief)
      if (resultat.type === 'clarification_requise') {
        mettreAJourBrief(brief, false, resultat.etatDialogue)
        ajouterMessage('produit', resultat.clarification.question)
        setGenerationEnCours(false)
        return
      }
      const { parcours } = resultat
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
    <PageLayout piedDePage={false} heroImmersif>
      <Seo title="Experience AI — Qu'as-tu envie de vivre ?" />

      {/* Hero immersif : plusieurs expériences derrière une question stable. Le
          champ d'intention est le vrai point d'entrée — même logique qu'avant. */}
      <Hero ambiances={AMBIANCES_HERO}>
        <h1 className="font-heading font-semibold text-white text-4xl sm:text-5xl leading-[1.08] drop-shadow-[0_2px_12px_rgba(23,18,14,0.45)]">
          Qu'as-tu envie de vivre&nbsp;?
        </h1>
        <p className="mt-4 text-ivoire/90 text-base sm:text-lg drop-shadow-[0_1px_8px_rgba(23,18,14,0.5)]">
          Décris ton envie — pas une destination.
        </p>

        <form
          className="mt-7 w-full max-w-xl flex gap-2"
          onSubmit={(e) => { e.preventDefault(); envoyer(saisie) }}
        >
          <label htmlFor="envie" className="sr-only">Décris ton envie</label>
          <input
            id="envie"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={messages.length === 0 ? 'Ex. : voir un match NBA avec mon frère…' : 'Réponds ou corrige ici…'}
            className="flex-1 min-w-0 px-4 py-3.5 rounded-xl bg-white text-encre shadow-card
                       placeholder:text-brume focus:outline-none focus:ring-2 focus:ring-laiton"
            maxLength={500}
            disabled={generationEnCours}
          />
          <Bouton type="submit" className="!py-3.5 shadow-card" disabled={enCours || generationEnCours || !saisie.trim()}>
            Envoyer
          </Bouton>
        </form>

        {/* Suggestions au premier contact — défilables horizontalement sur mobile */}
        {messages.length === 0 && (
          <div className="hero-chips mt-5 w-full max-w-xl">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip whitespace-nowrap shrink-0" onClick={() => envoyer(s)}>{s}</button>
            ))}
          </div>
        )}
      </Hero>

      {/* Dialogue et suite du flux — sous le hero, quand il y a quelque chose à montrer */}
      {(messages.length > 0 || estComplet || generationEnCours || erreurGeneration) && (
        <section className="conteneur-etroit py-8 space-y-4">
          {/* Fil du dialogue */}
          {messages.length > 0 && (
            <div className="carte p-4 sm:p-6 space-y-3 max-h-[60vh] overflow-y-auto" role="log" aria-live="polite">
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
            <div className="carte p-4 flex flex-col sm:flex-row items-center gap-3 border-laiton/40">
              <p className="text-sm text-encre-light flex-1">
                Le brief te convient ? Tu peux encore corriger en écrivant plus haut.
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
            <div className="carte p-6 text-center" role="status" aria-live="polite">
              <span className="inline-flex w-10 h-10 rounded-full bg-terracotta/10 items-center justify-center motion-safe:animate-pulse">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-terracotta">
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
          )}

          {messages.length > 0 && !generationEnCours && (
            <button className="text-xs text-brume hover:text-encre underline cursor-pointer" onClick={reinitialiser}>
              Repartir d'une nouvelle envie
            </button>
          )}
        </section>
      )}
    </PageLayout>
  )
}
