import { useEffect, useRef, useState } from 'react';
import { IconPaperclip, IconImage, IconFile, IconCamera } from './Icons';

// WhatsApp-style attachment picker: one paperclip button opens a small menu
// of source types, each backed by a hidden <input type="file"> with the
// right `accept`/`capture` so it works the same on desktop and mobile —
// "capture" opens the device camera directly on phones and is silently
// ignored on desktop, which just falls back to its normal file picker.
export function AttachmentMenu({ onSendFile }: { onSendFile: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function pick(file: File | undefined) {
    if (file) onSendFile(file);
    setOpen(false);
  }

  return (
    <div className="attach-menu" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn attach-toggle ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Attach"
      >
        <IconPaperclip />
      </button>

      {open && (
        <div className="attach-popover slide-in">
          <button type="button" className="attach-option" onClick={() => mediaInputRef.current?.click()}>
            <span className="attach-icon attach-icon--media"><IconImage /></span>
            Photo or Video
          </button>
          <button type="button" className="attach-option" onClick={() => fileInputRef.current?.click()}>
            <span className="attach-icon attach-icon--file"><IconFile /></span>
            Document
          </button>
          <button type="button" className="attach-option" onClick={() => cameraInputRef.current?.click()}>
            <span className="attach-icon attach-icon--camera"><IconCamera /></span>
            Camera
          </button>
        </div>
      )}

      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
