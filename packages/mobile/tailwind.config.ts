import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        saffron:  '#FF4500',
        obsidian: '#0A0A0A',
        surface:  '#111111',
        border:   '#1E1E1E',
        text:     '#E0E0E0',
        muted:    '#555555',
        ghost:    '#8B5CF6',
      },
      fontFamily: {
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
