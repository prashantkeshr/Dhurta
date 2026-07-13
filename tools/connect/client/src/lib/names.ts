// Default display names — no account, no login, just a friendly random handle
// the user can rename any time. Nothing here is transmitted anywhere except
// directly to connected peers over the encrypted data channel.

const ADJECTIVES = [
  'Swift', 'Quiet', 'Amber', 'Cosmic', 'Lucky', 'Gentle', 'Bright', 'Silver',
  'Bold', 'Calm', 'Rapid', 'Hidden', 'Golden', 'Velvet', 'Electric', 'Mellow',
  'Curious', 'Vivid', 'Nimble', 'Northern',
];

const NOUNS = [
  'Falcon', 'Otter', 'Comet', 'Maple', 'Panther', 'Harbor', 'Ember', 'Willow',
  'Fox', 'Raven', 'Tiger', 'Meadow', 'Wolf', 'Lantern', 'Horizon', 'Lynx',
  'Storm', 'River', 'Sparrow', 'Nova',
];

export function randomDisplayName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${a} ${n} ${num}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  '#00f5a0', '#00c2ff', '#ff2ec4', '#ff2d6e', '#a855f7', '#21ffa8', '#ff9f1c', '#7c5bff',
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
