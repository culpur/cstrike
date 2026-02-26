/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        grok: {
          void: '#000000',
          'surface-1': '#0a0a0f',
          'surface-2': '#12121a',
          'surface-3': '#1a1a26',
          border: '#2a2a3a',
          'border-glow': '#3a3a5a',
          'text-heading': '#e8e8f0',
          'text-body': '#b8b8c8',
          'text-muted': '#6a6a80',
          hover: '#1e1e2e',
          'rail-bg': '#060609',
          // Neon status
          success: '#00ff88',
          warning: '#ffaa00',
          error: '#ff3344',
          info: '#4488ff',
          // Offensive security
          'exploit-red': '#ff2040',
          'recon-blue': '#2266ff',
          'loot-green': '#00cc66',
          'ai-purple': '#8844ff',
          'scan-cyan': '#00ccdd',
          'crit-red': '#ff0033',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
        'border-glow': 'border-glow 3s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
        'fade-in': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        'border-glow': {
          '0%, 100%': { borderColor: '#2a2a3a' },
          '50%': { borderColor: '#3a3a5a' },
        },
      }
    },
  },
  plugins: [],
}
