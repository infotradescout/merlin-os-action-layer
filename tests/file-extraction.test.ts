import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSupportedFile } from '../src/fileExtraction.ts';

test('text file extraction succeeds', () => {
  const result = extractSupportedFile({
    file_id: 'f-1',
    file_name: 'note.txt',
    mime_type: 'text/plain',
    content: 'hello merlin drive'
  });
  assert.equal(result.extraction_status, 'completed');
  assert.equal(result.extracted_text.includes('hello merlin drive'), true);
});

test('markdown extraction succeeds', () => {
  const result = extractSupportedFile({
    file_id: 'f-2',
    file_name: 'README.md',
    mime_type: 'text/markdown',
    content: '# Heading\nMerlin context'
  });
  assert.equal(result.extraction_status, 'completed');
  assert.equal(result.extracted_text.includes('Heading'), true);
});

test('JSON extraction succeeds and preserves fields', () => {
  const result = extractSupportedFile({
    file_id: 'f-3',
    file_name: 'payload.json',
    mime_type: 'application/json',
    content: '{"a":1,"b":"two"}'
  });
  assert.equal(result.extraction_status, 'completed');
  assert.equal(result.extracted_fields.json_type, 'object');
  assert.equal(result.extracted_fields.key_count, 2);
});

test('CSV extraction succeeds as text', () => {
  const result = extractSupportedFile({
    file_id: 'f-4',
    file_name: 'rows.csv',
    mime_type: 'text/csv',
    content: 'name,city\nAda,Hammond\n'
  });
  assert.equal(result.extraction_status, 'completed');
  assert.equal(result.extracted_fields.row_count, 1);
  assert.equal(result.extracted_text.includes('Ada'), true);
});

test('unsupported file returns metadata or unsupported', () => {
  const result = extractSupportedFile({
    file_id: 'f-5',
    file_name: 'image.png',
    mime_type: 'image/png'
  });
  assert.equal(result.extraction_status, 'unsupported');
});

test('pdf is metadata-only', () => {
  const result = extractSupportedFile({
    file_id: 'f-6',
    file_name: 'doc.pdf',
    mime_type: 'application/pdf'
  });
  assert.equal(result.extraction_status, 'metadata_only');
});
