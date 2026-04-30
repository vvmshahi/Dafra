/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#fef9ec',
          100: '#fdf0c8',
          200: '#fbe08d',
          300: '#f8c84a',
          400: '#f5b020',
          500: '#e89510',
          600: '#cc720b',
          700: '#a8510c',
          800: '#8a3f10',
          900: '#723511',
          950: '#411806',
        },
        brand: {
          green: '#1a7a4a',
          'green-light': '#22a862',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
