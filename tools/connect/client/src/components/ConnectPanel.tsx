import { useState } from 'react';
import { randomPin } from '../lib/crypto';
import { randomDisplayName } from '../lib/names';
import { Avatar } from './Avatar';
import { IconRefreshCw } from './Icons';

export interface ConnectDetails {
  relayUrl: string;
  code: string;
  displayName: string;
}

export function ConnectPanel({ onConnect }: { onConnect: (details: ConnectDetails) => void }) {
  const [relayUrl, setRelayUrl] = useState('ws://localhost:8080');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState(() => randomDisplayName());
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="panel connect-panel fade-in-up">
      <div className="brand-mark">
        <img src="/logo.png" alt="Dhurta Connect" className="brand-logo-img" />
        <h1>Dhurta Connect</h1>
      </div>
      <p className="tagline">
        Anonymous, end-to-end encrypted chat, calls &amp; file transfer.
        Nothing is stored anywhere — not by us, not by the relay.
      </p>

      <label className="field">
        <span>Your name</span>
        <div className="name-row">
          <Avatar name={displayName || '?'} size={36} />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={40}
          />
          <button type="button" className="icon-btn" title="Shuffle name" onClick={() => setDisplayName(randomDisplayName())}>
            <IconRefreshCw />
          </button>
        </div>
        <small>Shown to peers you connect with. Made up — not tied to any account.</small>
      </label>

      <label className="field">
        <span>Session code (shared secret)</span>
        <div className="code-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="e.g. 482913"
            inputMode="numeric"
          />
          <button type="button" className="secondary" onClick={() => setCode(randomPin(6))}>
            Generate
          </button>
        </div>
        <small>Share this code out-of-band (voice, SMS, in person). It never leaves your device unencrypted.</small>
      </label>

      <button type="button" className="link-toggle" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? 'Hide' : 'Show'} advanced (self-hosted relay)
      </button>

      {showAdvanced && (
        <label className="field fade-in">
          <span>Relay address</span>
          <input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="ws://localhost:8080 or ws://192.168.1.5:8080"
          />
          <small>Point this at any self-hosted relay by IP — it only shuttles encrypted bytes.</small>
        </label>
      )}

      <button
        className="primary"
        disabled={!relayUrl || !code || !displayName.trim()}
        onClick={() => onConnect({ relayUrl, code, displayName: displayName.trim() })}
      >
        Connect
      </button>
    </div>
  );
}
