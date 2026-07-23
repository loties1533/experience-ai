/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        gold:      { DEFAULT: '#E3A72C', light: '#F6E6BE', dark: '#916312' }, // accent jaune chaud (soleil) — DEFAULT en fond, dark pour le texte lisible
        ink:       { DEFAULT: '#1A1410', light: '#3D3228' },                  // texte
        parchment: { DEFAULT: '#FAF7F2', dark: '#F0EBE0' },                   // surfaces claires
        muted:     '#7A6E62',                                                 // texte secondaire
        sage:      '#5A7A5E',                                                 // sémantique : succès
        coral:     '#C0634A',                                                 // sémantique : danger
      },
      boxShadow: {
        'card':    '0 4px 24px rgba(26,20,16,0.08)',
        'card-lg': '0 12px 48px rgba(26,20,16,0.14)',
      },
    },
  },
  plugins: [],
}
