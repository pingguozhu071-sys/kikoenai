/**
 * 断点续传的响应分流 —— 纯函数，便于单测。
 *
 * 三种情况：
 *   206 Partial Content：从已有字节往后写（append）
 *   200 OK：服务端不认 Range，丢掉已有字节从头下（restart）
 *   416 Range Not Satisfiable：本地可能已经下完，或远端文件变了
 */

/** received > 0 时才带 Range 头 */
function buildRangeHeader(received) {
  const n = Math.floor(Number(received) || 0)
  return n > 0 ? `bytes=${n}-` : null
}

/** 从 Content-Range 里取总大小：`bytes 0-99/1234`，或 416 时的 `bytes 星号/1234` */
function totalFromContentRange(value) {
  const m = /\/\s*(\d+)\s*$/.exec(String(value || ''))
  return m ? Number(m[1]) : 0
}

/**
 * @param {{ status: number, received?: number, total?: number, contentRange?: string }} input
 * @returns {{ mode: 'append'|'restart'|'done'|'start', startReceived: number, total: number }}
 */
function planResume({ status, received = 0, total = 0, contentRange = '' }) {
  const already = Math.max(0, Math.floor(Number(received) || 0))

  if (status === 206) {
    return {
      mode: 'append',
      startReceived: already,
      total: totalFromContentRange(contentRange) || Math.floor(Number(total) || 0),
    }
  }

  if (status === 416) {
    const remoteTotal = totalFromContentRange(contentRange)
    if (remoteTotal > 0 && already >= remoteTotal) {
      return { mode: 'done', startReceived: remoteTotal, total: remoteTotal }
    }
    return { mode: 'restart', startReceived: 0, total: 0 }
  }

  if (status === 200) {
    return { mode: 'restart', startReceived: 0, total: Math.floor(Number(total) || 0) }
  }

  return { mode: 'start', startReceived: 0, total: Math.floor(Number(total) || 0) }
}

module.exports = { buildRangeHeader, totalFromContentRange, planResume }
