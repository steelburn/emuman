import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('emuman UI error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card card-pad" style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
            <div className="confirm-icon danger" style={{ margin: '0 auto 14px' }}>
              <AlertTriangle size={20} />
            </div>
            <h2 style={{ fontSize: 18 }}>Something went wrong in the console</h2>
            <p className="muted small mt-8" style={{ lineHeight: 1.6 }}>
              {this.state.error.message || 'An unexpected rendering error occurred.'}
            </p>
            <div className="flex gap-8" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="btn" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Reload emuman
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
