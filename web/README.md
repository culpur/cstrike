# CStrike Web UI

Modern web interface for the CStrike offensive security automation framework. Built with React 19, TypeScript, and Tailwind CSS with a Grok dark theme.

## Features

### Core Modules

- **Dashboard**: Real-time system metrics, service status, and phase progress tracking
- **Reconnaissance**: Target management, tool selection, live scan output, and results display
- **AI Thought Stream**: Real-time AI decision visualization and reasoning display
- **Exploitation**: Web vulnerability exploitation and bruteforce attack controls
- **Loot Tracker**: Comprehensive credential and discovery management with export capabilities
- **Live Logs**: Real-time log streaming with advanced filtering and syntax highlighting
- **Service Control**: Metasploit RPC, OWASP ZAP, and Burp Suite management

### Technical Highlights

- **React 19**: Latest React features with concurrent rendering
- **TypeScript Strict Mode**: Full type safety across the application
- **Zustand State Management**: Lightweight global state with dedicated stores
- **WebSocket Integration**: Real-time updates for all system events
- **Grok Dark Theme**: Professionally designed monochrome dark UI
- **Responsive Design**: Mobile-first approach with collapsible navigation
- **Error Boundaries**: Comprehensive error handling and recovery
- **Path Aliases**: Clean imports with TypeScript path mapping

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Requirements

- Node.js 20+
- Backend API server running on port 8000
- WebSocket server at `/ws` endpoint

## Project Structure

```
src/
├── components/
│   ├── ui/                    # Core UI components
│   │   ├── Button.tsx         # Themed button with variants
│   │   ├── Panel.tsx          # Container panel component
│   │   ├── MetricCard.tsx     # System metric display
│   │   ├── StatusBadge.tsx    # Status indicator badge
│   │   ├── Input.tsx          # Form input component
│   │   └── ProgressBar.tsx    # Animated progress bar
│   └── layout/
│       ├── MainLayout.tsx     # Root layout wrapper
│       ├── Sidebar.tsx        # Collapsible navigation
│       └── ToastContainer.tsx # Toast notification display
│
├── modules/
│   ├── dashboard/             # System overview module
│   ├── reconnaissance/        # Target scanning module
│   ├── ai-stream/             # AI decision stream module
│   ├── exploitation/          # Exploitation controls module
│   ├── loot/                  # Loot tracker module
│   ├── logs/                  # Live logs viewer module
│   └── services/              # Service control module
│
├── stores/
│   ├── systemStore.ts         # System metrics & services state
│   ├── reconStore.ts          # Reconnaissance state
│   ├── aiStore.ts             # AI thought stream state
│   ├── lootStore.ts           # Loot collection state
│   ├── logStore.ts            # Logs state with filtering
│   └── uiStore.ts             # UI state (nav, toasts)
│
├── services/
│   ├── api.ts                 # REST API client (Axios)
│   └── websocket.ts           # WebSocket client with reconnection
│
├── types/
│   └── index.ts               # TypeScript type definitions
│
├── utils/
│   └── index.ts               # Utility functions
│
└── App.tsx                    # Main application entry point
```

## Architecture

### State Management

- **Zustand Stores**: Lightweight state containers for each domain
- **TanStack Query** (optional): Server state caching and synchronization
- **Local State**: React hooks for component-specific state

### API Integration

- **REST API**: Axios-based client with interceptors for auth and error handling
- **WebSocket**: Real-time event stream with automatic reconnection
- **Type Safety**: Full TypeScript coverage for all API interactions

### Styling

- **Tailwind CSS 4**: Utility-first CSS framework
- **Grok Theme**: Custom dark theme with offensive security color palette
- **Responsive**: Mobile-first design with defined breakpoints
- **Animations**: Custom animations for scanning and live updates

## API Endpoints

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete API documentation.

### REST Endpoints

- System: `/api/system/metrics`, `/api/services/status`
- Services: `/api/services/{service}/start|stop`
- Reconnaissance: `/api/recon/targets`, `/api/recon/start`
- Exploitation: `/api/exploit/web/start`, `/api/exploit/bruteforce/start`
- Loot: `/api/loot`, `/api/loot/credentials`
- Logs: `/api/logs`

### WebSocket Events

- `system_metrics`: System metric updates
- `service_status`: Service status changes
- `recon_output`: Live reconnaissance output
- `ai_thought`: AI decision stream
- `loot_item`: New loot discovered
- `log_entry`: New log entries
- `tool_update`: Tool execution updates

## Development

### Code Standards

- **TypeScript Strict Mode**: Enabled with zero `any` types
- **ESLint**: Zero warnings/errors required
- **Component Size**: Maximum 200 lines per component
- **Imports**: Use path aliases (`@components`, `@stores`, etc.)
- **Error Handling**: All API calls wrapped with try/catch
- **Accessibility**: WCAG 2.1 AA minimum compliance

### Adding a New Module

1. Create folder in `src/modules/{module-name}/`
2. Add view component: `{ModuleName}View.tsx`
3. Create store if needed: `src/stores/{module}Store.ts`
4. Define types in `src/types/index.ts`
5. Add navigation item to `Sidebar.tsx`
6. Import and route in `App.tsx`

### Testing

```bash
# Run linter
npm run lint

# Type check
npm run build

# Manual testing
npm run dev
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment instructions including:

- Production build configuration
- Nginx/Apache setup
- Docker containerization
- Environment variables
- Security considerations
- Performance optimization
- Troubleshooting guide

## Security

- **HTTPS Only**: Production deployments must use HTTPS
- **API Authentication**: Token-based auth with localStorage
- **Input Sanitization**: All user inputs validated and sanitized
- **XSS Prevention**: React's built-in XSS protection + manual sanitization
- **CORS Configuration**: Backend CORS properly configured
- **No Secrets in Code**: All secrets in environment variables

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

Proprietary - Internal use only for authorized penetration testing activities.

## Contributors

Built by the CStrike development team for offensive security automation.

---

**Warning**: This tool is designed for authorized penetration testing only. Unauthorized access to computer systems is illegal. Use responsibly and ethically.
