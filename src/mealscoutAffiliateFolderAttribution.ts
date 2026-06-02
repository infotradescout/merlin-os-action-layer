export type AffiliateFolderAttribution = {
  affiliate_attribution_email?: string;
  affiliate_attribution_source?: 'email_named_parent_folder';
  affiliate_attribution_folder?: string;
  affiliate_attribution_folder_path?: string;
  affiliate_attribution_warnings?: string[];
};

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function cleanFolderSegment(segment: string): string {
  return segment
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/%40/gi, '@')
    .trim();
}

export function resolveAffiliateFolderAttributionFromPath(input: {
  folderPath?: string;
  drivePath?: string;
  fileName?: string;
}): AffiliateFolderAttribution {
  const rawPath = (input.folderPath || input.drivePath || '').trim();
  if (!rawPath) return {};
  const parts = rawPath
    .split(/[\\/]+/)
    .map(cleanFolderSegment)
    .filter(Boolean);
  if (input.fileName && parts[parts.length - 1]?.toLowerCase() === input.fileName.trim().toLowerCase()) {
    parts.pop();
  }
  const validEmailFolders: Array<{ email: string; folder: string; index: number }> = [];
  const warnings: string[] = [];
  parts.forEach((part, index) => {
    if (!part.includes('@')) return;
    if (EMAIL_PATTERN.test(part)) {
      validEmailFolders.push({ email: part.toLowerCase(), folder: part, index });
    } else {
      warnings.push('invalid_email_named_parent_folder');
    }
  });
  if (validEmailFolders.length === 0) {
    return warnings.length > 0 ? { affiliate_attribution_warnings: Array.from(new Set(warnings)) } : {};
  }
  if (validEmailFolders.length > 1) warnings.push('multiple_email_named_parent_folders');
  const nearest = validEmailFolders[validEmailFolders.length - 1];
  return {
    affiliate_attribution_email: nearest.email,
    affiliate_attribution_source: 'email_named_parent_folder',
    affiliate_attribution_folder: nearest.folder,
    affiliate_attribution_folder_path: parts.slice(0, nearest.index + 1).join('/'),
    affiliate_attribution_warnings: Array.from(new Set(warnings))
  };
}

export function extractNearestAffiliateEmailFolder(input: {
  folderPath?: string;
  drivePath?: string;
  fileName?: string;
}): string | undefined {
  return resolveAffiliateFolderAttributionFromPath(input).affiliate_attribution_email;
}
