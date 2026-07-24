import { useRef, useState } from 'react';
import { uploadDriveBufferFiles } from './api/client';
import type { ThreadAttachment } from './types';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Composer(props: { onSend: (text: string, attachments: ThreadAttachment[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ThreadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const encoded = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Content: await readFileAsBase64(file)
        }))
      );
      const result = await uploadDriveBufferFiles({ files: encoded });
      setPendingAttachments((current) => [...current, ...result.threadAttachments]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSend(): Promise<void> {
    if (!text.trim() && pendingAttachments.length === 0) return;
    setSending(true);
    try {
      await props.onSend(text.trim(), pendingAttachments);
      setText('');
      setPendingAttachments([]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Describe what you want updated..."
        rows={3}
      />
      {pendingAttachments.length > 0 && (
        <ul className="composer-attachments">
          {pendingAttachments.map((attachment) => (
            <li key={attachment.fileId}>{attachment.fileName}</li>
          ))}
        </ul>
      )}
      <div className="composer-actions">
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} disabled={uploading} />
        <button type="button" onClick={handleSend} disabled={sending || uploading}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
