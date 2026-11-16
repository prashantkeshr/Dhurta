import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian:      'rgb(var(--color-obsidian) / <alpha-value>)',
        saffron:       '#FF5722',
        'saffron-dim': '#D84315',
        'saffron-glow':'#FF7043',
        'gold':        '#F59E0B',
        'gold-dim':    '#D97706',
        surface:       'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2':   'rgb(var(--color-surface2) / <alpha-value>)',
        'surface-3':   'rgb(var(--color-surface3) / <alpha-value>)',
        border:        'rgb(var(--color-border) / <alpha-value>)',
        muted:         'rgb(var(--color-muted) / <alpha-value>)',
        text:          'rgb(var(--color-text) / <alpha-value>)',
        'text-dim':    'rgb(var(--color-text-dim) / <alpha-value>)',
      },
      fontFamily: {
        sans:    ['Inter', 'Space Grotesk', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
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
          '0%, 100%': { boxShadow: '0 0 5px #FF5722' },
          '50%': { boxShadow: '0 0 14px #FF5722, 0 0 28px #FF572233' },
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
