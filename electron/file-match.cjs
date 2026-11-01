/**
 * 本地已下载文件匹配 —— 给定 workId 与文件名，找出磁盘上的实际文件。
 * 纯 Node，可单测；主进程与测试共用同一套规则。
 */
const fs = require('node:fs')
const path = require('node:path')
const { sanitizeFileName } = require('./guard.cjs')

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 候选目录：优先 RJ{workId}；只有关闭自动分类时才会再去根目录找 */
function candidateDirs(roots, workId, includeRoot = true) {
  const out = []
  const bases = (roots || []).filter(Boolean)
  if (Number.isInteger(workId) && workId > 0) {
    for (const r of bases) out.push(path.join(r, `RJ${workId}`))
  }
  if (includeRoot) {
    for (const r of bases) out.push(r)
  }
  return out
}

/** 在目录里找 fileName；同名多次下载会落成 "name (1).ext"，按序号取第一个 */
function findInDir(dir, fileName) {
  if (!dir) return null
  const safe = sanitizeFileName(fileName)
  let stat
  try {
    stat = fs.statSync(path.join(dir, safe))
    if (stat.isFile()) return path.join(dir, safe)
  } catch { /* 不存在，走 (n) 匹配 */ }

  const ext = path.extname(safe)
  const base = path.basename(safe, ext)
  let entries
  try { entries = fs.readdirSync(dir) } catch { return null }

  const re = new RegExp(`^${escapeRegExp(base)} \\((\\d+)\\)${escapeRegExp(ext)}$`)
  const hits = entries
    .filter((name) => re.test(name))
    .sort((a, b) => {
      const na = Number(re.exec(a)[1])
      const nb = Number(re.exec(b)[1])
      return na - nb
    })
  return hits.length ? path.join(dir, hits[0]) : null
}

/**
 * @param {{ roots: string[], workId?: number, fileName: string, knownPath?: string, includeRoot?: boolean }} opts
 * @returns {string|null} 命中的绝对路径
 */
function resolveLocalFile({ roots, workId, fileName, knownPath, includeRoot = true }) {
  if (knownPath) {
    try {
      if (fs.statSync(knownPath).isFile()) return knownPath
    } catch { /* 记录里的文件已被删 */ }
  }
  if (!fileName) return null
  for (const dir of candidateDirs(roots, workId, includeRoot)) {
    const hit = findInDir(dir, fileName)
    if (hit) return hit
  }
  return null
}

module.exports = { candidateDirs, findInDir, resolveLocalFile, escapeRegExp }
