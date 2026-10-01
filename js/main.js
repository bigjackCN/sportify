// UI for Guess the Athlete — plain DOM, no framework, no build step.
import { ATHLETES, SPORTS_EN, PHOTO_MODE } from './athletes.js'
import { MESSAGES, format } from './messages.js'
import { sportName } from './sports.js'
import { makeRun, nextQuestion, submit, summary, infoLine, rankKey, displayName, TIME_LIMIT } from './game.js'
import { Versus, ROUNDS } from './versus.js'
import { hostRoom, joinRoom, normalizeCode, transportName } from './net.js'
import * as stats from './stats.js'

// ---------------------------------------------------------------- helpers
const app = document.getElementById('app')
const $ = sel => app.querySelector(sel)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const storage = (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage } catch (e) { return null } })()
const get = (k, d = null) => { try { return storage ? storage.getItem(k) ?? d : d } catch (e) { return d } }
const put = (k, v) => { try { storage && storage.setItem(k, v) } catch (e) {} }

let lang = get('agq_lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
const t = (k, v) => format((MESSAGES[lang] || MESSAGES.zh)[k] ?? MESSAGES.zh[k] ?? k, v)
const nameOf = a => displayName(a, lang)
const sportsOf = a => a.sports.map(s => sportName(SPORTS_EN[s] || s, lang)).join(' / ')
const photoUrl = id => PHOTO_MODE === 'local' ? `photos/${id}.jpg` : `https://results.asiangames2026.org/ag2026/photos/${id}.jpg`
const preload = id => { if (id) { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = photoUrl(id) } }
const imgTag = id => `<img src="${photoUrl(id)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`

let myName = get('agq_name') || (lang === 'zh' ? '玩家' : 'Player') + Math.floor(100 + Math.random() * 900)
const best = { death: Number(get('agq_best_death')) || 0, speed: Number(get('agq_best_speed')) || 0 }

let view = 'home'
let toastTimer = null
function toast(msg) {
  let el = document.querySelector('.toast')
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el) }
  el.textContent = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 2600)
}

function nav(title, back = true) {
  return `<div class="nav">${back ? '<button class="back" data-act="back" aria-label="back">‹</button>' : ''}<span>${esc(title)}</span><button class="lang" data-act="lang">${esc(t('lang'))}</button></div>`
}

function setView(v) { view = v; app.dataset.view = ''; render() }

function render() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  document.title = t('appTitle') + ' · ' + t('tagline')
  if (view === 'home') return renderHome()
  if (view === 'solo' || view === 'versus') return renderGame()
  if (view === 'soloResult') return renderSoloResult()
  if (view === 'lobby') return renderLobby()
  if (view === 'versusResult') return renderVersusResult()
  if (view === 'ranking') return renderRanking()
}

// ---------------------------------------------------------------- home
function renderHome() {
  app.dataset.view = 'home'
  const pendingCode = lobby && lobby.role === 'guest' ? lobby.code : ''
  app.innerHTML = `
    ${nav(t('appTitle'), false)}
    <div class="hero">
      <div class="ed">${esc(t('edition'))}</div>
      <h1>${esc(t('appTitle'))}</h1>
      <div class="tag">${esc(t('tagline'))}</div>
      <p>${esc(t('subtitle'))}</p>
      <div class="rule">⏱ ${esc(t('rule'))}</div>
    </div>
    <div class="home-body">
      <div class="section-title">${esc(t('solo'))}</div>
      <div class="mode clickable" data-act="solo" data-mode="death">
        <h3>💀 ${esc(t('modeDeath'))}</h3><p>${esc(t('modeDeathDesc'))}</p>
        <div class="mf"><span class="mb">${best.death ? esc(t('bestDeath', { n: best.death })) : ''}</span><button class="go">${esc(t('play'))} ›</button></div>
      </div>
      <div class="mode speed clickable" data-act="solo" data-mode="speed">
        <h3>⚡ ${esc(t('modeSpeed'))}</h3><p>${esc(t('modeSpeedDesc'))}</p>
        <div class="mf"><span class="mb">${best.speed ? esc(t('best', { n: best.speed })) : ''}</span><button class="go">${esc(t('play'))} ›</button></div>
      </div>
      <div class="section-title">${esc(t('online'))}</div>
      <div class="mode versus">
        <h3>⚔️ ${esc(t('modeVersus'))}</h3><p>${esc(t('modeVersusDesc'))}</p>
        <div class="field"><label for="nick">${esc(t('nickname'))}</label><input id="nick" maxlength="16" value="${esc(myName)}"></div>
        <div class="mf" style="margin-top:12px"><button class="go blue" data-act="create">${esc(t('createRoom'))}</button></div>
        <div class="field"><input id="code" class="code" maxlength="6" placeholder="${esc(t('codePlaceholder'))}" value="${esc(pendingCode)}" autocomplete="off"><button class="go blue" data-act="join">${esc(t('joinRoom'))}</button></div>
        <div class="note">${esc(t('netNote'))}</div>
      </div>
      ${stats.enabled ? `<div class="section-title">${esc(t('board'))}</div>
      <div class="mode board-card clickable" data-act="ranking">
        <h3>📊 ${esc(t('boardTitle'))}</h3><p>${esc(t('boardDesc'))}</p>
        <div class="mf"><span class="mb" id="boardTeaser"></span><button class="go">${esc(t('boardOpen'))} ›</button></div>
      </div>` : ''}
      <div class="foot">${esc(t('footer'))}</div>
    </div>`
  if (stats.enabled) stats.loadStats().then(() => teaser())
  const nick = $('#nick')
  nick.addEventListener('change', () => { myName = nick.value.trim().slice(0, 16) || myName; nick.value = myName; put('agq_name', myName) })
  $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin() })
}

// ---------------------------------------------------------------- solo
const solo = { run: null, q: null, phase: 'idle', startAt: 0, left: TIME_LIMIT, later: null }

function startSolo(mode) {
  clearTimeout(solo.later)
  solo.run = makeRun(ATHLETES, { mode, lang })
  solo.q = null
  view = 'solo'
  app.dataset.view = ''
  soloLoad()
}
function soloLoad() {
  clearTimeout(solo.later)
  solo.q = nextQuestion(solo.run)
  if (!solo.q) return soloFinish()
  solo.phase = 'loading'
  solo.left = TIME_LIMIT
  renderGame()
  setPhoto(solo.q.answer.id, soloReady)
  const nx = solo.run.order[solo.run.questions.length]; if (nx) preload(nx.id)
}
function soloReady() {
  if (solo.phase !== 'loading' || view !== 'solo') return
  solo.phase = 'play'
  solo.startAt = Date.now()
  updateGame()
}
function soloAnswer(option) {
  if (solo.phase !== 'play') return
  const used = Date.now() - solo.startAt
  const ok = submit(solo.run, solo.q, option, used)
  solo.phase = 'done'
  solo.left = option ? Math.max(0, TIME_LIMIT - used) : 0
  updateGame()
  if (ok || (solo.run.mode === 'speed' && !solo.run.over)) solo.later = setTimeout(soloNext, ok ? 900 : 2000)
}
function soloNext() {
  clearTimeout(solo.later)
  if (solo.run.over) soloFinish(); else soloLoad()
}
function soloRecord() {
  if (!solo.run || solo.recorded === solo.run) return
  solo.recorded = solo.run
  stats.recordAnswers(solo.run.questions.filter(q => q.picked != null).map(q => ({ id: q.answer.id, ok: q.picked === q.answer.id, ms: q.ms })))
}
function soloFinish() {
  clearTimeout(solo.later)
  soloRecord()
  const s = summary(solo.run), mode = solo.run.mode
  solo.newBest = s.score > best[mode]
  if (solo.newBest) { best[mode] = s.score; put('agq_best_' + mode, s.score) }
  setView('soloResult')
}

function renderSoloResult() {
  app.dataset.view = 'soloResult'
  const run = solo.run, s = summary(run), mode = run.mode
  app.innerHTML = `
    ${nav(t('appTitle'))}
    <div class="rhead">
      <div class="t">${esc(t(mode === 'speed' ? 'modeSpeed' : 'modeDeath'))} · ${esc(t('resultTitle'))}</div>
      <div class="lb">${esc(t(mode === 'speed' ? 'resultSpeed' : 'resultDeath'))}</div>
      <div class="s" id="rscore">${s.score}${mode === 'death' && t('resultDeathUnit') ? ' <span style="font-size:22px">' + esc(t('resultDeathUnit')) + '</span>' : ''}</div>
      <div class="best">${solo.newBest ? '🏆 ' + esc(t('newBest')) : ''}</div>
      <div>${esc(s.cleared ? t('cleared') : t(rankKey(mode, s)))}</div>
      <div class="meta">${mode === 'speed' ? esc(t('resultCorrect', { c: s.correct, n: s.total })) + ' · ' : ''}${s.correct ? esc(t('avgTime', { s: s.avg })) : ''}</div>
    </div>
    <div class="ract">
      <button class="big" data-act="solo" data-mode="${mode}">${esc(t('playAgain'))}</button>
      <button class="big ghost" data-act="back">${esc(t('otherMode'))}</button>
    </div>
    <div class="sec">${esc(t('review'))}</div>
    <div class="grid">${run.questions.map(q => {
      const ok = q.picked === q.answer.id
      const tm = ok ? (q.ms / 1000).toFixed(1) + 's · ' : q.picked === 'timeout' ? '⏱ · ' : ''
      return `<div class="cell"><div class="ph">${imgTag(q.answer.id)}</div><span class="mk" style="background:var(--${ok ? 'ok' : 'bad'})">${ok ? '✓' : '✗'}</span><div class="n">${esc(nameOf(q.answer))}</div><div class="sp">${esc(tm + sportsOf(q.answer))}</div></div>`
    }).join('')}</div>`
}

// ---------------------------------------------------------------- shared game screen
function renderGame() {
  if (app.dataset.view === view) return updateGame()
  app.dataset.view = view
  const title = view === 'versus' ? t('modeVersus') : t(solo.run.mode === 'speed' ? 'modeSpeed' : 'modeDeath')
  app.innerHTML = `
    ${nav(title)}
    <div class="game">
      <div id="top"></div>
      <div class="timer"><div class="ttrack"><div class="tfill" id="tfill"></div></div><span class="tnum" id="tnum">5.0</span></div>
      <div class="photo" id="photo"></div>
      <div class="ask">${esc(t('whoIsThis'))}</div>
      <div class="opts" id="opts"></div>
      <div class="fb" id="fb"></div>
    </div>`
  const q = view === 'versus' ? vs && vs.q : solo.q
  if (q) setPhoto(q.answer.id, view === 'versus' ? () => vs && vs.photoReady(vs.i) : soloReady)
  updateGame()
}

let photoSafety = null
function setPhoto(id, onReady) {
  const box = $('#photo')
  if (!box) return
  if (box.dataset.id === id) return
  box.dataset.id = id
  clearTimeout(photoSafety)
  box.innerHTML = `<img alt="" referrerpolicy="no-referrer"><div class="mask">${esc(t('loading'))}</div>`
  const img = box.querySelector('img')
  let done = false
  const ready = () => {
    if (done || box.dataset.id !== id) return
    done = true; clearTimeout(photoSafety)
    const m = box.querySelector('.mask'); if (m) m.remove()
    onReady()
  }
  img.onload = ready
  img.onerror = () => { img.remove(); const m = box.querySelector('.mask'); if (m) m.textContent = t('noPhoto'); done = true; clearTimeout(photoSafety); onReady() }
  img.src = photoUrl(id)
  photoSafety = setTimeout(ready, 6000) // a very slow network shouldn't block the game
}

function drawTimer(left, active) {
  const f = $('#tfill'), n = $('#tnum')
  if (!f) return
  f.style.width = (left / TIME_LIMIT * 100) + '%'
  f.classList.toggle('hurry', left <= 2000)
  n.textContent = (left / 1000).toFixed(1)
  n.classList.toggle('hurry', active && left <= 2000)
}

function optionButtons(q, classOf, badgesOf, enabled) {
  return q.options.map((o, i) => `<button class="opt ${classOf(o)}" data-act="pick" data-id="${o.id}" ${enabled ? '' : 'disabled'}>
      <span class="key">${i + 1}</span>${esc(nameOf(o))}${badgesOf ? `<span class="badges">${badgesOf(o)}</span>` : ''}</button>`).join('')
}

function updateGame() {
  if (view === 'versus') return updateVersus()
  if (view !== 'solo' || !$('#opts') || !solo.q) return
  const run = solo.run, q = solo.q, done = solo.phase === 'done'
  const speed = run.mode === 'speed'
  const sc = speed ? run.questions.reduce((s, x) => s + x.points, 0) : run.questions.filter(x => x.picked === x.answer.id).length
  $('#top').innerHTML = `<div class="bar"><span>${esc(speed ? t('questionOf', { i: run.questions.length, n: run.order.length }) : t('question', { i: run.questions.length }))}</span><span>${esc(speed ? t('score') : t('streak'))} ${sc}</span></div>`
  $('#opts').innerHTML = optionButtons(q, o => !done ? '' : o.id === q.answer.id ? 'right' : o.id === q.picked ? 'wrong' : 'dim', null, solo.phase === 'play')
  if (done) {
    const ok = q.picked === q.answer.id
    const msg = ok ? t('correct') + (speed ? ' +' + q.points : '') : t(q.picked === 'timeout' ? 'timeUp' : 'wrong', { name: nameOf(q.answer) })
    const info = (lang === 'zh' ? q.answer.en + ' · ' : '') + infoLine(q.answer, SPORTS_EN, lang, t) + globalRate(q.answer.id)
    const auto = ok || (speed && !run.over)
    $('#fb').innerHTML = `<span class="${ok ? 'ok' : 'bad'}">${esc(msg)}</span><span class="sub">${esc(info)}</span>` +
      (auto ? '' : `<button class="big dark" data-act="next">${esc(run.over ? t('finish') : t('next'))}</button>`)
  } else $('#fb').innerHTML = ''
  drawTimer(solo.phase === 'play' ? TIME_LIMIT - (Date.now() - solo.startAt) : solo.phase === 'done' ? solo.left : TIME_LIMIT, solo.phase === 'play')
}

// ---------------------------------------------------------------- versus
let vs = null
let lobby = null // { role, code, status, error, handle }
let lastRound = -1

function newVersus(role, conn) {
  if (vs) vs.destroy()
  lastRound = -1
  vs = new Versus({ role, conn, name: myName, athletes: ATHLETES, onChange: onVersusChange })
  render()
}

async function doCreate() {
  leaveVersus(true)
  lobby = { role: 'host', code: '', status: 'creating' }
  setView('lobby')
  try {
    const h = await hostRoom(conn => { lobby.status = 'joined'; newVersus('host', conn) })
    if (!lobby || lobby.role !== 'host') { h.close(); return }
    lobby.handle = h
    lobby.code = h.code
    lobby.status = vs ? 'joined' : 'waiting'
    render()
  } catch (e) {
    if (lobby) { lobby.status = 'error'; lobby.error = t('connectFailed', { msg: e.type || e.message }) }
    render()
  }
}

async function doJoin(codeArg) {
  const input = $('#code')
  const code = normalizeCode(codeArg || (input && input.value))
  if (!code) { if (input) input.focus(); return }
  leaveVersus(true)
  lobby = { role: 'guest', code, status: 'connecting' }
  setView('lobby')
  try {
    const conn = await joinRoom(code)
    if (!lobby || lobby.code !== code) { conn.close(); return }
    lobby.status = 'joined'
    newVersus('guest', conn)
  } catch (e) {
    if (!lobby || lobby.code !== code) return
    lobby.status = 'error'
    lobby.error = e && e.notFound ? t('roomNotFound') : t('connectFailed', { msg: (e && (e.type || e.message)) || '?' })
    render()
  }
}

function leaveVersus(silent) {
  if (vs) { vs.leave(); vs = null }
  if (lobby && lobby.handle) lobby.handle.close()
  lobby = null
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
  if (!silent) setView('home')
}

function inviteLink() {
  return `${location.origin}${location.pathname}${location.search}#join=${lobby.code}`
}

function onVersusChange(v) {
  if (v !== vs) return
  if (v.phase === 'left') {
    toast(t('opponentLeft'))
    if (view === 'lobby' && lobby && lobby.role === 'host' && lobby.handle) {
      // still in the lobby: keep the room open for someone else
      vs = null; lobby.status = 'waiting'; lobby.handle.release()
    } else if (view === 'lobby' && lobby) {
      lobby.status = 'error'; lobby.error = t('opponentLeft')
    }
    render()
    return
  }
  if (v.phase === 'lobby') { if (view !== 'lobby') setView('lobby'); else render(); return }
  if (v.phase === 'over') {
    if (v._recorded !== v.seed) {
      v._recorded = v.seed
      stats.recordAnswers(v.rounds.map(r => { const a = r[v.role]; return { id: r.q.answer.id, ok: !!a && a.id === r.q.answer.id, ms: a ? a.ms : 0 } }))
    }
    if (view !== 'versusResult') setView('versusResult'); else render()
    return
  }
  // loading / play / reveal
  if (view !== 'versus') setView('versus')
  if (v.i !== lastRound) {
    lastRound = v.i
    const i = v.i
    setPhoto(v.q.answer.id, () => v.photoReady(i))
    const nx = v.run.order[v.i + 1]; if (nx) preload(nx.id)
  }
  updateGame()
}

function renderLobby() {
  app.dataset.view = 'lobby'
  const L = lobby || { role: 'guest', status: 'error', error: t('opponentLeft') }
  const host = L.role === 'host'
  const opp = vs && vs.opp.name
  let status = ''
  if (L.status === 'error') status = `<span class="err">${esc(L.error)}</span>`
  else if (L.status === 'creating') status = `<span class="dots">${esc(t('creating'))}</span>`
  else if (L.status === 'connecting') status = `<span class="dots">${esc(t('connecting'))}</span>`
  else if (host && !opp) status = `<span class="dots">${esc(t('waitingOpponent'))}</span>`
  else if (host && opp) status = esc(t('opponentJoined', { name: opp }))
  else if (!host && opp) status = `<span class="dots">${esc(t('waitingHost'))}</span>`
  app.innerHTML = `
    ${nav(t('modeVersus'))}
    <div class="lobby">
      <div class="label">${esc(t('roomCode'))}</div>
      <div class="code" id="roomcode">${esc(L.code || '····')}</div>
      ${host && L.code ? `<div class="label">${esc(t('shareHint'))}</div>
        <div class="linkbox"><input id="link" readonly value="${esc(inviteLink())}"><button class="go blue" data-act="copy">${esc(t('copyLink'))}</button></div>` : ''}
      <div class="players">
        <div class="player"><div class="role">${esc(host ? t('you') + ' · ' + t('host') : t('you'))}</div><div class="nm">${esc(myName)}</div></div>
        <div style="font-weight:800;color:var(--muted)">${esc(t('vs'))}</div>
        <div class="player ${opp ? '' : 'empty'}"><div class="role">${esc(t('opponent'))}</div><div class="nm">${esc(opp || '?')}</div></div>
      </div>
      <div class="status" id="lstatus">${status}</div>
      ${host ? `<button class="big blue" data-act="start" ${opp ? '' : 'disabled'}>${esc(t('startMatch'))}</button>` : ''}
      ${L.status === 'error' ? `<button class="big ghost" data-act="back">${esc(t('otherMode'))}</button>` : ''}
      <div class="note">${esc(t('netNote'))}</div>
    </div>`
}

function updateVersus() {
  if (!vs || !$('#opts')) return
  const v = vs, q = v.q, r = v.round
  if (!q || !r) return
  const reveal = v.phase === 'reveal', play = v.phase === 'play', left = v.phase === 'left'
  const meStatus = reveal ? (r.pts[v.role] ? '+' + r.pts[v.role] : '+0') : play ? (v.myAnswer ? t('answered') : t('thinking')) : ''
  const oppStatus = reveal ? (r.pts[v.oppRole] ? '+' + r.pts[v.oppRole] : '+0') : play ? (v.oppAnswered ? t('answered') : t('thinking')) : ''
  $('#top').innerHTML = `
    <div class="board">
      <div class="p l"><span class="nm">${esc(myName)} (${esc(t('you'))})</span><span class="sc">${v.me.score}</span><span class="st ${play && v.myAnswer ? 'done' : ''}">${esc(meStatus)}</span></div>
      <div class="mid"><b>${v.i + 1} / ${ROUNDS}</b>${esc(t('vs'))}</div>
      <div class="p r"><span class="nm">${esc(v.opp.name)}</span><span class="sc">${v.opp.score}</span><span class="st ${play && v.oppAnswered ? 'done' : ''}">${esc(oppStatus)}</span></div>
    </div>`
  const mine = v.myAnswer && v.myAnswer.id
  const oppPick = reveal && r[v.oppRole] && r[v.oppRole].id
  const fmt = a => a && a.id ? ' ' + (a.ms / 1000).toFixed(1) + 's' : ''
  $('#opts').innerHTML = optionButtons(q,
    o => {
      if (!reveal) return play && o.id === mine ? 'mine' : ''
      if (o.id === q.answer.id) return 'right'
      if (o.id === mine) return 'wrong'
      return 'dim'
    },
    reveal ? o => (o.id === mine ? `<span class="badge">${esc(t('you'))}${fmt(r[v.role])}</span>` : '') + (o.id === oppPick ? `<span class="badge opp">${esc(t('opponent'))}${fmt(r[v.oppRole])}</span>` : '') : null,
    play && !v.myAnswer)
  if (left) {
    $('#fb').innerHTML = `<span class="bad">${esc(t('opponentLeft'))}</span><button class="big ghost" data-act="back">${esc(t('otherMode'))}</button>`
  } else if (reveal) {
    const info = (lang === 'zh' ? q.answer.en + ' · ' : '') + infoLine(q.answer, SPORTS_EN, lang, t) + globalRate(q.answer.id)
    const ok = mine === q.answer.id
    $('#fb').innerHTML = `<span class="${ok ? 'ok' : 'bad'}">${esc(ok ? t('correct') + ' +' + r.pts[v.role] : t(mine ? 'wrong' : 'timeUp', { name: nameOf(q.answer) }))}</span><span class="sub">${esc(info)}</span>`
  } else if (v.phase === 'loading') {
    $('#fb').innerHTML = `<span class="sub dots">${esc(t('waitingReady'))}</span>`
  } else $('#fb').innerHTML = ''
  drawTimer(play ? v.msLeft() : reveal ? (v.myAnswer && v.myAnswer.id ? TIME_LIMIT - v.myAnswer.ms : 0) : TIME_LIMIT, play && !v.myAnswer)
}

function renderVersusResult() {
  app.dataset.view = 'versusResult'
  const v = vs
  if (!v) return setView('home')
  const me = v.me.score, op = v.opp.score
  const outcome = me > op ? t('youWin') : me < op ? t('youLose') : t('draw')
  const left = v.phase === 'left'
  const host = v.role === 'host'
  app.innerHTML = `
    ${nav(t('modeVersus'))}
    <div class="rhead">
      <div class="t">${esc(t('modeVersus'))} · ${esc(t('resultTitle'))}</div>
      <div class="s" style="font-size:40px;margin-top:10px" id="outcome">${me > op ? '🏆 ' : ''}${esc(outcome)}</div>
      <div class="vs">
        <div><div class="n">${esc(myName)}</div><div class="s">${me}</div></div>
        <div class="n">${esc(t('vs'))}</div>
        <div><div class="n">${esc(v.opp.name)}</div><div class="s opp">${op}</div></div>
      </div>
    </div>
    <div class="ract">
      ${left ? `<div class="note" style="text-align:center;color:var(--bad)">${esc(t('opponentLeft'))}</div>` : ''}
      ${!left && host && v.rematchAsked ? `<div class="note" style="text-align:center">${esc(t('rematchAsked'))}</div>` : ''}
      ${!left && !host && v.rematchSent ? `<div class="note dots" style="text-align:center">${esc(t('rematchSent'))}</div>` : ''}
      ${left ? '' : `<button class="big blue" data-act="rematch" ${!host && v.rematchSent ? 'disabled' : ''}>${esc(t('rematch'))}</button>`}
      <button class="big ghost" data-act="back">${esc(t('leave'))}</button>
    </div>
    <div class="sec">${esc(t('review'))}</div>
    <div class="vlegend"><span>◧ ${esc(myName)}</span><span style="color:var(--opp)">◨ ${esc(v.opp.name)}</span></div>
    <div class="grid">${v.rounds.map(r => {
      const ok = who => r[who] && r[who].id === r.q.answer.id
      const mark = (who, cls) => `<span class="mk ${cls}" style="background:var(--${ok(who) ? 'ok' : 'bad'})">${ok(who) ? '✓' : '✗'}</span>`
      return `<div class="cell"><div class="ph">${imgTag(r.q.answer.id)}</div>${mark(v.role, 'l')}${mark(v.oppRole, 'r opp')}<div class="n">${esc(nameOf(r.q.answer))}</div><div class="sp"><b style="color:var(--ink)">+${r.pts[v.role]}</b> : <b style="color:var(--opp)">+${r.pts[v.oppRole]}</b></div></div>`
    }).join('')}</div>`
}

// ---------------------------------------------------------------- global recognition board
let rankKind = 'known'
let rankState = 'idle' // idle | loading | ok | error

function globalRate(id) {
  const s = stats.getStat(id)
  return s && s.seen >= 3 ? ' · ' + t('globalRate', { p: Math.round(s.correct / s.seen * 100), n: s.seen }) : ''
}

function teaser() {
  const el = document.getElementById('boardTeaser')
  if (!el) return
  const top = stats.ranking(ATHLETES, 'known', 1).rows[0]
  el.textContent = top ? t('boardTeaser', { name: nameOf(top.a), p: Math.round(top.rate * 100) }) : ''
}

function openRanking(force) {
  if (view !== 'ranking') setView('ranking')
  rankState = 'loading'; render()
  stats.loadStats(force !== false).then(m => { rankState = m ? 'ok' : 'error'; if (view === 'ranking') render() })
}

function renderRanking() {
  app.dataset.view = 'ranking'
  const tabs = ['known', 'missed', 'fast'].map(k => `<button class="tab ${k === rankKind ? 'on' : ''}" data-act="ranking" data-kind="${k}">${esc(t('rank_' + k))}</button>`).join('')
  let body = ''
  if (rankState === 'loading') body = `<div class="empty dots">${esc(t('loadingBoard'))}</div>`
  else if (rankState === 'error') body = `<div class="empty">${esc(t('boardError'))} <button class="go" data-act="refresh">${esc(t('retry'))}</button></div>`
  else {
    const r = stats.ranking(ATHLETES, rankKind, 50)
    if (!r.rows.length) body = `<div class="empty">${esc(t('boardEmpty'))}</div>`
    else {
      body = `<div class="rank-meta">${esc(t('boardMeta', { n: r.totalAnswers, m: r.athletes, k: r.minSeen }))}</div>` +
        r.rows.map((x, i) => {
          const pct = Math.round(x.rate * 100)
          const big = rankKind === 'fast' ? (x.avg / 1000).toFixed(1) + 's' : pct + '%'
          const sub = rankKind === 'fast' ? t('fastSub', { n: x.correct, p: pct }) : t('rateSub', { n: x.seen, s: x.avg ? (x.avg / 1000).toFixed(1) : '–' })
          const bar = rankKind === 'fast' ? Math.max(4, 100 - x.avg / 50) : pct
          return `<div class="rrow">
            <div class="rk ${i < 3 ? 'top' : ''}">${i + 1}</div>
            <div class="rth">${imgTag(x.a.id)}</div>
            <div class="rmain"><div class="rn">${esc(nameOf(x.a))}</div><div class="rs">${esc(sportsOf(x.a))}</div>
              <div class="rbar"><span style="width:${bar}%;background:${rankKind === 'missed' ? 'var(--bad)' : rankKind === 'fast' ? 'var(--gold)' : 'var(--ok)'}"></span></div></div>
            <div class="rv"><b>${esc(big)}</b><small>${esc(sub)}</small></div>
          </div>`
        }).join('')
    }
  }
  app.innerHTML = `${nav(t('boardTitle'))}
    <div class="ranking">
      <div class="tabs">${tabs}</div>
      <div class="rhint">${esc(t('rankHint_' + rankKind))}</div>
      ${body}
      <button class="big ghost" data-act="refresh">${esc(t('refresh'))}</button>
    </div>`
}

// ---------------------------------------------------------------- events
app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (act === 'lang') { lang = lang === 'zh' ? 'en' : 'zh'; put('agq_lang', lang); app.dataset.view = ''; render(); return }
  if (act === 'back') {
    if (view === 'lobby' || view === 'versus' || view === 'versusResult') return leaveVersus()
    if (view === 'solo') soloRecord()
    clearTimeout(solo.later); solo.phase = 'idle'; return setView('home')
  }
  if (act === 'solo') return startSolo(el.dataset.mode || el.closest('[data-mode]').dataset.mode)
  if (act === 'next') return soloNext()
  if (act === 'ranking') { rankKind = el.dataset.kind || rankKind; return view === 'ranking' && rankState === 'ok' ? render() : openRanking() }
  if (act === 'refresh') return openRanking(true)
  if (act === 'pick') {
    if (view === 'solo') return soloAnswer(solo.q.options.find(o => o.id === el.dataset.id))
    if (view === 'versus' && vs) return vs.answer(el.dataset.id)
  }
  if (act === 'create') { saveNick(); return doCreate() }
  if (act === 'join') { saveNick(); return doJoin() }
  if (act === 'start' && vs) return vs.start()
  if (act === 'rematch' && vs) return vs.requestRematch()
  if (act === 'copy') {
    const input = $('#link')
    const done = () => { el.textContent = t('copied'); setTimeout(() => { if (el.isConnected) el.textContent = t('copyLink') }, 1500) }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); done() })
    else { input.select(); try { document.execCommand('copy') } catch (_) {} done() }
  }
})
function saveNick() {
  const n = $('#nick'); if (!n) return
  myName = n.value.trim().slice(0, 16) || myName; put('agq_name', myName)
}

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return
  const n = Number(e.key)
  if (n >= 1 && n <= 4) {
    const b = app.querySelectorAll('.opt')[n - 1]
    if (b && !b.disabled) b.click()
  } else if (e.key === 'Enter') {
    const b = app.querySelector('[data-act="next"]'); if (b) b.click()
  }
})

// one clock for both solo and versus
setInterval(() => {
  if (view === 'solo' && solo.phase === 'play') {
    const left = TIME_LIMIT - (Date.now() - solo.startAt)
    if (left <= 0) soloAnswer(null); else drawTimer(left, true)
  } else if (view === 'versus' && vs && vs.phase === 'play') {
    const left = vs.msLeft()
    if (left <= 0 && !vs.myAnswer) vs.answer(null)
    else if (!vs.myAnswer) drawTimer(left, true)
  }
}, 50)

window.addEventListener('beforeunload', () => { if (vs) vs.leave() })

function routeFromHash() {
  const m = location.hash.match(/^#join=([A-Za-z0-9]+)/)
  if (m) doJoin(m[1])
}
window.addEventListener('hashchange', routeFromHash)

render()
routeFromHash()
stats.loadStats()

// handy for debugging in the console
window.__agq = { get vs() { return vs }, get solo() { return solo }, transport: transportName() }
