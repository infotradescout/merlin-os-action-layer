import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinWorkspace,
  createMerlinWorkspaceMember,
  getMerlinWorkspaceById,
  listMerlinRolePolicyChecks,
  listMerlinWorkspaceBrandPermissions,
  listMerlinWorkspaceMembers,
  listMerlinWorkspaces,
  runMerlinRolePolicyCheck,
  setMerlinWorkspaceBrandPermission,
  type MerlinRolePolicyAction,
  type MerlinRolePolicyCheckStatus,
  type MerlinWorkspaceMemberStatus,
  type MerlinWorkspaceRole,
  type MerlinWorkspaceStatus,
  type MerlinWorkspaceType
} from '../workspaceRuntime.js';

const WORKSPACE_TYPES = new Set<MerlinWorkspaceType>(['internal', 'brand', 'client', 'affiliate', 'system']);
const WORKSPACE_STATUSES = new Set<MerlinWorkspaceStatus>(['active', 'suspended', 'archived']);
const MEMBER_ROLES = new Set<MerlinWorkspaceRole>(['viewer', 'operator', 'admin', 'owner', 'super_admin', 'system']);
const MEMBER_STATUSES = new Set<MerlinWorkspaceMemberStatus>(['active', 'disabled', 'removed']);
const ROLE_POLICY_ACTIONS = new Set<MerlinRolePolicyAction>([
  'view',
  'create_intake',
  'create_action_card',
  'request_approval',
  'approve',
  'create_execution_plan',
  'run_dry_run',
  'check_live_gate'
]);
const ROLE_POLICY_STATUSES = new Set<MerlinRolePolicyCheckStatus>([
  'pass',
  'blocked',
  'workspace_not_found',
  'operator_not_found',
  'role_denied',
  'brand_denied',
  'target_not_found'
]);

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({ __invalid_body: true });
      }
    });
    req.on('error', () => resolve({ __invalid_body: true }));
  });
}

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function invalidBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && '__invalid_body' in body;
}

export async function handleMerlinWorkspaceRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/workspaces') {
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    const workspaceType = asText(payload.workspace_type).toLowerCase() as MerlinWorkspaceType;
    const status = asText(payload.status).toLowerCase() as MerlinWorkspaceStatus;
    if (!asText(payload.workspace_name) || !WORKSPACE_TYPES.has(workspaceType)) {
      responseJson(res, { error: 'validation_error', reason: 'workspace_name and valid workspace_type are required', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const workspace = createMerlinWorkspace({
        workspace_name: asText(payload.workspace_name),
        workspace_type: workspaceType,
        status: WORKSPACE_STATUSES.has(status) ? status : undefined
      });
      responseJson(res, { mutationAllowed: false, workspace }, 201);
    } catch (error) {
      responseJson(res, { error: error instanceof Error ? error.message : 'workspace_create_failed', mutationAllowed: false }, 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/workspaces') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase() as MerlinWorkspaceStatus;
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      workspaces: listMerlinWorkspaces({
        status: WORKSPACE_STATUSES.has(status) ? status : undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const memberCollectionMatch = pathname.match(/^\/api\/merlin\/workspaces\/([^/]+)\/members$/);
  if (memberCollectionMatch) {
    const workspaceId = decodeURIComponent(memberCollectionMatch[1]);
    if (method === 'GET') {
      if (!getMerlinWorkspaceById(workspaceId)) return responseJson(res, { error: 'workspace_not_found', mutationAllowed: false }, 404), true;
      responseJson(res, { mutationAllowed: false, members: listMerlinWorkspaceMembers(workspaceId) });
      return true;
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400), true;
      const payload = (body || {}) as Record<string, unknown>;
      const role = asText(payload.role).toLowerCase() as MerlinWorkspaceRole;
      const status = asText(payload.status).toLowerCase() as MerlinWorkspaceMemberStatus;
      if (!asText(payload.operator_id) || !MEMBER_ROLES.has(role)) {
        responseJson(res, { error: 'validation_error', reason: 'operator_id and valid role are required', mutationAllowed: false }, 400);
        return true;
      }
      try {
        const member = createMerlinWorkspaceMember({
          workspace_id: workspaceId,
          operator_id: asText(payload.operator_id),
          operator_label: asText(payload.operator_label) || undefined,
          role,
          status: MEMBER_STATUSES.has(status) ? status : undefined
        });
        responseJson(res, { mutationAllowed: false, member }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'member_create_failed';
        responseJson(res, { error: message, mutationAllowed: false }, message === 'workspace_not_found' ? 404 : 409);
      }
      return true;
    }
  }

  const permissionCollectionMatch = pathname.match(/^\/api\/merlin\/workspaces\/([^/]+)\/brand-permissions$/);
  if (permissionCollectionMatch) {
    const workspaceId = decodeURIComponent(permissionCollectionMatch[1]);
    if (method === 'GET') {
      if (!getMerlinWorkspaceById(workspaceId)) return responseJson(res, { error: 'workspace_not_found', mutationAllowed: false }, 404), true;
      responseJson(res, { mutationAllowed: false, brandPermissions: listMerlinWorkspaceBrandPermissions(workspaceId) });
      return true;
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400), true;
      const payload = (body || {}) as Record<string, unknown>;
      if (!asText(payload.brand_lane)) {
        responseJson(res, { error: 'validation_error', reason: 'brand_lane is required', mutationAllowed: false }, 400);
        return true;
      }
      try {
        const brandPermission = setMerlinWorkspaceBrandPermission({ workspace_id: workspaceId, brand_lane: asText(payload.brand_lane), ...payload });
        responseJson(res, { mutationAllowed: false, brandPermission }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'brand_permission_failed';
        responseJson(res, { error: message, mutationAllowed: false }, message === 'workspace_not_found' ? 404 : 409);
      }
      return true;
    }
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/workspaces\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const workspace = getMerlinWorkspaceById(decodeURIComponent(detailMatch[1]));
    if (!workspace) return responseJson(res, { error: 'workspace_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, workspace });
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/role-policy-checks') {
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    const action = asText(payload.action).toLowerCase() as MerlinRolePolicyAction;
    if (!asText(payload.workspace_id) || !asText(payload.operator_id) || !asText(payload.target_type) || !asText(payload.target_id) || !ROLE_POLICY_ACTIONS.has(action)) {
      responseJson(res, { error: 'validation_error', reason: 'workspace_id, operator_id, target_type, target_id, and valid action are required', mutationAllowed: false }, 400);
      return true;
    }
    const check = runMerlinRolePolicyCheck({
      workspace_id: asText(payload.workspace_id),
      operator_id: asText(payload.operator_id),
      target_type: asText(payload.target_type),
      target_id: asText(payload.target_id),
      action,
      brand_lane: asText(payload.brand_lane) || undefined
    });
    responseJson(res, { mutationAllowed: false, check }, check.check_status === 'pass' ? 201 : 409);
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/role-policy-checks') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase() as MerlinRolePolicyCheckStatus;
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      checks: listMerlinRolePolicyChecks({
        workspace_id: asText(url.searchParams.get('workspace_id')) || undefined,
        operator_id: asText(url.searchParams.get('operator_id')) || undefined,
        status: ROLE_POLICY_STATUSES.has(status) ? status : undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  return false;
}
