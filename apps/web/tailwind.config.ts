import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111111',
        paper: '#ffffff',
        accent: '#00e676',
        warning: '#ffd600'
      }
    }
  },
  plugins: []
}

export default config
