export const DRIVE_MANAGED_FOLDER_NAMES = [
  '00_Inbox',
  '01_Processed',
  '02_Needs_Review',
  '03_Archived_Sources',
  '04_Entity_Files',
  '05_Exports',
  '06_Audit',
  '07_System'
] as const;

export type DriveManagedFolderType = (typeof DRIVE_MANAGED_FOLDER_NAMES)[number];
export type DriveManagedPathType =
  | 'inbox'
  | 'processed'
  | 'needs_review'
  | 'archived'
  | 'entity_files'
  | 'exports'
  | 'audit'
  | 'system'
  | 'unknown';

interface BuildDriveFolderPlanResult {
  root_folder_name: string;
  required_paths: string[];
  existing_paths: string[];
  missing_paths: string[];
  reusable_paths: string[];
}

export function normalizeDriveFolderName(name: string): string {
  return name
    .replace(/[\\]+/g, '/')
    .replace(/\/+/g, '/')
    .trim()
    .replace(/(^\/+|\/+$)/g, '');
}

export function getRequiredDriveFolders(rootFolderName = 'Merlin OR Storage'): string[] {
  const root = normalizeDriveFolderName(rootFolderName);
  return DRIVE_MANAGED_FOLDER_NAMES.map((folderName) => `${root}/${folderName}`);
}

export function buildDriveFolderPlan(existingFolders: string[], rootFolderName = 'Merlin OR Storage'): BuildDriveFolderPlanResult {
  const root = normalizeDriveFolderName(rootFolderName);
  const requiredPaths = getRequiredDriveFolders(root);
  const normalizedExisting = new Set(existingFolders.map((folder) => normalizeDriveFolderName(folder)));

  const normalizedToRequired = new Map(
    requiredPaths.map((requiredPath) => [normalizeDriveFolderName(requiredPath), requiredPath])
  );

  const reusablePaths: string[] = [];
  const missingPaths: string[] = [];

  for (const requiredPath of requiredPaths) {
    const normalizedRequiredPath = normalizeDriveFolderName(requiredPath);
    const found = normalizedExisting.has(requiredPath) || normalizedExisting.has(normalizedRequiredPath);
    const knownLeaf = normalizeDriveFolderName(requiredPath.split('/').at(-1) ?? requiredPath);
    const leafMatch = normalizedExisting.has(knownLeaf);
    if (found || leafMatch) {
      reusablePaths.push(normalizedToRequired.get(normalizedRequiredPath) ?? requiredPath);
    } else {
      missingPaths.push(normalizedToRequired.get(normalizedRequiredPath) ?? requiredPath);
    }
  }

  const existingPaths = requiredPaths.filter((requiredPath) => reusablePaths.includes(normalizeDriveFolderName(requiredPath)));

  return {
    root_folder_name: root,
    required_paths: requiredPaths,
    existing_paths: existingPaths,
    missing_paths: missingPaths,
    reusable_paths: reusablePaths
  };
}

export function classifyDriveManagedPath(path: string): DriveManagedPathType {
  const normalized = normalizeDriveFolderName(path).toLowerCase();
  const marker = normalized.split('/').join('/');
  if (!marker) return 'unknown';
  if (marker.includes('00_inbox')) return 'inbox';
  if (marker.includes('01_processed')) return 'processed';
  if (marker.includes('02_needs_review')) return 'needs_review';
  if (marker.includes('03_archived_sources')) return 'archived';
  if (marker.includes('04_entity_files')) return 'entity_files';
  if (marker.includes('05_exports')) return 'exports';
  if (marker.includes('06_audit')) return 'audit';
  if (marker.includes('07_system')) return 'system';
  return 'unknown';
}
