/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'sans-serif'],  // interface — très lisible
        heading: ['Fraunces', 'serif'],    // titres — éditorial, chaleureux
      },
      // Palette « Papier & Lumière » : surfaces chaudes claires, brun profond en
      // texte, doré patiné (laiton) en détail et terracotta en accent d'action.
      // Le doré reste un DÉTAIL (filets, labels, états), jamais un aplat dominant.
      colors: {
        ivoire: '#FAF6EF',                                          // fond principal
        creme:  '#F3EBDD',                                          // surface secondaire, bulle produit
        sable:  { DEFAULT: '#E7DAC5', dark: '#DBCBB0' },            // filets, bords, skeletons
        encre:  { DEFAULT: '#2E241B', light: '#4A3D30' },           // texte principal
        brume:  '#6F6152',                                          // texte secondaire
        terracotta: { DEFAULT: '#BE5A38', light: '#EBC9B8', dark: '#9A4526' }, // accent d'action (CTA)
        laiton:     { DEFAULT: '#B98A3E', light: '#E7CE9B', dark: '#8A6520' }, // doré patiné (détail)
        sauge:  { DEFAULT: '#4F7A5B', dark: '#3C5E46' },            // succès + statut « vérifié »
        corail: '#B4462F',                                          // danger + refus
      },
      boxShadow: {
        'card':    '0 4px 24px rgba(46,36,27,0.07)',
        'card-lg': '0 14px 44px rgba(46,36,27,0.12)',
      },
    },
  },
  plugins: [],
}
