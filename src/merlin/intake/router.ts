import type { RoutingDecision, UploadIntent, UploadIntentFileRef } from './intakeTypes.js';

type RoutableType = Exclude<RoutingDecision['routedType'], 'held' | 'unknown'>;

const ACTION_EXPECTED_ROUTES: Record<string, RoutableType[]> = {
  update_menu: ['menu'],
  update_schedule: ['schedule'],
  upload_logo: ['logo'],
  add_food_photos: ['photo'],
  attach_menu_evidence: ['menu'],
  attach_schedule_evidence: ['schedule'],
  attach_logo_media: ['logo'],
  add_event_flyer: ['photo'],
  attach_event_flyer: ['photo'],
  update_hours: ['schedule'],
  update_location: ['photo'],
  update_contact_info: ['photo', 'document']
};

const ACTION_ROUTE_CONFIDENCE_BONUS = 0.2;
const MIN_EXPECTED_DESTINATION_CONFIDENCE = 0.8;

function isRoutableType(routedType: RoutingDecision['routedType']): routedType is RoutableType {
  return routedType !== 'held' && routedType !== 'unknown';
}

function classifyBase(file: UploadIntentFileRef): RoutingDecision {
  const name = (file.fileName || '').toLowerCase();
  const text = (file.extractedText || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  const reasons: string[] = [];
  let routedType: RoutingDecision['routedType'] = 'unknown';
  let confidence = 0.2;

  const menuSignal = /menu|special|price/.test(name) || /\$\s?\d|\b\d+\.\d{2}\b|menu|combo|wings|plate|taco/.test(text);
  const scheduleSignal = /schedule|hours|open|closed|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|event/.test(name) ||
    /\b(mon|tue|wed|thu|fri|sat|sun)\b|hours|open|closed|\d{1,2}:\d{2}\s?(am|pm)/.test(text);
  const logoSignal = /logo|fb_img|avatar|profile[_ -]?pic/.test(name) || /logo/.test(text);
  const photoSignal = mime.startsWith('image/') && text.trim().length < 16;
  const docSignal = mime === 'application/pdf' || /\.pdf$/i.test(file.fileName || '');
  const contentSignalNames: Array<'menu' | 'schedule' | 'logo'> = [];

  if (menuSignal) contentSignalNames.push('menu');
  if (scheduleSignal) contentSignalNames.push('schedule');
  if (logoSignal) contentSignalNames.push('logo');

  if (contentSignalNames.length > 1) {
    return {
      ...file,
      routedType: 'held',
      confidence: 0.55,
      reasons: contentSignalNames.map((signal) => `${signal}_signal_detected`).concat('competing_destination_signals'),
      holdReason: 'ambiguous'
    };
  }

  if (menuSignal) {
    routedType = 'menu';
    confidence = 0.72;
    reasons.push('menu_signal_detected');
  } else if (scheduleSignal) {
    routedType = 'schedule';
    confidence = 0.7;
    reasons.push('schedule_signal_detected');
  } else if (logoSignal) {
    routedType = 'logo';
    confidence = 0.68;
    reasons.push('logo_signal_detected');
  } else if (photoSignal) {
    routedType = 'photo';
    confidence = 0.6;
    reasons.push('photo_signal_detected');
  } else if (docSignal) {
    routedType = 'document';
    confidence = 0.55;
    reasons.push('document_signal_detected');
  }

  if (routedType === 'unknown') {
    return { ...file, routedType: 'held', confidence, reasons: ['no_destination_signal_detected'], holdReason: 'insufficient_evidence' };
  }
  if (confidence < 0.6) {
    return { ...file, routedType: 'held', confidence, reasons: reasons.concat('low_base_confidence'), holdReason: 'insufficient_evidence' };
  }
  return { ...file, routedType, confidence, reasons };
}

export function routeUploadIntentFiles(intent: UploadIntent): RoutingDecision[] {
  return intent.files.map((file) => {
    const routed = classifyBase(file);
    const text = (file.extractedText || '').toLowerCase();
    const actionId = intent.actionId;
    let biased = routed;
    const expectedRoutings = ACTION_EXPECTED_ROUTES[actionId];

    if (expectedRoutings && isRoutableType(biased.routedType) && expectedRoutings.includes(biased.routedType)) {
      biased = {
        ...biased,
        confidence: Math.min(0.98, biased.confidence + ACTION_ROUTE_CONFIDENCE_BONUS),
        reasons: biased.reasons.concat(`action_bias_${actionId}`)
      };
    }

    if (intent.brand === 'MEALSCOUT' && /warranty|permit|invoice|contractor|home id/.test(text)) {
      return { ...biased, routedType: 'held', holdReason: 'AMBIGUOUS_OR_WRONG_DOMAIN', reasons: biased.reasons.concat('ambiguous_or_wrong_domain') };
    }
    if (expectedRoutings && isRoutableType(biased.routedType) && !expectedRoutings.includes(biased.routedType)) {
      return {
        ...biased,
        routedType: 'held',
        holdReason: 'INTENT_EVIDENCE_CONFLICT',
        reasons: biased.reasons.concat(`expected_route_${expectedRoutings.join('_or_')}`, 'intent_destination_mismatch')
      };
    }
    if (expectedRoutings && biased.routedType !== 'held' && biased.confidence < MIN_EXPECTED_DESTINATION_CONFIDENCE) {
      return {
        ...biased,
        routedType: 'held',
        holdReason: 'insufficient_evidence',
        reasons: biased.reasons.concat('low_destination_confidence', `minimum_destination_confidence_${MIN_EXPECTED_DESTINATION_CONFIDENCE}`)
      };
    }
    return biased;
  });
}
