import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMealScoutLocalOcr } from '../src/mealscoutOcrAdapter.ts';

test('adapter returns safe error when local tesseract is unavailable', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-1',
    name: 'truck.png',
    mimeType: 'image/png',
    downloadBytes: async () => Buffer.from('abc'),
    detectEngines: () => ({
      candidates: [
        { engine: 'tesseract', status: 'TESSERACT_NOT_FOUND' },
        { engine: 'paddleocr', status: 'PYTHON_NOT_FOUND' },
        { engine: 'easyocr', status: 'PYTHON_NOT_FOUND' }
      ],
      selectedEngine: 'none'
    })
  });

  assert.equal(result.ocrAttempted, false);
  assert.equal(result.ocrSucceeded, false);
  assert.equal(result.downloadAttempted, true);
  assert.equal(result.downloadSucceeded, true);
  assert.equal(result.safeError, 'TESSERACT_NOT_FOUND');
  assert.equal(result.extractedTextLength, 0);
});

test('adapter returns unsupported mime error', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-2',
    name: 'truck.txt',
    mimeType: 'text/plain',
    downloadBytes: async () => Buffer.from('not-image'),
    detectEngines: () => ({
      candidates: [{ engine: 'tesseract', status: 'AVAILABLE' }],
      selectedEngine: 'tesseract',
      tesseractBinary: 'tesseract'
    })
  });

  assert.equal(result.ocrAttempted, false);
  assert.equal(result.safeError, 'UNSUPPORTED_MIME_TYPE');
});

test('adapter returns PDF not supported error', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-3',
    name: 'truck.pdf',
    mimeType: 'application/pdf',
    downloadBytes: async () => Buffer.from('pdf'),
    detectEngines: () => ({
      candidates: [{ engine: 'tesseract', status: 'AVAILABLE' }],
      selectedEngine: 'tesseract',
      tesseractBinary: 'tesseract'
    })
  });

  assert.equal(result.ocrAttempted, false);
  assert.equal(result.safeError, 'PDF_OCR_NOT_SUPPORTED_YET');
});

test('adapter returns empty OCR error when engine output is blank', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-4',
    name: 'truck.png',
    mimeType: 'image/png',
    downloadBytes: async () => Buffer.from([1, 2, 3, 4]),
    detectEngines: () => ({
      candidates: [{ engine: 'tesseract', status: 'AVAILABLE' }],
      selectedEngine: 'tesseract',
      tesseractBinary: 'tesseract'
    }),
    executeOcr: () => '   '
  });

  assert.equal(result.ocrAttempted, true);
  assert.equal(result.ocrSucceeded, false);
  assert.equal(result.safeError, 'OCR_EMPTY_TEXT');
});

test('adapter reports FILE_BYTES_EMPTY before engine errors when bytes are missing', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-5',
    name: 'truck.png',
    mimeType: 'image/png',
    downloadBytes: async () => undefined,
    detectEngines: () => ({
      candidates: [{ engine: 'tesseract', status: 'TESSERACT_NOT_FOUND' }],
      selectedEngine: 'none'
    })
  });

  assert.equal(result.downloadAttempted, true);
  assert.equal(result.downloadSucceeded, false);
  assert.equal(result.downloadError, 'DRIVE_DOWNLOAD_NOT_IMPLEMENTED');
  assert.equal(result.safeError, 'FILE_BYTES_EMPTY');
});

test('adapter selects tesseract and marks OCR attempted when engine is available', async () => {
  const result = await runMealScoutLocalOcr({
    fileId: 'file-6',
    name: 'truck.png',
    mimeType: 'image/png',
    downloadBytes: async () => Buffer.from([1, 2, 3, 4]),
    detectEngines: () => ({
      candidates: [{ engine: 'tesseract', status: 'AVAILABLE' }],
      selectedEngine: 'tesseract',
      tesseractBinary: 'tesseract'
    }),
    executeOcr: () => 'Food Truck Name'
  });

  assert.equal(result.selectedEngine, 'tesseract');
  assert.equal(result.ocrAttempted, true);
  assert.equal(result.ocrSucceeded, true);
  assert.equal(result.extractedTextLength > 0, true);
});
