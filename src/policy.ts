type PolicyLevel = 'read_only' | 'organize_internal' | 'draft_only' | 'approval_required' | 'blocked_high_risk';

type ActionType =
  | 'view_context'
  | 'create_internal_note'
  | 'create_task'
  | 'draft_message'
  | 'suggest_follow_up'
  | 'update_internal_status'
  | 'send_external_message'
  | 'approve_verification'
  | 'change_payment_state'
  | 'delete_record';

type BrandLane = 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system';

const BRAND_LANES: Set<string> = new Set([
  'tradescout',
  'mealscout',
  'merlin',
  'lisa',
  'continuum',
  'marketfilter',
  'system'
]);

const POLICY_LEVEL_BY_ACTION: Record<ActionType, PolicyLevel> = {
  view_context: 'read_only',
  create_internal_note: 'organize_internal',
  create_task: 'organize_internal',
  draft_message: 'draft_only',
  suggest_follow_up: 'draft_only',
  update_internal_status: 'approval_required',
  send_external_message: 'approval_required',
  approve_verification: 'approval_required',
  change_payment_state: 'blocked_high_risk',
  delete_record: 'blocked_high_risk'
};

const FINANCIAL_ACTIONS: Set<string> = new Set(['change_payment_state']);
const DESTRUCTIVE_ACTIONS: Set<string> = new Set(['delete_record']);
const EXTERNAL_SEND_ACTIONS: Set<string> = new Set(['send_external_message']);

export interface PolicyInput {
  action_type: string;
  brand_lane?: string;
  reason_context?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  level: PolicyLevel;
  requires_approval: boolean;
  blocked: boolean;
  reason: string;
  brand_lane: BrandLane;
  action_type: ActionType | string;
}

function normalizeActionType(value: string): string {
  return (value || '').trim().toLowerCase();
}

function normalizeBrandLane(value = 'system'): BrandLane {
  const normalized = normalizeActionType(value);
  return (BRAND_LANES.has(normalized) ? normalized : 'system') as BrandLane;
}

function levelFromAction(actionType: string): PolicyLevel {
  if (!Object.prototype.hasOwnProperty.call(POLICY_LEVEL_BY_ACTION, actionType)) {
    return 'blocked_high_risk';
  }
  return POLICY_LEVEL_BY_ACTION[actionType as ActionType];
}

function actionIsFinancial(actionType: string): boolean {
  return FINANCIAL_ACTIONS.has(actionType);
}

function actionIsDestructive(actionType: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(actionType);
}

function actionIsExternalSend(actionType: string): boolean {
  return EXTERNAL_SEND_ACTIONS.has(actionType);
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const actionType = normalizeActionType(input.action_type);
  const brandLane = normalizeBrandLane(input.brand_lane);
  const actionIsKnown = Object.prototype.hasOwnProperty.call(POLICY_LEVEL_BY_ACTION, actionType);
  const action = actionIsKnown ? (actionType as ActionType) : ('view_context' as ActionType);

  if (actionIsFinancial(actionType)) {
    return {
      allowed: false,
      level: 'blocked_high_risk',
      requires_approval: false,
      blocked: true,
      reason: 'Financial actions are blocked under current policy.',
      brand_lane: brandLane,
      action_type: actionType
    };
  }

  if (actionIsDestructive(actionType)) {
    return {
      allowed: false,
      level: 'blocked_high_risk',
      requires_approval: false,
      blocked: true,
      reason: 'Destructive actions are blocked under current policy.',
      brand_lane: brandLane,
      action_type: actionType
    };
  }

  if (!actionIsKnown) {
    return {
      allowed: false,
      level: 'blocked_high_risk',
      requires_approval: false,
      blocked: true,
      reason: `Unknown action '${actionType}' is blocked by default.`,
      brand_lane: brandLane,
      action_type: actionType
    };
  }

  const level = levelFromAction(actionType);
  const requiresApproval = actionIsExternalSend(actionType) || level === 'approval_required';

  return {
    allowed: true,
    level,
    requires_approval: requiresApproval,
    blocked: false,
    reason:
      requiresApproval
        ? `${action} requires approval.`
        : `Action ${action} is allowed at policy level ${level}.`,
    brand_lane: brandLane,
    action_type: action
  };
}

export function resetPolicyForTest(): void {
  // Reserved for deterministic test setup.
}
