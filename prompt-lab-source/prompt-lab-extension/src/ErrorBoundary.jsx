import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[PromptLab] Uncaught error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', padding: '2rem', fontFamily: 'system-ui, sans-serif',
        background: '#0f172a', color: '#e2e8f0', textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Something went wrong</div>
        <p style={{ color: '#94a3b8', maxWidth: '360px', lineHeight: 1.5, marginBottom: '1.5rem' }}>
          Prompt Lab hit an unexpected error. Your data is safe in local storage.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              padding: '0.5rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer',
              background: '#7c3aed', color: '#fff', fontWeight: 600, fontSize: '0.875rem',
            }}
          >
            Reload panel
          </button>
          <a
            href="https://github.com/daverobertson63/prompt-lab/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.5rem 1.25rem', borderRadius: '0.5rem', border: '1px solid #334155',
              background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: '0.875rem',
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
            }}
          >
            Report issue
          </a>
        </div>
        <details style={{ marginTop: '1.5rem', color: '#64748b', fontSize: '0.75rem', maxWidth: '360px', textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer' }}>Error details</summary>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: '0.5rem' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
        </details>
      </div>
    );
  }
}
