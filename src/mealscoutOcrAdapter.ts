import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectMealScoutOcrEngines, type MealScoutOcrEngineCandidate } from './mealscoutOcrEngines.js';
import { preprocessImageForMealScoutOcr } from './mealscoutImagePreprocess.js';

export type MealScoutOcrSafeError =
  | 'TESSERACT_NOT_FOUND'
  | 'PYTHON_NOT_FOUND'
  | 'PADDLEOCR_NOT_INSTALLED'
  | 'EASYOCR_NOT_INSTALLED'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'PDF_OCR_NOT_SUPPORTED_YET'
  | 'FILE_BYTES_EMPTY'
  | 'DRIVE_DOWNLOAD_NOT_IMPLEMENTED'
  | 'IMAGE_PREPROCESS_FAILED'
  | 'OCR_EMPTY_TEXT'
  | 'OCR_PROCESS_FAILED';

export type MealScoutOcrAdapterResult = {
  fileId: string;
  name: string;
  mimeType: string;
  byteLength: number;
  downloadAttempted: boolean;
  downloadSucceeded: boolean;
  downloadError?: 'FILE_BYTES_EMPTY' | 'DRIVE_DOWNLOAD_NOT_IMPLEMENTED' | 'OCR_PROCESS_FAILED';
  downloadSource: string;
  detectedEngineCandidates: MealScoutOcrEngineCandidate[];
  selectedEngine: 'tesseract' | 'paddleocr' | 'easyocr' | 'none';
  engine: 'local_tesseract_cli' | 'none';
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  extractedText: string;
  extractedTextLength: number;
  safeError?: MealScoutOcrSafeError;
};

type ExecuteOcrFn = (params: { imageBytes: Buffer; fileExtension: string; tesseractBinary: string }) => string;
type DownloadBytesFn = () => Promise<Buffer | undefined>;

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function defaultExecuteTesseractOcr(params: { imageBytes: Buffer; fileExtension: string; tesseractBinary: string }): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'mealscout-ocr-'));
  const inputPath = join(tempDir, `input${params.fileExtension}`);
  try {
    writeFileSync(inputPath, params.imageBytes);
    const output = execFileSync(params.tesseractBinary, [inputPath, 'stdout', '-l', 'eng'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return output;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function runMealScoutLocalOcr(params: {
  fileId: string;
  name: string;
  mimeType: string;
  downloadBytes: DownloadBytesFn;
  detectEngines?: typeof detectMealScoutOcrEngines;
  executeOcr?: ExecuteOcrFn;
}): Promise<MealScoutOcrAdapterResult> {
  const detectEngines = params.detectEngines || detectMealScoutOcrEngines;
  const executeOcr = params.executeOcr || defaultExecuteTesseractOcr;
  const engineDetection = detectEngines();

  const base: MealScoutOcrAdapterResult = {
    fileId: params.fileId,
    name: params.name,
    mimeType: params.mimeType,
    byteLength: 0,
    downloadAttempted: false,
    downloadSucceeded: false,
    downloadSource: 'drive_binary_download',
    detectedEngineCandidates: engineDetection.candidates,
    selectedEngine: engineDetection.selectedEngine,
    engine: 'none',
    ocrAttempted: false,
    ocrSucceeded: false,
    extractedText: '',
    extractedTextLength: 0
  };

  if (isPdfMimeType(params.mimeType)) {
    return { ...base, safeError: 'PDF_OCR_NOT_SUPPORTED_YET' };
  }
  if (!isImageMimeType(params.mimeType)) {
    return { ...base, safeError: 'UNSUPPORTED_MIME_TYPE' };
  }

  let bytes: Buffer | undefined;
  try {
    bytes = await params.downloadBytes();
  } catch {
    return {
      ...base,
      downloadAttempted: true,
      downloadSucceeded: false,
      downloadError: 'OCR_PROCESS_FAILED',
      safeError: 'OCR_PROCESS_FAILED'
    };
  }
  if (!bytes || bytes.length <= 0) {
    return {
      ...base,
      downloadAttempted: true,
      downloadSucceeded: false,
      byteLength: bytes?.length || 0,
      downloadError: !bytes ? 'DRIVE_DOWNLOAD_NOT_IMPLEMENTED' : 'FILE_BYTES_EMPTY',
      safeError: 'FILE_BYTES_EMPTY'
    };
  }

  const tesseractBinary = engineDetection.tesseractBinary;
  if (!tesseractBinary || engineDetection.selectedEngine !== 'tesseract') {
    const tesseractStatus = engineDetection.candidates.find((candidate) => candidate.engine === 'tesseract')?.status;
    if (tesseractStatus === 'TESSERACT_NOT_FOUND')
      return { ...base, byteLength: bytes.length, downloadAttempted: true, downloadSucceeded: true, safeError: 'TESSERACT_NOT_FOUND' };
    const paddleStatus = engineDetection.candidates.find((candidate) => candidate.engine === 'paddleocr')?.status;
    if (paddleStatus === 'PYTHON_NOT_FOUND')
      return { ...base, byteLength: bytes.length, downloadAttempted: true, downloadSucceeded: true, safeError: 'PYTHON_NOT_FOUND' };
    if (paddleStatus === 'PADDLEOCR_NOT_INSTALLED')
      return { ...base, byteLength: bytes.length, downloadAttempted: true, downloadSucceeded: true, safeError: 'PADDLEOCR_NOT_INSTALLED' };
    const easyStatus = engineDetection.candidates.find((candidate) => candidate.engine === 'easyocr')?.status;
    if (easyStatus === 'EASYOCR_NOT_INSTALLED')
      return { ...base, byteLength: bytes.length, downloadAttempted: true, downloadSucceeded: true, safeError: 'EASYOCR_NOT_INSTALLED' };
    return { ...base, byteLength: bytes.length, downloadAttempted: true, downloadSucceeded: true, safeError: 'OCR_PROCESS_FAILED' };
  }

  const byteLength = bytes.length;
  const preprocessed = preprocessImageForMealScoutOcr({ bytes, mimeType: params.mimeType });
  if (!preprocessed.ok || !preprocessed.imageBytes) {
    return {
      ...base,
      byteLength,
      downloadAttempted: true,
      downloadSucceeded: true,
      selectedEngine: 'tesseract',
      engine: 'local_tesseract_cli',
      safeError: preprocessed.safeError === 'UNSUPPORTED_IMAGE_MIME_TYPE' ? 'UNSUPPORTED_MIME_TYPE' : 'IMAGE_PREPROCESS_FAILED'
    };
  }

  try {
    const rawText = executeOcr({
      imageBytes: preprocessed.imageBytes,
      fileExtension: preprocessed.fileExtension,
      tesseractBinary
    });
    const extractedText = (rawText || '').trim();
    if (!extractedText) {
      return {
        ...base,
        byteLength,
        downloadAttempted: true,
        downloadSucceeded: true,
        selectedEngine: 'tesseract',
        engine: 'local_tesseract_cli',
        ocrAttempted: true,
        safeError: 'OCR_EMPTY_TEXT'
      };
    }
    return {
      ...base,
      byteLength,
      downloadAttempted: true,
      downloadSucceeded: true,
      selectedEngine: 'tesseract',
      engine: 'local_tesseract_cli',
      ocrAttempted: true,
      ocrSucceeded: true,
      extractedText,
      extractedTextLength: extractedText.length
    };
  } catch {
    return {
      ...base,
      byteLength,
      downloadAttempted: true,
      downloadSucceeded: true,
      selectedEngine: 'tesseract',
      engine: 'local_tesseract_cli',
      ocrAttempted: true,
      safeError: 'OCR_PROCESS_FAILED'
    };
  }
}
