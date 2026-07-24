import { useState } from 'react';
import { connectSource } from './api/client';
import type { SourceCatalogEntry } from './types';

const STATUS_LABEL: Record<SourceCatalogEntry['connectionStatus'], string> = {
  connected: 'Connected',
  needs_auth: 'Needs re-auth',
  disconnected: 'Disconnected',
  not_connected: 'Not connected'
};

export default function ConnectedAppsList(props: {
  sourceCatalog: SourceCatalogEntry[];
  onSelectApp: (app: SourceCatalogEntry) => void;
  onConnected: () => void;
}) {
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  async function handleConnect(app: SourceCatalogEntry): Promise<void> {
    setConnectingKey(app.sourceKey);
    try {
      await connectSource({
        source_key: app.sourceKey,
        source_label: app.label,
        source_type: app.type,
        connection_status: 'connected',
        auth_kind: app.authKind || 'manual',
        capabilities: app.capabilities
      });
      props.onConnected();
    } finally {
      setConnectingKey(null);
    }
  }

  return (
    <section className="apps-grid" aria-label="Connected apps">
      {props.sourceCatalog.map((app) => (
        <article key={app.sourceKey} className={`app-card status-${app.connectionStatus}`}>
          <div className="app-card-head">
            <h2>{app.label}</h2>
            <span className="app-status-pill">{STATUS_LABEL[app.connectionStatus]}</span>
          </div>
          {app.capabilities.length > 0 && (
            <ul className="app-capabilities">
              {app.capabilities.slice(0, 3).map((capability) => (
                <li key={capability}>{capability.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          )}
          <div className="app-card-actions">
            {app.connectionStatus === 'connected' || app.connectionStatus === 'needs_auth' ? (
              <button type="button" onClick={() => props.onSelectApp(app)}>
                Open
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled={connectingKey === app.sourceKey}
                onClick={() => handleConnect(app)}
              >
                {connectingKey === app.sourceKey ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>
          {app.connectionStatus === 'not_connected' && (
            <p className="app-card-note">Marks this app as connected in Merlin. No live account sign-in happens yet.</p>
          )}
        </article>
      ))}
      {props.sourceCatalog.length === 0 && <p className="empty-state">No apps registered yet.</p>}
    </section>
  );
}
