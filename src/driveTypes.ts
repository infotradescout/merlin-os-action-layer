export type DriveProcessingStatus =
  | 'inbox'
  | 'pending'
  | 'processed'
  | 'needs_review'
  | 'archived'
  | 'unknown';

export type DriveSourceType = 'google_drive_file';

export interface DriveSourceMetadata {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_id: string;
  web_url: string;
  source_type: DriveSourceType;
}

export interface DriveFileRecord {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_id: string;
  folder_path: string;
  web_url: string;
  source_type: DriveSourceType;
  processing_status: DriveProcessingStatus;
  observed_at: string;
  processed_at?: string;
  extracted_summary?: string;
  extracted_fields?: Record<string, unknown>;
  confidence?: number;
  entity_id?: string;
}

export interface DriveRawFileInput {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_id: string;
  folder_path: string;
  web_url: string;
  entity_id?: string;
  observed_at?: string;
  extracted_summary?: string;
  extracted_fields?: Record<string, unknown>;
  confidence?: number;
}
