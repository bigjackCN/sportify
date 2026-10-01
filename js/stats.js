// Global athlete recognition stats, stored in Supabase (free tier).
// Plain fetch against the PostgREST API — no SDK needed.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js'

const URL_ = String(SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = String(SUPABASE_KEY || '')
export const enabled = !!(URL_ && KEY)

function headers() {
  const h = { apikey: KEY, 'Content-Type': 'application/json' }
  if (KEY.startsWith('eyJ')) h.Authorization = 'Bearer ' + KEY // legacy JWT anon key
  return h
}

let cache = null // Map id -> { seen, correct, ms }
let inflight = null

/** Load every athlete's stats (≈800 rows max). Returns the Map, or null on failure. */
export function loadStats(force = false) {
  if (!enabled) return Promise.resolve(null)
  if (cache && !force) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch(`${URL_}/rest/v1/athlete_stats?select=athlete_id,seen,correct,total_ms&limit=5000`, { headers: headers() })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(rows => {
      cache = new Map(rows.map(r => [String(r.athlete_id), { seen: +r.seen || 0, correct: +r.correct || 0, ms: +r.total_ms || 0 }]))
      return cache
    })
    .catch(() => cache)
    .finally(() => { inflight = null })
  return inflight
}

export const getStat = id => (cache && cache.get(String(id))) || null

/** Record answers: [{ id, ok, ms }]. Fire-and-forget; also updates the local cache. */
export function recordAnswers(items) {
  if (!enabled || !items || !items.length) return
  const clean = items
    .filter(x => x && x.id)
    .map(x => ({ id: String(x.id), ok: !!x.ok, ms: x.ok ? Math.max(0, Math.min(5000, Math.round(x.ms || 0))) : 0 }))
  for (let i = 0; i < clean.length; i += 30) {
    fetch(`${URL_}/rest/v1/rpc/record_answers`, {
      method: 'POST', headers: headers(), keepalive: true,
      body: JSON.stringify({ items: clean.slice(i, i + 30) })
    }).catch(() => {})
  }
  if (cache) {
    for (const x of clean) {
      const s = cache.get(x.id) || { seen: 0, correct: 0, ms: 0 }
      s.seen++; if (x.ok) { s.correct++; s.ms += x.ms }
      cache.set(x.id, s)
    }
  }
}

// Wilson score interval: keeps an athlete answered 1/1 times from outranking one answered 96/100 times.
function wilson(c, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = c / n, z2 = z * z, d = 1 + z2 / n
  const mid = p + z2 / (2 * n), half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
  return [(mid - half) / d, (mid + half) / d]
}

/**
 * Build a ranking. kind: 'known' (highest accuracy), 'missed' (lowest), 'fast' (quickest correct answers).
 * Athletes need at least `minSeen` answers; the threshold drops automatically while data is thin.
 */
export function ranking(athletes, kind = 'known', limit = 50) {
  if (!cache) return { rows: [], minSeen: 0, totalAnswers: 0 }
  const byId = new Map(athletes.map(a => [a.id, a]))
  const all = []
  let totalAnswers = 0
  for (const [id, s] of cache) {
    const a = byId.get(id)
    if (!a || !s.seen) continue
    totalAnswers += s.seen
    const [lo, hi] = wilson(s.correct, s.seen)
    all.push({ a, seen: s.seen, correct: s.correct, rate: s.correct / s.seen, lo, hi, avg: s.correct ? s.ms / s.correct : null })
  }
  let minSeen = 10
  const qualifies = r => (kind === 'fast' ? r.correct : r.seen) >= minSeen
  while (minSeen > 1 && all.filter(qualifies).length < 10) minSeen = minSeen > 3 ? 3 : 1
  // the 'missed' list only shows athletes most players actually get wrong
  const rows = all.filter(r => qualifies(r) && (kind !== 'missed' || r.rate < 0.5))
  if (kind === 'known') rows.sort((x, y) => y.lo - x.lo || y.seen - x.seen)
  else if (kind === 'missed') rows.sort((x, y) => x.hi - y.hi || y.seen - x.seen)
  else rows.sort((x, y) => x.avg - y.avg || y.correct - x.correct)
  return { rows: rows.slice(0, limit), minSeen, totalAnswers, athletes: all.length }
}
