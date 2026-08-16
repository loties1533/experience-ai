// Racine de l'app : monte React Query, les routes et les notifications (Toaster).
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import Envie from './pages/Envie'
import MesParcours from './pages/MesParcours'
import ParcoursDetail from './pages/ParcoursDetail'
import ParcoursPartage from './pages/ParcoursPartage'
import Login from './pages/Login'
import Preferences from './pages/Preferences'

// Cache partagé : une donnée reste « fraîche » 5 min, une seule reprise si erreur
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/"              element={<Envie />} />
          <Route path="/parcours"      element={<MesParcours />} />
          <Route path="/parcours/:id"  element={<ParcoursDetail />} />
          {/* Le parcours vu par le groupe : seule page accessible sans compte */}
          <Route path="/partage/:jeton" element={<ParcoursPartage />} />
          <Route path="/login"         element={<Login />} />
          <Route path="/preferences"   element={<Preferences />} />
        </Routes>
        <Toaster
          position="top-center"
          richColors
          toastOptions={{ style: { fontSize: '14px' } }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
