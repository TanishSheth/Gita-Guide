/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sage: {
          50: '#f4f6f3',
          100: '#e5eae1',
          200: '#cbd6c4',
          300: '#a9bb9d',
          400: '#849876',
          500: '#657a58',
          600: '#4f6144',
          700: '#404e37',
          800: '#35402e',
          900: '#2c3527',
          950: '#1a2018',
        },
        gold: {
          50: '#fdf9ec',
          100: '#faf0cb',
          200: '#f4dd97',
          300: '#edc55c',
          400: '#e6ab31',
          500: '#d6911e',
          600: '#b87118',
          700: '#935318',
          800: '#79421a',
          900: '#67381a',
        },
        // Claude-like dark surfaces (matte charcoal)
        ink: {
          50: '#e8e6e1',
          100: '#d4d1cb',
          200: '#b0aca4',
          300: '#8f8a82',
          400: '#7a756c',
          500: '#5e5a54',
          600: '#45423e',
          700: '#353535',
          800: '#2b2b2b',
          900: '#1a1a1a',
          950: '#141414',
        },
        // Warm terracotta accent (dark mode)
        clay: {
          300: '#e8a08a',
          400: '#e0896e',
          500: '#d97757',
          600: '#c45f3f',
          700: '#a34c32',
        },
        parchment: '#faf7f0',
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
