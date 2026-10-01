// Networking for live versus.
//
// Two transports with the same tiny interface:
//   conn.send(obj)          send a JSON-able message
//   conn.onData(cb)         receive messages
//   conn.onClose(cb)        the other side went away
//   conn.close()
//
// - "peer"  (default): WebRTC data channel via PeerJS. The free public PeerJS
//   server is only used to exchange connection info; game traffic goes
//   directly between the two browsers. No server of our own.
// - "local" (?net=local): BroadcastChannel between tabs of the same browser.
//   Handy for development and automated tests.

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
const PREFIX = 'agquiz26-'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const JOIN_TIMEOUT = 15000

export const transportName = () => new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer'

export function randomCode(n = 4) {
  let s = ''
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}
export const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

let peerLib = null
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer)
  if (peerLib) return peerLib
  peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = PEERJS_URL
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS failed to load')))
    s.onerror = () => { peerLib = null; reject(new Error('PeerJS failed to load')) }
    document.head.appendChild(s)
  })
  return peerLib
}

function wrapPeerConn(c, peer) {
  const closeCbs = []
  let closed = false
  const fireClose = () => { if (!closed) { closed = true; closeCbs.forEach(cb => cb()) } }
  c.on('close', fireClose)
  c.on('error', fireClose)
  return {
    send: obj => { try { if (c.open) c.send(obj) } catch (e) {} },
    onData: cb => c.on('data', cb),
    onClose: cb => closeCbs.push(cb),
    close: () => { try { c.close() } catch (e) {} try { peer && peer.destroy() } catch (e) {} fireClose() }
  }
}

// ---------------- PeerJS ----------------
async function peerHost(onConnection) {
  const Peer = await loadPeerJS()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    try {
      const peer = await new Promise((resolve, reject) => {
        const p = new Peer(PREFIX + code, { debug: 0 })
        p.on('open', () => resolve(p))
        p.on('error', e => { try { p.destroy() } catch (_) {} reject(e) })
      })
      let taken = false
      peer.on('connection', c => {
        if (taken) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300) }); return }
        taken = true
        c.on('open', () => onConnection(wrapPeerConn(c, null)))
      })
      return { code, close: () => { try { peer.destroy() } catch (e) {} }, release: () => { taken = false } }
    } catch (e) {
      if (e && e.type === 'unavailable-id') continue
      throw e
    }
  }
  throw new Error('could not reserve a room code')
}

async function peerJoin(code) {
  const Peer = await loadPeerJS()
  const peer = await new Promise((resolve, reject) => {
    const p = new Peer({ debug: 0 })
    p.on('open', () => resolve(p))
    p.on('error', reject)
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('timeout')) }, JOIN_TIMEOUT)
    peer.on('error', e => {
      clearTimeout(timer); peer.destroy()
      reject(e && e.type === 'peer-unavailable' ? Object.assign(new Error('notfound'), { notFound: true }) : e)
    })
    const c = peer.connect(PREFIX + code, { reliable: true })
    c.on('open', () => { clearTimeout(timer); resolve(wrapPeerConn(c, peer)) })
  })
}

// ---------------- BroadcastChannel (local testing) ----------------
function localConn(ch, me, other) {
  const data = [], closeCbs = []
  let closed = false
  ch.addEventListener('message', e => {
    const m = e.data
    if (!m || m.to !== me) return
    if (m.bye) { if (!closed) { closed = true; closeCbs.forEach(cb => cb()) } return }
    data.forEach(cb => cb(m.data))
  })
  return {
    send: obj => { if (!closed) ch.postMessage({ to: other, data: JSON.parse(JSON.stringify(obj)) }) },
    onData: cb => data.push(cb),
    onClose: cb => closeCbs.push(cb),
    close: () => { if (!closed) { ch.postMessage({ to: other, bye: true }); closed = true; closeCbs.forEach(cb => cb()) } }
  }
}

async function localHost(onConnection) {
  const code = randomCode()
  const ch = new BroadcastChannel(PREFIX + code)
  let taken = false
  ch.addEventListener('message', e => {
    if (e.data && e.data.join && !taken) {
      taken = true
      ch.postMessage({ welcome: true })
      onConnection(localConn(ch, 'host', 'guest'))
    }
  })
  return { code, close: () => ch.close(), release: () => { taken = false } }
}

function localJoin(code) {
  const ch = new BroadcastChannel(PREFIX + code)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('notfound'), { notFound: true })), 2500)
    ch.addEventListener('message', function onMsg(e) {
      if (e.data && e.data.welcome) {
        clearTimeout(timer); ch.removeEventListener('message', onMsg)
        resolve(localConn(ch, 'guest', 'host'))
      }
    })
    ch.postMessage({ join: true })
  })
}

/** Create a room. Resolves to { code, close() } once the code is reserved. */
export function hostRoom(onConnection) {
  return transportName() === 'local' ? localHost(onConnection) : peerHost(onConnection)
}
/** Join a room by code. Resolves to a conn. */
export function joinRoom(code) {
  return transportName() === 'local' ? localJoin(code) : peerJoin(code)
}
