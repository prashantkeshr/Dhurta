import { useState, useEffect } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'
type Theme = 'dark' | 'light'

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('dhurta:uiTheme', t)
}

export function useTheme() {
  // Fast init from localStorage to avoid flash before IPC resolves
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('dhurta:uiTheme')
    const t: Theme = saved === 'light' ? 'light' : 'dark'
    applyTheme(t)
    return t
  })

  useEffect(() => {
    if (!isElectron) return
    window.dhurta.getSetting('uiTheme').then(v => {
      if (v === 'light' || v === 'dark') {
        applyTheme(v)
        setThemeState(v)
      }
    }).catch(() => {})
  }, [])

  const setTheme = (t: Theme) => {
    applyTheme(t)
    setThemeState(t)
    if (isElectron) window.dhurta.setSetting('uiTheme', t).catch(() => {})
  }

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggle }
}
