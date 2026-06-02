const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function cleanFolderSegment(segment: string): string {
  return segment
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/%40/gi, '@')
    .trim();
}

export function extractNearestAffiliateEmailFolder(input: {
  folderPath?: string;
  drivePath?: string;
  fileName?: string;
}): string | undefined {
  const rawPath = (input.folderPath || input.drivePath || '').trim();
  if (!rawPath) return undefined;
  const parts = rawPath
    .split(/[\\/]+/)
    .map(cleanFolderSegment)
    .filter(Boolean);
  if (input.fileName && parts[parts.length - 1]?.toLowerCase() === input.fileName.trim().toLowerCase()) {
    parts.pop();
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const segment = parts[index];
    if (EMAIL_PATTERN.test(segment)) return segment.toLowerCase();
  }
  return undefined;
}
