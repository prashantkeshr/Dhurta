import { useRef, useState, type DragEvent } from 'react';
import { IconUpload, IconCheckCircle, IconDownload, IconX, IconFolder } from './Icons';

export interface TransferEntry {
  id: string;
  name: string;
  size: number;
  direction: 'sent' | 'received';
  progress: number; // 0-100
  url?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileTransfer({
  transfers,
  onSendFile,
  onClose,
}: {
  transfers: TransferEntry[];
  onSendFile: (file: File) => void;
  onClose?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onSendFile(file);
  }

  return (
    <div className="file-panel">
      <div className="drawer-header">
        <h2>Files</h2>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        )}
      </div>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="dropzone-icon"><IconFolder /></div>
        Drop a file here, or click to choose
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSendFile(file);
            e.target.value = '';
          }}
        />
      </div>
      <div className="transfer-list">
        {transfers.length === 0 && <p className="empty-hint">No files shared yet.</p>}
        {transfers.map((t) => (
          <div key={t.id} className="transfer-row slide-in">
            <div className={`transfer-icon ${t.progress >= 100 ? 'done' : ''}`}>
              {t.progress >= 100 ? <IconCheckCircle /> : <IconUpload />}
            </div>
            <div className="transfer-info">
              <span className="transfer-name">{t.name}</span>
              <span className="transfer-meta">
                {t.direction === 'sent' ? 'Sent' : 'Received'} · {formatSize(t.size)}
              </span>
              <div className="transfer-bar">
                <div className="transfer-bar-fill" style={{ width: `${t.progress}%` }} />
              </div>
            </div>
            {t.url && (
              <a href={t.url} download={t.name} className="transfer-link">
                <IconDownload />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
