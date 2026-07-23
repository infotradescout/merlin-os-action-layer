import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const exportPath = 'merlin-profile-seed-export.json';

assert.equal(existsSync(exportPath), true, 'merlin-profile-seed-export.json must exist');

const rows = JSON.parse(readFileSync(exportPath, 'utf8'));
assert.equal(Array.isArray(rows), true, 'merlin-profile-seed-export.json must be an array');
assert.ok(rows.length > 0, 'merlin-profile-seed-export.json must include at least one profile');

for (const [index, row] of rows.entries()) {
  assert.equal(row.seeded_from_evidence, true, `row ${index} must set seeded_from_evidence=true`);
  assert.equal(row.profile_origin, 'evidence_seed', `row ${index} must set profile_origin=evidence_seed`);
  assert.notEqual(row.profile_origin, 'auto_onboarded', `row ${index} must not use profile_origin=auto_onboarded`);
  assert.equal(row.claim_status, 'unclaimed', `row ${index} must set claim_status=unclaimed`);
  assert.equal(row.email_verified, false, `row ${index} must set email_verified=false`);
  assert.equal(row.insurance_verified, false, `row ${index} must set insurance_verified=false`);
  assert.equal(row.owner_user_id, null, `row ${index} must set owner_user_id=null`);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'affiliate_attribution'), true, `row ${index} must include affiliate_attribution`);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'affiliate_email'), true, `row ${index} must include affiliate_email`);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'affiliate_source_folder'), true, `row ${index} must include affiliate_source_folder`);

  if (row.attribution_method === 'admin_unattributed') {
    assert.equal(row.affiliate_attribution, null, `row ${index} admin_unattributed must set affiliate_attribution=null`);
    assert.equal(row.affiliate_email, null, `row ${index} admin_unattributed must set affiliate_email=null`);
    assert.equal(row.affiliate_source_folder, null, `row ${index} admin_unattributed must set affiliate_source_folder=null`);
  }
}

console.log('Merlin profile seed export contract passed');