/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      animation: {
        'particle-burst': 'particle-burst 0.4s ease-out forwards',
        'tile-flash': 'tile-flash 0.3s ease-out'
      },
      keyframes: {
        'particle-burst': {
          '0%': { transform: 'scale(0.5)', opacity: '1' },
          '100%': { transform: 'scale(2)', opacity: '0' }
        },
        'tile-flash': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(239, 68, 68, 0.4)' }
        }
      }
    }
  },
  plugins: []
}
