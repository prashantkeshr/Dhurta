import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar } from './Avatar';
import { AttachmentMenu } from './AttachmentMenu';
import { IconMessageCircle, IconSend } from './Icons';

export interface ChatEntry {
  id: string;
  peerId: string;
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

export function Chat({
  entries,
  onSend,
  onSendFile,
}: {
  entries: ChatEntry[];
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
}) {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef}>
        {entries.length === 0 && (
          <div className="empty-state fade-in">
            <div className="empty-icon"><IconMessageCircle /></div>
            <p>No messages yet. Say hello!</p>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`chat-row ${entry.self ? 'self' : 'peer'} slide-in`}>
            {!entry.self && <Avatar name={entry.name} size={28} />}
            <div className={`chat-bubble ${entry.self ? 'self' : 'peer'}`}>
              {!entry.self && <span className="chat-meta">{entry.name}</span>}
              <span className="chat-text">{entry.text}</span>
              <span className="chat-time">
                {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <AttachmentMenu onSendFile={onSendFile} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          autoComplete="off"
        />
        <button type="submit" className="send-btn" disabled={!draft.trim()} aria-label="Send">
          <IconSend />
        </button>
      </form>
    </div>
  );
}
