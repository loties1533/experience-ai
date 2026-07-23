import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore, useSearchStore } from '../../store'
import { chatOnboarding, getDestinations, getPreferences } from '../../lib/api'
import Logo from '../ui/Logo'

// ---- CORRECTIF 3 : date locale — évite le décalage UTC/local pour les users UTC- ----
// toISOString() retourne UTC ; pour UTC-5 à 23h30, ça donne "demain".
// localDateStr() utilise les méthodes locales du navigateur → toujours le bon jour.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ajouterJours(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

// ---- CORRECTIF 6 : utilitaire centralisé — était dupliqué 3 fois ----
function computeReturnDate(departure: string, durationDays: number): string {
  return localDateStr(new Date(new Date(departure).getTime() + durationDays * 86400000))
}

// Formatage du récap
function buildRecapMessage(data: Record<string, unknown>): string {
  const profileMap: Record<string, string> = {
    couple:  'En couple',
    amis:    'Entre amis',
    famille: 'En famille',
    solo:    'En solo',
  }
  const modeMap: Record<string, string> = {
    party:    'Fête',
    student:  'Étudiant',
    group:    'Groupe',
    relax:    'Détente',
    surprise: 'Surprise',
  }
  const profile   = profileMap[data.profile as string] || (data.profile as string) || '—'
  const style     = modeMap[data.mode as string] || (data.mode as string) || '—'
  const gamme     = data.premium ? ' · Premium' : ''
  const travelers = data.travelers
    ? `${data.travelers} personne${(data.travelers as number) > 1 ? 's' : ''}`
    : '—'
  // CORRECTIF 5 : budget peut arriver en string depuis l'IA — Number() avant toLocaleString
  const budget = data.budget
    ? `${Number(data.budget).toLocaleString('fr-FR')}€`
    : '—'
  // CORRECTIF 5 : departure manquant = avertissement visible, pas '—' silencieux
  const departure = (data.departure as string) || 'date non précisée'
  const duration  = data.duration
    ? `${data.duration} jour${(data.duration as number) > 1 ? 's' : ''}`
    : '—'
  return `Récap de votre voyage :\n• ${profile} — ${travelers}\n• Style : ${style}${gamme}\n• Budget : ${budget}\n• Départ : ${departure}, durée : ${duration}`
}

// QUIZ STEPS
const QUIZ_STEPS = [
  {
    // L'occasion ne définit QUE le profil (avec qui) — jamais le mode/ambiance.
    // Associer une personne à un mode faussait tout (un duo peut être luxe, fête…).
    key:      'occasion',
    question: "Quelle est l'occasion de ce voyage ?",
    chips: [
      { label: 'En couple',  data: { profile: 'couple'  } },
      { label: 'Entre amis', data: { profile: 'amis'    } },
      { label: 'En famille', data: { profile: 'famille' } },
      { label: 'En solo',    data: { profile: 'solo'    } },
    ]
  },
  {
    // Étape « ambiance/style » = le vrai mode. Sautée si l'utilisateur a une
    // préférence de style (default_mode) → appliquée directement, pas de question.
    key:      'style',
    question: 'Quelle ambiance pour ce voyage ?',
    chips: [
      { label: 'Fête',     data: { mode: 'party'    } },
      { label: 'Étudiant', data: { mode: 'student'  } },
      { label: 'Groupe',   data: { mode: 'group'    } },
      { label: 'Détente',  data: { mode: 'relax'    } },
      { label: 'Surprise', data: { mode: 'surprise' } },
    ]
  },
  {
    // Niveau de prix = axe INDÉPENDANT de l'ambiance (ex. une Détente peut être
    // Premium ou Classique). Remplace l'ancien mode « Luxe » fourre-tout.
    key:      'premium',
    question: 'Quel standing pour ce voyage ?',
    chips: [
      { label: 'Classique', data: { premium: false } },
      { label: 'Premium',   data: { premium: true  } },
    ]
  },
  {
    key:      'travelers',
    question: 'Vous serez combien ?',
    chips: [
      { label: '2 personnes',       data: { travelers: 2 } },
      { label: '3-4 personnes',     data: { travelers: 4 } },
      { label: '5-8 personnes',     data: { travelers: 6 } },
      // Au-delà de 8 : on laisse saisir le nombre EXACT (saisie en ligne), pas un preset flou.
      { label: 'Nombre exact…', data: null            },
    ]
  },
  {
    key:      'budget',
    question: 'Quel budget pour ce voyage ?',
    chips: [
      { label: 'Dès 1 500€',         data: { budget: 1500  } },
      { label: 'Environ 5 000€',     data: { budget: 5000  } },
      { label: '10 000€ et +',       data: { budget: 15000 } },
      { label: 'Montant précis…', data: null },
    ]
  },
  {
    // Le départ ne fixe QUE la date de départ — plus de durée imposée en douce
    // (avant, « Dans 1 mois » collait 7 jours sans le dire). La durée est demandée
    // à l'étape suivante, ou dérivée des dates si l'utilisateur les précise.
    key:      'departure',
    question: 'Quand souhaitez-vous partir ?',
    chips: [
      { label: 'Ce week-end',        data: () => ({ departure: ajouterJours(3) }) },
      { label: 'La semaine prochaine', data: () => ({ departure: ajouterJours(7) }) },
      { label: 'Date précise…', data: null },
    ]
  },
  {
    key:      'duration',
    question: 'Pour combien de temps ?',
    chips: [
      { label: 'Un week-end (2-3j)', data: { duration: 2  } },
      { label: '1 semaine',          data: { duration: 7  } },
      { label: '2 semaines',         data: { duration: 14 } },
      { label: '3 semaines et +',    data: { duration: 21 } },
    ]
  },
]

// Typing indicator
function TypingDots() {
  return (
    <div className="flex items-end gap-1.5 px-4 py-3">
      {[0,1,2].map(i => (
        <span key={i} className="typing-dot w-2 h-2 rounded-full bg-gold/60 inline-block"
          style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  )
}

// Message bulle + chips
function Message({ msg, onChipClick }: { msg: any; onChipClick?: (label: string) => void }) {
  const isBot = msg.role === 'bot' || msg.role === 'assistant'
  return (
    <div
      className={`flex gap-2 ${isBot ? 'justify-start' : 'justify-end'} msg-enter`}
    >
      {isBot && (
        <div className="w-7 h-7 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0 mt-1">
          <Logo size={15} className="text-gold-dark" />
        </div>
      )}
      <div className={`max-w-[78%] flex flex-col gap-2 ${isBot ? 'items-start' : 'items-end'}`}>
        <div className={isBot ? 'bubble-bot' : 'bubble-user'} style={{ whiteSpace: 'pre-line' }}>{msg.text}</div>
        {isBot && msg.chips?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {msg.chips.map((c: string | { label: string }, i: number) => {
              const label = typeof c === 'string' ? c : c.label
              return onChipClick ? (
                <button key={i} onClick={() => onChipClick(label)}
                  className="chip text-sm hover:border-gold/60 hover:bg-gold/10 active:scale-95 transition-all cursor-pointer">
                  {label}
                </button>
              ) : (
                <StaticChip key={i} label={label} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StaticChip({ label }: { label: string }) {
  return <span className="chip text-sm opacity-60 cursor-default">{label}</span>
}

// Composant InlineInput pour saisir date, voyageurs ou budget
function InlineInput({
  mode,
  dateRange,
  setDateRange,
  travelersCount,
  setTravelersCount,
  budgetAmount,
  setBudgetAmount,
  onConfirm,
  onCancel,
}: {
  mode: 'date' | 'travelers' | 'budget'
  dateRange: { departure: string; return_date: string }
  setDateRange: (v: { departure: string; return_date: string }) => void
  travelersCount: number | ''
  setTravelersCount: (v: number | '') => void
  budgetAmount: number | ''
  setBudgetAmount: (v: number | '') => void
  onConfirm: () => void
  onCancel: () => void
}) {
  // CORRECTIF 3 : date locale — pas de décalage UTC pour les users Americas
  const today = localDateStr(new Date())

  const canConfirm = mode === 'date'
    ? !!dateRange.departure
    : mode === 'travelers'
    ? travelersCount !== '' && (travelersCount as number) >= 1
    : budgetAmount !== '' && (budgetAmount as number) >= 1

  return (
    <div
      className="flex flex-col gap-3 pl-9 pr-4">
      {mode === 'date' ? (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gold-dark font-semibold">Date de départ</label>
            <input
              type="date"
              min={today}
              value={dateRange.departure}
              onChange={e => setDateRange({ ...dateRange, departure: e.target.value })}
              className="bg-ink/5 border border-gold/30 focus:border-gold/70 rounded-sm px-3 py-2 text-sm text-ink outline-none transition-colors w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gold-dark font-semibold">
              Date de retour <span className="text-muted normal-case">(optionnel)</span>
            </label>
            <input
              type="date"
              min={dateRange.departure || today}
              value={dateRange.return_date}
              onChange={e => setDateRange({ ...dateRange, return_date: e.target.value })}
              className="bg-ink/5 border border-gold/30 focus:border-gold/70 rounded-sm px-3 py-2 text-sm text-ink outline-none transition-colors w-44"
            />
          </div>
        </>
      ) : mode === 'travelers' ? (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gold-dark font-semibold">Nombre de voyageurs</label>
          <input
            type="number"
            min={1}
            max={50}
            placeholder="Ex : 7"
            value={travelersCount}
            onChange={e => setTravelersCount(
              e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1)
            )}
            className="bg-ink/5 border border-gold/30 focus:border-gold/70 rounded-sm px-3 py-2 text-sm text-ink outline-none transition-colors w-32"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gold-dark font-semibold">Budget total (€)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={50000}
              step={500}
              placeholder="Ex : 8 000"
              value={budgetAmount}
              onChange={e => setBudgetAmount(
                e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1)
              )}
              className="bg-ink/5 border border-gold/30 focus:border-gold/70 rounded-sm px-3 py-2 text-sm text-ink outline-none transition-colors w-32"
            />
            <span className="text-gold-dark text-sm font-semibold">€</span>
          </div>
        </div>
      )}
      <div className="flex gap-2 mt-1">
        <button onClick={onConfirm} disabled={!canConfirm}
          className="chip text-sm hover:border-gold/60 hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
          Confirmer
        </button>
        <button onClick={onCancel}
          className="chip text-sm opacity-60 hover:opacity-100 transition-all">
          Retour
        </button>
      </div>
    </div>
  )
}


// LOGIQUE TEXTE LIBRE (IA parsing)
async function traiterMessageIA(value: string, ctx: any) {
  const { addMessage, mergeChatData, setTyping, setReady, setMockMode,
          setField, chatData, turnCount, homeCity } = ctx
  const forceReady = turnCount >= 5
  try {
    setTyping(true)
    const reponse = await chatOnboarding(value, chatData)
    setTyping(false)
    if (reponse.isMock) setMockMode(true)
    if (reponse.extractedData) mergeChatData(reponse.extractedData)
    const merged = { ...chatData, ...(reponse.extractedData || {}) }
    // Origine : ce que l'utilisateur a précisé, sinon sa ville de préférence, sinon Paris
    merged.origin = merged.origin || homeCity || 'Paris'
    if (reponse.isReady || forceReady) {
      setReady(true)
      addMessage({ role: 'bot', text: "C'est noté. Je vous cherche trois destinations…" })
      await suggestDestinations(merged, { addMessage, setTyping, setField, setReady })
    } else {
      addMessage({ role: 'bot', text: reponse.response, chips: reponse.chips || [] })
    }
  } catch {
    setTyping(false)
    addMessage({ role: 'bot', text: 'Petit souci technique de mon côté — on réessaie ?' })
  }
}

// SUGGESTION DESTINATIONS
async function suggestDestinations(
  chatData: any,
  ctx: any,
  // CORRECTIF 11 : ref de montage — empêche setField sur composant démonté
  guard?: { mounted: { current: boolean } }
) {
  const { addMessage, setTyping, setField, setReady } = ctx
  setTyping(true)
  try {
    const reponse = await getDestinations({
      mode:        chatData.mode,
      premium:     chatData.premium,
      profile:     chatData.profile,
      interests:   chatData.interests,
      budget:      chatData.budget,
      travelers:   chatData.travelers,
      duration:    chatData.duration,
      origin:      chatData.origin || 'Paris',
      departure:   chatData.departure,
    })
    if (guard && !guard.mounted.current) return
    setTyping(false)
    const destinations = reponse.destinations || []
    if (destinations.length) {
      setField('concepts', destinations)
    } else {
      // Échec : l'IA n'a pas renvoyé de destinations : on ne bloque pas l'utilisateur, on lui propose de réessayer
      setReady?.(false)
      addMessage({ role: 'bot', text: "Je n'ai pas réussi à charger les destinations — on réessaie ?" })
    }
  } catch {
    if (guard && !guard.mounted.current) return
    setTyping(false)
    setReady?.(false)
    addMessage({ role: 'bot', text: 'Impossible de charger les destinations. Réessaie !' })
  }
}

// MAIN CHAT WIDGET
export default function ChatWidget() {
  const {
    messages, isTyping, addMessage, mergeChatData, setTyping,
    setReady, setMockMode, chatData, turnCount, isMockMode, isReady,
    quizMode, quizStep, setQuizMode, nextQuizStep, seedChatData,
  } = useChatStore()
  const { setField } = useSearchStore()

  const [input, setInput]   = useState('')
  // CORRECTIF 12 : sendingRef = ref pour éviter la race condition sendMessage/sendChip
  const sendingRef          = useRef(false)
  const [sending, setSending] = useState(false) // pour l'UI (spinner)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const [inputMode, setInputMode]             = useState<null | 'date' | 'travelers' | 'budget'>(null)
  const [dateRange, setDateRange]             = useState({ departure: '', return_date: '' })
  const [travelersCount, setTravelersCount]   = useState<number | ''>('')
  const [budgetAmount, setBudgetAmount]       = useState<number | ''>('')
  // Préférences utilisateur chargées au montage : ville de départ (home_city)
  // style de voyage (default_mode). Le mode vient de la PRÉFÉRENCE, jamais de
  // l'occasion → si une préf de mode existe, on saute l'étape « style » du quiz.
  const [homeCity, setHomeCity] = useState<string>('')
  const [modePref, setModePref] = useState<string>('')
  // Préférence de niveau de prix (default_premium) : null = non définie → on POSE
  // la question dans le quiz ; sinon on la seede et on saute l'étape « premium »
  const [premiumPref, setPremiumPref] = useState<boolean | null>(null)
  useEffect(() => {
    getPreferences()
      .then(({ preferences }) => {
        if (!preferences) return
        if (preferences.home_city) {
          setHomeCity(preferences.home_city)
          // Persiste l'origine si l'utilisateur n'a rien précisé → génération depuis sa ville
          if (!chatData.origin) seedChatData({ origin: preferences.home_city })
        }
        if (preferences.default_mode) {
          setModePref(preferences.default_mode)
          seedChatData({ mode: preferences.default_mode })
        }
        if (typeof preferences.default_premium === 'boolean') {
          setPremiumPref(preferences.default_premium)
          seedChatData({ premium: preferences.default_premium })
        }
        // Centres d'intérêt → orientent destinations ET activités (sur-mesure)
        if (preferences.preferred_prefs?.length) {
          seedChatData({ interests: preferences.preferred_prefs })
        }
      })
      .catch(() => {})
  // CORRECTIF 10 : [] pour ne pas recharger les préférences à chaque render (boucle infinie)
  }, [])

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const initRef    = useRef<boolean>(false)
  // CORRECTIF 11 : ref de montage — empêche setField sur composant démonté.
  // Note : on REMET à true à chaque (re)montage : en React.StrictMode (dev), le cycle
  // mount→unmount→remount laisserait sinon mountedRef à false → la garde bloquerait
  // setField('concepts') et les cartes n'apparaîtraient jamais ("ça charge, rien n'arrive").
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Message de bienvenue
  useEffect(() => {
    if (messages.length === 0 && !initRef.current) {
      initRef.current = true
      setTimeout(() => {
        addMessage({
          role: 'bot',
          text: 'Bienvenue sur TripGenie. Décrivez votre voyage en une phrase, je m\'occupe du reste.',
          chips: [],
        })
      }, 500)
    }
  }, [])

  // CORRECTIF 2 : réinitialiser les états locaux quand resetChat() est appelé (messages vidés)
  useEffect(() => {
    if (messages.length === 0) {
      setAwaitingConfirm(false)
      setInputMode(null)
      setDateRange({ departure: '', return_date: '' })
      setTravelersCount('')
      setBudgetAmount('')
    }
  }, [messages.length])

  useEffect(() => {
    // On scrolle UNIQUEMENT le conteneur des messages (pas la page)
    // scrollIntoView() faisait remonter tous les ancêtres scrollables, dont la
    // fenêtre → toute la page sautait en bas au moindre message / focus input
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isTyping])

  // Handler chip quiz
  const handleQuizChip = useCallback(async (chip: any) => {
    // Pastille de saisie en ligne (data === null)
    if (chip.data === null) {
      if (chip.label.includes('Date précise'))   setInputMode('date')
      if (chip.label.includes('Nombre exact'))   setInputMode('travelers')
      if (chip.label.includes('Montant précis')) setInputMode('budget')
      return
    }

    const chipData = typeof chip.data === 'function' ? chip.data() : chip.data
    addMessage({ role: 'user', text: chip.label })

    mergeChatData(chipData)

    const currentStep = QUIZ_STEPS[quizStep]
    const isLast      = quizStep === QUIZ_STEPS.length - 1

    // CORRECTIF 6 : recalcul return_date via utilitaire centralisé
    if (currentStep.key === 'duration' && chipData?.duration && chatData.departure) {
      mergeChatData({ return_date: computeReturnDate(chatData.departure as string, chipData.duration as number) })
    }

    if (isLast) {
      const merged: Record<string, unknown> = { ...chatData, ...chipData }
      if (merged.departure && merged.duration) {
        merged.return_date = computeReturnDate(merged.departure as string, merged.duration as number)
      }
      setAwaitingConfirm(true)
      setTimeout(() => addMessage({ role: 'bot', text: buildRecapMessage(merged), chips: [] }), 200)
    } else {
      // On avance jusqu'à la prochaine étape NON pré-remplie par les préférences
      // 'style' (si default_mode) et 'premium' (si default_premium) sont seedés en
      // amont → on les saute pour ne pas reposer une question déjà tranchée
      const dejaSeedee = (key: string) =>
        (key === 'style' && !!modePref) || (key === 'premium' && premiumPref !== null)
      let pas = 1
      while (quizStep + pas < QUIZ_STEPS.length && dejaSeedee(QUIZ_STEPS[quizStep + pas].key)) pas++
      for (let k = 0; k < pas; k++) nextQuizStep()
      const next = QUIZ_STEPS[quizStep + pas]
      setTimeout(() => addMessage({ role: 'bot', text: next.question }), 300)
    }
  // CORRECTIF 9 : awaitingConfirm retiré des deps (non lu dans le corps du callback)
  }, [quizStep, chatData, modePref, premiumPref])

  // Confirmation récap
  const handleConfirm = useCallback(async () => {
    setAwaitingConfirm(false)
    const merged: Record<string, unknown> = { ...chatData }
    // Origine : ce que l'utilisateur a précisé, sinon sa ville de préférence, sinon Paris
    merged.origin = merged.origin || homeCity || 'Paris'
    if (merged.departure && merged.duration) {
      merged.return_date = computeReturnDate(merged.departure as string, merged.duration as number)
    }

    // CORRECTIF 5 : validation departure avant d'envoyer à l'IA
    if (!merged.departure) {
      setAwaitingConfirm(true)
      setTimeout(() => addMessage({
        role: 'bot',
        text: "Il manque la date de départ. Cliquez sur « Modifier » pour la renseigner.",
      }), 100)
      return
    }

    addMessage({ role: 'user', text: "C'est parfait !" })
    setTimeout(() => addMessage({ role: 'bot', text: "C'est parti, je cherche vos destinations…" }), 200)
    setReady(true)
    // CORRECTIF 11 : passage de la garde de montage
    await suggestDestinations(merged, { addMessage, setTyping, setField, setReady }, { mounted: mountedRef })
  }, [chatData, homeCity])

  // ---- Modifier → réinitialise chatData + retour à l'étape 0 ----
  const handleModify = useCallback(() => {
    setAwaitingConfirm(false)
    // CORRECTIF 7 : réinitialiser chatData pour éviter les données fantômes du quiz précédent.
    // Le mode retombe sur la PRÉFÉRENCE si elle existe, sinon 'party' → Modifier ne
    // réécrase pas le style choisi par l'utilisateur (préférence prime).
    mergeChatData({ travelers: null, profile: null, mode: modePref || 'party', premium: premiumPref ?? false, budget: null, departure: null, return_date: null, duration: null })
    setQuizMode(true) // reset quizStep = 0
    setTimeout(() => addMessage({ role: 'bot', text: QUIZ_STEPS[0].question }), 200)
  }, [modePref, premiumPref])

  // Confirmation de la saisie en ligne
  const handleInlineConfirm = useCallback(async () => {
    // CORRECTIF 4 : try/finally — inputMode toujours réinitialisé même en cas d'exception
    try {
      if (inputMode === 'date') {
        const dateDepart = dateRange.departure
        const dateRetour = dateRange.return_date
        if (!dateDepart) return

        const label = `Du ${dateDepart}${dateRetour ? ` au ${dateRetour}` : ''}`
        addMessage({ role: 'user', text: label })

        if (dateRetour) {
          // Dates complètes → durée DÉRIVÉE des dates, on saute l'étape durée → récap
          const durationDays = Math.max(1, Math.round((new Date(dateRetour).getTime() - new Date(dateDepart).getTime()) / 86400000))
          mergeChatData({ departure: dateDepart, return_date: dateRetour, duration: durationDays })
          nextQuizStep() // départ → durée (dernier step) pour cohérence d'état
          const merged: Record<string, unknown> = { ...chatData, departure: dateDepart, return_date: dateRetour, duration: durationDays }
          setAwaitingConfirm(true)
          setTimeout(() => addMessage({ role: 'bot', text: buildRecapMessage(merged), chips: [] }), 300)
        } else {
          // Seule la date de départ est fournie → on demande la durée comme étape
          // normale (plus de durée « fantôme » de 7 jours imposée en douce)
          mergeChatData({ departure: dateDepart })
          nextQuizStep() // départ → durée
          const durationStep = QUIZ_STEPS.find(s => s.key === 'duration')!
          setTimeout(() => addMessage({ role: 'bot', text: durationStep.question }), 300)
        }

      } else if (inputMode === 'travelers') {
        // CORRECTIF 8 : !travelersCount est faux positif sur 0 → garde explicite
        if (travelersCount === '') return
        await handleQuizChip({
          label: `${travelersCount} personne${(travelersCount as number) > 1 ? 's' : ''}`,
          data:  { travelers: travelersCount },
        })
      } else if (inputMode === 'budget') {
        // Budget exact saisi à la main — délégué comme un chip budget normal
        if (budgetAmount === '') return
        await handleQuizChip({
          label: `${Number(budgetAmount).toLocaleString('fr-FR')}€`,
          data:  { budget: budgetAmount },
        })
      }
    } catch {
      // CORRECTIF 4 : en cas d'erreur, on informe sans bloquer l'interface
      addMessage({ role: 'bot', text: 'Quelque chose a coincé de mon côté — on réessaie ?' })
    } finally {
      // CORRECTIF 4 : toujours nettoyer l'état inline
      setInputMode(null)
      setDateRange({ departure: '', return_date: '' })
      setTravelersCount('')
      setBudgetAmount('')
    }
  }, [inputMode, dateRange, travelersCount, budgetAmount, handleQuizChip, chatData])

  // Envoi texte libre
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    // CORRECTIF 12 : sendingRef.current = toujours à jour (pas de stale closure comme avec le state)
    if (!text || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setInput('')
    addMessage({ role: 'user', text })
    try {
      await traiterMessageIA(text, {
        addMessage, mergeChatData, setTyping, setReady, setMockMode,
        setField, chatData, turnCount, homeCity,
      })
    } finally {
      sendingRef.current = false
      setSending(false)
      // preventScroll : re-focus l'input SANS que le navigateur fasse défiler la page
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [input, chatData, turnCount, homeCity])

  // Clic sur un chip de réponse bot
  const sendChip = useCallback(async (label: string) => {
    // CORRECTIF 12 : sendingRef empêche la race condition avec sendMessage
    if (sendingRef.current || isTyping) return
    sendingRef.current = true
    setSending(true)
    addMessage({ role: 'user', text: label })
    try {
      await traiterMessageIA(label, {
        addMessage, mergeChatData, setTyping, setReady, setMockMode,
        setField, chatData, turnCount, homeCity,
      })
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [isTyping, chatData, turnCount, homeCity])

  const onKey = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // Choix du mode au démarrage
  const handleModeSelect = useCallback((mode: string) => {
    if (mode === 'quiz') {
      addMessage({ role: 'user', text: 'Questionnaire guidé' })
      setQuizMode(true)
      setTimeout(() => addMessage({ role: 'bot', text: QUIZ_STEPS[0].question }), 300)
    } else {
      addMessage({ role: 'user', text: 'Je décris mon voyage' })
      setQuizMode(false)
      setTimeout(() => addMessage({
        role: 'bot',
        text: 'Décrivez-moi votre voyage en une phrase — je m\'occupe du reste.\nEx : "4 amis, fête, du 15/06 au 21/06, départ Bordeaux, budget 16 000€"',
      }), 300)
    }
  }, [])

  const isWelcomeState = messages.length === 1 && messages[0].role === 'bot' && !quizMode

  return (
    <div className="flex flex-col h-full">
      
        {isMockMode && (
          <div
            className="mx-4 mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200
                       rounded-sm text-xs text-amber-700">
            Mode démonstration — résultats d'exemple
          </div>
        )}
      

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-hide px-4 py-4 flex flex-col gap-4">
        
          {messages.map((msg, idx) => {
            const isLastBot = idx === messages.length - 1
              && (msg.role === 'bot' || msg.role === 'assistant')
              && !quizMode
              && !sending
              && !isTyping
            return (
              <Message key={msg.id} msg={msg} onChipClick={isLastBot ? sendChip : undefined} />
            )
          })}
        

        {/* Choix de mode (accueil) */}
        {isWelcomeState && (
          <div
            className="flex flex-col gap-2 pl-9">
            <button onClick={() => handleModeSelect('quiz')}
              className="w-full text-left px-4 py-3 text-sm text-ink bg-white border border-gray-300 rounded-sm hover:border-gold hover:bg-gold/5 transition-colors cursor-pointer">
              Définir mes préférences (guidé)
            </button>
            <button onClick={() => handleModeSelect('freeform')}
              className="w-full text-left px-4 py-3 text-sm text-ink bg-white border border-gray-300 rounded-sm hover:border-gold hover:bg-gold/5 transition-colors cursor-pointer">
              Décrire mon voyage (libre)
            </button>
          </div>
        )}

        {/* Quiz : input inline OU chips OU récap — masqué dès que l'onboarding
            est validé (isReady) pour ne pas laisser traîner de chips pendant
            le chargement des destinations. */}
        {quizMode && !isWelcomeState && !isReady && (
          <>
            {inputMode ? (
              <InlineInput
                mode={inputMode}
                dateRange={dateRange}
                setDateRange={setDateRange}
                travelersCount={travelersCount}
                setTravelersCount={setTravelersCount}
                budgetAmount={budgetAmount}
                setBudgetAmount={setBudgetAmount}
                onConfirm={handleInlineConfirm}
                onCancel={() => setInputMode(null)}
              />
            ) : awaitingConfirm ? (
              <div
                className="flex flex-wrap gap-2 pl-9">
                <button onClick={handleModify}
                  className="chip text-sm hover:border-gold/60 hover:bg-gold/10 transition-all">
                  Modifier
                </button>
                <button onClick={handleConfirm} disabled={isTyping}
                  className="chip text-sm hover:border-gold/60 hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  C'est parfait
                </button>
              </div>
            ) : (
              <QuizChips step={quizStep} onSelect={handleQuizChip} disabled={isTyping} />
            )}
          </>
        )}

        
          {isTyping && (
            <div className="flex gap-2 justify-start"
>
              <div className="w-7 h-7 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0 mt-1">
                <Logo size={15} className="text-gold-dark" />
              </div>
              <div className="bubble-bot"><TypingDots /></div>
            </div>
          )}
        
      </div>

      {/* Saisie texte libre (mode libre uniquement) */}
      {!quizMode && (
        <div className="px-4 pb-4 pt-2">
          <div className="flex gap-2 items-end bg-white/60 backdrop-blur-md border border-gold/20 rounded-sm p-1 shadow-inner">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Décrivez votre voyage en une phrase..."
              rows={1}
              className="flex-1 resize-none bg-transparent border-none
                         px-4 py-3 text-[15px] text-ink placeholder:text-muted/60
                         focus:outline-none focus:ring-0 transition-all duration-200 max-h-32 overflow-y-auto scroll-hide leading-relaxed"
              style={{ minHeight: '48px' }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                e.currentTarget.style.height = 'auto'
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="w-11 h-11 rounded-sm bg-gold text-ink flex items-center justify-center
                         disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gold-dark
                         transition-all duration-200 flex-shrink-0 hover:shadow-none">
              {sending
                ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
                : <SendIcon />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Quiz chips
function QuizChips({ step, onSelect, disabled }: { step: number; onSelect: (chip: any) => void; disabled: boolean }) {
  const currentStep = QUIZ_STEPS[step]
  if (!currentStep) return null
  return (
    <div key={step}
      className="flex flex-wrap gap-2 pl-9">
      {currentStep.chips.map((chip, i) => (
        <button key={i} onClick={() => !disabled && onSelect(chip)} disabled={disabled}
          className="chip text-sm hover:border-gold/60 hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
          {chip.label}
        </button>
      ))}
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}
