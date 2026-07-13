import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';

// Everything below lives only in process memory. Nothing is written to disk,
// nothing is logged except connection/disconnection counts. Payloads are
// opaque encrypted blobs to this server by design (see client/src/lib/crypto.ts) —
// even if this server were compromised or subpoenaed, there is nothing to hand over.

const PORT = process.env.PORT || 8080;
const ROOM_IDLE_TTL_MS = 5 * 60 * 1000; // rooms with no peers are forgotten after 5 min
const MAX_PEERS_PER_ROOM = 8;

/** @type {Map<string, { peers: Map<string, WebSocket>, lastActivity: number }>} */
const rooms = new Map();

function now() {
  return Date.now();
}

function makePeerId() {
  return randomBytes(8).toString('hex');
}

function getOrCreateRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = { peers: new Map(), lastActivity: now() };
    rooms.set(code, room);
  }
  return room;
}

function broadcast(room, senderId, message) {
  const raw = JSON.stringify(message);
  for (const [peerId, sock] of room.peers) {
    if (peerId === senderId) continue;
    if (sock.readyState === sock.OPEN) sock.send(raw);
  }
}

function leaveRoom(code, peerId) {
  const room = rooms.get(code);
  if (!room) return;
  room.peers.delete(peerId);
  broadcast(room, peerId, { type: 'peer-left', peerId });
  if (room.peers.size === 0) {
    room.lastActivity = now();
  }
}

// Periodic sweep: drop rooms that have sat empty past the TTL.
setInterval(() => {
  const cutoff = now() - ROOM_IDLE_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.peers.size === 0 && room.lastActivity < cutoff) {
      rooms.delete(code);
    }
  }
}, 30_000).unref();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  let joinedCode = null;
  let peerId = null;

  socket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // malformed frame, drop silently — never logged
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '').trim();
      if (!code || code.length > 32) return;

      const room = getOrCreateRoom(code);
      if (room.peers.size >= MAX_PEERS_PER_ROOM) {
        socket.send(JSON.stringify({ type: 'room-full' }));
        return;
      }

      peerId = makePeerId();
      joinedCode = code;
      room.peers.set(peerId, socket);
      room.lastActivity = now();

      const existingPeerIds = [...room.peers.keys()].filter((id) => id !== peerId);
      socket.send(JSON.stringify({ type: 'joined', peerId, peers: existingPeerIds }));
      broadcast(room, peerId, { type: 'peer-joined', peerId });
      return;
    }

    // Everything else is an opaque encrypted signaling blob (offer/answer/ice)
    // addressed to a specific peer within the room. We only route it.
    if (!joinedCode || !peerId) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    room.lastActivity = now();

    if (msg.type === 'signal' && msg.to) {
      const target = room.peers.get(msg.to);
      if (target && target.readyState === target.OPEN) {
        target.send(JSON.stringify({ type: 'signal', from: peerId, payload: msg.payload }));
      }
    }
  });

  socket.on('close', () => {
    if (joinedCode && peerId) leaveRoom(joinedCode, peerId);
  });
});

console.log(`[dhurta-connect relay] listening on port ${PORT} (no payload logging, no persistence)`);
