import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dhurta.browser',
  appName: 'Dhurta',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0A0A',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
    },
  },
}

export default config
