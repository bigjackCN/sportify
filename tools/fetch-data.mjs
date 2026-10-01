#!/usr/bin/env node
/**
 * 数据抓取脚本 / Data pipeline
 * ------------------------------------------------------------
 * 在你自己的电脑上运行（需要 Node 18+ 和能访问官网的网络）：
 *   cd tools && npm install && node fetch-data.mjs
 *
 * 它会：
 *  1. 从亚运会官方成绩网站的后台接口拉取中国代表团（CHN）全部运动员
 *  2. 拉取奖牌信息（尽力而为）
 *  3. 用 zh_names.txt（官方中文名单）+ 拼音自动匹配中文名
 *  4. 下载并压缩头像到 ../photos/
 *  5. 生成 ../js/athletes.js（游戏直接读取）和 tools/unmatched.csv（需人工核对的名单）
 *
 * 可选参数：
 *   --org=CHN          要抓取的代表团（默认 CHN）
 *   --photos           同时下载头像到 photos/（默认不下载，直接用官网图片链接）
 *   --size=240         头像宽度（像素），越小包体越小
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v === undefined ? true : v]
}))
const ORG = (args.org || 'CHN').toUpperCase()
const WITH_PHOTOS = !!args.photos
const PHOTO_W = Number(args.size || 240)

const API = process.env.AG_API || 'https://back.results.asiangames2026.org/s/AG2026/en/'
const PHOTO_BASE = process.env.AG_PHOTO || 'https://results.asiangames2026.org/ag2026/photos/'
const PHOTO = id => `${PHOTO_BASE}${id}.jpg`
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (ag-quiz data script)',
  Referer: 'https://results.asiangames2026.org/',
  Origin: 'https://results.asiangames2026.org'
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 官网接口返回的是 zlib 压缩后按 latin1 编进文本的数据，这里还原 */
function decodeBody(buf) {
  const tries = [
    () => JSON.parse(buf.toString('utf8')),
    () => JSON.parse(zlib.inflateSync(Buffer.from(buf.toString('utf8'), 'latin1')).toString('utf8')),
    () => JSON.parse(zlib.inflateSync(buf).toString('utf8')),
    () => JSON.parse(zlib.inflateRawSync(buf).toString('utf8')),
    () => JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
  ]
  for (const t of tries) { try { return t() } catch {} }
  throw new Error('无法解析接口数据 / cannot decode response')
}

async function api(p, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
      const r = await fetch(API + p, { headers: HEADERS })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return decodeBody(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      if (i === retry - 1) throw new Error(`${p}: ${e.message}`)
      await sleep(800 * (i + 1))
    }
  }
}

async function pool(items, n, fn) {
  let i = 0
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }
  await Promise.all(Array.from({ length: n }, run))
}

// ---------- 1. 运动员 ----------
console.log(`[1/5] 拉取 ${ORG} 代表团项目列表…`)
const orgInfo = await api(`ALL/entries/org/${ORG}`)
const discs = (orgInfo.Count || []).map(c => ({ code: c.Disc, en: c.DiscDesc }))
console.log(`      共 ${discs.length} 个分项，官方统计 ${(orgInfo.Count || []).reduce((s, c) => s + (c.Total || 0), 0)} 人次`)

const athletes = new Map()
// 个人项目：{Type:'A', FamilyName, GivenName}；团体项目成员在 Members 里：{Reg, Name:'HU Mingxuan', FuncDesc:'Athlete'}
function splitName(name) {
  const p = String(name || '').split(' ')
  let i = 0
  while (i < p.length && /[A-Z]/.test(p[i]) && p[i] === p[i].toUpperCase()) i++
  return [p.slice(0, i).join(' '), p.slice(i).join(' ')]
}
function isAthlete(n) {
  if (!n.Reg || !/^\d+$/.test(String(n.Reg))) return false
  if (n.Type === 'A') return true
  return n.Type === undefined && !!n.Name && (!n.FuncDesc || /athlete/i.test(n.FuncDesc))
}
function addAthlete(p, disc, ev) {
  if (!p || !isAthlete(p)) return
  let family = p.FamilyName, given = p.GivenName
  if (!family) [family, given] = splitName(p.Name)
  family = String(family || '').toUpperCase()
  if (given && given.toUpperCase() === family) given = ''
  let a = athletes.get(String(p.Reg))
  if (!a) {
    a = { id: String(p.Reg), family, given: given || '', sex: p.Gender || '', birth: p.BirthDateRaw || null, sports: [], events: [] }
    athletes.set(String(p.Reg), a)
  }
  if (!a.birth && p.BirthDateRaw) a.birth = p.BirthDateRaw
  if (!a.sports.includes(disc.code)) a.sports.push(disc.code)
  if (ev && a.events.length < 3 && !a.events.includes(ev)) a.events.push(ev)
}
function walk(node, disc, ev) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach(n => walk(n, disc, ev))
  addAthlete(node, disc, ev)
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') walk(v, disc, node.EvDesc || ev)
  }
}

console.log('[2/5] 拉取每个分项的报名名单…')
await pool(discs, 4, async d => {
  try {
    const data = await api(`${d.code}/entries/org/${ORG}`)
    walk(data.Events || data, d, null)
    process.stdout.write('.')
  } catch (e) { console.warn('\n      ⚠', e.message) }
})
console.log(`\n      去重后运动员：${athletes.size} 人`)

// ---------- 2. 奖牌（尽力而为） ----------
console.log('[3/5] 拉取奖牌信息…')
const medals = {}
try {
  const mm = await api('ALL/medals/multi-medallists')
  const visit = n => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visit)
    const reg = n.Reg || n.reg || n.Code || n.PartCode
    if (reg && athletes.has(String(reg))) {
      const num = re => { const k = Object.keys(n).find(k => re.test(k)); return k ? Number(n[k]) || 0 : 0 }
      const g = num(/^(me_gold|gold|g|golds)$/i), s = num(/^(me_silver|silver|s|silvers)$/i), b = num(/^(me_bronze|bronze|b|bronzes)$/i)
      if (g + s + b > 0) medals[String(reg)] = { g, s, b }
    }
    Object.values(n).forEach(visit)
  }
  visit(mm)
  console.log(`      找到 ${Object.keys(medals).length} 位奖牌得主`)
  if (!Object.keys(medals).length) {
    fs.writeFileSync(path.join(__dirname, 'debug-medals.json'), JSON.stringify(mm, null, 1).slice(0, 200000))
    console.warn('      ⚠ 未能识别奖牌数据结构，已写入 tools/debug-medals.json，请把它发给 Claude 调整脚本')
  }
} catch (e) { console.warn('      ⚠ 奖牌数据获取失败：', e.message) }

// ---------- 3. 中文名匹配 ----------
console.log('[4/5] 匹配中文名…')
let pinyinFn = null
try { ({ pinyin: pinyinFn } = await import('pinyin-pro')) } catch {
  console.warn('      ⚠ 未安装 pinyin-pro（cd tools && npm install），跳过中文名匹配')
}
const SECTION_RULES = {
  游泳: /^swimming$/i, 跳水: /diving/i, 花样游泳: /artistic swimming/i, 水球: /water polo/i,
  射箭: /archery/i, 田径: /athletics|marathon|race ?walk/i, 羽毛球: /badminton/i, 棒球: /^baseball/i,
  垒球: /softball/i, 篮球: /^basketball/i, 三人篮球: /3x3/i, 拳击: /boxing/i, 霹雳舞: /breaking/i,
  皮划艇静水: /canoe sprint/i, 皮划艇激流回旋: /slalom/i, 板球: /cricket/i, 自行车: /cycling/i,
  马术: /equestrian|dressage|jumping|eventing/i, 电子竞技: /esports/i, 击剑: /fencing/i,
  足球: /^football/i, 高尔夫球: /golf/i, 体操: /artistic gymnastics/i, 艺术体操: /rhythmic/i,
  蹦床: /trampoline/i, 手球: /handball/i, 曲棍球: /hockey/i, 柔道: /judo/i, 空手道: /karate/i,
  现代五项: /pentathlon/i, 赛艇: /rowing/i, 橄榄球: /rugby/i, 帆船帆板: /sailing/i, 射击: /shooting/i,
  滑板: /skateboard/i, 攀岩: /climbing/i, 壁球: /squash/i, 冲浪: /surfing/i, 乒乓球: /table tennis/i,
  跆拳道: /taekwondo/i, 网球: /^tennis$/i, 铁人三项: /triathlon/i, 排球: /^volleyball/i,
  沙滩排球: /beach volleyball/i, 举重: /weightlifting/i, 摔跤: /wrestling/i, 武术: /wushu/i
}
const discEn = Object.fromEntries(discs.map(d => [d.code, d.en]))
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'v').replace(/[^a-z]/g, '').replace(/lyu/g, 'lv').replace(/nyu/g, 'nv')

const zhList = []
for (const line of fs.readFileSync(path.join(__dirname, 'zh_names.txt'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('#')) continue
  const [section, sex, names] = line.split('|')
  for (const zh of names.split(/[、,，]/).map(s => s.trim()).filter(Boolean)) zhList.push({ section, sex, zh })
}
const toPy = zh => {
  if (!pinyinFn) return ''
  const clean = zh.replace(/[·・]/g, '')
  return norm(pinyinFn(clean, { toneType: 'none', surname: 'head', separator: '' }))
}
zhList.forEach(z => { z.py = toPy(z.zh) })

const overrides = fs.existsSync(path.join(__dirname, 'zh_overrides.json'))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, 'zh_overrides.json'), 'utf8')) : {}

const unmatched = []
const usedZh = new Set()
for (const a of athletes.values()) {
  if (overrides[a.id]) { a.zh = overrides[a.id]; continue }
  if (!pinyinFn) continue
  const key = norm(a.family + a.given)
  const keyAlt = norm(a.given + a.family)
  let cands = zhList.filter(z => (z.py === key || z.py === keyAlt))
  const sportOk = z => a.sports.some(c => (SECTION_RULES[z.section] || /$^/).test(discEn[c] || ''))
  const sexOk = z => !z.sex || !a.sex || z.sex === a.sex
  let best = cands.filter(z => sportOk(z) && sexOk(z))
  if (best.length === 0) best = cands.filter(sexOk)
  const uniq = [...new Set(best.map(z => z.zh))]
  if (uniq.length === 1) { a.zh = uniq[0]; usedZh.add(uniq[0] + '|' + best[0].section) }
  else unmatched.push({ a, reason: uniq.length > 1 ? '多个候选: ' + uniq.join('/') : '名单中未找到' })
}
const matched = [...athletes.values()].filter(a => a.zh).length
console.log(`      自动匹配 ${matched}/${athletes.size}，未匹配 ${unmatched.length}（见 tools/unmatched.csv）`)
fs.writeFileSync(path.join(__dirname, 'unmatched.csv'),
  '﻿id,family,given,sex,sports,reason,zh(请填写后运行 node apply-overrides.mjs)\n' +
  unmatched.map(({ a, reason }) => [a.id, a.family, a.given, a.sex, a.sports.map(c => discEn[c]).join('/'), reason, ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))

// ---------- 4. 头像 ----------
const photoDir = path.join(ROOT, 'photos')
fs.mkdirSync(photoDir, { recursive: true })
let sharp = null
if (WITH_PHOTOS) {
  try { sharp = (await import('sharp')).default } catch { console.warn('      ⚠ 未安装 sharp，头像将保存原图（不压缩）') }
  console.log(`[5/5] 下载头像（宽 ${PHOTO_W}px）…`)
  let ok = 0, miss = 0
  await pool([...athletes.values()], 6, async a => {
    const out = path.join(photoDir, `${a.id}.jpg`)
    if (fs.existsSync(out)) { a.photo = true; ok++; return }
    try {
      const r = await fetch(PHOTO(a.id), { headers: HEADERS })
      if (!r.ok) throw new Error(r.status)
      let buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 1500) throw new Error('placeholder')
      if (sharp) buf = await sharp(buf).resize({ width: PHOTO_W, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer()
      fs.writeFileSync(out, buf); a.photo = true; ok++
    } catch { a.photo = false; miss++ }
    if ((ok + miss) % 50 === 0) process.stdout.write(`${ok + miss} `)
  })
  const size = fs.readdirSync(photoDir).reduce((s, f) => s + fs.statSync(path.join(photoDir, f)).size, 0)
  console.log(`\n      头像 ${ok} 张，缺失 ${miss} 张，合计 ${(size / 1024 / 1024).toFixed(1)} MB`)
} else {
  console.log('[5/5] 跳过头像下载（--no-photos）')
  for (const a of athletes.values()) a.photo = true
}

// ---------- 5. 输出 ----------
const list = [...athletes.values()]
  .filter(a => a.photo !== false)
  .map(a => ({
    id: a.id,
    zh: a.zh || '',
    en: `${a.family} ${a.given}`.trim(),
    sex: a.sex,
    birth: a.birth,
    sports: a.sports,
    events: a.events,
    medals: medals[a.id] || { g: 0, s: 0, b: 0 }
  }))
  .sort((x, y) => x.id.localeCompare(y.id))
const sportsUsed = Object.fromEntries(discs.map(d => [d.code, d.en]))
const banner = `// 自动生成：tools/fetch-data.mjs  ${new Date().toISOString()}\n// 数据来源：results.asiangames2026.org（第20届亚运会官方成绩系统）\n`
fs.writeFileSync(path.join(ROOT, 'js', 'athletes.js'),
  banner +
  `export const PHOTO_MODE = '${WITH_PHOTOS ? 'local' : 'remote'}'\n` +
  `export const SPORTS_EN = ${JSON.stringify(sportsUsed, null, 1)}\n` +
  `export const ATHLETES = ${JSON.stringify(list)}\n`)
console.log(`\n✅ 完成：js/athletes.js 共 ${list.length} 人（有中文名 ${list.filter(a => a.zh).length} 人）`)
