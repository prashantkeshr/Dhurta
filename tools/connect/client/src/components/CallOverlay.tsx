import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { IconX, IconCheck, IconMic, IconMicOff, IconVideo, IconVideoOff, IconPhoneOff } from './Icons';
import type { CallMode } from '../lib/webrtc';

export type CallPhase = 'outgoing' | 'incoming' | 'active';

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

function formatDuration(total: number) {
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function RemoteVideoTile({ stream, name }: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // A remote video track's own `.enabled` is always true on the receiving side —
  // it's a local-only property. Whether the far end has their camera on is
  // reflected by `.muted` and the mute/unmute events, so we listen for those.
  const [hasVideo, setHasVideo] = useState(() => stream.getVideoTracks().some((t) => !t.muted && t.readyState === 'live'));

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) {
      setHasVideo(false);
      return;
    }
    const update = () => setHasVideo(!track.muted && track.readyState === 'live');
    update();
    track.addEventListener('mute', update);
    track.addEventListener('unmute', update);
    return () => {
      track.removeEventListener('mute', update);
      track.removeEventListener('unmute', update);
    };
  }, [stream]);

  return (
    <div className="call-remote-tile">
      <video ref={ref} autoPlay playsInline className={hasVideo ? '' : 'hidden'} />
      {!hasVideo && (
        <div className="call-avatar-fallback">
          <Avatar name={name} size={96} />
        </div>
      )}
    </div>
  );
}

export function CallOverlay({
  phase,
  mode,
  peerNames,
  localStream,
  remoteStreams,
  micOn,
  camOn,
  onAccept,
  onDecline,
  onCancel,
  onEnd,
  onToggleMic,
  onToggleCam,
}: {
  phase: CallPhase;
  mode: CallMode;
  peerNames: string[];
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  micOn: boolean;
  camOn: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  const elapsed = useElapsedSeconds(phase === 'active');
  const remoteList = [...remoteStreams.values()];
  const title = peerNames.length ? peerNames.join(', ') : 'Connecting…';

  // A callback ref (not useEffect) so srcObject is set the instant the pip
  // mounts, even if localStream itself hasn't changed since it was captured
  // (e.g. the pip only starts rendering once the call becomes active).
  const localVideoCallbackRef = (el: HTMLVideoElement | null) => {
    if (el) el.srcObject = localStream;
  };

  const isVideoCall = mode === 'video';
  const showLocalPip = phase === 'active' && isVideoCall && camOn;

  return (
    <div className={`call-overlay ${phase === 'active' ? 'call-overlay--active' : 'call-overlay--ringing'}`}>
      {phase === 'active' && isVideoCall && remoteList.length > 0 ? (
        <div className="call-video-stage">
          {remoteList.map((stream, i) => (
            <RemoteVideoTile key={i} stream={stream} name={peerNames[i] ?? 'Peer'} />
          ))}
        </div>
      ) : (
        <div className="call-center">
          <div className={`ring-avatar ${phase !== 'active' ? 'pulsing' : ''}`}>
            <Avatar name={peerNames[0] ?? '?'} size={120} />
          </div>
          <h2 className="call-title">{title}</h2>
          <p className="call-subtitle">
            {phase === 'outgoing' && `Calling… ${mode === 'video' ? '(video)' : '(voice)'}`}
            {phase === 'incoming' && `Incoming ${mode === 'video' ? 'video call' : 'call'}…`}
            {phase === 'active' && formatDuration(elapsed)}
          </p>
        </div>
      )}

      {showLocalPip && (
        <video ref={localVideoCallbackRef} autoPlay playsInline muted className="call-local-pip" />
      )}

      {phase === 'active' && isVideoCall && (
        <div className="call-header">
          <span>{title}</span>
          <span className="call-timer">{formatDuration(elapsed)}</span>
        </div>
      )}

      <div className="call-controls-bar">
        {phase === 'incoming' && (
          <>
            <button className="call-btn call-btn--decline" onClick={onDecline} aria-label="Decline">
              <IconX />
            </button>
            <button className="call-btn call-btn--accept" onClick={onAccept} aria-label="Accept">
              <IconCheck />
            </button>
          </>
        )}
        {phase === 'outgoing' && (
          <button className="call-btn call-btn--decline" onClick={onCancel} aria-label="Cancel">
            <IconX />
          </button>
        )}
        {phase === 'active' && (
          <>
            <button className={`call-btn call-btn--toggle ${micOn ? '' : 'off'}`} onClick={onToggleMic} aria-label="Mute">
              {micOn ? <IconMic /> : <IconMicOff />}
            </button>
            {isVideoCall && (
              <button className={`call-btn call-btn--toggle ${camOn ? '' : 'off'}`} onClick={onToggleCam} aria-label="Camera">
                {camOn ? <IconVideo /> : <IconVideoOff />}
              </button>
            )}
            <button className="call-btn call-btn--decline" onClick={onEnd} aria-label="End call">
              <IconPhoneOff />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
