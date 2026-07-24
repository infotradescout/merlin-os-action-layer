import { getRegisteredSources } from '../sourceRegistry.js';
import { getMerlinOperatorConsolePayload } from './operatorConsoleRuntime.js';
import { listMerlinConnectedSources, upsertMerlinConnectedSource, type MerlinConnectedSourceRecord } from './connectedSourceRuntime.js';
import { listMerlinConnectorAdapters } from './connectorAdapterRuntime.js';
import { listMerlinSystemConnectors } from './systemConnectorRuntime.js';
import { runMerlinSearch } from './search/merlinSearch.js';
import { getMerlinThreadById, listMerlinThreadMessages, listMerlinThreads } from './threadRuntime.js';
import {
  MERLIN_SYSTEM_WORKSPACE_ID,
  getMerlinWorkspaceById,
  listMerlinRolePolicyChecks,
  listMerlinWorkspaceMembers,
  listMerlinWorkspaces
} from './workspaceRuntime.js';
import { getRegisteredActions } from './intake/intentRegistry.js';
import type { MerlinBrand } from './intake/intakeTypes.js';

export type MerlinShellPayload = {
  status: 'ok';
  mode: 'read_only';
  mutationAllowed: false;
  implementationAllowed: false;
  generatedAt: string;
  shell: {
    workspace: ReturnType<typeof getMerlinWorkspaceById>;
    workspaces: ReturnType<typeof listMerlinWorkspaces>;
    members: ReturnType<typeof listMerlinWorkspaceMembers>;
    connectedSources: MerlinConnectedSourceRecord[];
    sourceCatalog: Array<{
      sourceKey: string;
      label: string;
      type: string;
      trustLevel: number;
      aliases: string[];
      connected: boolean;
      connectionStatus: MerlinConnectedSourceRecord['connection_status'] | 'not_connected';
      authKind?: MerlinConnectedSourceRecord['auth_kind'];
      capabilities: string[];
    }>;
    actions: Array<ReturnType<typeof getRegisteredActions>[number] & { label: string }>;
    adapters: Array<{
      tool: string;
      action: string;
      status: string;
      executionMode: string;
      requiresApproval: boolean;
      permissionLevelRequired: string;
    }>;
    connectors: Array<{
      id: string;
      sourceKey: string;
      brand: string;
      label: string;
      mode: string;
      readCapabilities: string[];
      stageCapabilities: string[];
      executeCapabilities: string[];
      blockers: string[];
    }>;
    threads: ReturnType<typeof listMerlinThreads>;
    selectedThread?: {
      thread: ReturnType<typeof getMerlinThreadById>;
      messages: ReturnType<typeof listMerlinThreadMessages>;
    };
    searchResults: ReturnType<typeof runMerlinSearch>;
    recentRoleChecks: ReturnType<typeof listMerlinRolePolicyChecks>;
    suggestedNextSteps: string[];
  };
  operatorConsole: ReturnType<typeof getMerlinOperatorConsolePayload>;
};

type MerlinShellSourceCatalogRecord = MerlinShellPayload['shell']['sourceCatalog'][number];

function normalizeBrand(input?: string): MerlinBrand | undefined {
  const brand = String(input || '').trim().toUpperCase();
  if (brand === 'MEALSCOUT' || brand === 'TRADESCOUT' || brand === 'HOMEID' || brand === 'MERLIN') return brand;
  return undefined;
}

function toBrandLane(brand?: MerlinBrand): string | undefined {
  return brand ? brand.toLowerCase() : undefined;
}

export function connectMerlinSource(input: Parameters<typeof upsertMerlinConnectedSource>[0]): MerlinConnectedSourceRecord {
  return upsertMerlinConnectedSource(input);
}

export function getMerlinShellPayload(input: {
  workspace_id?: string;
  brand?: string;
  q?: string;
  thread_id?: string;
} = {}): MerlinShellPayload {
  const workspaceId = input.workspace_id?.trim() || MERLIN_SYSTEM_WORKSPACE_ID;
  const brand = normalizeBrand(input.brand);
  const workspace = getMerlinWorkspaceById(workspaceId) || getMerlinWorkspaceById(MERLIN_SYSTEM_WORKSPACE_ID);
  const connectedSources = listMerlinConnectedSources(workspace?.id || MERLIN_SYSTEM_WORKSPACE_ID);
  const connectedByKey = new Map(connectedSources.map((row) => [row.source_key, row]));
  const actions = getRegisteredActions()
    .filter((row) => !brand || row.brand === brand)
    .map((row) => ({
      ...row,
      label: `${row.brand} / ${row.actorScope} / ${row.actionId}`
    }));
  const searchResults = brand && input.q?.trim() ? runMerlinSearch(brand, input.q.trim()) : [];
  const threads = listMerlinThreads({
    workspace_id: workspace?.id || MERLIN_SYSTEM_WORKSPACE_ID,
    limit: 25
  });
  const selectedThreadRecord = input.thread_id ? getMerlinThreadById(input.thread_id) : threads[0];
  const selectedThread = selectedThreadRecord
    ? {
        thread: selectedThreadRecord,
        messages: listMerlinThreadMessages(selectedThreadRecord.id)
      }
    : undefined;
  const sourceCatalog = getRegisteredSources().map((source): MerlinShellSourceCatalogRecord => {
    const connection = connectedByKey.get(source.id);
    return {
      sourceKey: source.id,
      label: source.name,
      type: source.type,
      trustLevel: source.trustLevel,
      aliases: source.aliases,
      connected: Boolean(connection && connection.connection_status === 'connected'),
      connectionStatus: (connection?.connection_status || 'not_connected') as MerlinShellSourceCatalogRecord['connectionStatus'],
      authKind: connection?.auth_kind,
      capabilities: connection?.capabilities?.length ? connection.capabilities : []
    };
  });
  for (const connection of connectedSources) {
    if (sourceCatalog.some((row) => row.sourceKey === connection.source_key)) continue;
    sourceCatalog.push({
      sourceKey: connection.source_key,
      label: connection.source_label,
      type: connection.source_type,
      trustLevel: 1,
      aliases: [],
      connected: connection.connection_status === 'connected',
      connectionStatus: connection.connection_status,
      authKind: connection.auth_kind,
      capabilities: connection.capabilities
    });
  }
  const operatorConsole = getMerlinOperatorConsolePayload({
    brand_lane: toBrandLane(brand),
    limit: 10
  });

  const suggestedNextSteps: string[] = [];
  if (!sourceCatalog.some((row) => row.connected)) {
    suggestedNextSteps.push('Connect at least one source so Merlin has a live system to read from or act against.');
  }
  if (!actions.length) {
    suggestedNextSteps.push('No brand actions are registered for this shell view yet.');
  } else {
    suggestedNextSteps.push('Start an intake intent from the shell and attach evidence before asking Merlin to propose changes.');
  }
  const connectors =
    brand === 'MEALSCOUT' || brand === 'TRADESCOUT'
      ? listMerlinSystemConnectors({ brand })
      : listMerlinSystemConnectors();
  if (connectors.length > 0) {
    suggestedNextSteps.push(
      `Merlin has ${connectors.length} mapped system connector${connectors.length === 1 ? '' : 's'} for this brand, but execution still needs a live session bridge and normalized apply contract.`
    );
  }
  if (!threads.length) {
    suggestedNextSteps.push('Start a Merlin thread so user intent, follow-up context, files, and preview state stay in one conversation lane.');
  }
  if (!searchResults.length && input.q?.trim() && brand) {
    suggestedNextSteps.push('Search returned no indexed evidence yet. Attach or route evidence into Merlin intake first.');
  }
  if (operatorConsole.summary.approvalRequestedCount > 0) {
    suggestedNextSteps.push(`There are ${operatorConsole.summary.approvalRequestedCount} pending approvals waiting in the operator lane.`);
  }

  return {
    status: 'ok',
    mode: 'read_only',
    mutationAllowed: false,
    implementationAllowed: false,
    generatedAt: new Date().toISOString(),
    shell: {
      workspace,
      workspaces: listMerlinWorkspaces({ limit: 50 }),
      members: workspace ? listMerlinWorkspaceMembers(workspace.id) : [],
      connectedSources,
      sourceCatalog,
      actions,
      adapters: listMerlinConnectorAdapters({ limit: 100 }).map((row) => ({
        tool: row.tool,
        action: row.action,
        status: row.adapter_status,
        executionMode: row.execution_mode,
        requiresApproval: row.requires_approval === 1,
        permissionLevelRequired: row.permission_level_required
      })),
      connectors: connectors.map((row) => ({
        id: row.id,
        sourceKey: row.source_key,
        brand: row.brand,
        label: row.label,
        mode: row.mode,
        readCapabilities: row.read_capabilities,
        stageCapabilities: row.stage_capabilities,
        executeCapabilities: row.execute_capabilities,
        blockers: row.current_blockers
      })),
      threads,
      selectedThread,
      searchResults,
      recentRoleChecks: listMerlinRolePolicyChecks({ workspace_id: workspace?.id, limit: 10 }),
      suggestedNextSteps
    },
    operatorConsole
  };
}
