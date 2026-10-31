/**
 * guard.cjs 的单元测试：node --test electron/guard.test.cjs
 * 只测纯逻辑，不联网、不启动 Electron。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BlockedUrlError, isPrivateHost, validateRemoteUrl, fetchGuarded, sanitizeFileName, isInsideRoot,
} = require('./guard.cjs')

const reply = (status, headers = {}, body = null) => new Response(body, { status, headers })

test('isPrivateHost：拒绝环回 / 私有 / 保留 / IPv6 本地', () => {
  for (const h of [
    'localhost', 'LOCALHOST.', 'app.localhost', '127.0.0.1', '127.10.0.9',
    '10.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '100.64.0.1', '100.127.255.255',
    '::1', '[::1]', 'fd00::1', 'fe80::1', '', null,
  ]) {
    assert.equal(isPrivateHost(h), true, String(h))
  }
})

test('isPrivateHost：公网地址放行', () => {
  for (const h of ['api.example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2400:3200::1']) {
    assert.equal(isPrivateHost(h), false, h)
  }
})

test('validateRemoteUrl：协议白名单', () => {
  assert.equal(validateRemoteUrl('file:///etc/passwd'), null)
  assert.equal(validateRemoteUrl('ftp://example.com/a'), null)
  assert.equal(validateRemoteUrl('javascript:alert(1)'), null)
  assert.match(validateRemoteUrl('https://api.example.com/api/works'), /^https:\/\/api\.example\.com\//)
  assert.equal(validateRemoteUrl('http://127.0.0.1:9200/'), null)
  assert.equal(validateRemoteUrl('http://[::1]/'), null)
})

test('validateRemoteUrl：自建服务器主机例外', () => {
  const raw = 'http://192.168.1.5:8888/api/health'
  assert.equal(validateRemoteUrl(raw), null)
  assert.equal(
    validateRemoteUrl(raw, { allowHosts: ['192.168.1.5'] }),
    'http://192.168.1.5:8888/api/health',
  )
})

/** 模拟 fetch 返回：只关心 fetchGuarded 会读的字段 */
const fakeResponse = ({ status = 200, url = '', redirected = false } = {}) => ({
  status, url, redirected, headers: new Headers(),
})

test('fetchGuarded：公网直连正常返回（跟随模式，媒体流才可靠）', async () => {
  const res = await fetchGuarded('https://cdn.example/a.mp3', {}, {
    fetch: async (_url, init) => {
      assert.equal(init.redirect, 'follow')
      return fakeResponse()
    },
  })
  assert.equal(res.status, 200)
})

test('fetchGuarded：首跳就是环回地址时直接拒绝，且不发请求', async () => {
  let calls = 0
  await assert.rejects(
    () => fetchGuarded('http://127.0.0.1:9200/_cat', {}, {
      fetch: async () => { calls++; return fakeResponse() },
    }),
    (e) => e instanceof BlockedUrlError,
  )
  assert.equal(calls, 0)
})

test('fetchGuarded：重定向最终落到环回地址的响应被丢弃', async () => {
  await assert.rejects(
    () => fetchGuarded('https://evil.example/a', {}, {
      fetch: async () => fakeResponse({ redirected: true, url: 'http://127.0.0.1:9200/_cat' }),
    }),
    (e) => e instanceof BlockedUrlError && /重定向/.test(e.message),
  )
})

test('fetchGuarded：重定向到公网地址放行', async () => {
  const res = await fetchGuarded('https://api.example/a', {}, {
    fetch: async () => fakeResponse({ redirected: true, url: 'https://cdn.example/b' }),
  })
  assert.equal(res.status, 200)
})

test('sanitizeFileName：Windows 保留名与非法字符', () => {
  assert.equal(sanitizeFileName('con.mp3'), '_con.mp3')
  assert.equal(sanitizeFileName('LPT9'), '_LPT9')
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j.mp3'), 'a_b_c_d_e_f_g_h_i_j.mp3')
  assert.equal(sanitizeFileName('name.  '), 'name')
  assert.equal(sanitizeFileName(''), 'file')
  assert.equal(sanitizeFileName('01 耳かき.mp3'), '01 耳かき.mp3')
  assert.ok(sanitizeFileName('x'.repeat(400)).length <= 180)
})

test('isInsideRoot：目录边界', () => {
  const root = 'C:\\Downloads\\RJ123'
  assert.equal(isInsideRoot(root, 'C:\\Downloads\\RJ123'), true)
  assert.equal(isInsideRoot(root, 'C:\\Downloads\\RJ123\\a.mp3'), true)
  assert.equal(isInsideRoot(root, 'C:\\Downloads\\RJ1234\\a.mp3'), false)
  assert.equal(isInsideRoot(root, 'C:\\Downloads\\RJ123\\..\\other\\a.mp3'), false)
  assert.equal(isInsideRoot(root, ''), false)
})
