// Monaco themes that match the rest of Zero.
//
// The canvas used to hand Monaco the stock 'vs' / 'vs-dark'. 'vs-dark' happens
// to be close, because the canvas column is #1e1e1e and so is that theme's
// background -- but 'vs' is plain VS Code light: a white editor with a grey
// gutter, blue selection and its own widget chrome, none of which belongs next
// to the slate surfaces and the nebula accent the rest of the app uses.
//
// These two themes take their surfaces from the canvas (#1e1e1e / #252526 /
// #3e3e3e in dark, white / slate-50 / slate-200 in light) and their selection
// and cursor from the live --nebula-* variables, so they follow the accent
// picker like everything else.

export const ZERO_MONACO_DARK = 'zero-dark';
export const ZERO_MONACO_LIGHT = 'zero-light';

type MonacoLike = {
  editor: {
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
    setTheme: (name: string) => void;
  };
};

const FALLBACK_ACCENT = { accent: '#f59e0b', accentStrong: '#d97706' };

function readAccent(): { accent: string; accentStrong: string } {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK_ACCENT;
  const styles = getComputedStyle(document.body);
  const accent = styles.getPropertyValue('--nebula-500').trim();
  const accentStrong = styles.getPropertyValue('--nebula-600').trim();
  return {
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : FALLBACK_ACCENT.accent,
    accentStrong: /^#[0-9a-f]{6}$/i.test(accentStrong) ? accentStrong : FALLBACK_ACCENT.accentStrong,
  };
}

/** Monaco takes 8-digit hex for alpha, not rgba(). */
const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

export function defineZeroMonacoThemes(monaco: MonacoLike) {
  const { accent, accentStrong } = readAccent();

  monaco.editor.defineTheme(ZERO_MONACO_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#e2e8f0',
      'editorGutter.background': '#1e1e1e',
      'editorLineNumber.foreground': '#5c5c5c',
      'editorLineNumber.activeForeground': '#cbd5e1',
      'editor.lineHighlightBackground': '#ffffff0a',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': withAlpha(accent, '3d'),
      'editor.inactiveSelectionBackground': withAlpha(accent, '1f'),
      'editor.selectionHighlightBackground': withAlpha(accent, '26'),
      'editor.wordHighlightBackground': withAlpha(accent, '1f'),
      'editorCursor.foreground': accent,
      'editorIndentGuide.background1': '#3e3e3e',
      'editorIndentGuide.activeBackground1': '#5c5c5c',
      'editorWhitespace.foreground': '#3e3e3e',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#3e3e3e',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#3e3e3e',
      'editorSuggestWidget.selectedBackground': withAlpha(accent, '26'),
      'editorHoverWidget.background': '#252526',
      'editorHoverWidget.border': '#3e3e3e',
      'editorBracketMatch.background': withAlpha(accent, '26'),
      'editorBracketMatch.border': '#00000000',
      'minimap.background': '#1e1e1e',
      'minimapSlider.background': '#ffffff0f',
      'minimapSlider.hoverBackground': '#ffffff1a',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
      'scrollbarSlider.activeBackground': '#ffffff33',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': '#fb7185',
      'editorWarning.foreground': '#fbbf24',
    },
  });

  monaco.editor.defineTheme(ZERO_MONACO_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e293b',
      'editorGutter.background': '#ffffff',
      'editorLineNumber.foreground': '#94a3b8',
      'editorLineNumber.activeForeground': '#475569',
      'editor.lineHighlightBackground': '#f1f5f9',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': withAlpha(accent, '33'),
      'editor.inactiveSelectionBackground': withAlpha(accent, '1a'),
      'editor.selectionHighlightBackground': withAlpha(accent, '24'),
      'editor.wordHighlightBackground': withAlpha(accent, '1a'),
      'editorCursor.foreground': accentStrong,
      'editorIndentGuide.background1': '#e2e8f0',
      'editorIndentGuide.activeBackground1': '#cbd5e1',
      'editorWhitespace.foreground': '#cbd5e1',
      'editorWidget.background': '#f8fafc',
      'editorWidget.border': '#e2e8f0',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e2e8f0',
      'editorSuggestWidget.selectedBackground': withAlpha(accent, '24'),
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e2e8f0',
      'editorBracketMatch.background': withAlpha(accent, '24'),
      'editorBracketMatch.border': '#00000000',
      'minimap.background': '#f8fafc',
      'minimapSlider.background': '#94a3b829',
      'minimapSlider.hoverBackground': '#94a3b83d',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#cbd5e159',
      'scrollbarSlider.hoverBackground': '#94a3b859',
      'scrollbarSlider.activeBackground': '#64748b59',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': '#be123c',
      'editorWarning.foreground': '#b45309',
    },
  });
}
