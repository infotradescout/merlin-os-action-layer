import { listMerlinActionCards, type MerlinActionCardStatus } from './actionCardRuntime.js';
import { listMerlinApprovals } from './approvalRuntime.js';
import { findMerlinIntakeItemIdByActionCardId, getMerlinIntakeItemById } from './intakeRuntime.js';
import { listMerlinOutcomes } from './outcomeRuntime.js';

export const MERLIN_WEEKLY_SCOREBOARD_KPI_IDS = [
  'loop_completion_rate',
  'intake_to_action_cycle_time',
  'approval_turnaround_time',
  'verification_failure_rate',
  'context_loss_incidents',
  'model_cost_per_completed_loop',
  'external_action_failure_rate',
  'operator_override_rate'
] as const;

export type MerlinWeeklyScoreboardKpiId = (typeof MERLIN_WEEKLY_SCOREBOARD_KPI_IDS)[number];

export type MerlinOwnerLane =
  | 'Mission Owner'
  | 'Product Loop Owner'
  | 'Runtime/Platform Owner'
  | 'Verification/Policy Owner'
  | 'Memory/Knowledge Owner'
  | 'Connector Operations Owner'
  | 'Operator Experience Owner'
  | 'Economics Owner';

export type MerlinScoreboardAvailability = 'implemented' | 'partial' | 'not_implemented';

export type MerlinWeeklyKpiContractDefinition = {
  id: MerlinWeeklyScoreboardKpiId;
  owner_lane: MerlinOwnerLane;
  source_table_file_event_stream: string[];
  calculation_formula: string;
  required_fields: string[];
  missing_data_behavior: string;
  authoritative_query_output_path: string;
  weekly_output_shape: {
    value: 'number|null';
    unit: 'ratio|hours|count|usd';
    numerator: 'number|null';
    denominator: 'number|null';
    sample_size: 'number';
    status: 'available|unavailable';
    missing_reason: 'string|null';
  };
  availability: MerlinScoreboardAvailability;
};

export type MerlinWeeklyScoreboardContract = {
  contract: 'merlin_weekly_scoreboard_data_contract';
  version: 'v1';
  authoritative_output_path: '/api/merlin/scoreboard/weekly';
  kpis: MerlinWeeklyKpiContractDefinition[];
};

export type MerlinWeeklyMetricValue = {
  kpi_id: MerlinWeeklyScoreboardKpiId;
  owner_lane: MerlinOwnerLane;
  value: number | null;
  unit: 'ratio' | 'hours' | 'count' | 'usd';
  numerator: number | null;
  denominator: number | null;
  sample_size: number;
  status: 'available' | 'unavailable';
  missing_reason: string | null;
};

export type MerlinWeeklyScoreboardSnapshot = {
  status: 'ok';
  mode: 'read_only';
  mutationAllowed: false;
  contractVersion: 'v1';
  week: {
    start: string;
    end: string;
  };
  metrics: Record<MerlinWeeklyScoreboardKpiId, MerlinWeeklyMetricValue>;
};

const TERMINAL_ACTION_CARD_STATUSES = new Set<MerlinActionCardStatus>(['completed', 'failed', 'blocked', 'rejected', 'deferred']);
const TERMINAL_APPROVAL_STATUSES = new Set(['approved', 'rejected', 'expired', 'revoked', 'blocked']);

const KPI_DEFINITIONS: MerlinWeeklyKpiContractDefinition[] = [
  {
    id: 'loop_completion_rate',
    owner_lane: 'Product Loop Owner',
    source_table_file_event_stream: ['sqlite:merlin_action_cards'],
    calculation_formula: 'completed_loops / started_loops where started_loops are action cards created in week and completed_loops are terminal statuses in week scope.',
    required_fields: ['id', 'status', 'created_at'],
    missing_data_behavior: 'If started_loops = 0, emit status=unavailable and missing_reason=no_started_loops.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.loop_completion_rate',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'implemented'
  },
  {
    id: 'intake_to_action_cycle_time',
    owner_lane: 'Runtime/Platform Owner',
    source_table_file_event_stream: ['sqlite:merlin_intake_items', 'sqlite:merlin_intake_action_card_links', 'sqlite:merlin_outcomes'],
    calculation_formula: 'median(hours(outcome.observed_at - intake.created_at)) for outcomes linked to action cards and intake items in week window.',
    required_fields: ['merlin_intake_items.id', 'merlin_intake_items.created_at', 'merlin_intake_action_card_links.action_card_id', 'merlin_outcomes.action_card_id', 'merlin_outcomes.observed_at'],
    missing_data_behavior: 'If no linked intake->action->outcome samples exist, emit status=unavailable and missing_reason=no_linked_samples.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.intake_to_action_cycle_time',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'implemented'
  },
  {
    id: 'approval_turnaround_time',
    owner_lane: 'Verification/Policy Owner',
    source_table_file_event_stream: ['sqlite:merlin_approvals'],
    calculation_formula: 'median(hours(updated_at - created_at)) for approvals that reach terminal approval_status in week window.',
    required_fields: ['id', 'approval_status', 'created_at', 'updated_at'],
    missing_data_behavior: 'If no terminal approvals exist in window, emit status=unavailable and missing_reason=no_terminal_approvals.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.approval_turnaround_time',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'implemented'
  },
  {
    id: 'verification_failure_rate',
    owner_lane: 'Verification/Policy Owner',
    source_table_file_event_stream: ['planned:merlin_verification_packets'],
    calculation_formula: 'failed_verification_packets / total_verification_packets for weekly window.',
    required_fields: ['verification_id', 'status', 'created_at'],
    missing_data_behavior: 'Current runtime has no dedicated verification packet store. Emit status=unavailable and missing_reason=source_not_implemented.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.verification_failure_rate',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'not_implemented'
  },
  {
    id: 'context_loss_incidents',
    owner_lane: 'Memory/Knowledge Owner',
    source_table_file_event_stream: ['planned:context_loss_incident_events'],
    calculation_formula: 'count(context_loss_incident) in weekly window.',
    required_fields: ['incident_id', 'entity_id', 'created_at', 'reason'],
    missing_data_behavior: 'Current runtime has no dedicated context-loss incident event stream. Emit status=unavailable and missing_reason=source_not_implemented.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.context_loss_incidents',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'not_implemented'
  },
  {
    id: 'model_cost_per_completed_loop',
    owner_lane: 'Economics Owner',
    source_table_file_event_stream: ['planned:model_usage_cost_ledger', 'sqlite:merlin_action_cards'],
    calculation_formula: 'sum(model_cost_usd) / completed_loops in weekly window.',
    required_fields: ['model_cost_usd', 'created_at', 'loop_id'],
    missing_data_behavior: 'Current runtime has no model cost ledger. Emit status=unavailable and missing_reason=source_not_implemented.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.model_cost_per_completed_loop',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'not_implemented'
  },
  {
    id: 'external_action_failure_rate',
    owner_lane: 'Connector Operations Owner',
    source_table_file_event_stream: ['planned:merlin_external_execution_receipts'],
    calculation_formula: 'failed_external_actions / attempted_external_actions in weekly window.',
    required_fields: ['execution_id', 'status', 'connector', 'created_at'],
    missing_data_behavior: 'Current runtime does not persist a dedicated external execution receipt stream. Emit status=unavailable and missing_reason=source_not_implemented.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.external_action_failure_rate',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'not_implemented'
  },
  {
    id: 'operator_override_rate',
    owner_lane: 'Operator Experience Owner',
    source_table_file_event_stream: ['planned:operator_override_decision_events', 'sqlite:merlin_approvals'],
    calculation_formula: 'operator_overrides / total_decisions in weekly window.',
    required_fields: ['decision_id', 'is_override', 'created_at'],
    missing_data_behavior: 'Current runtime does not mark explicit override decisions. Emit status=unavailable and missing_reason=source_not_implemented.',
    authoritative_query_output_path: '/api/merlin/scoreboard/weekly -> metrics.operator_override_rate',
    weekly_output_shape: {
      value: 'number|null',
      unit: 'ratio|hours|count|usd',
      numerator: 'number|null',
      denominator: 'number|null',
      sample_size: 'number',
      status: 'available|unavailable',
      missing_reason: 'string|null'
    },
    availability: 'not_implemented'
  }
];

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`invalid_${label}`);
  }
}

function asRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Number(sorted[mid].toFixed(6));
  return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(6));
}

function withinRange(iso: string, startMs: number, endMs: number): boolean {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return false;
  return parsed >= startMs && parsed < endMs;
}

function unavailableMetric(def: MerlinWeeklyKpiContractDefinition, reason: string): MerlinWeeklyMetricValue {
  const unit = def.id.includes('time') ? 'hours' : def.id.includes('cost') ? 'usd' : def.id.includes('incidents') ? 'count' : 'ratio';
  return {
    kpi_id: def.id,
    owner_lane: def.owner_lane,
    value: null,
    unit,
    numerator: null,
    denominator: null,
    sample_size: 0,
    status: 'unavailable',
    missing_reason: reason
  };
}

function metricUnit(id: MerlinWeeklyScoreboardKpiId): MerlinWeeklyMetricValue['unit'] {
  if (id === 'intake_to_action_cycle_time' || id === 'approval_turnaround_time') return 'hours';
  if (id === 'context_loss_incidents') return 'count';
  if (id === 'model_cost_per_completed_loop') return 'usd';
  return 'ratio';
}

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function getMerlinWeeklyScoreboardContract(): MerlinWeeklyScoreboardContract {
  const contract: MerlinWeeklyScoreboardContract = {
    contract: 'merlin_weekly_scoreboard_data_contract',
    version: 'v1',
    authoritative_output_path: '/api/merlin/scoreboard/weekly',
    kpis: KPI_DEFINITIONS
  };
  validateMerlinWeeklyScoreboardContract(contract);
  return contract;
}

export function validateMerlinWeeklyScoreboardContract(contract: MerlinWeeklyScoreboardContract): void {
  const ids = new Set(contract.kpis.map((kpi) => kpi.id));
  for (const requiredId of MERLIN_WEEKLY_SCOREBOARD_KPI_IDS) {
    if (!ids.has(requiredId)) {
      throw new Error(`missing_kpi_definition:${requiredId}`);
    }
  }
  if (ids.size !== MERLIN_WEEKLY_SCOREBOARD_KPI_IDS.length) {
    throw new Error('duplicate_or_unknown_kpi_definition');
  }
  for (const kpi of contract.kpis) {
    assertNonEmptyString(kpi.id, 'kpi_id');
    assertNonEmptyString(kpi.owner_lane, 'owner_lane');
    assertNonEmptyString(kpi.calculation_formula, 'calculation_formula');
    assertNonEmptyString(kpi.missing_data_behavior, 'missing_data_behavior');
    assertNonEmptyString(kpi.authoritative_query_output_path, 'authoritative_query_output_path');
    if (!Array.isArray(kpi.source_table_file_event_stream) || kpi.source_table_file_event_stream.length === 0) {
      throw new Error(`invalid_source_table_file_event_stream:${kpi.id}`);
    }
    if (!Array.isArray(kpi.required_fields) || kpi.required_fields.length === 0) {
      throw new Error(`invalid_required_fields:${kpi.id}`);
    }
  }
}

export function buildMerlinWeeklyScoreboardSnapshot(input: {
  weekStart?: string;
  weekEnd?: string;
  brandLane?: string;
} = {}): MerlinWeeklyScoreboardSnapshot {
  const contract = getMerlinWeeklyScoreboardContract();
  const fallback = defaultWindow();
  const weekStart = input.weekStart || fallback.start;
  const weekEnd = input.weekEnd || fallback.end;
  const startMs = Date.parse(weekStart);
  const endMs = Date.parse(weekEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error('invalid_week_range');
  }
  const brand = input.brandLane?.trim().toLowerCase();

  const metrics: Record<MerlinWeeklyScoreboardKpiId, MerlinWeeklyMetricValue> = {
    loop_completion_rate: unavailableMetric(contract.kpis[0], 'pending_computation'),
    intake_to_action_cycle_time: unavailableMetric(contract.kpis[1], 'pending_computation'),
    approval_turnaround_time: unavailableMetric(contract.kpis[2], 'pending_computation'),
    verification_failure_rate: unavailableMetric(contract.kpis[3], 'source_not_implemented'),
    context_loss_incidents: unavailableMetric(contract.kpis[4], 'source_not_implemented'),
    model_cost_per_completed_loop: unavailableMetric(contract.kpis[5], 'source_not_implemented'),
    external_action_failure_rate: unavailableMetric(contract.kpis[6], 'source_not_implemented'),
    operator_override_rate: unavailableMetric(contract.kpis[7], 'source_not_implemented')
  };

  const actionCards = listMerlinActionCards({ brand, limit: 5000 }).filter((row) => withinRange(row.created_at, startMs, endMs));
  const startedLoops = actionCards.length;
  const completedLoops = actionCards.filter((row) => TERMINAL_ACTION_CARD_STATUSES.has(row.status)).length;
  metrics.loop_completion_rate = startedLoops > 0
    ? {
        kpi_id: 'loop_completion_rate',
        owner_lane: 'Product Loop Owner',
        value: asRatio(completedLoops, startedLoops),
        unit: metricUnit('loop_completion_rate'),
        numerator: completedLoops,
        denominator: startedLoops,
        sample_size: startedLoops,
        status: 'available',
        missing_reason: null
      }
    : unavailableMetric(contract.kpis[0], 'no_started_loops');

  const outcomes = listMerlinOutcomes({ brand_lane: brand, limit: 5000 }).filter((row) => withinRange(row.observed_at, startMs, endMs));
  const intakeToActionSamples: number[] = [];
  for (const outcome of outcomes) {
    const intakeId = findMerlinIntakeItemIdByActionCardId(outcome.action_card_id);
    if (!intakeId) continue;
    const intake = getMerlinIntakeItemById(intakeId);
    if (!intake) continue;
    const intakeMs = Date.parse(intake.created_at);
    const observedMs = Date.parse(outcome.observed_at);
    if (!Number.isFinite(intakeMs) || !Number.isFinite(observedMs) || observedMs < intakeMs) continue;
    intakeToActionSamples.push((observedMs - intakeMs) / 3_600_000);
  }
  const cycleMedian = median(intakeToActionSamples);
  metrics.intake_to_action_cycle_time = cycleMedian !== null
    ? {
        kpi_id: 'intake_to_action_cycle_time',
        owner_lane: 'Runtime/Platform Owner',
        value: cycleMedian,
        unit: metricUnit('intake_to_action_cycle_time'),
        numerator: null,
        denominator: null,
        sample_size: intakeToActionSamples.length,
        status: 'available',
        missing_reason: null
      }
    : unavailableMetric(contract.kpis[1], 'no_linked_samples');

  const approvals = listMerlinApprovals({ brand_lane: brand, limit: 5000 }).filter((row) => withinRange(row.created_at, startMs, endMs));
  const approvalSamples: number[] = [];
  for (const approval of approvals) {
    if (!TERMINAL_APPROVAL_STATUSES.has(approval.approval_status)) continue;
    const created = Date.parse(approval.created_at);
    const updated = Date.parse(approval.updated_at);
    if (!Number.isFinite(created) || !Number.isFinite(updated) || updated < created) continue;
    approvalSamples.push((updated - created) / 3_600_000);
  }
  const approvalMedian = median(approvalSamples);
  metrics.approval_turnaround_time = approvalMedian !== null
    ? {
        kpi_id: 'approval_turnaround_time',
        owner_lane: 'Verification/Policy Owner',
        value: approvalMedian,
        unit: metricUnit('approval_turnaround_time'),
        numerator: null,
        denominator: null,
        sample_size: approvalSamples.length,
        status: 'available',
        missing_reason: null
      }
    : unavailableMetric(contract.kpis[2], 'no_terminal_approvals');

  return {
    status: 'ok',
    mode: 'read_only',
    mutationAllowed: false,
    contractVersion: 'v1',
    week: {
      start: weekStart,
      end: weekEnd
    },
    metrics
  };
}
