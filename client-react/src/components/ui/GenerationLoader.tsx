export default function GenerationLoader({ destination }: { destination?: string }) {
  return (
    <div className="max-w-lg mx-auto mt-8 px-4">
      <div className="glass rounded-sm p-8 border border-gray-200 text-center">
        <div className="w-10 h-10 mx-auto mb-5 border-2 border-gold/30 border-t-gold-dark rounded-full animate-spin" />
        <h3 className="text-xl font-bold text-ink">
          {destination ? `Création de votre pack pour ${destination}` : 'Création de votre pack'}
        </h3>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          On rassemble les vols, l'hébergement, les activités et le budget.
          Cela prend quelques instants.
        </p>
      </div>
    </div>
  )
}
