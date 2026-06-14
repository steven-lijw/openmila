import { Component, type ErrorInfo, type ReactNode } from "react";

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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // If the children reference changed (e.g. the app re-rendered with new
    // content after the error), clear the error state so we try rendering
    // the new children instead of staying stuck on the error screen until
    // a full page reload.
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell">
          <main className="app-main" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
            <div className="empty-state">
              <p>Something went wrong while loading the app.</p>
              <p style={{ fontSize: "13px", color: "#888", marginTop: "8px" }}>
                {this.state.error?.message}
              </p>
              <div style={{ marginTop: "16px", display: "flex", gap: "8px", justifyContent: "center" }}>
                <button type="button" onClick={this.reset}>Try again</button>
                <button type="button" onClick={() => window.location.reload()}>Reload</button>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
