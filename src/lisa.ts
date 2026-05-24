type BrandLane = 'TradeScout' | 'MealScout' | 'TradersCorner' | 'LISA' | 'MerlinOS';

type SignalType =
  | 'contractor_claim'
  | 'homeowner_need'
  | 'host_intake'
  | 'event_intake'
  | 'vendor_activation'
  | 'online_order'
  | 'parking_booking'
  | 'payment_status'
  | 'design_request'
  | 'calendar_commitment'
  | 'support_request'
  | 'repo_task'
  | 'ops_update';

const SIGNAL_TYPES: SignalType[] = [
  'contractor_claim',
  'homeowner_need',
  'host_intake',
  'event_intake',
  'vendor_activation',
  'online_order',
  'parking_booking',
  'payment_status',
  'design_request',
  'calendar_commitment',
  'support_request',
  'repo_task',
  'ops_update'
];

const TRADESCOUT_SIGNAL_MAP: Record<string, SignalType> = {
  verification_document_uploaded: 'contractor_claim',
  insurance_document_uploaded: 'contractor_claim',
  contractor_document_uploaded: 'contractor_claim',
  quote_requested: 'support_request',
  payment_received: 'payment_status',
  verification_review_needed: 'support_request'
};

type SourceType = 'drive' | 'gmail' | 'calendar' | 'stripe' | 'canva' | 'github' | 'web' | 'app' | 'manual';

type ActionType = 'none' | 'inspect' | 'draft' | 'create' | 'update' | 'route' | 'block';

interface LISARecommendedAction {
  type: ActionType;
  description: string;
}

interface LISAEntityRef {
  type: string;
  id_or_name: string;
}

interface LISASource {
  type: SourceType;
  name: string;
  reference: string;
}

interface LISAEvent {
  signal_id: string;
  source: LISASource;
  brand_lane: BrandLane;
  signal_type: SignalType;
  entity: LISAEntityRef;
  observed_at: string;
  truth_score: number;
  newness_score: number;
  recommended_action: LISARecommendedAction;
  review_required: boolean;
  block_reason?: string;
  notes?: string;
  title?: string;
  summary?: string;
}

interface TradeScoutActivityEvent {
  event_id?: string;
  entity_id: string;
  entity_type?: string;
  event_type?: string;
  signal_type?: string;
  observed_at?: string;
  truth_score?: number;
  newness_score?: number;
  recommended_action?: LISARecommendedAction;
  review_required?: boolean;
  source_reference?: string;
  title?: string;
  summary?: string;
  notes?: string;
}

export interface EntityStatePayload {
  entity_id: string;
  entity_type: string;
  brand_lane: BrandLane;
  current_state: string;
  truth_score: number;
  newness_score: number;
  state_age_hours: number;
  last_signal_id: string;
  source_refs: string[];
  last_observed_at: string;
  attention_required: boolean;
}

export interface TimelineEntry {
  id: string;
  entity_id: string;
  signal_type: SignalType;
  observed_at: string;
  age_hours: number;
  title: string;
  summary: string;
  source: string;
  brand_lane: BrandLane;
  review_required: boolean;
  truth_score: number;
  newness_score: number;
}

export interface DailyChangeItem {
  id: string;
  title: string;
  summary: string;
  source_refs: string[];
  confidence?: number;
}

export interface DailyPayload {
  date: string;
  user_id: string;
  sections: {
    changed: DailyChangeItem[];
    needs_attention: DailyChangeItem[];
    waiting: DailyChangeItem[];
    stale: DailyChangeItem[];
    suggested_next_steps: DailyChangeItem[];
  };
  source_refs: string[];
  generated_at: string;
}

interface DailyConfig {
  userId: string;
  now: number;
  maxItemsPerSection: number;
}

type ChangeResult = {
  changes: TimelineEntry[];
  sourceRefs: string[];
};

const events = new Map<string, LISAEvent[]>();
const eventIndex: LISAEvent[] = [];

const ONE_HOUR = 1000 * 60 * 60;
const DAY = ONE_HOUR * 24;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toSignalDate(observedAt?: string): string {
  if (!observedAt) return new Date().toISOString();
  const parsed = new Date(observedAt);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function addEvent(signal: LISAEvent): void {
  const existing = events.get(signal.entity.id_or_name) ?? [];
  existing.push(signal);
  existing.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
  events.set(signal.entity.id_or_name, existing);

  eventIndex.push(signal);
  eventIndex.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
}

function toTimelineEntry(event: LISAEvent, now: number): TimelineEntry {
  const observedTime = new Date(event.observed_at).getTime();
  const title =
    event.title ??
    `${event.signal_type.replace(/_/g, ' ')} for ${event.entity.id_or_name} (${event.brand_lane})`;
  const summary =
    event.summary ??
    `${event.source.name} reported: ${event.recommended_action.description}`;

  return {
    id: event.signal_id,
    entity_id: event.entity.id_or_name,
    signal_type: event.signal_type,
    observed_at: event.observed_at,
    age_hours: Math.max(0, (now - observedTime) / ONE_HOUR),
    title,
    summary,
    source: event.source.reference,
    brand_lane: event.brand_lane,
    review_required: event.review_required,
    truth_score: event.truth_score,
    newness_score: event.newness_score
  };
}

function asDailyItem(event: LISAEvent): DailyChangeItem {
  const summary =
    event.summary ??
    `${event.recommended_action.description} (${new Date(event.observed_at).toISOString()})`;
  return {
    id: `daily-${event.signal_id}`,
    title: event.title ?? `${event.signal_type.replace(/_/g, ' ')}`,
    summary,
    confidence: event.truth_score,
    source_refs: [event.source.reference, `lisa:${event.signal_id}`]
  };
}

function deriveActionType(signalType: SignalType): ActionType {
  if (signalType === 'contractor_claim' || signalType === 'support_request') return 'inspect';
  if (signalType === 'host_intake' || signalType === 'vendor_activation') return 'route';
  if (signalType === 'online_order' || signalType === 'parking_booking') return 'update';
  return 'none';
}

function normalizeSignalType(value?: string): SignalType {
  if (!value) return 'contractor_claim';
  const direct = value.trim().toLowerCase();
  if (SIGNAL_TYPES.includes(direct as SignalType)) return direct as SignalType;
  if (direct in TRADESCOUT_SIGNAL_MAP) return TRADESCOUT_SIGNAL_MAP[direct];
  return 'contractor_claim';
}

function createSignalFromTradeScoutEvent(payload: TradeScoutActivityEvent): LISAEvent {
  const observedAt = toSignalDate(payload.observed_at);
  const rawSignalType = payload.signal_type ?? payload.event_type;
  const signalType = normalizeSignalType(rawSignalType);
  const signalId = payload.event_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title =
    payload.title ??
    `TradeScout ${signalType.replace(/_/g, ' ')}: ${payload.entity_id}`;
  const summary =
    payload.summary ??
    `${payload.entity_id} had a TradeScout activity of ${signalType.replace(/_/g, ' ')}`;
  const action =
    payload.recommended_action ??
    { type: deriveActionType(signalType), description: `Review ${signalType.replace(/_/g, ' ')}` };

  return {
    signal_id: signalId,
    source: {
      type: 'app',
      name: 'TradeScout',
      reference: payload.source_reference || `tradescout:${payload.entity_id}`
    },
    brand_lane: 'TradeScout',
    signal_type: signalType,
    entity: {
      type: payload.entity_type || 'entity',
      id_or_name: payload.entity_id
    },
    observed_at: observedAt,
    truth_score: clamp01(payload.truth_score ?? 0.9),
    newness_score: clamp01(payload.newness_score ?? 0.9),
    recommended_action: action,
    review_required: Boolean(payload.review_required),
    title,
    summary,
    notes: payload.notes
  };
}

function classifyEventForDaily(event: LISAEvent, now: number): keyof DailyPayload['sections'] | 'ignore' {
  const ageHours = (now - new Date(event.observed_at).getTime()) / ONE_HOUR;
  if (event.review_required) return 'needs_attention';
  if (ageHours <= 24 && event.truth_score >= 0.6) return 'changed';
  if (event.recommended_action.type === 'route' && ageHours <= (DAY / ONE_HOUR) * 2) return 'waiting';
  if (ageHours >= 72 && event.truth_score < 0.75) return 'stale';
  return 'ignore';
}

function collectRecentEvents(limit: number): LISAEvent[] {
  return eventIndex.slice(0, Math.max(1, limit));
}

export function ingestTradeScoutEvent(payload: TradeScoutActivityEvent): string {
  if (!payload.entity_id || !String(payload.entity_id).trim()) {
    throw new Error('TradeScout events require entity_id');
  }

  const event = createSignalFromTradeScoutEvent(payload);
  addEvent(event);
  return event.signal_id;
}

export function getEntityState(entityId: string): EntityStatePayload | null {
  const timeline = events.get(entityId) ?? [];
  if (!timeline.length) return null;

  const latest = timeline[0];
  const now = Date.now();
  const ageHours = (now - new Date(latest.observed_at).getTime()) / ONE_HOUR;
  const attentionRequired = latest.review_required || latest.truth_score < 0.5;

  const currentState =
    latest.review_required
      ? 'needs_attention'
      : latest.recommended_action.type === 'route'
        ? 'waiting_for_followup'
        : latest.recommended_action.type === 'none'
          ? 'monitoring'
          : 'active';

  return {
    entity_id: entityId,
    entity_type: latest.entity.type,
    brand_lane: latest.brand_lane,
    current_state: currentState,
    truth_score: latest.truth_score,
    newness_score: latest.newness_score,
    state_age_hours: ageHours,
    last_signal_id: latest.signal_id,
    source_refs: [latest.source.reference, `lisa:${latest.signal_id}`],
    last_observed_at: latest.observed_at,
    attention_required: attentionRequired
  };
}

export function getEntityTimeline(entityId: string, limit = 20): TimelineEntry[] {
  const timeline = events.get(entityId) ?? [];
  const now = Date.now();
  const maxCount = Math.max(1, Math.min(100, limit));
  return timeline.slice(0, maxCount).map((event) => toTimelineEntry(event, now));
}

export function getRecentChanges(limit = 20): ChangeResult {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const now = Date.now();
  const changes = collectRecentEvents(safeLimit).map((event) => toTimelineEntry(event, now));
  const sourceRefs = Array.from(
    new Set(changes.map((change) => change.id).map((id) => `lisa:${id}`))
  );
  return { changes, sourceRefs };
}

export function searchLisaSignals(query: string, limit = 20): ChangeResult {
  const token = (query || '').trim().toLowerCase();
  const maxCount = Math.max(1, Math.min(100, limit));
  const now = Date.now();

  const candidates = token.length
    ? eventIndex.filter((event) => {
        const haystack = `${event.signal_id} ${event.signal_type} ${event.entity.id_or_name} ${event.title ?? ''} ${event.summary ?? ''} ${event.notes ?? ''}`.toLowerCase();
        return haystack.includes(token);
      })
    : eventIndex;

  const results = candidates.slice(0, maxCount).map((event) => toTimelineEntry(event, now));
  const sourceRefs = Array.from(new Set(results.map((item) => item.source)));
  return { changes: results, sourceRefs };
}

export function getDailyPayloadForUser(userId = 'demo-user', options: Partial<DailyConfig> = {}): DailyPayload {
  const now = options.now || Date.now();
  const maxItemsPerSection = options.maxItemsPerSection || 12;
  const sorted = eventIndex.slice();
  const sectionCounts = {
    changed: [] as DailyChangeItem[],
    needs_attention: [] as DailyChangeItem[],
    waiting: [] as DailyChangeItem[],
    stale: [] as DailyChangeItem[],
    suggested_next_steps: [] as DailyChangeItem[]
  };

  for (const event of sorted) {
    const category = classifyEventForDaily(event, now);
    if (category === 'ignore') continue;
    if (sectionCounts[category].length >= maxItemsPerSection) continue;
    sectionCounts[category].push(asDailyItem(event));
  }

  // fill one suggested-next-step section from anything that needs attention, waiting,
  // or changed with high urgency signals.
  sectionCounts.suggested_next_steps = [
    ...sectionCounts.needs_attention,
    ...sectionCounts.waiting,
    ...sectionCounts.changed.filter((entry) => entry.confidence && entry.confidence >= 0.8)
  ].slice(0, maxItemsPerSection).map((entry, index) => ({
    ...entry,
    id: `next-${index + 1}-${entry.id}`
  }));

  const sourceRefs = new Set<string>(['lisa']);
  for (const item of [...sectionCounts.changed, ...sectionCounts.needs_attention, ...sectionCounts.waiting, ...sectionCounts.stale]) {
    for (const ref of item.source_refs) sourceRefs.add(ref);
  }

  return {
    date: new Date(now).toISOString().slice(0, 10),
    user_id: userId,
    sections: sectionCounts,
    source_refs: [...sourceRefs],
    generated_at: new Date(now).toISOString()
  };
}

export function resetLisaStore(): void {
  events.clear();
  eventIndex.length = 0;
}
