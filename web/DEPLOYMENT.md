# CStrike Web UI - Deployment Guide

## Overview

This document provides comprehensive deployment instructions for the CStrike Web UI frontend application.

## Prerequisites

- Node.js 20+ and npm
- Backend API server running on port 8000
- WebSocket server accessible at `/ws`

## Environment Setup

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The development server will start on `http://localhost:3000` with:
- Hot module replacement (HMR)
- API proxy to `http://localhost:8000`
- WebSocket proxy to `ws://localhost:8000`

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

The production build outputs to `dist/` directory.

## Architecture

### Technology Stack

- **React 19**: Latest React with concurrent features
- **TypeScript**: Strict type safety
- **Vite**: Lightning-fast build tool
- **Tailwind CSS 4**: Utility-first styling with Grok dark theme
- **Zustand**: Lightweight state management
- **Axios**: HTTP client for REST API
- **WebSocket**: Real-time communication
- **Lucide React**: Icon library

### Project Structure

```
src/
├── components/
│   ├── ui/              # Reusable UI components
│   └── layout/          # Layout components
├── modules/             # Feature modules
│   ├── dashboard/       # System metrics & overview
│   ├── reconnaissance/  # Target scanning
│   ├── ai-stream/       # AI thought stream
│   ├── exploitation/    # Exploitation tools
│   ├── loot/            # Collected data
│   ├── logs/            # Live logs
│   └── services/        # Service control
├── stores/              # Zustand state stores
├── services/            # API & WebSocket clients
├── types/               # TypeScript definitions
├── utils/               # Utility functions
└── hooks/               # Custom React hooks
```

## API Integration

### REST API Endpoints

The frontend expects the following API endpoints:

- `GET /api/system/metrics` - System metrics
- `GET /api/services/status` - Service status
- `POST /api/services/{service}/start` - Start service
- `POST /api/services/{service}/stop` - Stop service
- `POST /api/recon/targets` - Add target
- `DELETE /api/recon/targets/:id` - Remove target
- `POST /api/recon/start` - Start reconnaissance
- `POST /api/exploit/web/start` - Start web exploitation
- `GET /api/loot` - Get collected loot
- `GET /api/logs` - Get logs

### WebSocket Messages

The WebSocket connection (`/ws`) handles real-time updates:

- `system_metrics` - System metric updates
- `service_status` - Service status changes
- `phase_update` - Exploitation phase changes
- `recon_output` - Live reconnaissance output
- `ai_thought` - AI decision stream
- `loot_item` - New loot discovered
- `log_entry` - New log entries
- `tool_update` - Tool execution updates

## Configuration

### Vite Configuration

See `vite.config.ts` for:
- Path aliases (`@components`, `@stores`, etc.)
- API proxy configuration
- WebSocket proxy
- Build optimizations

### Tailwind Configuration

See `tailwind.config.js` for:
- Grok dark theme colors
- Custom animations
- Typography settings
- Responsive breakpoints

## Deployment Options

### Option 1: Static Hosting (Recommended)

Build and serve the static files:

```bash
npm run build
```

Deploy the `dist/` folder to:
- **Nginx**: See nginx configuration below
- **Apache**: Standard static file serving
- **CDN**: CloudFront, Cloudflare, etc.

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name cstrike.yourdomain.com;
    root /var/www/cstrike/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

### Option 2: Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -t cstrike-web .
docker run -p 3000:80 cstrike-web
```

### Option 3: Development Mode (Not for Production)

```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

## Security Considerations

1. **HTTPS Only**: Always use HTTPS in production
2. **API Authentication**: Implement token-based auth (stored in localStorage)
3. **CORS**: Configure backend CORS properly
4. **CSP**: Set Content Security Policy headers
5. **Input Validation**: All user inputs are validated
6. **XSS Prevention**: All dynamic content is sanitized

## Performance Optimization

1. **Code Splitting**: Implemented via Vite's dynamic imports
2. **Lazy Loading**: Routes and heavy components load on demand
3. **Caching**: Browser caching for static assets
4. **Compression**: Gzip/Brotli compression enabled
5. **CDN**: Use CDN for production deployments

## Monitoring

### Browser Console

Check browser console for:
- WebSocket connection status
- API request errors
- Component errors

### Network Tab

Monitor:
- API response times
- WebSocket message frequency
- Asset load times

## Troubleshooting

### WebSocket Connection Fails

1. Check backend WebSocket server is running
2. Verify `/ws` endpoint is accessible
3. Check proxy configuration (nginx/vite)
4. Ensure no firewall blocking WebSocket connections

### API Requests Fail

1. Verify backend API is running on port 8000
2. Check CORS configuration
3. Inspect network tab for error details
4. Verify API endpoints match expected format

### Build Errors

1. Clear node_modules: `rm -rf node_modules && npm install`
2. Clear Vite cache: `rm -rf node_modules/.vite`
3. Check TypeScript errors: `npm run build`

### Blank Page After Deploy

1. Check browser console for errors
2. Verify all assets loaded correctly
3. Check base URL configuration
4. Ensure fallback route configured (SPA)

## Environment Variables

Create `.env` file for environment-specific configuration:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

Access in code:
```typescript
const apiUrl = import.meta.env.VITE_API_BASE_URL;
```

## Maintenance

### Updating Dependencies

```bash
# Check for outdated packages
npm outdated

# Update all dependencies
npm update

# Update major versions
npx npm-check-updates -u
npm install
```

### Version Control

Follow semantic versioning:
- **Major**: Breaking changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes

Update version in `package.json` before release.

## Support

For issues or questions:
1. Check this documentation
2. Review browser console errors
3. Check backend API logs
4. Inspect network requests
5. Review component error boundaries

## License

Proprietary - Internal use only for authorized penetration testing.
