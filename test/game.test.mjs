// node test/game.test.mjs — solo modes, scoring, data sanity
import assert from 'node:assert/strict'
import { ATHLETES, SPORTS_EN } from '../js/athletes.js'
import { makeRun, nextQuestion, submit, summary, speedPoints, infoLine, rankKey, displayName, medalTotal, TIME_LIMIT } from '../js/game.js'
import { MESSAGES, format } from '../js/messages.js'
assert.deepEqual(Object.keys(MESSAGES.zh).sort(), Object.keys(MESSAGES.en).sort())
assert.equal(speedPoints(5000), 150); assert.equal(speedPoints(0), 50); assert.equal(speedPoints(2500), 100)
for (let seed = 1; seed <= 300; seed++) {
  const lang = seed % 2 ? 'zh' : 'en'
  // speed: 10 medallist questions
  const r = makeRun(ATHLETES, { mode: 'speed', lang, seed })
  let q, n = 0
  while ((q = nextQuestion(r))) {
    n++; assert.equal(q.options.length, 4); assert.ok(medalTotal(q.answer) > 0)
    assert.equal(new Set(q.options.map(o => displayName(o, lang))).size, 4)
    assert.ok(q.options.every(o => o.sex === q.answer.sex))
    const pickRight = seed % 3 !== 0
    submit(r, q, pickRight ? q.answer : (seed % 2 ? null : q.options.find(o => o.id !== q.answer.id)), 1234)
  }
  assert.equal(n, 10); assert.ok(r.over)
  const s = summary(r); if (seed % 3) assert.equal(s.score, 10 * speedPoints(TIME_LIMIT - 1234)); else assert.equal(s.score, 0)
  // death: answer right k times then wrong
  const d = makeRun(ATHLETES, { mode: 'death', lang, seed })
  const k = seed % 40
  for (let i = 0; i <= k; i++) {
    const dq = nextQuestion(d)
    if (i < 10) assert.ok(medalTotal(dq.answer) > 0)
    const ok = submit(d, dq, i < k ? dq.answer : null, 800)
    assert.equal(ok, i < k); assert.equal(d.over, i === k)
  }
  assert.equal(nextQuestion(d), null)
  assert.equal(summary(d).score, k)
  assert.equal(new Set(d.order.map(a => a.id)).size, d.order.length)
}
// death clear all
const d = makeRun(ATHLETES, { mode: 'death', lang: 'zh', seed: 9 }); let q; while ((q = nextQuestion(d))) submit(d, q, q.answer, 100)
const s = summary(d); console.log('death full run', s.score, s.cleared); assert.ok(s.cleared)
const t = (k, v) => format(MESSAGES.zh[k], v)
console.log(infoLine(ATHLETES.find(a => a.id === '12371343'), SPORTS_EN, 'zh', t), rankKey('death', { score: 31 }), rankKey('speed', { score: 800 }))
console.log('ALL TESTS PASSED')
// options never repeat a name in either language
for (let seed = 1; seed <= 200; seed++) {
  const r = makeRun(ATHLETES, { mode: 'death', lang: 'zh', seed }); let q, n = 0
  while ((q = nextQuestion(r)) && n++ < 60) {
    assert.equal(new Set(q.options.map(o => o.en.toLowerCase())).size, 4)
    assert.equal(new Set(q.options.map(o => o.zh)).size, 4)
    submit(r, q, q.answer, 500)
  }
}
console.log('name de-dup ✓')
