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
          void: '#0d1117',
          'surface-1': '#161b22',
          'surface-2': '#1c2128',
          'surface-3': '#21262d',
          border: '#30363d',
          'border-glow': '#3b4048',
          'text-heading': '#e6edf3',
          'text-body': '#8b949e',
          'text-muted': '#6e7681',
          hover: '#1c2128',
          'rail-bg': '#0d1117',
          // Culpur Defense status
          success: '#3fb950',
          warning: '#d29922',
          error: '#f85149',
          info: '#58a6ff',
          // Culpur Defense palette
          'exploit-red': '#f85149',
          'recon-blue': '#58a6ff',
          'loot-green': '#3fb950',
          'ai-purple': '#bc8cff',
          'scan-cyan': '#39d2c0',
          'crit-red': '#f85149',
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
          '0%, 100%': { borderColor: '#30363d' },
          '50%': { borderColor: '#3b4048' },
        },
      }
    },
  },
  plugins: [],
}
