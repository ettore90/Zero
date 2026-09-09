/**
 * Tailwind is compiled at build time. It used to be loaded from the Play CDN
 * (`<script src="https://cdn.tailwindcss.com">` in index.html), which ships the
 * whole compiler to the browser and installs a MutationObserver that
 * regenerates CSS on every DOM mutation -- including the ones React makes on
 * each keystroke. Measured on a 13-node page, its mere presence took the p90
 * input latency from 28ms to 150ms. Tailwind documents that CDN as
 * development-only.
 *
 * This config mirrors the one that was inline in index.html, so the output is
 * the same set of classes with the same theme.
 */

// This package is ESM ("type": "module"), so the plugin is imported rather
// than required.
import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './constants.ts',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  // components/workflow/NodeIcon.tsx builds its size classes as `h-${sz}`/`w-${sz}`,
  // which the scanner cannot see. Only 3 and 4 are ever passed.
  safelist: ['h-3', 'w-3', 'h-4', 'w-4'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        nebula: {
          50: 'var(--nebula-50)',
          100: 'var(--nebula-100)',
          500: 'var(--nebula-500)',
          600: 'var(--nebula-600)',
          800: 'var(--nebula-800)',
          900: 'var(--nebula-900)',
        },
        dark: {
          800: '#18181b',
          900: '#09090b',
          950: '#020203',
        },
      },
    },
  },
  plugins: [typography],
};
