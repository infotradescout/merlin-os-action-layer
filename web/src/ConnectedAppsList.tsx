import { useState } from 'react';
import { connectSource } from './api/client';
import type { SourceCatalogEntry } from './types';

const STATUS_LABEL: Record<SourceCatalogEntry['connectionStatus'], string> = {
  connected: 'Connected',
  needs_auth: 'Needs re-auth',
  disconnected: 'Disconnected',
  not_connected: 'Not connected'
};

// GitHub is the only source with a real OAuth handshake today — connecting it means
// leaving the SPA for GitHub's consent screen, not a same-page status flip like the
// other manually-tracked sources below.
const OAUTH_SOURCE_KEYS = new Set(['github']);

export default function ConnectedAppsList(props: {
  sourceCatalog: SourceCatalogEntry[];
  workspaceId: string;
  onSelectApp: (app: SourceCatalogEntry) => void;
  onConnected: () => void;
}) {
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  function handleOAuthConnect(): void {
    window.location.href = `/api/merlin/connected-sources/github/authorize?workspace_id=${encodeURIComponent(props.workspaceId)}`;
  }

  async function handleConnect(app: SourceCatalogEntry): Promise<void> {
    if (OAUTH_SOURCE_KEYS.has(app.sourceKey)) {
      handleOAuthConnect();
      return;
    }
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
          {app.connectionStatus === 'not_connected' && !OAUTH_SOURCE_KEYS.has(app.sourceKey) && (
            <p className="app-card-note">Marks this app as connected in Merlin. No live account sign-in happens yet.</p>
          )}
          {app.connectionStatus === 'not_connected' && OAUTH_SOURCE_KEYS.has(app.sourceKey) && (
            <p className="app-card-note">Opens GitHub's sign-in page to authorize Merlin.</p>
          )}
          {app.connectionStatus === 'connected' && app.sourceKey === 'github' && (
            <p className="app-card-note">Connected via GitHub OAuth.</p>
          )}
        </article>
      ))}
      {props.sourceCatalog.length === 0 && <p className="empty-state">No apps registered yet.</p>}
    </section>
  );
}
