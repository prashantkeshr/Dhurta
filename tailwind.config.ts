import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian:      'rgb(var(--color-obsidian) / <alpha-value>)',
        saffron:       '#FF4500',
        'saffron-dim': '#CC3700',
        'saffron-glow':'#FF6A33',
        surface:       'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2':   'rgb(var(--color-surface2) / <alpha-value>)',
        'surface-3':   'rgb(var(--color-surface3) / <alpha-value>)',
        border:        'rgb(var(--color-border) / <alpha-value>)',
        muted:         'rgb(var(--color-muted) / <alpha-value>)',
        text:          'rgb(var(--color-text) / <alpha-value>)',
        'text-dim':    'rgb(var(--color-text-dim) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      keyframes: {
        glitch: {
          '0%, 100%': { transform: 'translate(0)', opacity: '1' },
          '20%': { transform: 'translate(-2px, 1px)', opacity: '0.8' },
          '40%': { transform: 'translate(2px, -1px)', opacity: '0.9' },
          '60%': { transform: 'translate(-1px, 2px)', opacity: '0.85' },
          '80%': { transform: 'translate(1px, -2px)', opacity: '0.95' },
        },
        'saffron-pulse': {
          '0%, 100%': { boxShadow: '0 0 4px #FF4500' },
          '50%': { boxShadow: '0 0 12px #FF4500, 0 0 24px #FF450055' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'dl-slide': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        glitch: 'glitch 0.4s ease-in-out',
        'saffron-pulse': 'saffron-pulse 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.15s ease-out',
        'dl-slide': 'dl-slide 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
