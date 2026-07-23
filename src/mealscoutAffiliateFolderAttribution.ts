export type AffiliateFolderAttribution = {
  attributionSource?: 'folder_context';
  attributionStatus?: 'matched_affiliate_folder' | 'unknown';
  affiliate_attribution_email?: string;
  affiliate_attribution_source?: 'folder_email_token';
  affiliate_attribution_folder?: string;
  affiliate_attribution_folder_path?: string;
  affiliate_attribution_warnings?: string[];
};

const EMAIL_TOKEN_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

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
  return resolveAffiliateFolderAttributionFromPath(input).affiliate_attribution_email;
}

export function resolveAffiliateFolderAttributionFromPath(input: {
  folderPath?: string;
  drivePath?: string;
  fileName?: string;
}): AffiliateFolderAttribution {
  const rawPath = (input.folderPath || input.drivePath || '').trim();
  if (!rawPath) {
    return {};
  }
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
    const match = part.match(EMAIL_TOKEN_PATTERN);
    if (match?.[0]) {
      validEmailFolders.push({ email: match[0].toLowerCase(), folder: part, index });
    } else {
      warnings.push('invalid_email_named_parent_folder');
    }
  });
  if (validEmailFolders.length > 0) {
    if (validEmailFolders.length > 1) warnings.push('multiple_email_named_parent_folders');
    const nearest = validEmailFolders[validEmailFolders.length - 1];
    return {
      attributionSource: 'folder_context',
      attributionStatus: 'matched_affiliate_folder',
      affiliate_attribution_email: nearest.email,
      affiliate_attribution_source: 'folder_email_token',
      affiliate_attribution_folder: nearest.folder,
      affiliate_attribution_folder_path: parts.slice(0, nearest.index + 1).join('/'),
      affiliate_attribution_warnings: Array.from(new Set(warnings))
    };
  }
  return {
    affiliate_attribution_warnings: rawPath.includes('@') ? ['invalid_email_named_parent_folder'] : undefined
  };
}
