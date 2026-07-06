export type ConnectionStatus = 'connected' | 'needs_auth' | 'disconnected' | 'not_connected';

export type SourceCatalogEntry = {
  sourceKey: string;
  label: string;
  type: string;
  trustLevel: number;
  aliases: string[];
  connected: boolean;
  connectionStatus: ConnectionStatus;
  authKind?: 'oauth' | 'api_key' | 'manual' | 'internal';
  capabilities: string[];
};

export type ConnectedSource = {
  id: string;
  workspace_id: string;
  source_key: string;
  source_label: string;
  source_type: string;
  connection_status: ConnectionStatus;
  auth_kind: 'oauth' | 'api_key' | 'manual' | 'internal';
  capabilities: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SystemConnector = {
  id: string;
  sourceKey: string;
  brand: string;
  label: string;
  mode: string;
  readCapabilities: string[];
  stageCapabilities: string[];
  executeCapabilities: string[];
  blockers: string[];
};

export type ThreadStatus = 'open' | 'waiting_for_user' | 'ready_for_preview' | 'closed';

export type MerlinThread = {
  id: string;
  workspace_id: string;
  title: string;
  status: ThreadStatus;
  brand?: string;
  actor_scope?: string;
  entity_type?: string;
  entity_id?: string;
  action_id?: string;
  latest_upload_intent_id?: string;
  latest_preview_upload_intent_id?: string;
  created_at: string;
  updated_at: string;
};

export type ThreadAttachment = {
  fileId: string;
  fileName: string;
  mimeType: string;
  extractedText?: string;
  driveFolderId?: string;
  metadata?: Record<string, unknown>;
};

export type ThreadMessageRole = 'user' | 'assistant' | 'system';

export type MerlinThreadMessage = {
  id: string;
  thread_id: string;
  role: ThreadMessageRole;
  message_text?: string;
  attachments: ThreadAttachment[];
  metadata: Record<string, unknown>;
  linked_upload_intent_id?: string;
  created_at: string;
};

export type UploadIntentPreview = {
  sourceFiles: Array<{ fileId: string; [key: string]: unknown }>;
  detectedChanges: Record<string, unknown>;
  holdReasons: string[];
};

export type UploadIntent = {
  uploadId: string;
  actionId: string;
  preview: UploadIntentPreview;
  [key: string]: unknown;
};

export type InferredIntent = {
  brand?: string;
  actorScope?: string;
  entityType?: string;
  actionId?: string;
  userHint?: string;
  reasons: string[];
};

export type MerlinShellPayload = {
  status: string;
  mode: string;
  mutationAllowed: boolean;
  implementationAllowed: boolean;
  generatedAt: string;
  shell: {
    workspace?: { id: string; [key: string]: unknown };
    connectedSources: ConnectedSource[];
    sourceCatalog: SourceCatalogEntry[];
    connectors: SystemConnector[];
    threads: MerlinThread[];
    selectedThread?: { thread: MerlinThread; messages: MerlinThreadMessage[] };
    suggestedNextSteps: string[];
  };
  operator: { decidedBy: string; source: string };
  operatorRole: { role: string; source: string };
};

export type IntentHandoffResult = {
  mutationAllowed: false;
  implementationAllowed: false;
  thread: MerlinThread;
  uploadIntent: UploadIntent;
  message: MerlinThreadMessage;
  inferredIntent: InferredIntent;
};

export type UploadedDriveFile = {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  web_url: string;
  folder_id: string;
  folder_path: string;
  manifest_id: string;
  extracted_text_available: boolean;
};

export type DriveBufferUploadResult = {
  status: 'ok';
  mutationAllowed: false;
  implementationAllowed: false;
  driveBufferWritten: true;
  driveFolder: { id: string; path: string; parentFolderId: string };
  uploadedFiles: UploadedDriveFile[];
  threadAttachments: ThreadAttachment[];
};
