import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[SnapDeploy AI Error Boundary Caught]:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full bg-slate-950/90 border border-rose-500/30 rounded-xl p-6 flex flex-col items-center justify-center text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4 border border-rose-500/30">
            <AlertOctagon className="w-6 h-6" />
          </div>

          <h3 className="text-sm font-bold text-white">
            {this.props.fallbackTitle || 'Component Execution Interrupted'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            {this.state.error?.message || 'An unexpected sandbox runtime error occurred in this pane.'}
          </p>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Recover Component</span>
            </button>

            <button
              onClick={() => this.setState({ showDetails: !this.state.showDetails })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium transition"
            >
              <span>Stack Trace</span>
              {this.state.showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {this.state.showDetails && (
            <div className="mt-4 p-3 rounded-lg bg-slate-900 border border-slate-800 text-left font-mono text-[10px] text-rose-300 max-w-md w-full max-h-36 overflow-auto">
              <pre className="whitespace-pre-wrap">{this.state.error?.stack || 'No stack trace available'}</pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
