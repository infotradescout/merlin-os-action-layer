import { useCallback, useEffect, useState } from 'react';
import { fetchShell, getWorkspaceId } from './api/client';
import type { MerlinShellPayload, SourceCatalogEntry } from './types';
import ConnectedAppsList from './ConnectedAppsList';
import AppWorkspacePanel from './AppWorkspacePanel';

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  github_not_configured: 'GitHub connect is not configured on this server yet.',
  invalid_state: 'That GitHub sign-in link expired or was already used. Try connecting again.',
  github_denied: 'GitHub sign-in was cancelled.',
  github_oauth_failed: 'GitHub sign-in failed. Try connecting again.'
};

export default function App() {
  const [shell, setShell] = useState<MerlinShellPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<SourceCatalogEntry | null>(null);
  const [connectNotice, setConnectNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadShell = useCallback(() => {
    setLoadError(null);
    fetchShell(getWorkspaceId())
      .then(setShell)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load Merlin shell'));
  }, []);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connect_error');
    if (connected) {
      setConnectNotice({ kind: 'success', text: `Connected ${connected}.` });
    } else if (connectError) {
      setConnectNotice({ kind: 'error', text: CONNECT_ERROR_MESSAGES[connectError] || 'Connecting that app failed.' });
    }
    if (connected || connectError) {
      params.delete('connected');
      params.delete('connect_error');
      const nextSearch = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
    }
  }, []);

  const brandForSourceKey = (sourceKey: string): string | undefined =>
    shell?.shell.connectors.find((connector) => connector.sourceKey === sourceKey)?.brand;

  return (
    <div className="page">
      <header className="topbar">
        <div className="app-title">
          <h1>Merlin</h1>
          <span className="subtitle">Connected apps &amp; requests</span>
        </div>
      </header>

      <div className="staging-banner">
        Staging mode: Merlin previews and stages changes here. Nothing is applied to a connected app automatically.
      </div>

      {connectNotice && (
        <div className={connectNotice.kind === 'success' ? 'success-banner' : 'error-banner'}>
          {connectNotice.text}{' '}
          <button type="button" className="secondary" onClick={() => setConnectNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loadError && (
        <div className="error-banner">
          Couldn&apos;t load Merlin: {loadError}{' '}
          <button type="button" onClick={loadShell}>
            Retry
          </button>
        </div>
      )}

      {!shell && !loadError && <div className="loading-state">Loading Merlin...</div>}

      {shell && (
        <ConnectedAppsList
          sourceCatalog={shell.shell.sourceCatalog}
          workspaceId={getWorkspaceId()}
          onSelectApp={(app) => setActiveApp(app)}
          onConnected={loadShell}
        />
      )}

      {activeApp && shell && (
        <AppWorkspacePanel
          app={activeApp}
          brand={brandForSourceKey(activeApp.sourceKey)}
          existingThreads={shell.shell.threads}
          onClose={() => setActiveApp(null)}
        />
      )}
    </div>
  );
}
