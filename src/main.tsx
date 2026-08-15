import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initLocale } from "./i18n";

initLocale();

class DeskErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Grok Desk UI crashed", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="desk-crash">
          <h1>界面出错，但应用还在</h1>
          <p>{this.state.message}</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeskErrorBoundary>
      <App />
    </DeskErrorBoundary>
  </StrictMode>,
);
