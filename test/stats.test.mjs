// node test/stats.test.mjs — ranking maths (no network)
import assert from 'node:assert/strict'
globalThis.fetch = async (url, opt) => {
  if (url.includes('athlete_stats')) return { ok: true, json: async () => ROWS }
  CALLS.push(JSON.parse(opt.body).items.length); return { ok: true, json: async () => 1 }
}
const CALLS = []
const ROWS = [
  { athlete_id: 'A', seen: 100, correct: 96, total_ms: 96 * 1500 },
  { athlete_id: 'B', seen: 1, correct: 1, total_ms: 800 },
  { athlete_id: 'C', seen: 40, correct: 4, total_ms: 4 * 3000 },
  { athlete_id: 'D', seen: 2, correct: 0, total_ms: 0 },
  { athlete_id: 'GHOST', seen: 5, correct: 5, total_ms: 1 }
]
const A = id => ({ id, en: id, zh: id, sports: ['SWM'] })
const athletes = ['A', 'B', 'C', 'D'].map(A)
// js/config.js is empty in the repo, so test a copy of stats.js wired to a dummy project.
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../js/stats.js', import.meta.url), 'utf8')
  .replace("from './config.js'", `from 'data:text/javascript,export const SUPABASE_URL="https://x.supabase.co";export const SUPABASE_KEY="sb_publishable_x"'`)
const tmp = new URL('./.stats-under-test.mjs', import.meta.url)
fs.writeFileSync(tmp, src)
try { await run(await import(tmp)) } finally { fs.unlinkSync(tmp) }

async function run(s) {
  assert.ok(s.enabled)
  await s.loadStats()
  const known = s.ranking(athletes, 'known').rows.map(r => r.a.id)
  assert.equal(known[0], 'A', '96/100 beats 1/1')
  const missed = s.ranking(athletes, 'missed').rows.map(r => r.a.id)
  assert.equal(missed[0], 'C', '4/40 is more surely bad than 0/2')
  assert.ok(!known.includes('GHOST'), 'unknown ids ignored')
  const fast = s.ranking(athletes, 'fast').rows
  assert.ok(fast.every((r, i) => i === 0 || fast[i - 1].avg <= r.avg))
  s.recordAnswers(Array.from({ length: 65 }, (_, i) => ({ id: 'A', ok: i % 2 === 0, ms: 99999 })))
  assert.deepEqual(CALLS, [30, 30, 5], 'batched by 30')
  assert.equal(s.getStat('A').seen, 165, 'local cache updated')
  assert.ok(s.getStat('A').ms <= 96 * 1500 + 33 * 5000, 'ms clamped')
  console.log('ALL STATS TESTS PASSED')
}
