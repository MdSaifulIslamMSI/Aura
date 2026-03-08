import React from 'react';
import { reportClientError } from '@/services/clientObservability';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    reportClientError(error, {
      source: 'react.error_boundary',
      componentStack: errorInfo?.componentStack || '',
    });

    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo);
    } else {
      // Keep console logging for local debugging while providing a safe fallback UI.
      console.error('AppErrorBoundary captured an error:', error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <div className="max-w-lg w-full rounded-2xl border border-neo-rose/35 bg-zinc-950/90 p-6 text-center shadow-glass">
          <h2 className="text-xl font-black text-white tracking-tight">Something went wrong</h2>
          <p className="mt-2 text-sm text-slate-300">
            A UI module failed to load correctly. Refresh or retry to continue.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
            >
              Retry Render
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-neo-cyan/45 bg-neo-cyan/15 px-4 py-2 text-sm font-semibold text-neo-cyan hover:bg-neo-cyan/20 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
