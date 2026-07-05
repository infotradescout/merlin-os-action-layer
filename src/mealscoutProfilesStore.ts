import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { MealScoutExistingProfile } from './mealscoutProfileImport.js';

interface MealScoutProfileRow {
  id: string;
  truck_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city_area: string | null;
  socials_json: string | null;
  affiliate_attribution_email: string | null;
  affiliate_attribution_source: string | null;
  affiliate_attribution_folder: string | null;
  affiliate_attribution_folder_path: string | null;
  affiliate_attribution_warnings_json: string | null;
  email_verified: number | null;
  insurance_verified: number | null;
  claim_status: string | null;
  seeded_from_evidence: number | null;
  seeded_source: string | null;
  onboarding_source: string | null;
  profile_origin: string | null;
  owner_user_id: string | null;
  source_refs_json: string;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeMealScoutProfilesStore();
  }
  return db as Database.Database;
}

function toOptionalBoolean(value: number | null): boolean | undefined {
  return value === null ? undefined : value === 1;
}

function toStoredBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : (value ? 1 : 0);
}

function mapRowToProfile(row: MealScoutProfileRow): MealScoutExistingProfile {
  return {
    id: row.id,
    truckName: row.truck_name ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    cityArea: row.city_area ?? undefined,
    socials: row.socials_json ? JSON.parse(row.socials_json) : undefined,
    affiliate_attribution_email: row.affiliate_attribution_email ?? undefined,
    affiliate_attribution_source: (row.affiliate_attribution_source ?? undefined) as MealScoutExistingProfile['affiliate_attribution_source'],
    affiliate_attribution_folder: row.affiliate_attribution_folder ?? undefined,
    affiliate_attribution_folder_path: row.affiliate_attribution_folder_path ?? undefined,
    affiliate_attribution_warnings: row.affiliate_attribution_warnings_json ? JSON.parse(row.affiliate_attribution_warnings_json) : undefined,
    email_verified: toOptionalBoolean(row.email_verified),
    insurance_verified: toOptionalBoolean(row.insurance_verified),
    claim_status: (row.claim_status ?? undefined) as MealScoutExistingProfile['claim_status'],
    seeded_from_evidence: toOptionalBoolean(row.seeded_from_evidence),
    seeded_source: (row.seeded_source ?? undefined) as MealScoutExistingProfile['seeded_source'],
    onboarding_source: (row.onboarding_source ?? undefined) as MealScoutExistingProfile['onboarding_source'],
    profile_origin: (row.profile_origin ?? undefined) as MealScoutExistingProfile['profile_origin'],
    owner_user_id: row.owner_user_id,
    source_refs: row.source_refs_json ? JSON.parse(row.source_refs_json) : []
  };
}

function toRow(profile: MealScoutExistingProfile): MealScoutProfileRow {
  return {
    id: profile.id,
    truck_name: profile.truckName ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
    website: profile.website ?? null,
    city_area: profile.cityArea ?? null,
    socials_json: profile.socials ? JSON.stringify(profile.socials) : null,
    affiliate_attribution_email: profile.affiliate_attribution_email ?? null,
    affiliate_attribution_source: profile.affiliate_attribution_source ?? null,
    affiliate_attribution_folder: profile.affiliate_attribution_folder ?? null,
    affiliate_attribution_folder_path: profile.affiliate_attribution_folder_path ?? null,
    affiliate_attribution_warnings_json: profile.affiliate_attribution_warnings
      ? JSON.stringify(profile.affiliate_attribution_warnings)
      : null,
    email_verified: toStoredBoolean(profile.email_verified),
    insurance_verified: toStoredBoolean(profile.insurance_verified),
    claim_status: profile.claim_status ?? null,
    seeded_from_evidence: toStoredBoolean(profile.seeded_from_evidence),
    seeded_source: profile.seeded_source ?? null,
    onboarding_source: profile.onboarding_source ?? null,
    profile_origin: profile.profile_origin ?? null,
    owner_user_id: profile.owner_user_id ?? null,
    source_refs_json: JSON.stringify(profile.source_refs ?? [])
  };
}

export function initializeMealScoutProfilesStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS mealscout_profiles (
      id TEXT PRIMARY KEY,
      truck_name TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      city_area TEXT,
      socials_json TEXT,
      affiliate_attribution_email TEXT,
      affiliate_attribution_source TEXT,
      affiliate_attribution_folder TEXT,
      affiliate_attribution_folder_path TEXT,
      affiliate_attribution_warnings_json TEXT,
      email_verified INTEGER,
      insurance_verified INTEGER,
      claim_status TEXT,
      seeded_from_evidence INTEGER,
      seeded_source TEXT,
      onboarding_source TEXT,
      profile_origin TEXT,
      owner_user_id TEXT,
      source_refs_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS mealscout_profiles_origin_idx ON mealscout_profiles(profile_origin);
  `);

  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function getAllMealScoutProfiles(): MealScoutExistingProfile[] {
  const rows = getDb().prepare('SELECT * FROM mealscout_profiles').all() as MealScoutProfileRow[];
  return rows.map(mapRowToProfile);
}

export function getMealScoutProfileRowById(id: string): MealScoutExistingProfile | undefined {
  const row = getDb().prepare('SELECT * FROM mealscout_profiles WHERE id = ?').get(id) as MealScoutProfileRow | undefined;
  return row ? mapRowToProfile(row) : undefined;
}

export function insertMealScoutProfile(profile: MealScoutExistingProfile): void {
  const row = toRow(profile);
  getDb()
    .prepare(
      `
      INSERT INTO mealscout_profiles (
        id, truck_name, phone, email, website, city_area, socials_json,
        affiliate_attribution_email, affiliate_attribution_source, affiliate_attribution_folder,
        affiliate_attribution_folder_path, affiliate_attribution_warnings_json,
        email_verified, insurance_verified, claim_status, seeded_from_evidence,
        seeded_source, onboarding_source, profile_origin, owner_user_id, source_refs_json
      ) VALUES (
        @id, @truck_name, @phone, @email, @website, @city_area, @socials_json,
        @affiliate_attribution_email, @affiliate_attribution_source, @affiliate_attribution_folder,
        @affiliate_attribution_folder_path, @affiliate_attribution_warnings_json,
        @email_verified, @insurance_verified, @claim_status, @seeded_from_evidence,
        @seeded_source, @onboarding_source, @profile_origin, @owner_user_id, @source_refs_json
      )
      `
    )
    .run(row);
}

export function replaceMealScoutProfile(profile: MealScoutExistingProfile): void {
  const row = toRow(profile);
  getDb()
    .prepare(
      `
      UPDATE mealscout_profiles SET
        truck_name = @truck_name,
        phone = @phone,
        email = @email,
        website = @website,
        city_area = @city_area,
        socials_json = @socials_json,
        affiliate_attribution_email = @affiliate_attribution_email,
        affiliate_attribution_source = @affiliate_attribution_source,
        affiliate_attribution_folder = @affiliate_attribution_folder,
        affiliate_attribution_folder_path = @affiliate_attribution_folder_path,
        affiliate_attribution_warnings_json = @affiliate_attribution_warnings_json,
        email_verified = @email_verified,
        insurance_verified = @insurance_verified,
        claim_status = @claim_status,
        seeded_from_evidence = @seeded_from_evidence,
        seeded_source = @seeded_source,
        onboarding_source = @onboarding_source,
        profile_origin = @profile_origin,
        owner_user_id = @owner_user_id,
        source_refs_json = @source_refs_json
      WHERE id = @id
      `
    )
    .run(row);
}

export function resetMealScoutProfilesStoreForTest(): void {
  getDb().prepare('DELETE FROM mealscout_profiles').run();
}

export function closeMealScoutProfilesStore(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}
