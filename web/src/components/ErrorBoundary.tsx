/**
 * ErrorBoundary Component - Catch and display React errors
 */

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-grok-void p-6">
          <div className="max-w-md w-full bg-grok-surface-1 border border-grok-border rounded-lg p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-grok-error/20 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-grok-error" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-grok-text-heading mb-2">
              Something went wrong
            </h1>

            <p className="text-sm text-grok-text-muted mb-6">
              The application encountered an unexpected error. Please try refreshing the
              page or contact support if the problem persists.
            </p>

            {this.state.error && (
              <div className="mb-6 p-4 bg-grok-void rounded text-left">
                <p className="text-xs text-grok-error font-mono">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => window.location.reload()}
              >
                Refresh Page
              </Button>
              <Button variant="primary" className="flex-1" onClick={this.handleReset}>
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
