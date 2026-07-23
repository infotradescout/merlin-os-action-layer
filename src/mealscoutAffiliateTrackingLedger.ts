import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const LEDGER_PATH = './data/affiliate-tracking-ledger.csv';

export const AFFILIATE_TRACKING_LEDGER_COLUMNS = [
  'affiliate_attribution_email',
  'affiliate_user_id',
  'affiliate_source_folder_id',
  'affiliate_source_folder_name',
  'attribution_method',
  'attribution_confidence',
  'submitted_by_staff',
  'staff_placed_in_affiliate_folder',
  'brand_lane',
  'source_file_id',
  'source_file_name',
  'source_file_path',
  'batch_id',
  'preview_id',
  'profile_seed_id',
  'target_profile_id',
  'target_profile_type',
  'profile_action',
  'profile_name',
  'profile_email',
  'verification_email_status',
  'seed_status',
  'seeded_at',
  'last_updated_at',
  'audit_notes'
] as const;

export type AffiliateTrackingLedgerColumn = (typeof AFFILIATE_TRACKING_LEDGER_COLUMNS)[number];
export type AffiliateTrackingLedgerRow = Record<AffiliateTrackingLedgerColumn, string>;

function ledgerPath(): string {
  return resolve(process.cwd(), process.env.MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH || LEDGER_PATH);
}

function emptyRow(): AffiliateTrackingLedgerRow {
  return Object.fromEntries(AFFILIATE_TRACKING_LEDGER_COLUMNS.map((column) => [column, ''])) as AffiliateTrackingLedgerRow;
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes && char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function rowKey(row: Partial<AffiliateTrackingLedgerRow>): string {
  const profileSeedId = row.profile_seed_id?.trim();
  if (profileSeedId) return `profile_seed:${profileSeedId}`;
  const previewId = row.preview_id?.trim();
  if (previewId) return `preview:${previewId}`;
  const batchId = row.batch_id?.trim();
  const sourceFileId = row.source_file_id?.trim();
  if (batchId && sourceFileId) return `batch_file:${batchId}:${sourceFileId}`;
  return `source_file:${sourceFileId || row.source_file_name || 'unknown'}`;
}

function rowKeys(row: Partial<AffiliateTrackingLedgerRow>): string[] {
  const keys: string[] = [];
  const profileSeedId = row.profile_seed_id?.trim();
  const previewId = row.preview_id?.trim();
  const batchId = row.batch_id?.trim();
  const sourceFileId = row.source_file_id?.trim();
  if (profileSeedId) keys.push(`profile_seed:${profileSeedId}`);
  if (previewId) keys.push(`preview:${previewId}`);
  if (batchId && sourceFileId) keys.push(`batch_file:${batchId}:${sourceFileId}`);
  keys.push(`source_file:${sourceFileId || row.source_file_name || 'unknown'}`);
  return Array.from(new Set(keys));
}

export function readAffiliateTrackingLedgerRows(): AffiliateTrackingLedgerRow[] {
  const path = ledgerPath();
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  if (header.join(',') !== AFFILIATE_TRACKING_LEDGER_COLUMNS.join(',')) return [];
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    const row = emptyRow();
    AFFILIATE_TRACKING_LEDGER_COLUMNS.forEach((column, index) => {
      row[column] = values[index] || '';
    });
    return row;
  });
}

function writeAffiliateTrackingLedgerRows(rows: AffiliateTrackingLedgerRow[]): void {
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    AFFILIATE_TRACKING_LEDGER_COLUMNS.join(','),
    ...rows.map((row) => AFFILIATE_TRACKING_LEDGER_COLUMNS.map((column) => escapeCsv(row[column] || '')).join(','))
  ];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export function upsertAffiliateTrackingLedgerRow(input: Partial<AffiliateTrackingLedgerRow>): AffiliateTrackingLedgerRow {
  const now = new Date().toISOString();
  const next = emptyRow();
  for (const column of AFFILIATE_TRACKING_LEDGER_COLUMNS) {
    next[column] = typeof input[column] === 'string' ? input[column] as string : '';
  }
  if (!next.seeded_at) next.seeded_at = now;
  next.last_updated_at = now;

  const rows = readAffiliateTrackingLedgerRows();
  const candidateKeys = new Set(rowKeys(next));
  const existingIndex = rows.findIndex((row) => rowKeys(row).some((key) => candidateKeys.has(key)));
  if (existingIndex >= 0) {
    rows[existingIndex] = {
      ...rows[existingIndex],
      ...Object.fromEntries(
        AFFILIATE_TRACKING_LEDGER_COLUMNS
          .filter((column) => next[column] !== '')
          .map((column) => [column, next[column]])
      ),
      last_updated_at: now
    } as AffiliateTrackingLedgerRow;
  } else {
    rows.push(next);
  }
  writeAffiliateTrackingLedgerRows(rows);
  return existingIndex >= 0 ? rows[existingIndex] : next;
}

export function resetAffiliateTrackingLedgerForTest(): void {
  if (process.env.MERLIN_RUNTIME !== 'test') return;
  const path = ledgerPath();
  if (existsSync(path)) rmSync(path, { force: true });
}
