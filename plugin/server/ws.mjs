/**
 * Just enough of a WebSocket server (RFC 6455) for the bridge: text messages both ways,
 * pings answered, close handled. No dependencies, so the plugin needs no npm install.
 */
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 4 << 20;

/** Frame `payload` (a Buffer) with opcode `op`; servers never mask. */
function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | op, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * Complete the handshake on an 'upgrade' request and return a connection
 * `{send(text), close(), onMessage, onClose}`, or null (and drop the socket) if it isn't
 * a WebSocket request.
 */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', '',
  ].join('\r\n'));
  socket.setNoDelay(true);

  const ws = {
    closed: false,
    onMessage: null,
    onClose: null,
    send(text) {
      if (!ws.closed) socket.write(frame(0x1, Buffer.from(String(text))));
    },
    close() {
      if (ws.closed) return;
      ws.closed = true;
      try { socket.end(frame(0x8, Buffer.alloc(0))); } catch { /* gone */ }
    },
  };

  let buf = Buffer.alloc(0);
  let parts = [];
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_MESSAGE) { socket.destroy(); return; }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return; // wait for the rest
      const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + maskLen + len);
      if (op === 0x8) { ws.close(); socket.destroy(); return; }
      if (op === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        parts.push(payload);
        if (fin) {
          const text = Buffer.concat(parts).toString('utf8');
          parts = [];
          if (ws.onMessage) ws.onMessage(text);
        }
      }
    }
  });
  const gone = () => {
    ws.closed = true;
    const cb = ws.onClose;
    ws.onClose = null;
    if (cb) cb();
  };
  socket.on('close', gone);
  socket.on('error', gone);
  return ws;
}
