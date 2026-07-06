import { useCallback, useEffect, useState } from 'react';
import { fetchShell, getWorkspaceId } from './api/client';
import type { MerlinShellPayload, SourceCatalogEntry } from './types';
import ConnectedAppsList from './ConnectedAppsList';
import AppWorkspacePanel from './AppWorkspacePanel';

export default function App() {
  const [shell, setShell] = useState<MerlinShellPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<SourceCatalogEntry | null>(null);

  const loadShell = useCallback(() => {
    setLoadError(null);
    fetchShell(getWorkspaceId())
      .then(setShell)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load Merlin shell'));
  }, []);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

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
