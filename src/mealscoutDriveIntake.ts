import { parseDriveManagerConfig } from './driveManager.js';
import { getDriveAuthConfig, getDriveAuthProfile } from './driveAuth.js';
import { getDriveClient, type DriveClient } from './driveClient.js';

type IntakeLeafKey =
  | 'incoming'
  | 'incoming/screenshots'
  | 'incoming/logos'
  | 'incoming/menus'
  | 'incoming/unknown'
  | 'processing'
  | 'processed'
  | 'processed/screenshots'
  | 'processed/logos'
  | 'processed/menus'
  | 'review-needed'
  | 'review-needed/uncertain-match'
  | 'review-needed/missing-required'
  | 'review-needed/duplicate-possible'
  | 'review-needed/logo-unmatched'
  | 'failed'
  | 'archive';

type FolderEntry = { id: string; path: string };
type IntakeFolders = Record<IntakeLeafKey, FolderEntry>;

type DiscoveryStatus = 'ready' | 'error' | 'disabled';

export type MealScoutIntakeDiscovery = {
  status: DiscoveryStatus;
  mode: 'read_only' | 'provisioned';
  reason?: string;
  root: {
    merlin: FolderEntry;
    mealscout_intake: FolderEntry;
  };
  summary: {
    required: number;
    present: number;
    missing: number;
    duplicateCount: number;
  };
  folders: IntakeFolders;
  duplicates: Partial<Record<IntakeLeafKey | 'root/merlin' | 'root/mealscout_intake', string[]>>;
  missing: IntakeLeafKey[];
  mutationAllowed: boolean;
  checkedAt: string;
};

const MEALSCOUT_INTAKE_ROOT = 'MealScout Intake';
const MERLIN_ROOT = 'Merlin';
const CREATE_MISSING_ENV = 'MERLIN_MEALSCOUT_INTAKE_CREATE_MISSING_FOLDERS';

const REQUIRED_TREE: Array<{ key: IntakeLeafKey; segments: string[] }> = [
  { key: 'incoming', segments: ['incoming'] },
  { key: 'incoming/screenshots', segments: ['incoming', 'screenshots'] },
  { key: 'incoming/logos', segments: ['incoming', 'logos'] },
  { key: 'incoming/menus', segments: ['incoming', 'menus'] },
  { key: 'incoming/unknown', segments: ['incoming', 'unknown'] },
  { key: 'processing', segments: ['processing'] },
  { key: 'processed', segments: ['processed'] },
  { key: 'processed/screenshots', segments: ['processed', 'screenshots'] },
  { key: 'processed/logos', segments: ['processed', 'logos'] },
  { key: 'processed/menus', segments: ['processed', 'menus'] },
  { key: 'review-needed', segments: ['review-needed'] },
  { key: 'review-needed/uncertain-match', segments: ['review-needed', 'uncertain-match'] },
  { key: 'review-needed/missing-required', segments: ['review-needed', 'missing-required'] },
  { key: 'review-needed/duplicate-possible', segments: ['review-needed', 'duplicate-possible'] },
  { key: 'review-needed/logo-unmatched', segments: ['review-needed', 'logo-unmatched'] },
  { key: 'failed', segments: ['failed'] },
  { key: 'archive', segments: ['archive'] }
];

function envTrue(value: string | undefined): boolean {
  return (value || '').toLowerCase() === 'true';
}

async function findOrCreateFolder(
  client: DriveClient,
  name: string,
  parentId: string,
  createMissing: boolean
): Promise<{ folder?: { id: string; name: string }; duplicateIds: string[] }> {
  const matches = await client.listFoldersByName(name, parentId);
  if (matches.length > 0) {
    return {
      folder: matches[0],
      duplicateIds: matches.length > 1 ? matches.map((entry) => entry.id) : []
    };
  }
  if (!createMissing) {
    return { folder: undefined, duplicateIds: [] };
  }
  const created = await client.createFolderIfMissing(name, parentId);
  return { folder: created, duplicateIds: [] };
}

function emptyFolders(): IntakeFolders {
  const empty = {} as IntakeFolders;
  for (const item of REQUIRED_TREE) {
    empty[item.key] = { id: '', path: `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}/${item.segments.join('/')}` };
  }
  return empty;
}

export async function discoverMealScoutIntakeFolders(
  options: { client?: DriveClient; createMissing?: boolean } = {}
): Promise<MealScoutIntakeDiscovery> {
  const authConfig = getDriveAuthConfig();
  const profile = getDriveAuthProfile(authConfig);
  const config = parseDriveManagerConfig();
  const createMissing = options.createMissing ?? envTrue(process.env[CREATE_MISSING_ENV]);
  const checkedAt = new Date().toISOString();

  if (!config.syncEnabled || !profile.ready) {
    return {
      status: 'disabled',
      mode: 'read_only',
      reason: profile.reason || 'Drive sync disabled',
      root: {
        merlin: { id: '', path: MERLIN_ROOT },
        mealscout_intake: { id: '', path: `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}` }
      },
      summary: { required: REQUIRED_TREE.length, present: 0, missing: REQUIRED_TREE.length, duplicateCount: 0 },
      folders: emptyFolders(),
      duplicates: {},
      missing: REQUIRED_TREE.map((entry) => entry.key),
      mutationAllowed: false,
      checkedAt
    };
  }

  const client = options.client || getDriveClient(authConfig);
  const duplicates: Partial<Record<IntakeLeafKey | 'root/merlin' | 'root/mealscout_intake', string[]>> = {};
  const folders = emptyFolders();
  const missing: IntakeLeafKey[] = [];
  let duplicateCount = 0;

  const merlinRoot = await findOrCreateFolder(client, MERLIN_ROOT, 'root', createMissing);
  if (merlinRoot.duplicateIds.length > 0) {
    duplicates['root/merlin'] = merlinRoot.duplicateIds;
    duplicateCount += merlinRoot.duplicateIds.length;
  }
  if (!merlinRoot.folder) {
    return {
      status: 'error',
      mode: createMissing ? 'provisioned' : 'read_only',
      reason: 'Missing Merlin root folder',
      root: {
        merlin: { id: '', path: MERLIN_ROOT },
        mealscout_intake: { id: '', path: `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}` }
      },
      summary: { required: REQUIRED_TREE.length, present: 0, missing: REQUIRED_TREE.length, duplicateCount },
      folders,
      duplicates,
      missing: REQUIRED_TREE.map((entry) => entry.key),
      mutationAllowed: createMissing,
      checkedAt
    };
  }

  const intakeRoot = await findOrCreateFolder(client, MEALSCOUT_INTAKE_ROOT, merlinRoot.folder.id, createMissing);
  if (intakeRoot.duplicateIds.length > 0) {
    duplicates['root/mealscout_intake'] = intakeRoot.duplicateIds;
    duplicateCount += intakeRoot.duplicateIds.length;
  }
  if (!intakeRoot.folder) {
    return {
      status: 'error',
      mode: createMissing ? 'provisioned' : 'read_only',
      reason: 'Missing MealScout Intake root folder',
      root: {
        merlin: { id: merlinRoot.folder.id, path: MERLIN_ROOT },
        mealscout_intake: { id: '', path: `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}` }
      },
      summary: { required: REQUIRED_TREE.length, present: 0, missing: REQUIRED_TREE.length, duplicateCount },
      folders,
      duplicates,
      missing: REQUIRED_TREE.map((entry) => entry.key),
      mutationAllowed: createMissing,
      checkedAt
    };
  }

  for (const entry of REQUIRED_TREE) {
    let parentId = intakeRoot.folder.id;
    let path = `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}`;
    let finalFolderId = '';
    for (const segment of entry.segments) {
      const result = await findOrCreateFolder(client, segment, parentId, createMissing);
      if (result.duplicateIds.length > 0) {
        duplicates[entry.key] = result.duplicateIds;
        duplicateCount += result.duplicateIds.length;
      }
      if (!result.folder) {
        finalFolderId = '';
        break;
      }
      parentId = result.folder.id;
      path = `${path}/${segment}`;
      finalFolderId = result.folder.id;
    }
    folders[entry.key] = { id: finalFolderId, path };
    if (!finalFolderId) {
      missing.push(entry.key);
    }
  }

  const present = REQUIRED_TREE.length - missing.length;
  const hasBlockingIssues = missing.length > 0 || duplicateCount > 0;
  return {
    status: hasBlockingIssues ? 'error' : 'ready',
    mode: createMissing ? 'provisioned' : 'read_only',
    reason: hasBlockingIssues ? (missing.length > 0 ? 'setup_required' : 'folder_conflict') : undefined,
    root: {
      merlin: { id: merlinRoot.folder.id, path: MERLIN_ROOT },
      mealscout_intake: { id: intakeRoot.folder.id, path: `${MERLIN_ROOT}/${MEALSCOUT_INTAKE_ROOT}` }
    },
    summary: {
      required: REQUIRED_TREE.length,
      present,
      missing: missing.length,
      duplicateCount
    },
    folders,
    duplicates,
    missing,
    mutationAllowed: createMissing,
    checkedAt
  };
}

