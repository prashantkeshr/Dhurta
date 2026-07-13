# Dhurta Connect

Anonymous, end-to-end encrypted chat, voice calls, video calls, and file
transfer between browsers — peer-to-peer, with nothing stored anywhere.

A WhatsApp-style call experience (ringing/incoming screen, live call timer,
mute/camera controls, floating self-view) runs on top of the same encrypted
data channel, and every participant picks (or is given) a display name and
avatar instead of a raw connection ID. The UI is mobile-first and responsive
from phone width up to desktop.

## How it works

```
Peer A  ──WebSocket (encrypted blobs only)──►  Relay server  ──►  Peer B
   │                                                                 │
   └──────────────── WebRTC data/media, DTLS-SRTP encrypted ─────────┘
                        (chat, files, audio, video — direct P2P)
```

1. **Pairing.** One person picks or generates a short code (a PIN) and shares
   it out-of-band (voice, SMS, in person — never through this app itself).
   The other person enters the same code and points at the same relay.
2. **Key derivation.** Both browsers independently derive an AES-256-GCM key
   from the code via PBKDF2 (150,000 iterations). The code/key is never
   transmitted anywhere.
3. **Signaling.** The relay server's only job is forwarding WebRTC connection
   setup messages (SDP offers/answers, ICE candidates) between the two
   browsers so they can find each other. Every one of those messages is
   encrypted with the PIN-derived key *before* it touches the relay — the
   relay only ever sees opaque ciphertext, and it has no way to derive the
   key itself.
4. **Direct P2P.** Once the WebRTC connection is established, all chat
   messages, files, and audio/video flow **directly between the two
   browsers**, encrypted end-to-end by WebRTC's mandatory DTLS-SRTP — the
   relay is no longer involved at all.
5. **Nothing persists.** The relay keeps an in-memory list of who's in which
   room and forgets it the instant everyone disconnects (and sweeps stale
   empty rooms every 30s). It writes no logs of message content, no
   database, no files to disk. There are no accounts, no phone numbers, no
   identifiers beyond a random per-connection ID that exists only in RAM.

### Why this is genuinely end-to-end encrypted

There are two independent encryption layers, so even if you don't trust the
relay operator:

- **Transport layer:** WebRTC mandates DTLS-SRTP for all data channels and
  media tracks — this is negotiated directly between the two browsers and
  the relay is never a party to it.
- **Application layer:** every signaling message (and, for defense in depth,
  every chat/file control message) is separately encrypted with a key only
  the two participants know, derived from a secret they exchanged
  out-of-band. A malicious or compromised relay can see connection metadata
  (who connected, when, from what IP, room size) but never message content.

## Connecting "by IP address"

The relay is intentionally a few lines of code with no state to leak. You can
run your own instance anywhere — a home server, a VPS, a Raspberry Pi on your
LAN — and connect directly to it by address instead of using a shared public
instance:

```
ws://192.168.1.42:8080     # LAN
ws://your-server-ip:8080   # self-hosted, anywhere
```

Both sides just need to agree on the same relay address and the same PIN.

## Running it

**Signaling relay** (run once, anywhere reachable to both peers):

```bash
cd server
npm install
npm start        # listens on :8080 by default (PORT env var to change)
```

**Client** (each peer runs this locally, or you host the built static files):

```bash
cd client
npm install
npm run dev       # http://localhost:5173
```

Open the client in two browser windows/tabs (or two devices), enter the same
relay address and the same code in both, and connect.

## Limitations / honesty notes

- **NAT traversal**: only public STUN servers are configured, no TURN
  relay. If both peers are behind restrictive/symmetric NATs, the direct
  P2P connection may fail to establish — this is a deliberate trade-off
  (a TURN server would otherwise see encrypted media/data traffic pass
  through it, even though it can't decrypt it, and running a trustworthy
  TURN relay is outside this project's threat model for now).
- **Metadata is not hidden.** The relay sees IP addresses and connection
  timing of anyone who joins a room, and a network observer can see that
  two IPs are talking to each other and to the relay. This project makes
  message *content* unreadable to anyone but the two participants; it does
  not provide Tor-level metadata anonymity by itself. If that's required,
  route the relay connection through Tor/a VPN.
- **Group calls** use a full mesh (every peer connects to every other peer
  directly), capped at 8 peers per room — fine for small groups, not
  designed to scale to large conference calls.
