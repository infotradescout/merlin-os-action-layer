import { searchLisaSignals } from './lisa.js';
import { searchMerlinActionCards } from './merlin/actionCardRuntime.js';
import { searchMerlinApprovals } from './merlin/approvalRuntime.js';
import { searchMerlinConnectorAdapterChecks } from './merlin/connectorAdapterRuntime.js';
import { searchMerlinDryRunExecutions } from './merlin/dryRunExecutorRuntime.js';
import { searchMerlinExecutionPlans } from './merlin/executionPlanRuntime.js';
import { searchMerlinIntakeItems } from './merlin/intakeRuntime.js';
import { searchMerlinEntities } from './merlin/entityMemoryRuntime.js';
import { searchMerlinLiveExecutionGates } from './merlin/liveExecutionGateRuntime.js';
import { searchMerlinOutcomes } from './merlin/outcomeRuntime.js';

export function getSearchPayload(query = '') {
  const liveGateResults = searchMerlinLiveExecutionGates(query, 10).map((gate, index) => ({
    id: gate.id || `live-execution-gate-${index + 1}`,
    title: `[Live Gate] ${gate.gate_status}`,
    summary: `${gate.brand_lane} · ${gate.tool} · ${gate.action} · risk:${gate.risk_level} · reason:${gate.eligibility_reason}`,
    source: 'merlin_live_execution_gate',
    observed_at: gate.updated_at,
    confidence: gate.gate_status === 'disabled' ? 0.75 : gate.gate_status === 'blocked' ? 0.25 : 0.8
  }));
  const dryRunResults = searchMerlinDryRunExecutions(query, 10).map((dryRun, index) => ({
    id: dryRun.id || `dry-run-execution-${index + 1}`,
    title: `[Dry Run] ${dryRun.dry_run_status}`,
    summary: `${dryRun.brand_lane} · ${dryRun.tool} · ${dryRun.action} · suggested:${dryRun.suggested_outcome_type}`,
    source: 'merlin_dry_run_execution',
    observed_at: dryRun.updated_at,
    confidence: dryRun.dry_run_status === 'simulated' ? 0.9 : 0.35
  }));
  const adapterCheckResults = searchMerlinConnectorAdapterChecks(query, 10).map((check, index) => ({
    id: check.id || `adapter-check-${index + 1}`,
    title: `[Adapter Check] ${check.check_status}`,
    summary: `${check.execution_plan_id} · ${check.reason}`,
    source: 'merlin_connector_adapter_check',
    observed_at: check.created_at,
    confidence: check.check_status === 'pass' ? 0.9 : 0.35
  }));
  const executionPlanResults = searchMerlinExecutionPlans(query, 10).map((plan, index) => ({
    id: plan.id || `execution-plan-${index + 1}`,
    title: `[Execution Plan] ${plan.execution_status}`,
    summary: `${plan.brand_lane} · ${plan.tool} · ${plan.action} · mode:${plan.execution_mode} · reason:${plan.eligibility_reason}`,
    source: 'merlin_execution_plan',
    observed_at: plan.updated_at,
    confidence: plan.execution_status === 'eligible' ? 0.85 : plan.execution_status === 'blocked' ? 0.35 : 0.65
  }));
  const approvalResults = searchMerlinApprovals(query, 10).map((approval, index) => ({
    id: approval.id || `approval-${index + 1}`,
    title: `[Approval] ${approval.approval_status}`,
    summary: `${approval.brand_lane} · ${approval.kpi} · level:${approval.approval_level} · policy:${approval.policy_level}`,
    source: 'merlin_approval',
    observed_at: approval.updated_at,
    confidence: approval.approval_status === 'approved' ? 0.9 : approval.approval_status === 'blocked' ? 0.2 : 0.7
  }));
  const outcomeResults = searchMerlinOutcomes(query, 10).map((row, index) => ({
    id: row.id || `outcome-${index + 1}`,
    title: `[Outcome] ${row.outcome_type}`,
    summary: `${row.brand_lane} · ${row.kpi} · status:${row.status} · ${row.result_summary}`,
    source: 'merlin_outcome',
    observed_at: row.observed_at,
    confidence: row.status === 'verified' ? 0.95 : row.status === 'failed' ? 0.25 : 0.7
  }));
  const entityResults = searchMerlinEntities(query, 10).map((entity, index) => ({
    id: entity.id || `entity-${index + 1}`,
    title: `[Entity] ${entity.canonical_name}`,
    summary: `${entity.brand_lane} · ${entity.entity_type} · status:${entity.status}`,
    source: 'merlin_entity',
    observed_at: entity.updated_at,
    confidence: entity.confidence
  }));
  const intakeResults = searchMerlinIntakeItems(query, 10).map((item, index) => ({
    id: item.id || `intake-item-${index + 1}`,
    title: `[Intake] ${item.intent_text || item.raw_text || item.source_reference}`,
    summary: `${item.brand_lane} · ${item.source_type} · status:${item.status} · source:${item.source_reference}`,
    source: 'merlin_intake_item',
    observed_at: item.updated_at,
    confidence: item.confidence
  }));
  const signalResults = searchLisaSignals(query, 10).changes.map((item, index) => ({
    id: item.id || `search-${index + 1}`,
    title: item.title,
    summary: item.summary,
    source: item.source,
    observed_at: item.observed_at,
    confidence: item.truth_score
  }));
  const cardResults = searchMerlinActionCards(query, 10).map((card, index) => ({
    id: card.id || `action-card-${index + 1}`,
    title: `[Action Card] ${card.intent}`,
    summary: `${card.brand} · ${card.kpi} · status:${card.status} · action:${card.action}`,
    source: 'merlin_action_card',
    observed_at: card.updated_at,
    confidence: card.policy_result.blocked ? 0.1 : 0.8
  }));
  const results = [...liveGateResults, ...dryRunResults, ...adapterCheckResults, ...executionPlanResults, ...approvalResults, ...outcomeResults, ...entityResults, ...intakeResults, ...cardResults, ...signalResults].slice(0, 20);

  return {
    source: 'lisa+merlin_live_execution_gates+merlin_dry_run_executions+merlin_connector_adapter_checks+merlin_execution_plans+merlin_approvals+merlin_outcomes+merlin_entities+merlin_intake+merlin_action_cards',
    query,
    results
  };
}
