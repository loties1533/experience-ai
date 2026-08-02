/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['"Open Sans"', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
      },
      // Palette « aventure » (UI/UX Pro Max : adventure orange + map teal)
      colors: {
        soleil: { DEFAULT: '#EA580C', light: '#FED7AA', dark: '#C2410C' }, // primaire — orange coucher de soleil
        lagon:  { DEFAULT: '#0891B2', light: '#CFFAFE', dark: '#0E7490' }, // secondaire — teal carte
        sable:  { DEFAULT: '#FFF7ED', dark: '#FDF0E3' },                   // surfaces claires
        encre:  { DEFAULT: '#0F172A', light: '#334155' },                  // texte
        brume:  '#64748B',                                                 // texte secondaire
        sauge:  { DEFAULT: '#16A34A', dark: '#166534' },                   // sémantique : succès
        corail: '#DC2626',                                                 // sémantique : danger
      },
      boxShadow: {
        'card':    '0 4px 24px rgba(15,23,42,0.06)',
        'card-lg': '0 12px 48px rgba(15,23,42,0.12)',
      },
    },
  },
  plugins: [],
}
