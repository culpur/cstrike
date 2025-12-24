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
          'surface-1': '#111111',
          'surface-2': '#1E1E1E',
          'surface-3': '#2A2A2A',
          border: '#333333',
          'text-heading': '#FFFFFF',
          'text-body': '#E0E0E0',
          'text-muted': '#888888',
          hover: '#2A2A2A',
          'rail-bg': '#0A0A0A',
          // Accent colors for status indicators
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
          // Offensive security themed accents
          'exploit-red': '#DC2626',
          'recon-blue': '#2563EB',
          'loot-green': '#059669',
          'ai-purple': '#7C3AED',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2s linear infinite',
      },
      keyframes: {
        scan: {
          '0%, 100%': { opacity: 0.3 },
          '50%': { opacity: 1 },
        }
      }
    },
  },
  plugins: [],
}
