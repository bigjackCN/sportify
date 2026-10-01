#!/usr/bin/env node
/**
 * 人工补中文名：
 *  1. 用 Excel/WPS 打开 tools/unmatched.csv，在最后一列填上中文名，保存为 CSV(UTF-8)
 *  2. 运行：node apply-overrides.mjs
 * 会写入 tools/zh_overrides.json 并直接更新 js/athletes.js（无需重新抓取）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const csvPath = path.join(__dirname, 'unmatched.csv')
const ovPath = path.join(__dirname, 'zh_overrides.json')
const dataPath = path.resolve(__dirname, '..', 'js', 'athletes.js')

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false
  text = text.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, 'utf8')) : {}
let added = 0
for (const r of parseCSV(fs.readFileSync(csvPath, 'utf8')).slice(1)) {
  const id = (r[0] || '').trim(), zh = (r[6] || '').trim()
  if (id && zh) { ov[id] = zh; added++ }
}
fs.writeFileSync(ovPath, JSON.stringify(ov, null, 2))

let src = fs.readFileSync(dataPath, 'utf8')
const m = src.match(/export const ATHLETES = (\[.*\])\s*$/s)
if (!m) throw new Error('js/athletes.js 格式不对')
const list = JSON.parse(m[1])
for (const a of list) if (ov[a.id]) a.zh = ov[a.id]
src = src.replace(m[1], JSON.stringify(list))
fs.writeFileSync(dataPath, src)
console.log(`已写入 ${added} 条中文名；当前有中文名 ${list.filter(a => a.zh).length}/${list.length} 人`)
