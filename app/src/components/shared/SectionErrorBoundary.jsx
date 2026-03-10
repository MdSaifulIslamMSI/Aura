import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from '@/services/clientObservability';

/**
 * SectionErrorBoundary — lightweight inline error isolation.
 *
 * Unlike AppErrorBoundary (which renders a full-page fallback),
 * this renders a compact card that lets the rest of the page remain
 * visible. Wraps individual sections (reviews, compatibility, etc.)
 * so a crash in one section doesn't cascade to the whole page.
 *
 * Usage:
 *   <SectionErrorBoundary label="Customer Reviews">
 *     <ReviewsSection />
 *   </SectionErrorBoundary>
 */
class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    reportClientError(error, {
      source: 'react.section_error_boundary',
      section: this.props.label || 'unknown',
      componentStack: errorInfo?.componentStack || '',
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const label = this.props.label || 'This section';

    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-5 py-4 flex items-start gap-4"
      >
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black uppercase tracking-widest text-amber-200">
            {label} failed to load
          </p>
          <p className="mt-1 text-xs text-amber-100/70">
            An unexpected error occurred in this section. The rest of the page is working normally.
          </p>
        </div>
        <button
          type="button"
          onClick={this.handleRetry}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }
}

export default SectionErrorBoundary;
