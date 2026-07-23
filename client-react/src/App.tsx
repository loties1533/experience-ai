// Racine de l'app : monte React Query, les routes et les notifications (Toaster).
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuthStore, useSearchStore } from './store'
import Home        from './pages/Home'
import Trips       from './pages/Trips'
import TripDetail  from './pages/TripDetail'
import Login       from './pages/Login'
import Preferences from './pages/Preferences'

// Cache partagé : une donnée reste « fraîche » 5 min avant d'être rechargée, 1 seule reprise si erreur
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 }
  }
})

function AppCleanup() {
  const { user } = useAuthStore()
  const { clearPack } = useSearchStore()
  useEffect(() => {
    // Si pas connecté au démarrage, on vide le vieux voyage du cache
    if (!user) clearPack()
  }, [])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppCleanup />
        <Routes>
          <Route path="/"            element={<Home />} />
          <Route path="/trips"       element={<Trips />} />
          <Route path="/trip/:id"    element={<TripDetail />} />
          <Route path="/login"       element={<Login />} />
          <Route path="/preferences" element={<Preferences />} />
        </Routes>
        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            style: {
              fontFamily: '"DM Sans", sans-serif',
              fontSize:   '14px',
            }
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
