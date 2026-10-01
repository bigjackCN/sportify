// node test/versus.test.mjs — simulates two players over a laggy link with a fake clock
import assert from 'node:assert/strict'
import { ATHLETES } from '../js/athletes.js'
import { Versus, ROUNDS, REVEAL_MS } from '../js/versus.js'
import { speedPoints, TIME_LIMIT } from '../js/game.js'

function fakeClock() {
  let now = 0, id = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout: (f, ms) => { timers.set(++id, { at: now + ms, f }); return id },
    clearTimeout: i => timers.delete(i),
    setInterval: (f, ms) => { const k = ++id; const tick = () => { timers.set(k, { at: now + ms, f: () => { f(); tick() } }) }; tick(); return k },
    clearInterval: i => timers.delete(i),
    advance(ms) {
      const end = now + ms
      for (;;) {
        let next = null
        for (const [k, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t]
        if (!next) break
        timers.delete(next[0]); now = next[1].at; next[1].f()
      }
      now = end
    }
  }
}
function pair(clock, latency) {
  const mk = () => ({ data: [], close: [], other: null, closed: false })
  const a = mk(), b = mk(); a.other = b; b.other = a
  const api = s => ({
    send: m => { if (s.closed) return; const copy = JSON.parse(JSON.stringify(m)); clock.setTimeout(() => s.other.data.forEach(cb => cb(copy)), latency) },
    onData: cb => s.data.push(cb),
    onClose: cb => s.close.push(cb),
    close: () => { s.closed = true; clock.setTimeout(() => s.other.close.forEach(cb => cb()), latency) }
  })
  return [api(a), api(b)]
}

for (const latency of [0, 40, 400]) {
  for (const seed of [1, 2, 3]) {
    const clock = fakeClock()
    const [ch, cg] = pair(clock, latency)
    const host = new Versus({ role: 'host', conn: ch, name: 'Alice', athletes: ATHLETES, clock })
    const guest = new Versus({ role: 'guest', conn: cg, name: 'Bob', athletes: ATHLETES, clock })
    clock.advance(1000)
    assert.equal(host.opp.name, 'Bob'); assert.equal(guest.opp.name, 'Alice')
    host.start(seed * 7919)
    clock.advance(latency + 10)
    let expectedHost = 0, expectedGuest = 0
    for (let r = 0; r < ROUNDS; r++) {
      assert.equal(host.i, r); assert.equal(guest.i, r)
      assert.equal(host.q.answer.id, guest.q.answer.id, 'same question')
      assert.deepEqual(host.q.options.map(o => o.id), guest.q.options.map(o => o.id), 'same options')
      // photos load at different speeds
      clock.advance(100); host.photoReady(r)
      clock.advance(300); guest.photoReady(r)
      clock.advance(latency * 2 + 5)
      assert.equal(host.phase, 'play'); assert.equal(guest.phase, 'play')
      const right = host.q.answer.id, wrong = host.q.options.find(o => o.id !== right).id
      // host: answers right after 1s on even rounds, wrong on odd; guest: right after 2s, times out every 4th
      clock.advance(1000); host.answer(r % 2 ? wrong : right)
      clock.advance(1000)
      if (r % 4 === 3) { clock.advance(TIME_LIMIT); guest.answer(null) } else guest.answer(right)
      clock.advance(latency * 2 + 20)
      if (r % 4 !== 3) { assert.equal(host.phase, 'reveal', `reveal r${r}`); assert.equal(guest.phase, 'reveal') }
      else clock.advance(3000)
      const hr = host.round
      if (r % 2 === 0) expectedHost += speedPoints(TIME_LIMIT - hr.host.ms)
      if (r % 4 !== 3) expectedGuest += speedPoints(TIME_LIMIT - hr.guest.ms)
      assert.equal(host.me.score, expectedHost); assert.equal(guest.opp.score, expectedHost)
      assert.equal(guest.me.score, expectedGuest); assert.equal(host.opp.score, expectedGuest)
      clock.advance(REVEAL_MS + latency + 10)
    }
    assert.equal(host.phase, 'over'); assert.equal(guest.phase, 'over')
    // rematch requested by guest
    guest.requestRematch(); clock.advance(latency + 5); assert.ok(host.rematchAsked)
    host.requestRematch(); clock.advance(latency + 5)
    assert.equal(guest.phase, 'loading'); assert.equal(guest.i, 0); assert.equal(guest.me.score, 0)
    // guest's photo never loads -> host still starts after grace, guest catches up
    host.photoReady(0); clock.advance(7000)
    assert.equal(host.phase === 'play' || host.phase === 'reveal', true)
    // guest leaves -> host notices
    guest.leave(); clock.advance(latency + 10)
    assert.equal(host.phase, 'left')
    host.destroy()
    console.log(`latency ${latency}ms seed ${seed}: host ${expectedHost} vs guest ${expectedGuest} ✓`)
  }
}
// heartbeat: silent drop is detected
{
  const clock = fakeClock()
  const [ch, cg] = pair(clock, 10)
  const host = new Versus({ role: 'host', conn: ch, name: 'A', athletes: ATHLETES, clock })
  const guest = new Versus({ role: 'guest', conn: cg, name: 'B', athletes: ATHLETES, clock })
  clock.advance(500); guest.destroy(); cg.send = () => {} // guest vanishes without bye
  clock.advance(12000); assert.equal(host.phase, 'left'); host.destroy()
  console.log('heartbeat drop detected ✓')
}
console.log('ALL VERSUS TESTS PASSED')
