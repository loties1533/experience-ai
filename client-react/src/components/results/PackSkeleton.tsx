import { useState, useEffect } from 'react'
import Logo from '../ui/Logo'

// Images et textes qui défilent pendant le chargement
const LOADING_SLIDES = [
  {
    img: "https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1920&q=80",
    text: "On cherche les plus belles adresses…",
    sub: "En croisant les avis voyageurs et les coups de cœur locaux"
  },
  {
    img: "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1920&q=80",
    text: "On compose votre séjour…",
    sub: "Des incontournables et quelques adresses plus confidentielles"
  },
  {
    img: "https://images.unsplash.com/photo-1549294413-26f195200c16?auto=format&fit=crop&w=1920&q=80",
    text: "On cale votre itinéraire…",
    sub: "Un rythme pensé pour profiter sans courir"
  },
  {
    img: "https://images.unsplash.com/photo-1519659528534-7fd733a832a0?auto=format&fit=crop&w=1920&q=80",
    text: "On repère ce qui se passe sur place…",
    sub: "Concerts, soirées et bonnes tables du moment"
  },
  {
    img: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1920&q=80",
    text: "On finalise votre pack…",
    sub: "Un dernier coup d'œil avant de vous le montrer"
  }
]

export default function PackSkeleton() {
  const [current, setCurrent] = useState(0)
  const [progress, setProgress] = useState(0)

  // Auto-avancement des slides (changement toutes les 6s)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent(prev => (prev + 1) % LOADING_SLIDES.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  // Barre de progression qui avance lentement (120s max, ~30s en général)
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95 // Jamais à 100 avant que le résultat arrive
        return prev + 0.4
      })
    }, 200)
    return () => clearInterval(timer)
  }, [])

  const slide = LOADING_SLIDES[current]

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-ink">

      {/* Image de fond qui change */}
      
        <div
          key={current}
          className="absolute inset-0"
>
          <img
            src={slide.img}
            alt="loading"
            className="w-full h-full object-cover"
          />
          {/* Voile noir profond */}
          <div className="absolute inset-0 bg-ink/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/60" />
        </div>
      

      {/* Contenu centré */}
      <div className="relative z-10 text-center px-8 max-w-2xl mx-auto">
        {/* Logo animé */}
        <div
          className="w-16 h-16 mx-auto mb-10 rounded-full border border-gold/30 flex items-center justify-center">
          <Logo size={30} className="text-gold-dark" />
        </div>

        {/* Badge */}
        <p className="text-[10px] uppercase tracking-[0.4em] text-gold-dark font-semibold mb-6">
          TripGenie — Génération en cours
        </p>

        {/* Texte principal qui change */}
        
          <h2
            key={current + 'text'}
            className="text-3xl sm:text-4xl text-white font-bold mb-4 leading-snug">
            {slide.text}
          </h2>
        

        
          <p
            key={current + 'sub'}
            className="text-parchment/50 text-sm font-light italic tracking-wide">
            {slide.sub}
          </p>
        

        {/* Barre de progression */}
        <div className="mt-12 w-full max-w-xs mx-auto">
          <div className="h-px w-full bg-ink/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold-dark via-gold to-gold-light rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-white/30 mt-3 tracking-widest uppercase">
            {Math.round(progress)}% — Préparation en cours
          </p>
        </div>

        {/* Points d'étape */}
        <div className="flex justify-center gap-2 mt-8">
          {LOADING_SLIDES.map((_, i) => (
            <span key={i}
              className={`w-1.5 h-1.5 rounded-sm transition-all duration-500 ${i === current ? 'bg-gold w-4' : 'bg-white/20'}`}
            />
          ))}
        </div>
      </div>

      {/* Citation en bas */}
      <div className="absolute bottom-10 left-0 right-0 text-center z-10">
        <p className="text-white/20 text-xs italic tracking-wider">
          "Les plus beaux voyages commencent par une envie"
        </p>
      </div>
    </div>
  )
}
