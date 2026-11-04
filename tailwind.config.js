/** Brand colours sampled from the Leafy Digital logo:
 *  lime  #9ED03E (the "L" stem)   leaf #428638 (leaf gradient)   ink #000000 (the "D") */
export default {
  content: ['./src/hrms/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        lime: {
          50: '#f6fbe9',
          100: '#eaf6c9',
          200: '#d6ec9b',
          300: '#bfe070',
          400: '#aed74f',
          500: '#9ed03e',
          600: '#82b02c',
          700: '#668922',
        },
        leaf: {
          50: '#eff7ee',
          100: '#d9ecd7',
          500: '#52a047',
          600: '#428638',
          700: '#356d2d',
          800: '#2a5524',
          900: '#1f3f1b',
        },
        ink: {
          DEFAULT: '#0b0f0a',
          800: '#141a12',
          700: '#1d251a',
          600: '#2a3426',
        },
        paper: '#f5f7f2',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,15,10,.04), 0 4px 16px rgba(11,15,10,.05)',
      },
    },
  },
  plugins: [],
}
