// Live versus match logic. Transport- and UI-agnostic (testable in Node).
//
// The host is authoritative: it picks the seed, waits until both players
// have the photo on screen, starts each round, collects both answers and
// broadcasts the reveal. Both sides build the exact same questions from the
// shared seed, so only tiny messages cross the wire.
//
// Messages
//   hello   {name}                  both, on connect
//   start   {seed}                  host → guest
//   ready   {i}                     guest → host   (photo for round i shown)
//   go      {i}                     host → guest   (start the 5 s clock)
//   answered{i}                     both           (so the other side can show "answered")
//   answer  {i, id, ms}             guest → host
//   reveal  {i, host:{id,ms}, guest:{id,ms}}   host → guest
//   rematch {}                      guest → host   (request)
//   bye     {}                      either
//   ping    {}                      either, heartbeat

import { makeRun, nextQuestion, speedPoints, TIME_LIMIT } from './game.js'

export const ROUNDS = 10
export const REVEAL_MS = 2600
const HEARTBEAT_MS = 2000
const DEAD_MS = 9000
const READY_GRACE_MS = 6000
const ANSWER_GRACE_MS = 2500

export class Versus {
  /**
   * @param {object} o
   * @param {'host'|'guest'} o.role
   * @param {object} o.conn      transport connection
   * @param {string} o.name      my nickname
   * @param {Array}  o.athletes  athlete list
   * @param {function} o.onChange  called whenever state changes
   * @param {object} [o.clock]   { now, setTimeout, clearTimeout, setInterval, clearInterval } (for tests)
   */
  constructor({ role, conn, name, athletes, onChange, clock }) {
    this.role = role
    this.conn = conn
    this.athletes = athletes
    this.onChange = onChange || (() => {})
    this.c = clock || { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id), setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id) }
    this.me = { name, score: 0 }
    this.opp = { name: '', score: 0 }
    this.phase = 'lobby' // lobby | loading | play | reveal | over | left
    this.run = null
    this.q = null
    this.i = -1
    this.rounds = [] // { q, host:{id,ms}|null, guest:{id,ms}|null, pts:{host,guest} }
    this.oppAnswered = false
    this.myAnswer = null
    this.startAt = 0
    this.rematchAsked = false
    this.rematchSent = false
    this._timers = new Set()
    this._ready = { host: -1, guest: -1 }
    this.lastSeen = this.c.now()

    conn.onData(m => this._onMessage(m))
    conn.onClose(() => this._left())
    this.send({ t: 'hello', name })
    this._hb = this.c.setInterval(() => {
      this.send({ t: 'ping' })
      if (this.c.now() - this.lastSeen > DEAD_MS) this._left()
    }, HEARTBEAT_MS)
  }

  get myRole() { return this.role }
  get oppRole() { return this.role === 'host' ? 'guest' : 'host' }
  get connected() { return this.phase !== 'left' }
  get round() { return this.rounds[this.i] }

  send(m) { this.conn.send(m) }
  _emit() { this.onChange(this) }
  _later(f, ms) {
    const id = this.c.setTimeout(() => { this._timers.delete(id); f() }, ms)
    this._timers.add(id)
    return id
  }
  _clearTimers() { this._timers.forEach(id => this.c.clearTimeout(id)); this._timers.clear() }

  // ---------- host actions ----------
  start(seed = Math.floor(Math.random() * 2 ** 31)) {
    if (this.role !== 'host' || !this.opp.name || this.phase === 'left') return
    this.send({ t: 'start', seed })
    this._start(seed)
  }

  // ---------- both ----------
  requestRematch() {
    if (this.role === 'host') return this.start()
    this.rematchSent = true
    this.send({ t: 'rematch' })
    this._emit()
  }

  /** UI calls this once the photo for round i is visible (or failed to load). */
  photoReady(i) {
    if (i !== this.i || this.phase !== 'loading') return
    if (this.role === 'guest') this.send({ t: 'ready', i })
    this._markReady(this.role, i)
  }

  /** UI calls this when the player taps an option (id) or the clock runs out (null). */
  answer(id) {
    if (this.phase !== 'play' || this.myAnswer) return
    const ms = Math.min(TIME_LIMIT, Math.max(0, this.c.now() - this.startAt))
    this.myAnswer = { id: id || null, ms: id ? ms : TIME_LIMIT }
    this.send({ t: 'answered', i: this.i })
    if (this.role === 'guest') this.send({ t: 'answer', i: this.i, ...this.myAnswer })
    else { this.round.host = this.myAnswer; this._maybeReveal() }
    this._emit()
  }

  leave() {
    this.send({ t: 'bye' })
    this.destroy()
    this.conn.close()
  }

  destroy() {
    this._clearTimers()
    this.c.clearInterval(this._hb)
  }

  msLeft() {
    if (this.phase !== 'play') return this.phase === 'loading' ? TIME_LIMIT : 0
    return Math.max(0, TIME_LIMIT - (this.c.now() - this.startAt))
  }

  // ---------- internals ----------
  _start(seed) {
    this._clearTimers()
    this.seed = seed
    // Questions always come from athletes with Chinese names so both players get the same set,
    // whatever language each of them is using.
    this.run = makeRun(this.athletes, { mode: 'speed', lang: 'zh', seed })
    this.rounds = []
    this.i = -1
    this.me.score = 0
    this.opp.score = 0
    this.rematchAsked = false
    this.rematchSent = false
    this._ready = { host: -1, guest: -1 }
    this._pendingGo = null
    this._nextRound()
  }

  _nextRound() {
    const q = nextQuestion(this.run)
    if (!q || this.rounds.length >= ROUNDS) { this.phase = 'over'; this._emit(); return }
    this.i = this.rounds.length
    this.rounds.push({ q, host: null, guest: null, pts: { host: 0, guest: 0 } })
    this.q = q
    this.phase = 'loading'
    this.myAnswer = null
    this.oppAnswered = false
    if (this.role === 'guest' && this._pendingGo === this.i) { this._pendingGo = null; this._emit(); this._go(this.i); return }
    if (this.role === 'host') {
      const i = this.i
      // don't wait forever for a slow photo on the other side
      this._later(() => { if (this.i === i && this.phase === 'loading' && this._ready.host === i) this._go(i) }, READY_GRACE_MS)
    }
    this._emit()
  }

  _markReady(who, i) {
    this._ready[who] = Math.max(this._ready[who], i)
    if (this.role === 'host' && this._ready.host === this.i && this._ready.guest === this.i && this.phase === 'loading') this._go(this.i)
  }

  _go(i) {
    if (this.role === 'host') this.send({ t: 'go', i })
    this.phase = 'play'
    this.startAt = this.c.now()
    if (this.role === 'host') {
      // collect late / missing answers
      this._later(() => {
        if (this.i !== i || this.phase !== 'play') return
        if (!this.round.host) this.answer(null)
        if (!this.round.guest) this.round.guest = { id: null, ms: TIME_LIMIT }
        this._maybeReveal()
      }, TIME_LIMIT + ANSWER_GRACE_MS)
    }
    this._emit()
  }

  _maybeReveal() {
    const r = this.round
    if (this.role !== 'host' || this.phase !== 'play' || !r.host || !r.guest) return
    const msg = { t: 'reveal', i: this.i, host: r.host, guest: r.guest }
    this.send(msg)
    this._reveal(msg)
  }

  _reveal({ i, host, guest }) {
    if (i !== this.i) return
    const r = this.round
    r.host = host; r.guest = guest
    const pts = a => (a && a.id === r.q.answer.id ? speedPoints(TIME_LIMIT - a.ms) : 0)
    r.pts = { host: pts(host), guest: pts(guest) }
    this.me.score += r.pts[this.role]
    this.opp.score += r.pts[this.oppRole]
    this.myAnswer = r[this.role]
    this.phase = 'reveal'
    this._emit()
    this._later(() => { if (this.phase === 'reveal' && this.i === i) this._nextRound() }, REVEAL_MS)
  }

  _left() {
    if (this.phase === 'left') return
    this.destroy()
    this.phase = 'left'
    this._emit()
  }

  _onMessage(m) {
    if (!m || typeof m !== 'object') return
    this.lastSeen = this.c.now()
    switch (m.t) {
      case 'hello':
        this.opp.name = String(m.name || '').slice(0, 16) || '?'
        this._emit(); break
      case 'start':
        if (this.role === 'guest') this._start(m.seed)
        break
      case 'ready':
        if (this.role === 'host') this._markReady('guest', m.i)
        break
      case 'go':
        if (this.role !== 'guest') break
        if (m.i === this.i && this.phase === 'loading') this._go(m.i)
        else if (m.i > this.i) this._pendingGo = m.i // we are a little behind; start as soon as we get there
        break
      case 'answered':
        if (m.i === this.i) { this.oppAnswered = true; this._emit() }
        break
      case 'answer':
        if (this.role === 'host' && m.i === this.i && !this.round.guest && this.phase === 'play') {
          this.round.guest = { id: m.id || null, ms: Math.min(TIME_LIMIT, Math.max(0, Number(m.ms) || 0)) }
          this.oppAnswered = true
          this._maybeReveal()
          this._emit()
        }
        break
      case 'reveal':
        if (this.role === 'guest') this._reveal(m)
        break
      case 'rematch':
        if (this.role === 'host') { this.rematchAsked = true; this._emit() }
        break
      case 'bye':
        this._left(); break
    }
  }
}
