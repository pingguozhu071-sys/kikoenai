/**
 * file-match / resume 的单测：node --test electron/local.test.cjs
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { candidateDirs, findInDir, resolveLocalFile } = require('./file-match.cjs')
const { buildRangeHeader, totalFromContentRange, planResume } = require('./resume.cjs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kikoenai-'))
}

test('candidateDirs：先 RJ{workId}，再根目录', () => {
  const dirs = candidateDirs(['C:\\DL'], 123)
  assert.deepEqual(dirs, [path.join('C:\\DL', 'RJ123'), 'C:\\DL'])
  assert.deepEqual(candidateDirs(['C:\\DL'], 0), ['C:\\DL'])
})

test('findInDir：精确命中与非法字符清洗', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, '01_a.mp3'), 'x')
  assert.equal(findInDir(dir, '01_a.mp3'), path.join(dir, '01_a.mp3'))
  assert.equal(findInDir(dir, '01/a.mp3'), path.join(dir, '01_a.mp3'))
  assert.equal(findInDir(dir, 'missing.mp3'), null)
})

test('findInDir：同名重复下载的 (n) 后缀按序号取第一个', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'name (2).mp3'), 'x')
  fs.writeFileSync(path.join(dir, 'name (1).mp3'), 'x')
  fs.writeFileSync(path.join(dir, 'name (10).mp3'), 'x')
  assert.equal(findInDir(dir, 'name.mp3'), path.join(dir, 'name (1).mp3'))
  // 不能把 "其他名字 (1).mp3" 当成同名
  fs.writeFileSync(path.join(dir, 'name_extra (1).mp3'), 'x')
  assert.equal(findInDir(dir, 'name_extra.mp3'), path.join(dir, 'name_extra (1).mp3'))
})

test('resolveLocalFile：knownPath 优先，其次 RJ 目录，再根目录', () => {
  const root = tmpDir()
  const rj = path.join(root, 'RJ999')
  fs.mkdirSync(rj)
  fs.writeFileSync(path.join(root, 'flat.mp3'), 'x')
  fs.writeFileSync(path.join(rj, 'track.mp3'), 'x')

  assert.equal(
    resolveLocalFile({ roots: [root], workId: 999, fileName: 'track.mp3' }),
    path.join(rj, 'track.mp3'),
  )
  assert.equal(
    resolveLocalFile({ roots: [root], workId: 999, fileName: 'flat.mp3' }),
    path.join(root, 'flat.mp3'),
  )
  assert.equal(
    resolveLocalFile({ roots: [root], workId: 999, fileName: 'track.mp3', knownPath: path.join(root, 'flat.mp3') }),
    path.join(root, 'flat.mp3'),
  )
  assert.equal(resolveLocalFile({ roots: [root], workId: 999, fileName: 'nope.mp3' }), null)
})

test('buildRangeHeader：0 不带 Range', () => {
  assert.equal(buildRangeHeader(0), null)
  assert.equal(buildRangeHeader(1024), 'bytes=1024-')
})

test('totalFromContentRange', () => {
  assert.equal(totalFromContentRange('bytes 0-99/1234'), 1234)
  assert.equal(totalFromContentRange('bytes */1234'), 1234)
  assert.equal(totalFromContentRange(''), 0)
})

test('planResume：206 续写并取总大小', () => {
  assert.deepEqual(
    planResume({ status: 206, received: 500, contentRange: 'bytes 500-999/2000' }),
    { mode: 'append', startReceived: 500, total: 2000 },
  )
})

test('planResume：200 不支持 Range → 从头重下', () => {
  assert.deepEqual(
    planResume({ status: 200, received: 500, total: 2000 }),
    { mode: 'restart', startReceived: 0, total: 2000 },
  )
})

test('planResume：416 且本地已满 → 视为完成', () => {
  assert.deepEqual(
    planResume({ status: 416, received: 2000, contentRange: 'bytes */2000' }),
    { mode: 'done', startReceived: 2000, total: 2000 },
  )
})

test('planResume：416 但本地不足 → 重下', () => {
  assert.deepEqual(
    planResume({ status: 416, received: 100, contentRange: 'bytes */2000' }),
    { mode: 'restart', startReceived: 0, total: 0 },
  )
})
