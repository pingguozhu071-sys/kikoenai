/** 字幕窗样式：桌面字幕与任务栏字幕各存一份，两个窗口共用 */
export type LyricStyle = 'classic' | 'frosted' | 'liquid'
export type LyricWindowKind = 'desktop' | 'taskbar'

export const LYRIC_STYLE_NAMES: Record<LyricStyle, string> = {
  classic: '经典',
  frosted: '磨砂',
  liquid: '液态',
}

export const LYRIC_STYLE_KEY: Record<LyricWindowKind, string> = {
  desktop: 'kikoeru-pc/lyricStyleDesktop',
  taskbar: 'kikoeru-pc/lyricStyleTaskbar',
}

export function isLyricStyle(v: unknown): v is LyricStyle {
  return v === 'classic' || v === 'frosted' || v === 'liquid'
}

export function readLyricStyle(kind: LyricWindowKind): LyricStyle {
  try {
    const raw = localStorage.getItem(LYRIC_STYLE_KEY[kind])
    if (isLyricStyle(raw)) return raw
  } catch { /* 忽略 */ }
  return kind === 'desktop' ? 'frosted' : 'classic'
}

export function writeLyricStyle(kind: LyricWindowKind, style: LyricStyle) {
  try {
    localStorage.setItem(LYRIC_STYLE_KEY[kind], style)
  } catch { /* 忽略 */ }
}
