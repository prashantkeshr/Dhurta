import { avatarColor, initials } from '../lib/names';

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: avatarColor(name),
      }}
    >
      {initials(name)}
    </div>
  );
}
