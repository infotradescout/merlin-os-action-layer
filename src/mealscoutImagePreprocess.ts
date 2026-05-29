export type MealScoutPreprocessResult = {
  ok: boolean;
  mimeType: string;
  fileExtension: string;
  imageBytes?: Buffer;
  safeError?: 'IMAGE_PREPROCESS_FAILED' | 'UNSUPPORTED_IMAGE_MIME_TYPE';
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff'
]);

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/bmp':
      return '.bmp';
    case 'image/gif':
      return '.gif';
    case 'image/tiff':
      return '.tiff';
    default:
      return '.img';
  }
}

export function preprocessImageForMealScoutOcr(input: { bytes: Buffer; mimeType: string }): MealScoutPreprocessResult {
  const mimeType = input.mimeType.toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      mimeType,
      fileExtension: '',
      safeError: 'UNSUPPORTED_IMAGE_MIME_TYPE'
    };
  }
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    return {
      ok: false,
      mimeType,
      fileExtension: extensionFromMimeType(mimeType),
      safeError: 'IMAGE_PREPROCESS_FAILED'
    };
  }
  return {
    ok: true,
    mimeType,
    fileExtension: extensionFromMimeType(mimeType),
    imageBytes: input.bytes
  };
}

