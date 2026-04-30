/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#edf7f1',
          100: '#d0eadb',
          200: '#a1d5b7',
          300: '#6bb990',
          400: '#3ea06e',
          500: '#1B6B3A',
          600: '#165d31',
          700: '#114d28',
          800: '#0c3c1f',
          900: '#072c15',
          950: '#041a0c',
        },
        gold: {
          50:  '#fdf8ef',
          100: '#f9edda',
          200: '#f1d9af',
          300: '#e6bf7e',
          400: '#d9a755',
          500: '#C8A96E',
          600: '#b8913a',
          700: '#9a7830',
          800: '#7c6127',
          900: '#5f491d',
        },
        sidebar: {
          DEFAULT: '#0F2419',
          hover:   '#1a3828',
          active:  '#1B6B3A',
          border:  '#1e3327',
          text:    '#86b898',
        },
      },
      fontFamily: {
        sans:   ['Inter', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '12px',
        '3xl': '16px',
      },
      boxShadow: {
        card:       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md':  '0 4px 12px rgba(0,0,0,0.08)',
        'card-lg':  '0 8px 24px rgba(0,0,0,0.10)',
        sidebar:    '2px 0 12px rgba(0,0,0,0.15)',
      },
    },
  },
  plugins: [],
}
