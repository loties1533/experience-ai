// Logo TripGenie — boussole + monogramme T (voyage + marque).
// Emblème vectoriel unique, réutilisé partout (header, footer, chat, chargement).
// La couleur suit `currentColor` : on la pilote via une classe Tailwind (ex. text-gold-dark).
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="TripGenie"
    >
      {/* Cadran de la boussole */}
      <circle cx="24" cy="24" r="17.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="24" cy="24" r="12.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      {/* Monogramme T au centre */}
      <text
        x="24"
        y="31"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="20"
        fontWeight="700"
        fill="currentColor"
        textAnchor="middle"
      >
        T
      </text>
      {/* Aiguille nord */}
      <path d="M24 7 L25.6 11 L22.4 11 Z" fill="currentColor" />
    </svg>
  )
}
