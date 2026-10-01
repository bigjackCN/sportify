// 纯逻辑，不依赖 uni / Vue，方便测试和复用（H5、小程序、以后做小游戏都能用）
import { sportName } from './sports.js'

export const GAMES_DATE = '2026-09-19' // 开幕日，用于计算年龄
export const CHOICES = 4

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function medalTotal(a) {
  return a.medals ? (a.medals.g || 0) + (a.medals.s || 0) + (a.medals.b || 0) : 0
}

export function ageOf(a, on = GAMES_DATE) {
  if (a.age) return a.age
  if (!a.birth) return null
  const [y, m, d] = a.birth.split('-').map(Number)
  const [Y, M, D] = on.split('-').map(Number)
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0)
}

/** 英文名：姓大写 + 名，例如 ZHANG Yufei */
export function displayName(a, lang) {
  if (lang === 'zh' && a.zh) return a.zh
  return a.en
}

/** 按筛选条件选题库；人数不足 4 人时自动放宽，返回 { pool, widened } */
export function filterPool(all, { mode = 'all', sport = '', lang = 'zh' } = {}) {
  const need = CHOICES
  const byLang = list => {
    if (lang !== 'zh') return list
    const withZh = list.filter(a => a.zh)
    return withZh.length >= need ? withZh : list
  }
  const base = byLang(all)
  const steps = [
    a => (!sport || a.sports.includes(sport)) && (mode !== 'easy' || medalTotal(a) > 0),
    a => (!sport || a.sports.includes(sport)),
    a => (mode !== 'easy' || medalTotal(a) > 0),
    () => true
  ]
  for (let i = 0; i < steps.length; i++) {
    const pool = base.filter(steps[i])
    if (pool.length >= need) return { pool, widened: i > 0 }
  }
  return { pool: base, widened: true }
}

/** 为一道题挑干扰项：优先同性别；「全部」难度下优先同项目，更难 */
export function pickOptions(answer, pool, all, { mode = 'all', lang = 'zh', rng = Math.random } = {}) {
  // 中英文名都去重，保证切换语言后选项也不会重名（例如 刘宇 / 刘雨 拼音相同）
  const keys = a => [a.en.toLowerCase(), a.zh || '']
  const seen = new Set(keys(answer).filter(Boolean))
  const out = [answer]
  const tiers = [
    a => a.sex === answer.sex && (mode === 'easy' || a.sports.some(s => answer.sports.includes(s))),
    a => a.sex === answer.sex,
    () => true
  ]
  const sources = [pool, all]
  for (const tier of tiers) {
    for (const src of sources) {
      for (const c of shuffle(src.filter(tier), rng)) {
        if (out.length >= CHOICES) break
        if (c.id === answer.id) continue
        if (lang === 'zh' && !c.zh && answer.zh) continue // 中文模式下不混入拼音名
        const k = keys(c).filter(Boolean)
        if (k.some(x => seen.has(x))) continue
        k.forEach(x => seen.add(x)); out.push(c)
      }
    }
  }
  return shuffle(out, rng)
}

// ================= 模式 =================
// death：生死局 —— 一直答，错一题（或超时）就结束；前 10 题只出奖牌得主，之后全体运动员 + 同项目干扰项，越来越难
// speed：极速 10 题 —— 固定 10 题（奖牌得主），每题 5 秒，答得越快分越高
export const TIME_LIMIT = 5000
export const MODES = ['death', 'speed']
export const DEATH_WARMUP = 10
export const SPEED_ROUNDS = 10

/** 开一局：order 是预先打乱好的答案顺序，题目按需生成 */
export function makeRun(all, { mode = 'death', lang = 'zh', seed } = {}) {
  const rng = seed == null ? Math.random : mulberry32(seed)
  const pool = filterPool(all, { mode: 'all', lang }).pool
  const medal = pool.filter(a => medalTotal(a) > 0)
  let order
  if (mode === 'speed') {
    order = shuffle(medal.length >= CHOICES ? medal : pool, rng).slice(0, SPEED_ROUNDS)
  } else {
    const warm = shuffle(medal, rng).slice(0, DEATH_WARMUP)
    const used = new Set(warm.map(a => a.id))
    order = warm.concat(shuffle(pool.filter(a => !used.has(a.id)), rng))
  }
  return { mode, lang, all, pool, medal, order, questions: [], rng, over: false }
}

/** 生成下一题；没有题了返回 null */
export function nextQuestion(run) {
  const i = run.questions.length
  if (run.over || i >= run.order.length) return null
  const answer = run.order[i]
  const hard = run.mode === 'death' && i >= DEATH_WARMUP
  const src = hard ? run.pool : run.medal.length >= CHOICES ? run.medal : run.pool
  const q = {
    answer,
    options: pickOptions(answer, src, run.pool, { mode: hard ? 'all' : 'easy', lang: run.lang, rng: run.rng }),
    picked: null, // 选项 id；超时为 'timeout'
    ms: null, // 用时
    points: 0
  }
  run.questions.push(q)
  return q
}

/** 速度分：答对 50 分 + 剩余时间每 50ms 1 分（最多 150） */
export function speedPoints(msLeft) {
  return 50 + Math.floor(Math.max(0, Math.min(TIME_LIMIT, msLeft)) / 50)
}

/** 作答（option 为 null 表示超时）。返回是否答对，并更新 run.over */
export function submit(run, q, option, msUsed) {
  const ms = Math.max(0, Math.min(TIME_LIMIT, msUsed))
  q.ms = option ? ms : TIME_LIMIT
  q.picked = option ? option.id : 'timeout'
  const ok = !!option && option.id === q.answer.id
  if (run.mode === 'speed') {
    q.points = ok ? speedPoints(TIME_LIMIT - ms) : 0
    if (run.questions.length >= run.order.length) run.over = true
  } else {
    q.points = ok ? 1 : 0
    if (!ok || run.questions.length >= run.order.length) run.over = true
  }
  return ok
}

export function summary(run) {
  const qs = run.questions
  const correct = qs.filter(q => q.picked === q.answer.id)
  const score = run.mode === 'speed' ? qs.reduce((s, q) => s + q.points, 0) : correct.length
  const avg = correct.length ? correct.reduce((s, q) => s + q.ms, 0) / correct.length / 1000 : 0
  const cleared = run.mode === 'death' && correct.length === run.order.length
  return { score, correct: correct.length, total: qs.length, avg: Math.round(avg * 10) / 10, cleared }
}

/** 答完后显示的运动员信息：项目 · 奖牌 */
export function infoLine(a, sportsEn, lang, t) {
  const parts = [a.sports.map(s => sportName(sportsEn[s] || s, lang)).join(' / ')]
  const m = a.medals
  if (m && medalTotal(a) > 0) {
    const md = []
    if (m.g) md.push(`${m.g}${t('gold')}`)
    if (m.s) md.push(`${m.s}${t('silver')}`)
    if (m.b) md.push(`${m.b}${t('bronze')}`)
    parts.push(md.join(' '))
  }
  return parts.join(' · ')
}

/** 称号 */
export function rankKey(mode, s) {
  if (mode === 'death') return s.score >= 30 ? 'rank1' : s.score >= 15 ? 'rank2' : s.score >= 5 ? 'rank3' : 'rank4'
  return s.score >= 1100 ? 'rank1' : s.score >= 700 ? 'rank2' : s.score >= 300 ? 'rank3' : 'rank4'
}
