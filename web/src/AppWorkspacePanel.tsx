import { useEffect, useState } from 'react';
import { createThread, fetchThread, requestIntentHandoff, sendThreadMessage } from './api/client';
import type { MerlinThread, MerlinThreadMessage, SourceCatalogEntry, ThreadAttachment, UploadIntentPreview } from './types';
import MessageTimeline from './MessageTimeline';
import Composer from './Composer';

export default function AppWorkspacePanel(props: {
  app: SourceCatalogEntry;
  brand?: string;
  existingThreads: MerlinThread[];
  onClose: () => void;
}) {
  const [thread, setThread] = useState<MerlinThread | null>(null);
  const [messages, setMessages] = useState<MerlinThreadMessage[]>([]);
  const [preview, setPreview] = useState<UploadIntentPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparingPreview, setPreparingPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function openWorkspace(): Promise<void> {
      setLoading(true);
      setError(null);
      setPreview(null);
      try {
        const resumable = props.existingThreads.find(
          (candidate) => candidate.brand === props.brand && candidate.status !== 'closed'
        );

        if (resumable) {
          const result = await fetchThread(resumable.id);
          if (cancelled) return;
          setThread(result.thread);
          setMessages(result.messages);
        } else {
          const result = await createThread({
            title: `${props.app.label} request`,
            brand: props.brand
          });
          if (cancelled) return;
          setThread(result.thread);
          setMessages([]);
        }
      } catch (openError) {
        if (!cancelled) {
          setError(openError instanceof Error ? openError.message : 'Failed to open workspace');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    openWorkspace();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.app.sourceKey]);

  async function handleSend(text: string, attachments: ThreadAttachment[]): Promise<void> {
    if (!thread) return;
    const result = await sendThreadMessage(thread.id, { role: 'user', message_text: text, attachments });
    setMessages((current) => [...current, result.message]);
  }

  async function handlePreparePreview(): Promise<void> {
    if (!thread) return;
    setPreparingPreview(true);
    setError(null);
    try {
      const result = await requestIntentHandoff(thread.id, { brand: props.brand });
      setThread(result.thread);
      setMessages((current) => [...current, result.message]);
      setPreview(result.uploadIntent.preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to prepare preview');
    } finally {
      setPreparingPreview(false);
    }
  }

  return (
    <div className="workspace-overlay" role="dialog" aria-modal="true" aria-label={`${props.app.label} workspace`}>
      <div className="workspace-panel">
        <header className="workspace-panel-head">
          <h2>{props.app.label}</h2>
          <button type="button" className="secondary" onClick={props.onClose} aria-label="Close">
            Close
          </button>
        </header>

        {loading && <div className="loading-state">Opening {props.app.label}...</div>}
        {error && <div className="error-banner">{error}</div>}

        {!loading && thread && (
          <>
            <MessageTimeline messages={messages} />
            <Composer onSend={handleSend} />
            <div className="workspace-panel-actions">
              <button type="button" onClick={handlePreparePreview} disabled={preparingPreview || messages.length === 0}>
                {preparingPreview ? 'Preparing preview...' : 'Prepare preview'}
              </button>
            </div>
            {preview && (
              <section className="preview-panel" aria-label="Staged preview">
                <h3>Staged preview</h3>
                {preview.holdReasons.length > 0 && (
                  <p className="preview-hold">Held for review: {preview.holdReasons.join(', ')}</p>
                )}
                <pre className="preview-json">{JSON.stringify(preview.detectedChanges, null, 2)}</pre>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
