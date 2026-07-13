import { useCallback, useRef, useState } from 'react';
import { ConnectPanel, type ConnectDetails } from './components/ConnectPanel';
import { Chat, type ChatEntry } from './components/Chat';
import { FileTransfer, type TransferEntry } from './components/FileTransfer';
import { CallOverlay, type CallPhase } from './components/CallOverlay';
import { Avatar } from './components/Avatar';
import { IconPhone, IconVideo, IconFolder, IconPower } from './components/Icons';
import { SignalingClient } from './lib/signaling';
import { PeerManager, type CallMode } from './lib/webrtc';
import { deriveRoomKey } from './lib/crypto';

type SessionState = 'setup' | 'connecting' | 'connected' | 'error';

interface CallState {
  phase: CallPhase;
  mode: CallMode;
}

export default function App() {
  const [state, setState] = useState<SessionState>('setup');
  const [errorMsg, setErrorMsg] = useState('');
  const [myName, setMyName] = useState('');
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [peerNames, setPeerNames] = useState<Map<string, string>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [showFiles, setShowFiles] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);
  const [callBadge, setCallBadge] = useState('');

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Mirrors peerNames so callbacks registered once at connect-time (closures)
  // can read the latest map without re-subscribing.
  const peerNamesRef = useRef(peerNames);
  peerNamesRef.current = peerNames;

  const updateTransfer = useCallback((id: string, patch: Partial<TransferEntry>) => {
    setTransfers((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return [...prev, { id, name: '', size: 0, direction: 'received', progress: 0, ...patch } as TransferEntry];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  function peerLabel(peerId: string) {
    return peerNames.get(peerId) ?? `Peer ${peerId.slice(0, 4)}`;
  }

  async function handleConnect({ relayUrl, code, displayName }: ConnectDetails) {
    setState('connecting');
    setErrorMsg('');
    setMyName(displayName);
    try {
      const roomKey = await deriveRoomKey(code, code);

      const signaling = new SignalingClient();
      signalingRef.current = signaling;

      signaling.onJoined((selfId, existingPeers) => {
        const manager = new PeerManager(signaling, roomKey, selfId, displayName, localStreamRef.current, {
          onRemoteStream: (peerId, stream) => {
            setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
          },
          onPeerConnected: () => setPeerCount((n) => n + 1),
          onPeerDisconnected: (peerId) => {
            setPeerCount((n) => Math.max(0, n - 1));
            setRemoteStreams((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          },
          onPeerName: (peerId, name) => {
            setPeerNames((prev) => new Map(prev).set(peerId, name));
          },
          onChatMessage: (peerId, text, ts) => {
            setChatEntries((prev) => [
              ...prev,
              { id: crypto.randomUUID(), peerId, name: peerNamesRef.current.get(peerId) ?? peerId.slice(0, 4), text, ts, self: false },
            ]);
          },
          onFileIncomingStart: (_peerId, file) => {
            updateTransfer(file.id, { name: file.name, size: file.size, direction: 'received', progress: 0 });
          },
          onFileProgress: (_peerId, id, receivedBytes, size) => {
            updateTransfer(id, { progress: Math.round((receivedBytes / size) * 100) });
          },
          onFileComplete: (_peerId, id, url, name) => {
            updateTransfer(id, { progress: 100, url, name });
          },
          onCallRequest: (_peerId, mode) => {
            setCall((prev) => (prev ? prev : { phase: 'incoming', mode }));
          },
          onCallAccepted: (_peerId, mode) => {
            setCall((prev) => (prev && prev.phase === 'outgoing' ? { phase: 'active', mode } : prev));
          },
          onCallDeclined: () => {
            setCall((prev) => {
              if (prev?.phase === 'outgoing') {
                teardownLocalMedia();
                return null;
              }
              return prev;
            });
          },
          onCallEnded: () => {
            teardownLocalMedia();
            setCall(null);
          },
        });
        peerManagerRef.current = manager;
        for (const existingId of existingPeers) manager.connectToPeer(existingId);
      });

      signaling.onPeerJoined((peerId) => {
        peerManagerRef.current?.connectToPeer(peerId);
      });

      signaling.onPeerLeft((peerId) => {
        peerManagerRef.current?.removePeer(peerId);
        setPeerNames((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      });

      signaling.onRoomFull(() => setErrorMsg('That room already has the maximum number of peers.'));
      signaling.onClose(() => setState('setup'));

      await signaling.connect(relayUrl, code);
      setState('connected');
    } catch (err) {
      console.error(err);
      setErrorMsg('Could not connect to the relay. Check the address and try again.');
      setState('error');
    }
  }

  function teardownLocalMedia() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    peerManagerRef.current?.setLocalStream(null);
    setMicOn(false);
    setCamOn(false);
  }

  async function getMedia(mode: CallMode): Promise<MediaStream> {
    // Explicit constraints (not just `audio: true`) so echo cancellation is
    // guaranteed on rather than left to browser defaults — without it, two
    // devices (or two tabs) near each other feed each other's speaker output
    // back into the mic and produce a feedback hum.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: mode === 'video',
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(mode === 'video');
    peerManagerRef.current?.setLocalStream(stream);
    return stream;
  }

  async function startCall(mode: CallMode) {
    if (call) return;
    try {
      await getMedia(mode);
      await peerManagerRef.current?.requestCall(mode);
      setCall({ phase: 'outgoing', mode });
    } catch (err) {
      console.error(err);
      setCallBadge('Camera/mic permission denied');
      setTimeout(() => setCallBadge(''), 3000);
    }
  }

  async function acceptCall() {
    if (!call) return;
    try {
      await getMedia(call.mode);
      await peerManagerRef.current?.acceptCall(call.mode);
      setCall({ phase: 'active', mode: call.mode });
    } catch (err) {
      console.error(err);
      declineCall();
    }
  }

  async function declineCall() {
    await peerManagerRef.current?.declineCall();
    setCall(null);
  }

  async function cancelOutgoing() {
    await peerManagerRef.current?.endCall();
    teardownLocalMedia();
    setCall(null);
  }

  async function endActiveCall() {
    await peerManagerRef.current?.endCall();
    teardownLocalMedia();
    setCall(null);
  }

  function toggleMic() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }

  function toggleCam() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  function handleSendChat(text: string) {
    peerManagerRef.current?.sendChat(text);
    setChatEntries((prev) => [...prev, { id: crypto.randomUUID(), peerId: 'self', name: myName, text, ts: Date.now(), self: true }]);
  }

  async function handleSendFile(file: File) {
    const id = crypto.randomUUID();
    updateTransfer(id, { name: file.name, size: file.size, direction: 'sent', progress: 100 });
    await peerManagerRef.current?.sendFile(file);
  }

  function handleHangUp() {
    peerManagerRef.current?.closeAll();
    signalingRef.current?.disconnect();
    teardownLocalMedia();
    setChatEntries([]);
    setTransfers([]);
    setPeerNames(new Map());
    setPeerCount(0);
    setCall(null);
    setState('setup');
  }

  if (state === 'setup' || state === 'connecting' || state === 'error') {
    return (
      <div className="app-shell centered">
        <ConnectPanel onConnect={handleConnect} />
        {state === 'connecting' && <p className="status pulsing-text">Connecting…</p>}
        {errorMsg && <p className="status error shake">{errorMsg}</p>}
      </div>
    );
  }

  const otherNames = [...peerNames.values()];
  const headerName = otherNames.length > 0 ? otherNames.join(', ') : 'Waiting for someone to join…';

  return (
    <div className="app-shell session">
      <header className="session-header">
        <div className="header-identity">
          <img src="/logo.png" alt="DC" className="header-logo" />
          <div className="header-text">
            <span className="header-name">{headerName}</span>
            <span className="header-status">{peerCount > 0 ? `${peerCount} online` : 'Waiting…'}</span>
          </div>
        </div>
        <div className="call-controls">
          <button className="icon-btn" title="Voice call" onClick={() => startCall('audio')} disabled={peerCount === 0 || !!call}>
            <IconPhone />
          </button>
          <button className="icon-btn" title="Video call" onClick={() => startCall('video')} disabled={peerCount === 0 || !!call}>
            <IconVideo />
          </button>
          <button className="icon-btn" title="File history" onClick={() => setShowFiles(true)}>
            <IconFolder />
          </button>
          <button className="icon-btn danger" title="Leave" onClick={handleHangUp}>
            <IconPower />
          </button>
        </div>
      </header>

      {callBadge && <div className="toast shake">{callBadge}</div>}

      <div className="session-body">
        <Chat entries={chatEntries} onSend={handleSendChat} onSendFile={handleSendFile} />
      </div>

      <div className={`drawer ${showFiles ? 'drawer--open' : ''}`}>
        <FileTransfer transfers={transfers} onSendFile={handleSendFile} onClose={() => setShowFiles(false)} />
      </div>
      {showFiles && <div className="drawer-backdrop" onClick={() => setShowFiles(false)} />}

      {call && (
        <CallOverlay
          phase={call.phase}
          mode={call.mode}
          peerNames={otherNames.length ? otherNames : ['Peer']}
          localStream={localStream}
          remoteStreams={remoteStreams}
          micOn={micOn}
          camOn={camOn}
          onAccept={acceptCall}
          onDecline={declineCall}
          onCancel={cancelOutgoing}
          onEnd={endActiveCall}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
        />
      )}
    </div>
  );
}
