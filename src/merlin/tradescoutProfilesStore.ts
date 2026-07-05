import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { TradeScoutSeededProfile } from './profileSeedRuntime.js';

interface TradeScoutProfileRow {
  id: string;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  service_area: string | null;
  claim_status: string;
  email_verified: number;
  insurance_verified: number;
  affiliate_attribution_email: string | null;
  affiliate_attribution_source: string | null;
  affiliate_attribution_folder: string | null;
  affiliate_attribution_folder_path: string | null;
  seeded_from_evidence: number;
  seeded_source: string;
  onboarding_source: string;
  profile_origin: string;
  owner_user_id: string | null;
  source_file_ids_json: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeTradeScoutProfilesStore();
  }
  return db as Database.Database;
}

function toStoredBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function mapRowToProfile(row: TradeScoutProfileRow): TradeScoutSeededProfile {
  return {
    id: row.id,
    businessName: row.business_name ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    serviceArea: row.service_area ?? undefined,
    claim_status: row.claim_status as TradeScoutSeededProfile['claim_status'],
    email_verified: row.email_verified === 1,
    insurance_verified: row.insurance_verified === 1,
    affiliate_attribution_email: row.affiliate_attribution_email ?? undefined,
    affiliate_attribution_source: (row.affiliate_attribution_source ?? undefined) as TradeScoutSeededProfile['affiliate_attribution_source'],
    affiliate_attribution_folder: row.affiliate_attribution_folder ?? undefined,
    affiliate_attribution_folder_path: row.affiliate_attribution_folder_path ?? undefined,
    seeded_from_evidence: row.seeded_from_evidence === 1,
    seeded_source: row.seeded_source as TradeScoutSeededProfile['seeded_source'],
    onboarding_source: row.onboarding_source as TradeScoutSeededProfile['onboarding_source'],
    profile_origin: row.profile_origin as TradeScoutSeededProfile['profile_origin'],
    owner_user_id: null,
    sourceFileIds: row.source_file_ids_json ? JSON.parse(row.source_file_ids_json) : [],
    source_refs: row.source_refs_json ? JSON.parse(row.source_refs_json) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(profile: TradeScoutSeededProfile): TradeScoutProfileRow {
  return {
    id: profile.id,
    business_name: profile.businessName ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
    service_area: profile.serviceArea ?? null,
    claim_status: profile.claim_status,
    email_verified: toStoredBoolean(profile.email_verified),
    insurance_verified: toStoredBoolean(profile.insurance_verified),
    affiliate_attribution_email: profile.affiliate_attribution_email ?? null,
    affiliate_attribution_source: profile.affiliate_attribution_source ?? null,
    affiliate_attribution_folder: profile.affiliate_attribution_folder ?? null,
    affiliate_attribution_folder_path: profile.affiliate_attribution_folder_path ?? null,
    seeded_from_evidence: toStoredBoolean(profile.seeded_from_evidence),
    seeded_source: profile.seeded_source,
    onboarding_source: profile.onboarding_source,
    profile_origin: profile.profile_origin,
    owner_user_id: profile.owner_user_id,
    source_file_ids_json: JSON.stringify(profile.sourceFileIds ?? []),
    source_refs_json: JSON.stringify(profile.source_refs ?? []),
    created_at: profile.createdAt,
    updated_at: profile.updatedAt
  };
}

export function initializeTradeScoutProfilesStore(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) {
    return nextPath;
  }
  if (db) {
    db.close();
    db = null;
  }

  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  nextDb.pragma('foreign_keys = ON');

  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS tradescout_profiles (
      id TEXT PRIMARY KEY,
      business_name TEXT,
      phone TEXT,
      email TEXT,
      service_area TEXT,
      claim_status TEXT NOT NULL,
      email_verified INTEGER NOT NULL,
      insurance_verified INTEGER NOT NULL,
      affiliate_attribution_email TEXT,
      affiliate_attribution_source TEXT,
      affiliate_attribution_folder TEXT,
      affiliate_attribution_folder_path TEXT,
      seeded_from_evidence INTEGER NOT NULL,
      seeded_source TEXT NOT NULL,
      onboarding_source TEXT NOT NULL,
      profile_origin TEXT NOT NULL,
      owner_user_id TEXT,
      source_file_ids_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tradescout_profiles_origin_idx ON tradescout_profiles(profile_origin);
  `);

  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function getAllTradeScoutProfiles(): TradeScoutSeededProfile[] {
  const rows = getDb().prepare('SELECT * FROM tradescout_profiles').all() as TradeScoutProfileRow[];
  return rows.map(mapRowToProfile);
}

export function upsertTradeScoutProfile(profile: TradeScoutSeededProfile): void {
  const row = toRow(profile);
  getDb()
    .prepare(
      `
      INSERT INTO tradescout_profiles (
        id, business_name, phone, email, service_area, claim_status, email_verified,
        insurance_verified, affiliate_attribution_email, affiliate_attribution_source,
        affiliate_attribution_folder, affiliate_attribution_folder_path, seeded_from_evidence,
        seeded_source, onboarding_source, profile_origin, owner_user_id,
        source_file_ids_json, source_refs_json, created_at, updated_at
      ) VALUES (
        @id, @business_name, @phone, @email, @service_area, @claim_status, @email_verified,
        @insurance_verified, @affiliate_attribution_email, @affiliate_attribution_source,
        @affiliate_attribution_folder, @affiliate_attribution_folder_path, @seeded_from_evidence,
        @seeded_source, @onboarding_source, @profile_origin, @owner_user_id,
        @source_file_ids_json, @source_refs_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        business_name = excluded.business_name,
        phone = excluded.phone,
        email = excluded.email,
        service_area = excluded.service_area,
        claim_status = excluded.claim_status,
        email_verified = excluded.email_verified,
        insurance_verified = excluded.insurance_verified,
        affiliate_attribution_email = excluded.affiliate_attribution_email,
        affiliate_attribution_source = excluded.affiliate_attribution_source,
        affiliate_attribution_folder = excluded.affiliate_attribution_folder,
        affiliate_attribution_folder_path = excluded.affiliate_attribution_folder_path,
        seeded_from_evidence = excluded.seeded_from_evidence,
        seeded_source = excluded.seeded_source,
        onboarding_source = excluded.onboarding_source,
        profile_origin = excluded.profile_origin,
        owner_user_id = excluded.owner_user_id,
        source_file_ids_json = excluded.source_file_ids_json,
        source_refs_json = excluded.source_refs_json,
        updated_at = excluded.updated_at
      `
    )
    .run(row);
}

export function resetTradeScoutProfilesStoreForTest(): void {
  getDb().prepare('DELETE FROM tradescout_profiles').run();
}
