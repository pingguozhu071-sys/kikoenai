/**
 * 主题引擎 — 由种子色生成整套 Material 3 配色（TonalSpot）。
 *
 * 使用 @material/material-color-utilities 的 themeFromSourceColor，
 *   primary = seed, isDark, isAmoled, style = PaletteStyle.TonalSpot)
 * MaterialKolor 是 material-color-utilities 的 Kotlin 移植，
 * 因此这里用官方 @material/material-color-utilities + 同一种子色可得到一致结果。
 *
 * 种子色取自 animeko DefaultSeedColor.kt: 0xFF4F378B
 * surfaceContainer* 各档位按 M3 中性色板 tone 规范取值。
 * AMOLED（纯黑背景）把 surface container 各档位压到近黑。
 */
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities'

export const DEFAULT_SEED = '#4F378B'

function css(color: number | string): string {
  return hexFromArgb(typeof color === 'number' ? color : argbFromHex(color))
}

function applyScheme(dark: boolean, amoled: boolean, seed: string) {
  const theme = themeFromSourceColor(argbFromHex(seed))
  const scheme = dark ? theme.schemes.dark : theme.schemes.light
  const p = theme.palettes
  // M3 surface container 档位（light/dark 各自的 neutral tone 规范）
  const containerTones = dark
    ? { lowest: 4, low: 10, base: 12, high: 17, highest: 22, dim: 6, bright: 24 }
    : { lowest: 100, low: 96, base: 94, high: 92, highest: 90, dim: 87, bright: 98 }
  const n = p.neutral
  const root = document.documentElement
  const set = (k: string, v: string) => root.style.setProperty(`--md-${k}`, v)

  const vars: Record<string, string> = {
    'primary': css(scheme.primary),
    'on-primary': css(scheme.onPrimary),
    'primary-container': css(scheme.primaryContainer),
    'on-primary-container': css(scheme.onPrimaryContainer),
    'secondary': css(scheme.secondary),
    'on-secondary': css(scheme.onSecondary),
    'secondary-container': css(scheme.secondaryContainer),
    'on-secondary-container': css(scheme.onSecondaryContainer),
    'tertiary': css(scheme.tertiary),
    'on-tertiary': css(scheme.onTertiary),
    'error': css(scheme.error),
    'on-error': css(scheme.onError),
    'error-container': css(scheme.errorContainer),
    'on-error-container': css(scheme.onErrorContainer),
    'background': css(scheme.background),
    'on-background': css(scheme.onBackground),
    'surface': css(scheme.surface),
    'on-surface': css(scheme.onSurface),
    'surface-variant': css(scheme.surfaceVariant),
    'on-surface-variant': css(scheme.onSurfaceVariant),
    'outline': css(scheme.outline),
    'outline-variant': css(scheme.outlineVariant),
    'inverse-surface': css(scheme.inverseSurface),
    'inverse-on-surface': css(scheme.inverseOnSurface),
    'scrim': css(scheme.scrim),
    'surface-container-lowest': css(n.tone(containerTones.lowest)),
    'surface-container-low': css(n.tone(containerTones.low)),
    'surface-container': css(n.tone(containerTones.base)),
    'surface-container-high': css(n.tone(containerTones.high)),
    'surface-container-highest': css(n.tone(containerTones.highest)),
    'surface-dim': css(n.tone(containerTones.dim)),
    'surface-bright': css(n.tone(containerTones.bright)),
  }
  for (const [k, v] of Object.entries(vars)) set(k, v)

  if (dark && amoled) {
    // AMOLED：把 surface container 阶梯压到近黑，
    // 否则会出现"纯黑背景上浮着一块块深灰砖"的半吊子效果
    set('background', '#000000')
    set('surface', '#000000')
    set('surface-container-lowest', '#000000')
    set('surface-container-low', '#08080a')
    set('surface-container', '#0e0e11')
    set('surface-container-high', '#151518')
    set('surface-container-highest', '#1c1c20')
    set('surface-dim', '#000000')
    set('surface-bright', '#26262a')
    set('surface-variant', '#000000')
    for (const k of ['on-background', 'on-surface']) set(k, '#FFFFFF')
    set('on-surface-variant', '#c9c4d0')
    // 黑色背景上中性色描边会消失，稍微提亮
    set('outline', '#8f8a96')
    set('outline-variant', '#3a3a40')
  }
  set('scheme-dark', dark ? '1' : '0')
  root.dataset.scheme = dark ? 'dark' : 'light'
}

// ---------------------------------------------------------------- 唯一主题

/**
 * 固定主题：深色 + 种子色 #4F378B。
 * 不再提供明暗 / AMOLED / 种子色切换 —— 这一套就是默认，也是唯一选择。
 */
export function applyTheme(): void {
  applyScheme(true, false, DEFAULT_SEED)
}
