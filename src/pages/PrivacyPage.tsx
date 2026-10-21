import React from 'react'

const S = {
  root: {
    minHeight: '100%',
    background: 'var(--bg, #0d0d0d)',
    color: 'var(--text, #e8e8e8)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '0 0 80px',
    overflowY: 'auto' as const,
  },
  header: {
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    padding: '18px 32px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600 as const,
    color: '#c9a227',
    margin: 0,
  },
  headerSub: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  content: {
    maxWidth: 740,
    margin: '0 auto',
    padding: '40px 32px',
  },
  h2: {
    fontSize: 22,
    fontWeight: 700 as const,
    color: '#fff',
    marginBottom: 4,
  },
  tagline: {
    color: '#777',
    fontSize: 14,
    marginBottom: 10,
  },
  updated: {
    fontSize: 12,
    color: '#555',
    marginBottom: 32,
  },
  highlight: {
    background: 'rgba(201,162,39,0.08)',
    borderLeft: '3px solid #c9a227',
    padding: '12px 16px',
    borderRadius: 4,
    marginBottom: 32,
    color: '#d4c08a',
    fontSize: 14,
    lineHeight: 1.6,
  },
  section: {
    marginBottom: 28,
  },
  h3: {
    fontSize: 14,
    fontWeight: 600 as const,
    color: '#c9a227',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  p: {
    color: '#aaa',
    fontSize: 13.5,
    lineHeight: 1.75,
    marginBottom: 10,
  },
  ul: {
    color: '#aaa',
    fontSize: 13.5,
    lineHeight: 1.75,
    paddingLeft: 20,
    marginBottom: 10,
  },
  li: {
    marginBottom: 5,
  },
  link: {
    color: '#d4af37',
    textDecoration: 'none' as const,
  },
}

export default function PrivacyPage() {
  return (
    <div style={S.root}>
      <div style={S.header}>
        <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" fill="#111"/>
          <path d="M50 18 L50 82 M36 28 L64 28 M36 72 L64 72 M50 18 L36 28 M50 18 L64 28 M50 82 L36 72 M50 82 L64 72"
            stroke="#c9a227" strokeWidth="4.5" strokeLinecap="round"/>
          <circle cx="50" cy="50" r="7" fill="#c9a227"/>
        </svg>
        <div>
          <p style={S.headerTitle}>Dhurta Browser — Privacy Policy</p>
          <p style={S.headerSub}>by Dhurta.inc</p>
        </div>
      </div>

      <div style={S.content}>
        <h2 style={S.h2}>Privacy Policy</h2>
        <p style={S.tagline}>Dhurta is built on a single principle: your browsing is yours alone.</p>
        <p style={S.updated}>Last updated: October 2026 &nbsp;·&nbsp; Applies to Dhurta Browser v1.0 and later</p>

        <div style={S.highlight}>
          <strong>Summary:</strong> Dhurta Browser collects no personal data, sends no telemetry, and stores everything locally on your device. We have nothing to sell or share.
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>1. Information We Do Not Collect</h3>
          <p style={S.p}>Dhurta Browser does not collect, transmit, or store any of the following:</p>
          <ul style={S.ul}>
            <li style={S.li}>Browsing history or visited URLs</li>
            <li style={S.li}>Search queries</li>
            <li style={S.li}>Passwords, credentials, or form data</li>
            <li style={S.li}>Device identifiers or IP addresses</li>
            <li style={S.li}>Crash reports or diagnostic telemetry</li>
            <li style={S.li}>Usage analytics or behavioural metrics</li>
            <li style={S.li}>Location data</li>
          </ul>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>2. Local Storage Only</h3>
          <p style={S.p}>All data created while using Dhurta — bookmarks, history, settings, cookies, cached pages, and session data — is stored exclusively on your local device. Dhurta.inc has no access to this data, and it is never transmitted to our servers or any third party.</p>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>3. Built-In Privacy Features</h3>
          <p style={S.p}>Dhurta includes several privacy-enhancing features by default:</p>
          <ul style={S.ul}>
            <li style={S.li}><strong>Ad &amp; tracker blocking</strong> — network-level blocking of known tracking domains</li>
            <li style={S.li}><strong>Fingerprint spoofing</strong> — randomises hardware and browser fingerprints to prevent cross-site tracking</li>
            <li style={S.li}><strong>WebRTC leak protection</strong> — prevents exposure of your real IP address through WebRTC</li>
            <li style={S.li}><strong>Ghost Mode</strong> — enhanced private browsing that leaves no local trace</li>
            <li style={S.li}><strong>Tor routing</strong> — optional anonymous routing through the Tor network</li>
            <li style={S.li}><strong>HTTPS enforcement</strong> — upgrades connections to HTTPS where available</li>
          </ul>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>4. Network Requests</h3>
          <p style={S.p}>When you browse the web, your browser communicates with the websites you visit. This is inherent to how the internet works. Dhurta does not intercept, log, or forward these communications. The content of your browsing sessions is never seen by Dhurta.inc.</p>
          <p style={S.p}>Dhurta may check for software updates by contacting our update server. This check includes your current version number and operating system, but no personally identifiable information.</p>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>5. Third-Party Services</h3>
          <p style={S.p}>Dhurta does not bundle or enable any third-party analytics, advertising, or data-collection services. When you use a website or web service through Dhurta, that website's own privacy policy applies to your interaction with it.</p>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>6. Children's Privacy</h3>
          <p style={S.p}>Dhurta Browser is not directed at children under the age of 13. We do not knowingly collect personal information from children. Because Dhurta does not collect any personal data at all, this standard is met by default.</p>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>7. Changes to This Policy</h3>
          <p style={S.p}>If we make material changes to this privacy policy, we will update the date at the top of this page. Your continued use of Dhurta after changes are posted constitutes acceptance of the updated policy.</p>
        </div>

        <div style={S.section}>
          <h3 style={S.h3}>8. Contact</h3>
          <p style={S.p}>Questions about this privacy policy can be directed to:<br/>
            <a href="mailto:contact@dhurta.com" style={S.link}>contact@dhurta.com</a>
            &nbsp;·&nbsp;
            <a href="https://dhurta.com" style={S.link}>dhurta.com</a>
          </p>
        </div>
      </div>
    </div>
  )
}
