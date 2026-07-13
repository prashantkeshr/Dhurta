// Thin wrapper around a WebSocket connection to a relay (default hosted relay,
// or any self-hosted relay reachable at ws(s)://ip:port — "direct IP" mode).
// All payloads passed through send()/onSignal() are pre-encrypted by the caller;
// this module never sees plaintext and neither does the relay.

export type SignalMessage = { from: string; payload: unknown };

export class SignalingClient {
  private ws: WebSocket | null = null;
  private listeners = {
    joined: new Set<(peerId: string, existingPeers: string[]) => void>(),
    peerJoined: new Set<(peerId: string) => void>(),
    peerLeft: new Set<(peerId: string) => void>(),
    signal: new Set<(msg: SignalMessage) => void>(),
    roomFull: new Set<() => void>(),
    error: new Set<(err: Event) => void>(),
    close: new Set<() => void>(),
  };

  connect(relayUrl: string, roomCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', code: roomCode }));
      };

      ws.onmessage = (evt) => {
        let msg: any;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'joined':
            resolve();
            this.listeners.joined.forEach((cb) => cb(msg.peerId, msg.peers ?? []));
            break;
          case 'peer-joined':
            this.listeners.peerJoined.forEach((cb) => cb(msg.peerId));
            break;
          case 'peer-left':
            this.listeners.peerLeft.forEach((cb) => cb(msg.peerId));
            break;
          case 'signal':
            this.listeners.signal.forEach((cb) => cb({ from: msg.from, payload: msg.payload }));
            break;
          case 'room-full':
            this.listeners.roomFull.forEach((cb) => cb());
            break;
        }
      };

      ws.onerror = (err) => {
        this.listeners.error.forEach((cb) => cb(err));
        reject(err);
      };

      ws.onclose = () => {
        this.listeners.close.forEach((cb) => cb());
      };
    });
  }

  sendSignal(to: string, payload: unknown) {
    this.ws?.send(JSON.stringify({ type: 'signal', to, payload }));
  }

  onJoined(cb: (peerId: string, existingPeers: string[]) => void) {
    this.listeners.joined.add(cb);
    return () => this.listeners.joined.delete(cb);
  }
  onPeerJoined(cb: (peerId: string) => void) {
    this.listeners.peerJoined.add(cb);
    return () => this.listeners.peerJoined.delete(cb);
  }
  onPeerLeft(cb: (peerId: string) => void) {
    this.listeners.peerLeft.add(cb);
    return () => this.listeners.peerLeft.delete(cb);
  }
  onSignal(cb: (msg: SignalMessage) => void) {
    this.listeners.signal.add(cb);
    return () => this.listeners.signal.delete(cb);
  }
  onRoomFull(cb: () => void) {
    this.listeners.roomFull.add(cb);
    return () => this.listeners.roomFull.delete(cb);
  }
  onClose(cb: () => void) {
    this.listeners.close.add(cb);
    return () => this.listeners.close.delete(cb);
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
