import type {
  ConnectedSource,
  DriveBufferUploadResult,
  IntentHandoffResult,
  MerlinShellPayload,
  MerlinThread,
  MerlinThreadMessage,
  ThreadAttachment
} from '../types';

const DEFAULT_WORKSPACE_ID = 'merlin-workspace-system';

// No session/cookie auth exists in the backend yet (see src/operatorIdentity.ts) —
// identity is read purely from these trusted headers, normally injected by a
// reverse proxy. Hardcoded here until a real auth flow exists.
const OPERATOR_HEADERS = {
  'x-operator-id': 'merlin-shell-operator',
  'x-operator-role': 'admin'
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...OPERATOR_HEADERS,
      ...init.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const reason = (body && (body.error || body.reason)) || response.statusText;
    throw new Error(`${path} failed: ${reason}`);
  }
  return body as T;
}

export function getWorkspaceId(): string {
  return DEFAULT_WORKSPACE_ID;
}

export function fetchShell(workspaceId: string = DEFAULT_WORKSPACE_ID): Promise<MerlinShellPayload> {
  return request(`/api/merlin/shell?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function connectSource(input: {
  workspace_id?: string;
  source_key: string;
  source_label: string;
  source_type: string;
  connection_status: 'connected' | 'needs_auth' | 'disconnected';
  auth_kind: 'oauth' | 'api_key' | 'manual' | 'internal';
  capabilities?: string[];
}): Promise<{ mutationAllowed: false; implementationAllowed: false; connectedSource: ConnectedSource }> {
  return request('/api/merlin/connected-sources', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: DEFAULT_WORKSPACE_ID, ...input })
  });
}

export function createThread(input: {
  workspace_id?: string;
  title?: string;
  brand?: string;
  actor_scope?: string;
  entity_type?: string;
  entity_id?: string;
  action_id?: string;
}): Promise<{ mutationAllowed: false; implementationAllowed: false; thread: MerlinThread }> {
  return request('/api/merlin/threads', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: DEFAULT_WORKSPACE_ID, ...input })
  });
}

export function fetchThread(
  threadId: string
): Promise<{ mutationAllowed: false; implementationAllowed: false; thread: MerlinThread; messages: MerlinThreadMessage[] }> {
  return request(`/api/merlin/threads/${encodeURIComponent(threadId)}`);
}

export function sendThreadMessage(
  threadId: string,
  input: { role?: 'user' | 'assistant' | 'system'; message_text?: string; attachments?: ThreadAttachment[] }
): Promise<{ mutationAllowed: false; implementationAllowed: false; message: MerlinThreadMessage }> {
  return request(`/api/merlin/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function requestIntentHandoff(
  threadId: string,
  input: {
    brand?: string;
    actorScope?: string;
    entityType?: string;
    actionId?: string;
    entityId?: string;
    userHint?: string;
  }
): Promise<IntentHandoffResult> {
  return request(`/api/merlin/threads/${encodeURIComponent(threadId)}/intent-handoff`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function uploadDriveBufferFiles(input: {
  parent_folder_id?: string;
  folder_label?: string;
  files: Array<{ fileName: string; mimeType: string; base64Content: string; textContent?: string }>;
}): Promise<DriveBufferUploadResult> {
  return request('/api/merlin/drive-buffer/upload', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}
