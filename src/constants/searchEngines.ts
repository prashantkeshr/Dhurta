export const SEARCH_ENGINES = [
  // ── Privacy-first ──
  { value: 'brave',      label: 'Brave Search',  url: 'search.brave.com',    badge: '⭐ Privacy Pick',   badgeColor: '#22c55e', letter: 'B',  letterColor: '#FF4500', logo: './logos/brave.svg',      desc: 'Independent index, no Google tracking' },
  { value: 'duckduckgo', label: 'DuckDuckGo',    url: 'duckduckgo.com',      badge: '⭐ Privacy Pick',   badgeColor: '#22c55e', letter: 'D',  letterColor: '#DE5833', logo: './logos/duckduckgo.svg', desc: 'No personal data stored, ever' },
  { value: 'startpage',  label: 'Startpage',     url: 'startpage.com',       badge: '🔒 Private Google', badgeColor: '#3b82f6', letter: 'S',  letterColor: '#FF6D28', logo: './logos/startpage.svg',  desc: 'Google results without the tracking' },
  { value: 'qwant',      label: 'Qwant',         url: 'qwant.com',           badge: '🔒 Privacy',        badgeColor: '#8b5cf6', letter: 'Q',  letterColor: '#8b5cf6', logo: './logos/qwant.svg',      desc: 'EU-based, zero tracking policy' },
  // ── Eco-friendly ──
  { value: 'ecosia',     label: 'Ecosia',        url: 'ecosia.org',          badge: '🌱 Eco-Friendly',   badgeColor: '#16a34a', letter: 'E',  letterColor: '#16a34a', logo: './logos/ecosia.svg',     desc: 'Plants trees with ad revenue' },
  // ── Popular ──
  { value: 'google',     label: 'Google',        url: 'google.com',          badge: '🌐 Popular',        badgeColor: '#f59e0b', letter: 'G',  letterColor: '#4285f4', logo: './logos/google.svg',     desc: 'Most comprehensive web index' },
  { value: 'bing',       label: 'Bing',          url: 'bing.com',            badge: '🌐 Popular',        badgeColor: '#f59e0b', letter: 'Bi', letterColor: '#0078d4', logo: './logos/bing.svg',       desc: 'Microsoft — strong image & video search' },
  { value: 'yahoo',      label: 'Yahoo',         url: 'search.yahoo.com',    badge: null,                badgeColor: '',        letter: 'Y',  letterColor: '#720e9e', logo: './logos/yahoo.svg',      desc: 'Classic search portal' },
  // ── Custom ──
  { value: 'custom',     label: 'Custom URL',    url: '',                    badge: null,                badgeColor: '',        letter: '⚙',  letterColor: '#888',    logo: './logos/custom.svg',     desc: 'Use any search engine with %s placeholder' },
]
