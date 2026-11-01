/**
 * 编译 Windows 媒体面板宿主（SMTC）。
 * 需要 Visual Studio 的 C++ 工具链；没有就跳过（打包时该功能自动关闭）。
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'smc', 'build')
const exe = path.join(outDir, 'Kikoenai.Media.exe')
fs.mkdirSync(outDir, { recursive: true })

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
let vsRoot = ''
try {
  const r = spawnSync(VSWHERE, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' })
  vsRoot = (r.stdout || '').trim()
} catch { /* 没装 VS */ }

if (!vsRoot) {
  console.warn('[smtc] 未找到 Visual Studio C++ 工具链，跳过媒体面板宿主')
  process.exit(0)
}

const vcvars = path.join(vsRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
if (!fs.existsSync(vcvars)) {
  console.warn('[smtc] 缺少 vcvars64.bat，跳过')
  process.exit(0)
}

const bat = path.join(outDir, 'build.bat')
fs.writeFileSync(bat, [
  '@echo off',
  'chcp 65001 >nul',
  `call "${vcvars}" >nul`,
  `cl /nologo /std:c++20 /EHsc /O2 /utf-8 /DUNICODE /D_UNICODE "${path.join(root, 'smc', 'main.cpp')}" /link /SUBSYSTEM:CONSOLE windowsapp.lib RuntimeObject.lib shell32.lib ole32.lib propsys.lib /OUT:"${exe}"`,
].join('\r\n'))

const run = spawnSync('cmd.exe', ['/c', bat], { cwd: root, encoding: 'utf8' })
const log = (run.stdout || '') + (run.stderr || '')
if (run.status !== 0 || !fs.existsSync(exe)) {
  console.error('[smtc] 编译失败\n' + log)
  process.exit(1)
}
console.log('[smtc] 已生成 ' + exe + ' (' + Math.round(fs.statSync(exe).size / 1024) + ' KB)')
