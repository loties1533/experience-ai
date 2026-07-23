// Logo Experience AI — un parcours : des moments reliés par un chemin.
// Emblème vectoriel unique, réutilisé partout (en-tête, pied de page, connexion).
// La couleur suit `currentColor` : on la pilote via une classe Tailwind (ex. text-soleil).
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="Experience AI"
    >
      {/* Le chemin : une trajectoire souple, pas une ligne droite */}
      <path
        d="M11 34 C 17 34, 17 24, 24 24 C 31 24, 31 14, 37 14"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Les moments : un départ, une étape, une arrivée pleine */}
      <circle cx="11" cy="34" r="4" stroke="currentColor" strokeWidth="2.4" fill="none" />
      <circle cx="24" cy="24" r="2.6" fill="currentColor" opacity="0.55" />
      <circle cx="37" cy="14" r="4.5" fill="currentColor" />
    </svg>
  )
}
