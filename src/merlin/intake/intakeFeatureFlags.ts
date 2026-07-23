import type { MerlinBrand } from './intakeTypes.js';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isMerlinIntakeEnabled(): boolean {
  return envBool('MERLIN_INTAKE_ENABLED', false);
}

export function isMerlinSearchEnabled(): boolean {
  return envBool('MERLIN_SEARCH_ENABLED', false);
}

export function isProductIntakeEnabled(brand: MerlinBrand): boolean {
  switch (brand) {
    case 'MEALSCOUT':
      return envBool('MERLIN_INTAKE_MEALSCOUT_ENABLED', false);
    case 'TRADESCOUT':
      return envBool('MERLIN_INTAKE_TRADESCOUT_ENABLED', false);
    case 'HOMEID':
      return envBool('MERLIN_INTAKE_HOMEID_ENABLED', false);
    case 'MERLIN':
      return envBool('MERLIN_INTAKE_ENABLED', false);
    default:
      return false;
  }
}

export function isMerlinIntakeAdminEnabled(): boolean {
  return envBool('MERLIN_INTAKE_ADMIN_ENABLED', false);
}

export function isMerlinIntakeApplyEnabled(): boolean {
  return envBool('MERLIN_INTAKE_APPLY_ENABLED', false);
}

export function isMerlinIntakeCleanupEnabled(): boolean {
  return envBool('MERLIN_INTAKE_CLEANUP_ENABLED', false);
}

export function getMerlinIntakeFlags() {
  return {
    MERLIN_INTAKE_ENABLED: isMerlinIntakeEnabled(),
    MERLIN_SEARCH_ENABLED: isMerlinSearchEnabled(),
    MERLIN_INTAKE_MEALSCOUT_ENABLED: envBool('MERLIN_INTAKE_MEALSCOUT_ENABLED', false),
    MERLIN_INTAKE_TRADESCOUT_ENABLED: envBool('MERLIN_INTAKE_TRADESCOUT_ENABLED', false),
    MERLIN_INTAKE_HOMEID_ENABLED: envBool('MERLIN_INTAKE_HOMEID_ENABLED', false),
    MERLIN_INTAKE_ADMIN_ENABLED: isMerlinIntakeAdminEnabled(),
    MERLIN_INTAKE_APPLY_ENABLED: isMerlinIntakeApplyEnabled(),
    MERLIN_INTAKE_CLEANUP_ENABLED: isMerlinIntakeCleanupEnabled()
  };
}
