import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '@/utils/logger';

export interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

interface Props {
  children: ReactNode;
  /** What to render instead of the children after a crash. */
  fallback: (props: ErrorFallbackProps) => ReactNode;
  /** Label for the logs, so you can tell which boundary caught the error. */
  name?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in its subtree so one broken part of the page
 * doesn't blank the whole site. React still requires a class for this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(error, { boundary: this.props.name, componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    return error ? this.props.fallback({ error, reset: this.reset }) : this.props.children;
  }
}
