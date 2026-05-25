export type FileExtractionStatus =
  | 'completed'
  | 'metadata_only'
  | 'unsupported'
  | 'failed';

export interface FileExtractionResult {
  file_id: string;
  file_name: string;
  mime_type: string;
  extracted_text: string;
  extracted_fields: Record<string, unknown>;
  extraction_status: FileExtractionStatus;
  extraction_error?: string;
  extracted_at: string;
}

export interface FileExtractionInput {
  file_id: string;
  file_name: string;
  mime_type: string;
  content?: string;
}

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv'
]);

function toNow(): string {
  return new Date().toISOString();
}

function truncateText(value: string, max = 20000): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function metadataOnly(input: FileExtractionInput, reason: string): FileExtractionResult {
  return {
    file_id: input.file_id,
    file_name: input.file_name,
    mime_type: input.mime_type,
    extracted_text: '',
    extracted_fields: {
      mode: 'metadata_only',
      reason
    },
    extraction_status: 'metadata_only',
    extracted_at: toNow()
  };
}

function unsupported(input: FileExtractionInput, reason: string): FileExtractionResult {
  return {
    file_id: input.file_id,
    file_name: input.file_name,
    mime_type: input.mime_type,
    extracted_text: '',
    extracted_fields: {
      mode: 'unsupported',
      reason
    },
    extraction_status: 'unsupported',
    extracted_at: toNow()
  };
}

function parseJsonContent(content: string): { text: string; fields: Record<string, unknown> } {
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) {
    return {
      text: truncateText(content),
      fields: {
        json_type: 'array',
        item_count: parsed.length
      }
    };
  }
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    return {
      text: truncateText(content),
      fields: {
        json_type: 'object',
        keys,
        key_count: keys.length
      }
    };
  }
  return {
    text: truncateText(content),
    fields: {
      json_type: typeof parsed
    }
  };
}

function parseCsvContent(content: string): { text: string; fields: Record<string, unknown> } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0] || '';
  const columns = header ? header.split(',').map((entry) => entry.trim()) : [];
  return {
    text: truncateText(content),
    fields: {
      row_count: Math.max(0, lines.length - 1),
      column_count: columns.length,
      columns
    }
  };
}

export function extractSupportedFile(input: FileExtractionInput): FileExtractionResult {
  const mimeType = input.mime_type.toLowerCase();
  const content = input.content || '';
  const extension = input.file_name.includes('.') ? input.file_name.split('.').pop()?.toLowerCase() : '';
  const isPdf = mimeType === 'application/pdf' || extension === 'pdf';

  if (isPdf) {
    return metadataOnly(input, 'pdf_metadata_only');
  }

  if (!TEXT_MIME_TYPES.has(mimeType)) {
    if (['txt', 'md', 'json', 'csv'].includes(extension || '')) {
      // Extension fallback for files with generic mime type.
    } else {
      return unsupported(input, 'unsupported_mime_type');
    }
  }

  if (!content) {
    return {
      file_id: input.file_id,
      file_name: input.file_name,
      mime_type: input.mime_type,
      extracted_text: '',
      extracted_fields: {},
      extraction_status: 'failed',
      extraction_error: 'empty_content',
      extracted_at: toNow()
    };
  }

  try {
    if (mimeType === 'application/json' || extension === 'json') {
      const parsed = parseJsonContent(content);
      return {
        file_id: input.file_id,
        file_name: input.file_name,
        mime_type: input.mime_type,
        extracted_text: parsed.text,
        extracted_fields: parsed.fields,
        extraction_status: 'completed',
        extracted_at: toNow()
      };
    }

    if (mimeType === 'text/csv' || extension === 'csv') {
      const parsed = parseCsvContent(content);
      return {
        file_id: input.file_id,
        file_name: input.file_name,
        mime_type: input.mime_type,
        extracted_text: parsed.text,
        extracted_fields: parsed.fields,
        extraction_status: 'completed',
        extracted_at: toNow()
      };
    }

    return {
      file_id: input.file_id,
      file_name: input.file_name,
      mime_type: input.mime_type,
      extracted_text: truncateText(content),
      extracted_fields: {
        char_count: content.length
      },
      extraction_status: 'completed',
      extracted_at: toNow()
    };
  } catch (error) {
    return {
      file_id: input.file_id,
      file_name: input.file_name,
      mime_type: input.mime_type,
      extracted_text: '',
      extracted_fields: {},
      extraction_status: 'failed',
      extraction_error: error instanceof Error ? error.message : 'extraction_failed',
      extracted_at: toNow()
    };
  }
}
