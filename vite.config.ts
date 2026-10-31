import { defineConfig, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import { HttpsProxyAgent } from 'https-proxy-agent'

// 浏览器直连会被 CORS 拦：api.asmr.one 的白名单只放行它自己的站点，
// kikoeru-express 未配置 CORS。所以开发时统一走同源 /kapi/* 转发。
//
// 环境变量：
//   KIKOERU_TARGET  目标服务器，默认 https://api.asmr.one；自建站填 http://localhost:8888
//   KIKOERU_PROXY   dev server 访问目标所需的上游 HTTP 代理（如 http://127.0.0.1:7897）
// 打包成桌面应用（npm run app / npm run package）后，由 Electron 主进程承担同样的转发。
const ASMR_TARGET = process.env.KIKOERU_TARGET ?? 'https://api.asmr.one'
const UPSTREAM_PROXY = process.env.KIKOERU_PROXY

const kapiOptions: ProxyOptions = {
  target: ASMR_TARGET,
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/kapi/, '/api'),
  ...(UPSTREAM_PROXY ? { agent: new HttpsProxyAgent(UPSTREAM_PROXY) as never } : {}),
}

export default defineConfig({
  // 桌面壳用自定义协议加载，资源需相对路径
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: { '/kapi': kapiOptions },
    watch: {
      // release/ 里有正在运行的 exe，被监听会导致 EBUSY
      ignored: ['**/release/**', '**/node_modules/**', '**/.git/**', '**/ref-asmrone/**'],
    },
  },
  build: {
    target: 'chrome120',
    cssCodeSplit: false,
  },
})
