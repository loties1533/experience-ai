import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Pack, TravelMode } from '../../../server/lib/types'

// SEARCH STORE — état de la recherche et du pack
interface SearchState {
  destination: string;
  origin: string;
  departure: string;
  returnDate: string;
  travelers: number;
  budget: number;
  mode: TravelMode | string;
  prefs: string[];
  concepts: unknown[] | null;
  pack: Pack | null;
  tripId: string | null;
  packId: string | null;
  isLoading: boolean;
  error: string | null;
  setField: (key: keyof SearchState, valeur: SearchState[keyof SearchState]) => void;
  setPack: (pack: Pack | null, tripId: string | null, packId?: string | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  clearPack: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      // Formulaire
      destination: '',
      origin:      'Paris',
      departure:   '',
      returnDate:  '',
      travelers:   2,
      budget:      2000,
      mode:        'party',
      prefs:       [],

      // Results
      concepts:    null,
      pack:        null,
      tripId:      null,
      packId:      null,
      isLoading:   false,
      error:       null,

      // Actions
      setField:    (key, valeur) => set({ [key]: valeur } as Partial<SearchState>),
      // packId optionnel : si non fourni (ex: chat de modif), on garde l'ancien
      setPack:     (pack, tripId, packId) => set((s) => ({ pack, tripId, packId: packId !== undefined ? packId : s.packId, isLoading: false, error: null })),
      setLoading:  (v) => set({ isLoading: v }),
      setError:    (e) => set({ error: e, isLoading: false }),
      clearPack:   () => set({ pack: null, tripId: null, packId: null }),
    }),
    {
      name:    'tg_v2_search',
      partialize: (s) => ({ destination: s.destination } as any),
    }
  )
)

// CHAT STORE — état du chatbot onboarding
export interface ChatMessage {
  id?: number | string;
  role: 'user' | 'assistant' | 'bot';
  text?: string;
  chips?: (string | { label: string })[];
  isFlightSearch?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  chatData: Record<string, unknown>;
  isTyping: boolean;
  isReady: boolean;
  turnCount: number;
  isMockMode: boolean;
  quizMode: boolean;
  quizStep: number;
  addMessage: (message: ChatMessage) => void;
  setTyping: (v: boolean) => void;
  mergeChatData: (data: Record<string, unknown>) => void;
  seedChatData: (data: Record<string, unknown>) => void;
  setReady: (v: boolean) => void;
  setMockMode: (v: boolean) => void;
  setQuizMode: (v: boolean) => void;
  nextQuizStep: () => void;
  resetChat: () => void;
}

// Valeurs par défaut du chatData — définies une seule fois, réutilisées à l'init et dans resetChat.
const CHAT_DATA_DEFAUT: Record<string, unknown> = {
  travelers:     null,
  profile:       null,
  mode:          'party',
  premium:       false,
  interests:     [],
  budget:        null,
  origin:        '',
  destination:   null,
  duration:      null,
  departure:     null,
  return_date:   null,
};

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      chatData: { ...CHAT_DATA_DEFAUT },
      isTyping:   false,
      isReady:    false,
      turnCount:  0,
      isMockMode: false,
      quizMode:   false,
      quizStep:   0,

      addMessage:    (message) => set((s) => ({ messages: [...s.messages, { id: Date.now() + Math.random(), ...message }] })),
      setTyping:     (v) => set({ isTyping: v }),
      mergeChatData: (data) => set((s) => ({ chatData: { ...s.chatData, ...data }, turnCount: s.turnCount + 1 })),
      // Pré-remplissage (préférences user) — ne compte PAS comme un tour de conversation
      seedChatData:  (data) => set((s) => ({ chatData: { ...s.chatData, ...data } })),
      setReady:      (v) => set({ isReady: v }),
      setMockMode:   (v) => set({ isMockMode: v }),
      setQuizMode:   (v) => set({ quizMode: v, quizStep: 0 }),
      nextQuizStep:  ()  => set((s) => ({ quizStep: s.quizStep + 1 })),

      resetChat: () => set({
        messages:   [],
        chatData:   { ...CHAT_DATA_DEFAUT },
        isTyping:   false,
        isReady:    false,
        turnCount:  0,
        isMockMode: false,
        quizMode:   false,
        quizStep:   0,
      }),
    }),
    {
      name: 'tg_v2_chat',
      partialize: (s) => ({ chatData: s.chatData }) as any,
    }
  )
)

// AUTH STORE — utilisateur connecté
interface User {
  id: string;
  email: string;
  [key: string]: any;
}

interface AuthState {
  user: User | null;
  setAuth: (user: User | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth:  (user) => set({ user }),        // plus de token — géré par cookie httpOnly
      clearAuth: () => set({ user: null }),
    }),
    { name: 'tg_v2_auth', partialize: (s) => ({ user: s.user }) }
  )
)

