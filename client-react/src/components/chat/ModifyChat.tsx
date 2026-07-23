import { useState, useRef, useEffect } from 'react'
import { useSearchStore } from '../../store'
import Logo from '../ui/Logo'

interface MessageChat {
  role: 'user' | 'assistant'
  text: string
}

interface ModifyChatProps {
  tripId?: string
  mode?: string
}

const SUGGESTIONS = [
  'Hôtel moins cher',
  'Activité premium',
  'Vol direct',
  'Plus d\'activités',
]

export default function ModifyChat({ tripId, mode }: ModifyChatProps) {
  const { pack, setPack } = useSearchStore()
  const [messages, setMessages] = useState<MessageChat[]>([
    { role: 'assistant', text: 'Envie de changer quelque chose ? Dites-moi tout.' }
  ])
  const [input, setInput] = useState('')
  const [chargement, setChargement] = useState(false)
  const refBas = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refBas.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const envoyer = async (text?: string) => {
    const message = (text ?? input).trim()
    if (!message || chargement) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: message }])
    setChargement(true)

    try {
      const reponse = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: message,
          current_pack: pack,
          mode: mode || 'party',
          trip_id: tripId ?? null,
        }),
      })
      const donneesReponse = await reponse.json()
      // On ne fusionne QUE si l'IA a réellement renvoyé des changements.
      // Chaque clé présente (activities/hotels/itinerary) remplace la liste
      // correspondante → l'IA doit renvoyer la liste complète et à jour
      // (cf. prompt chatModify côté serveur), sinon les anciens éléments sont perdus
      const mods = donneesReponse.modifications
      const aDesModifs = mods && typeof mods === 'object' && Object.keys(mods).length > 0
      if (aDesModifs && pack) {
        setPack({ ...pack, ...mods }, tripId ?? null)
      }
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: donneesReponse.response
            || (aDesModifs ? 'Modification effectuée' : "Je n'ai pas réussi à appliquer ce changement — pouvez-vous reformuler ?"),
        },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Connexion perdue — on réessaie ?' },
      ])
    } finally {
      setChargement(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-gold-dark flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                <Logo size={13} className="text-white" />
              </div>
            )}
            <div className={`max-w-[82%] px-3.5 py-2.5 rounded-sm text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-gold text-ink'
                : 'glass text-ink border border-gold/10'
            }`}>
              {m.text}
            </div>
          </div>
        ))}

        {chargement && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-gold-dark flex items-center justify-center mr-2 mt-1 flex-shrink-0">
              <Logo size={13} className="text-white" />
            </div>
            <div className="glass px-4 py-3 rounded-sm border border-gold/10">
              <span className="flex gap-1.5 items-center">
                {[0, 150, 300].map(delay => (
                  <span key={delay} className="w-1.5 h-1.5 rounded-sm bg-gold animate-bounce"
                    style={{ animationDelay: `${delay}ms` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={refBas} />
      </div>

      {/* Suggestions rapides */}
      {messages.length === 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => envoyer(s)}
              className="text-[11px] px-3 py-1.5 rounded-sm border border-gold/30 text-gold-dark hover:bg-gold/10 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Saisie */}
      <div className="border-t border-gold/10 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && envoyer()}
            placeholder="Remplace l'hôtel par..."
            className="flex-1 bg-ink/5 border border-gold/20 rounded-sm px-3.5 py-2.5 text-sm
                       text-ink placeholder:text-muted
                       focus:outline-none focus:border-gold/50 transition-colors"
          />
          <button
            onClick={() => envoyer()}
            disabled={chargement || !input.trim()}
            className="bg-gold hover:bg-gold/80 disabled:opacity-30 text-ink
                       w-10 h-10 rounded-sm font-bold transition-all flex items-center justify-center"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
