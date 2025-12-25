# CStrike Frontend Development Guide

## Quick Start

### Option 1: Automated Startup (Recommended)

From the project root directory:

```bash
# Start both backend and frontend
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh

# The script will:
# 1. Start backend API on port 8000
# 2. Start frontend dev server on port 3000
# 3. Verify both are healthy
# 4. Show logs from both servers
```

### Option 2: Manual Startup

Terminal 1 - Backend:
```bash
cd /Users/soulofall/projects/cstrike
python3 api_server.py
```

Terminal 2 - Frontend:
```bash
cd /Users/soulofall/projects/cstrike/web
npm run dev
```

## Access Points

- **Frontend Application**: http://localhost:3000
- **Backend API**: http://localhost:8000/api/v1/
- **WebSocket**: ws://localhost:8000/socket.io

## Important: Vite Proxy Configuration

The Vite dev server is configured to proxy API requests to the backend. This means:

### DO THIS ✅
```javascript
// Frontend code makes requests to the same origin
fetch('/api/v1/targets')
// Vite proxy forwards to http://localhost:8000/api/v1/targets
```

### DON'T DO THIS ❌
```javascript
// Don't hardcode backend URL in frontend code
fetch('http://localhost:8000/api/v1/targets')
// This bypasses the proxy and causes CORS issues
```

## Proxy Configuration Details

File: `/Users/soulofall/projects/cstrike/web/vite.config.ts`

```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      // API requests proxy
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // WebSocket proxy
      '/socket.io': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
```

## Request Flow

```
Browser (localhost:3000)
    ↓
    │ GET /api/v1/targets
    ↓
Vite Dev Server (localhost:3000)
    ↓
    │ Proxy matches '/api' pattern
    ↓
Backend API (localhost:8000)
    ↓
    │ GET /api/v1/targets
    ↓
Response → Proxy → Browser
```

## Troubleshooting

### Frontend not loading?

```bash
# Check if Vite is running
lsof -i :3000

# If not, start it
cd /Users/soulofall/projects/cstrike/web
npm run dev
```

### API requests failing with 500 errors?

This means Vite dev server is not running. The proxy only works when Vite is active.

```bash
# Verify Vite is running on port 3000
lsof -i :3000

# Verify backend is running on port 8000
lsof -i :8000

# Both must be running!
```

### CORS errors in browser console?

If you see CORS errors, you're probably:
1. Accessing `http://localhost:8000` directly (use `http://localhost:3000` instead)
2. Making requests to full backend URL instead of using the proxy

**Solution**: Always access the app via `http://localhost:3000` and use relative paths like `/api/v1/targets`

### Port already in use?

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use the automated script
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh stop
```

## Development Workflow

1. **Start servers**: Use the automated script or manual startup
2. **Open browser**: Navigate to http://localhost:3000
3. **Code changes**:
   - Frontend changes: Auto-reload via Vite HMR
   - Backend changes: Restart `api_server.py`
4. **View logs**:
   - Frontend: Check terminal running `npm run dev`
   - Backend: Check terminal running `api_server.py`
5. **Debug**: Use browser DevTools Network tab to inspect requests

## Available npm Scripts

```bash
npm run dev      # Start dev server with HMR
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## Tech Stack

- **React**: 19.2.0
- **Vite**: 7.2.4
- **TypeScript**: 5.9.3
- **TanStack Query**: 5.90.12 (data fetching)
- **Zustand**: 5.0.9 (state management)
- **Socket.IO Client**: 4.8.3 (WebSocket)
- **Axios**: 1.13.2 (HTTP client)
- **Tailwind CSS**: 4.1.18 (styling)

## Project Structure

```
web/
├── src/
│   ├── components/      # Reusable UI components
│   ├── modules/         # Feature modules
│   ├── hooks/           # Custom React hooks
│   ├── stores/          # Zustand stores
│   ├── services/        # API services
│   ├── types/           # TypeScript types
│   ├── utils/           # Utility functions
│   ├── App.tsx          # Main application component
│   └── main.tsx         # Application entry point
├── vite.config.ts       # Vite configuration (PROXY CONFIG HERE)
├── tsconfig.json        # TypeScript configuration
├── tailwind.config.js   # Tailwind CSS configuration
└── package.json         # Dependencies and scripts
```

## Path Aliases

The project uses TypeScript path aliases for cleaner imports:

```typescript
import Button from '@components/Button'        // Instead of ../../../components/Button
import { useAuth } from '@hooks/useAuth'       // Instead of ../../hooks/useAuth
import { api } from '@services/api'            // Instead of ../services/api
import type { Target } from '@types/models'    // Instead of ../types/models
```

Configuration in `vite.config.ts`:
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@components': path.resolve(__dirname, './src/components'),
    '@modules': path.resolve(__dirname, './src/modules'),
    '@hooks': path.resolve(__dirname, './src/hooks'),
    '@stores': path.resolve(__dirname, './src/stores'),
    '@services': path.resolve(__dirname, './src/services'),
    '@types': path.resolve(__dirname, './src/types'),
    '@utils': path.resolve(__dirname, './src/utils'),
  },
}
```

## Environment Variables

Vite uses `.env` files for environment configuration:

- `.env` - Default environment variables
- `.env.local` - Local overrides (gitignored)
- `.env.production` - Production variables

Access in code:
```typescript
const apiUrl = import.meta.env.VITE_API_URL
```

**Note**: In development, we use the Vite proxy, so you typically don't need to set `VITE_API_URL`.

## Hot Module Replacement (HMR)

Vite provides instant HMR for a fast development experience:

- **Component changes**: Instant updates without page reload
- **State preservation**: Component state is preserved during updates
- **CSS changes**: Instant style updates

If HMR breaks, refresh the page manually with `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux).

## Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

The production build is optimized and minified, output to `dist/` directory.

## Common Issues and Solutions

### Issue: "Failed to fetch" errors

**Cause**: Backend not running
**Solution**: Start backend with `python3 api_server.py`

### Issue: White screen on load

**Cause**: Build error or runtime error
**Solution**: Check browser console for errors, check terminal for build errors

### Issue: Changes not reflecting

**Cause**: HMR issue or cached assets
**Solution**:
1. Try hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux)
2. Stop and restart dev server
3. Clear browser cache

### Issue: TypeScript errors

**Cause**: Type mismatches or missing types
**Solution**:
1. Check terminal for TypeScript errors
2. Run `npm run lint` to find issues
3. Fix type errors in code

## Best Practices

1. **Always use the proxy**: Make API requests to relative paths (`/api/v1/...`)
2. **Use TypeScript**: Define types for all data structures
3. **Follow naming conventions**: Components in PascalCase, files in kebab-case
4. **Keep components small**: Break large components into smaller, reusable pieces
5. **Use React Query**: For all API data fetching and caching
6. **Use Zustand**: For global state management
7. **Handle errors**: Always handle API errors gracefully

## Debugging Tips

1. **Browser DevTools Network Tab**: View all HTTP requests and responses
2. **React DevTools**: Inspect component tree and props
3. **Console logging**: Use `console.log()` for debugging (remove before commit)
4. **Vite debug mode**: Set `DEBUG=vite:* npm run dev` for verbose logging
5. **Backend logs**: Check backend terminal for API errors

## Additional Resources

- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [TanStack Query Docs](https://tanstack.com/query/latest)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
- [Socket.IO Client Docs](https://socket.io/docs/v4/client-api/)

## Quick Reference

```bash
# Start development
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh

# Stop servers
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh stop

# Check status
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh status

# Manual frontend start
cd /Users/soulofall/projects/cstrike/web && npm run dev

# Manual backend start
cd /Users/soulofall/projects/cstrike && python3 api_server.py

# Test API directly
curl http://localhost:8000/api/v1/targets

# Test via proxy
curl http://localhost:3000/api/v1/targets
```

---

**Need help?** Check `/Users/soulofall/projects/cstrike/FRONTEND_BACKEND_TROUBLESHOOTING.md` for detailed troubleshooting.
