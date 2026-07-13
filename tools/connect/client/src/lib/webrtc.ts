import { SignalingClient } from './signaling';
import { decryptJSON, encryptJSON, type EncryptedEnvelope } from './crypto';

// Public STUN only (helps NAT traversal, sees nothing but IP/port — no content,
// no relay of media/data). No TURN server is configured by default, which means
// media/data prefers a direct peer-to-peer path whenever possible.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CHUNK_SIZE = 16 * 1024; // bytes per file chunk, pre-encryption

export type CallMode = 'audio' | 'video';

type ControlMessage =
  | { type: 'hello'; name: string }
  | { type: 'chat'; text: string; ts: number }
  | { type: 'file-meta'; id: string; name: string; size: number; mime: string }
  | { type: 'file-chunk'; id: string; index: number; total: number; data: string }
  | { type: 'file-end'; id: string }
  | { type: 'call-request'; mode: CallMode }
  | { type: 'call-accept'; mode: CallMode }
  | { type: 'call-decline' }
  | { type: 'call-end' };

export interface IncomingFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  receivedBytes: number;
  chunks: string[];
  totalChunks: number;
}

export interface PeerManagerCallbacks {
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onPeerName?: (peerId: string, name: string) => void;
  onChatMessage?: (peerId: string, text: string, ts: number) => void;
  onFileIncomingStart?: (peerId: string, file: { id: string; name: string; size: number; mime: string }) => void;
  onFileProgress?: (peerId: string, id: string, receivedBytes: number, size: number) => void;
  onFileComplete?: (peerId: string, id: string, blobUrl: string, name: string, mime: string) => void;
  onCallRequest?: (peerId: string, mode: CallMode) => void;
  onCallAccepted?: (peerId: string, mode: CallMode) => void;
  onCallDeclined?: (peerId: string) => void;
  onCallEnded?: (peerId: string) => void;
}

interface RemotePeer {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export class PeerManager {
  private peers = new Map<string, RemotePeer>();
  private incomingFiles = new Map<string, IncomingFile>();

  constructor(
    private signaling: SignalingClient,
    private roomKey: CryptoKey,
    private localPeerId: string,
    private localDisplayName: string,
    private localStream: MediaStream | null,
    private callbacks: PeerManagerCallbacks,
  ) {
    this.signaling.onSignal(async (msg) => {
      const envelope = msg.payload as EncryptedEnvelope;
      const data = await decryptJSON<any>(this.roomKey, envelope);
      await this.handleSignal(msg.from, data);
    });
  }

  private shouldInitiate(remoteId: string): boolean {
    // Deterministic tie-break so exactly one side sends the initial data channel.
    return this.localPeerId < remoteId;
  }

  private getOrCreatePeer(remoteId: string): RemotePeer {
    let peer = this.peers.get(remoteId);
    if (peer) return peer;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer = { pc, dataChannel: null, polite: !this.shouldInitiate(remoteId), makingOffer: false, ignoreOffer: false };
    this.peers.set(remoteId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (evt) => {
      this.callbacks.onRemoteStream?.(remoteId, evt.streams[0]);
    };

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.sendSignal(remoteId, { kind: 'ice', candidate: evt.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.callbacks.onPeerConnected?.(remoteId);
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.callbacks.onPeerDisconnected?.(remoteId);
      }
    };

    pc.ondatachannel = (evt) => {
      this.wireDataChannel(remoteId, evt.channel);
    };

    pc.onnegotiationneeded = async () => {
      const p = this.peers.get(remoteId);
      if (!p) return;
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        await this.sendSignal(remoteId, { kind: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.error('negotiation failed', err);
      } finally {
        p.makingOffer = false;
      }
    };

    return peer;
  }

  private wireDataChannel(remoteId: string, channel: RTCDataChannel) {
    const peer = this.peers.get(remoteId);
    if (peer) peer.dataChannel = channel;

    channel.onopen = () => {
      this.sendTo(remoteId, { type: 'hello', name: this.localDisplayName });
    };

    channel.onmessage = async (evt) => {
      const envelope: EncryptedEnvelope = JSON.parse(evt.data);
      const msg = await decryptJSON<ControlMessage>(this.roomKey, envelope);
      this.handleControlMessage(remoteId, msg);
    };
  }

  private async handleControlMessage(remoteId: string, msg: ControlMessage) {
    switch (msg.type) {
      case 'hello':
        this.callbacks.onPeerName?.(remoteId, msg.name);
        break;
      case 'chat':
        this.callbacks.onChatMessage?.(remoteId, msg.text, msg.ts);
        break;
      case 'file-meta':
        this.incomingFiles.set(msg.id, {
          id: msg.id,
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          receivedBytes: 0,
          chunks: [],
          totalChunks: 0,
        });
        this.callbacks.onFileIncomingStart?.(remoteId, msg);
        break;
      case 'file-chunk': {
        const file = this.incomingFiles.get(msg.id);
        if (!file) return;
        file.chunks[msg.index] = msg.data;
        file.totalChunks = msg.total;
        file.receivedBytes = Math.min(file.size, (msg.index + 1) * CHUNK_SIZE);
        this.callbacks.onFileProgress?.(remoteId, msg.id, file.receivedBytes, file.size);
        break;
      }
      case 'file-end': {
        const file = this.incomingFiles.get(msg.id);
        if (!file) return;
        const binary = atob(file.chunks.join(''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: file.mime });
        const url = URL.createObjectURL(blob);
        this.callbacks.onFileComplete?.(remoteId, file.id, url, file.name, file.mime);
        this.incomingFiles.delete(file.id);
        break;
      }
      case 'call-request':
        this.callbacks.onCallRequest?.(remoteId, msg.mode);
        break;
      case 'call-accept':
        this.callbacks.onCallAccepted?.(remoteId, msg.mode);
        break;
      case 'call-decline':
        this.callbacks.onCallDeclined?.(remoteId);
        break;
      case 'call-end':
        this.callbacks.onCallEnded?.(remoteId);
        break;
    }
  }

  private async sendSignal(remoteId: string, payload: unknown) {
    const envelope = await encryptJSON(this.roomKey, payload);
    this.signaling.sendSignal(remoteId, envelope);
  }

  private async handleSignal(remoteId: string, data: any) {
    const peer = this.getOrCreatePeer(remoteId);
    const pc = peer.pc;

    if (data.kind === 'offer' || data.kind === 'answer') {
      const description = data.sdp as RTCSessionDescriptionInit;
      if (data.kind === 'offer') {
        const offerCollision = peer.makingOffer || pc.signalingState !== 'stable';
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        if (offerCollision) {
          await Promise.all([pc.setLocalDescription({ type: 'rollback' }), pc.setRemoteDescription(description)]);
        } else {
          await pc.setRemoteDescription(description);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.sendSignal(remoteId, { kind: 'answer', sdp: pc.localDescription });
      } else {
        await pc.setRemoteDescription(description);
      }
    } else if (data.kind === 'ice') {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('ICE candidate error', err);
      }
    }
  }

  async connectToPeer(remoteId: string) {
    const peer = this.getOrCreatePeer(remoteId);
    if (!this.shouldInitiate(remoteId)) return; // other side owns the data channel

    const channel = peer.pc.createDataChannel('data');
    this.wireDataChannel(remoteId, channel);
  }

  removePeer(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (peer) {
      peer.dataChannel?.close();
      peer.pc.close();
      this.peers.delete(remoteId);
    }
  }

  private sendTo(remoteId: string, msg: ControlMessage) {
    const peer = this.peers.get(remoteId);
    if (peer?.dataChannel?.readyState === 'open') {
      encryptJSON(this.roomKey, msg).then((envelope) => peer.dataChannel!.send(JSON.stringify(envelope)));
    }
  }

  private async broadcastControl(msg: ControlMessage) {
    const envelope = await encryptJSON(this.roomKey, msg);
    const raw = JSON.stringify(envelope);
    for (const peer of this.peers.values()) {
      if (peer.dataChannel?.readyState === 'open') peer.dataChannel.send(raw);
    }
  }

  async sendChat(text: string) {
    await this.broadcastControl({ type: 'chat', text, ts: Date.now() });
  }

  async sendFile(file: File) {
    const id = crypto.randomUUID();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const total = Math.ceil(buffer.length / CHUNK_SIZE);

    await this.broadcastControl({ type: 'file-meta', id, name: file.name, size: buffer.length, mime: file.type || 'application/octet-stream' });

    for (let i = 0; i < total; i++) {
      const chunk = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      let binary = '';
      for (const b of chunk) binary += String.fromCharCode(b);
      await this.broadcastControl({ type: 'file-chunk', id, index: i, total, data: btoa(binary) });
    }

    await this.broadcastControl({ type: 'file-end', id });
  }

  async requestCall(mode: CallMode) {
    await this.broadcastControl({ type: 'call-request', mode });
  }

  async acceptCall(mode: CallMode) {
    await this.broadcastControl({ type: 'call-accept', mode });
  }

  async declineCall() {
    await this.broadcastControl({ type: 'call-decline' });
  }

  async endCall() {
    await this.broadcastControl({ type: 'call-end' });
  }

  async updateName(name: string) {
    this.localDisplayName = name;
    await this.broadcastControl({ type: 'hello', name });
  }

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
    for (const peer of this.peers.values()) {
      const senders = peer.pc.getSenders();
      senders.forEach((s) => peer.pc.removeTrack(s));
      if (stream) {
        for (const track of stream.getTracks()) peer.pc.addTrack(track, stream);
      }
    }
  }

  closeAll() {
    for (const remoteId of [...this.peers.keys()]) this.removePeer(remoteId);
  }
}
