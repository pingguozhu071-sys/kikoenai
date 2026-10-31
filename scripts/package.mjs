/**
 * 打包成可双击运行的桌面应用目录（不依赖 electron-builder 的额外下载）：
 *
 *   release/Kikoenai/
 *     Kikoenai.exe           ← 由 electron.exe 改名
 *     resources/app/         ← 前端 dist + electron 主进程 + package.json
 *     ...(Electron 运行时)
 *
 * 目录结构：可执行文件 + 同目录 app 资源，整个文件夹拷走就能跑。
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const electronDir = path.dirname(require('electron'))
const electronRoot = path.resolve(electronDir, '..', 'dist') // node_modules/electron/dist
const outRoot = path.join(root, 'release', 'Kikoenai')

function rm(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true })
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function main() {
  // 构建必须由打包自己执行并检查退出码：
  // 否则构建失败时 dist 里还是上一次的产物，会把旧版本原样装出去。
  console.log('构建前端…')
  run('npm', ['run', 'build'])

  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('构建后仍找不到 dist/index.html，中止')
    process.exit(1)
  }
  if (!fs.existsSync(electronRoot)) {
    console.error('找不到 Electron 运行时：', electronRoot)
    process.exit(1)
  }

  console.log('清空输出目录…')
  rm(outRoot)
  fs.mkdirSync(outRoot, { recursive: true })

  console.log('复制 Electron 运行时…')
  copyDir(electronRoot, outRoot)

  const appDir = path.join(outRoot, 'resources', 'app')
  fs.mkdirSync(appDir, { recursive: true })

  console.log('复制应用文件…')
  copyDir(path.join(root, 'dist'), path.join(appDir, 'dist'))
  copyDir(path.join(root, 'electron'), path.join(appDir, 'electron'))
  // 单元测试不进安装包
  fs.rmSync(path.join(appDir, 'electron', 'guard.test.cjs'), { force: true })
  fs.rmSync(path.join(appDir, 'electron', 'local.test.cjs'), { force: true })

  // 产物一致性：装进去的那份必须就是刚构建出来的那份
  const distIndex = path.join(root, 'dist', 'index.html')
  const packedIndex = path.join(appDir, 'dist', 'index.html')
  if (sha256(distIndex) !== sha256(packedIndex)) {
    console.error('打包产物与 dist 哈希不一致，中止')
    process.exit(1)
  }
  console.log('校验通过：安装目录与 dist/index.html 哈希一致')

  // 运行期只需要 main + version + name
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const runtimePkg = {
    name: pkg.name,
    productName: 'Kikoenai',
    version: pkg.version,
    description: pkg.description,
    main: 'electron/main.cjs',
    type: 'commonjs',
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePkg, null, 2))

  // 重命名可执行文件
  const exeSrc = path.join(outRoot, 'electron.exe')
  const exeDst = path.join(outRoot, 'Kikoenai.exe')
  if (fs.existsSync(exeSrc)) {
    fs.renameSync(exeSrc, exeDst)
  }

  // 写入 exe 图标与版本信息（rcedit 为可选依赖）
  const icoPath = path.join(root, 'build', 'icon.ico')
  const rcedit = path.join(
    root, 'node_modules', 'rcedit', 'bin',
    process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe',
  )
  if (fs.existsSync(rcedit) && fs.existsSync(icoPath)) {
    try {
      execFileSync(rcedit, [
        exeDst,
        '--set-icon', icoPath,
        '--set-file-version', pkg.version,
        '--set-product-version', pkg.version,
        '--set-version-string', 'ProductName', 'Kikoenai',
        '--set-version-string', 'FileDescription', 'Kikoenai — ASMR 桌面客户端',
        '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026. All rights reserved. Licensed under PolyForm Strict 1.0.0.',
      ], { stdio: 'inherit' })
      console.log('已写入 exe 图标与版本信息')
    } catch (e) {
      console.warn('写入 exe 图标失败（不影响运行）:', e.message)
    }
  } else {
    console.warn('未找到 rcedit 或 icon.ico，跳过 exe 图标')
  }

  // 便捷启动脚本（可带上游代理）
  fs.writeFileSync(
    path.join(outRoot, '启动.bat'),
    [
      '@echo off',
      'rem 如需上游代理，取消下一行注释并改成你的端口',
      'rem set KIKOERU_PROXY=http://127.0.0.1:7897',
      'rem 使用自建服务器时取消下一行',
      'rem set KIKOERU_TARGET=http://localhost:8888',
      'start "" "%~dp0Kikoenai.exe"',
    ].join('\r\n'),
    'utf8',
  )

  // 安装向导入口（同一个 exe 的 --install 模式）
  fs.writeFileSync(
    path.join(outRoot, '安装.bat'),
    [
      '@echo off',
      'start "" "%~dp0Kikoenai.exe" --install',
    ].join('\r\n'),
    'utf8',
  )

  const size = dirSize(outRoot)
  console.log(`\n完成 → ${outRoot}`)
  console.log(`体积约 ${(size / 1024 / 1024).toFixed(1)} MB`)
  console.log('安装：双击 安装.bat；免安装：双击 Kikoenai.exe（或 启动.bat）')
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else total += fs.statSync(p).size
  }
  return total
}

main()
