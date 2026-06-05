import { randomUUID } from 'node:crypto';
import type { PreviewPacket, RoutingDecision, UploadIntent, UploadIntentFileRef } from './intakeTypes.js';

const store = new Map<string, UploadIntent>();
const nowIso = () => new Date().toISOString();

export function createUploadIntentRecord(input: Omit<UploadIntent, 'uploadId' | 'files' | 'routing' | 'preview' | 'status' | 'implementationAllowed' | 'mutationAllowed' | 'previewRequired' | 'approvalRequired' | 'createdAt' | 'updatedAt'>): UploadIntent {
  const createdAt = nowIso();
  const record: UploadIntent = {
    ...input,
    uploadId: `merlin-upload-${randomUUID()}`,
    files: [],
    routing: [],
    status: 'CREATED',
    implementationAllowed: false,
    mutationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt,
    updatedAt: createdAt
  };
  store.set(record.uploadId, record);
  return record;
}

export function getUploadIntentRecord(uploadId: string): UploadIntent | undefined {
  return store.get(uploadId);
}

export function attachFilesToUploadIntent(uploadId: string, files: UploadIntentFileRef[]): UploadIntent | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const nextFiles = [...current.files];
  for (const file of files) {
    const idx = nextFiles.findIndex((f) => f.fileId === file.fileId);
    if (idx >= 0) nextFiles[idx] = { ...nextFiles[idx], ...file };
    else nextFiles.push(file);
  }
  const next: UploadIntent = { ...current, files: nextFiles, status: 'FILES_ATTACHED', updatedAt: nowIso() };
  store.set(uploadId, next);
  return next;
}

export function setUploadIntentRouting(uploadId: string, routing: RoutingDecision[]): UploadIntent | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const status = routing.some((row) => row.routedType === 'held') ? 'HELD_FOR_REVIEW' : 'ROUTED';
  const next: UploadIntent = { ...current, routing, status, updatedAt: nowIso() };
  store.set(uploadId, next);
  return next;
}

export function setUploadIntentPreview(uploadId: string, preview: PreviewPacket): UploadIntent | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const status = preview.holdReasons.length > 0 ? 'HELD_FOR_REVIEW' : 'PREVIEW_READY';
  const next: UploadIntent = { ...current, preview, status, updatedAt: nowIso() };
  store.set(uploadId, next);
  return next;
}

export function resetUploadIntentStoreForTest(): void {
  store.clear();
}
