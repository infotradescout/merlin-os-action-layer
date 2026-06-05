import type { RoutingDecision, UploadIntent, UploadIntentFileRef } from './intakeTypes.js';

function classifyBase(file: UploadIntentFileRef): RoutingDecision {
  const name = (file.fileName || '').toLowerCase();
  const text = (file.extractedText || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  const reasons: string[] = [];
  let routedType: RoutingDecision['routedType'] = 'unknown';
  let confidence = 0.2;

  const menuSignal = /menu|combo|wings|plate|special|price|fries|burger|taco/.test(name) || /\$\s?\d|\b\d+\.\d{2}\b|menu|combo|wings|plate|taco/.test(text);
  const scheduleSignal = /schedule|hours|open|closed|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|event/.test(name) ||
    /\b(mon|tue|wed|thu|fri|sat|sun)\b|hours|open|closed|\d{1,2}:\d{2}\s?(am|pm)/.test(text);
  const logoSignal = /logo|fb_img|avatar|profile[_ -]?pic/.test(name) || /logo/.test(text);
  const photoSignal = mime.startsWith('image/') && text.trim().length < 16;
  const docSignal = mime === 'application/pdf' || /\.pdf$/i.test(file.fileName || '');

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

  if (confidence < 0.6 || routedType === 'unknown') {
    return { ...file, routedType: 'held', confidence, reasons: reasons.length ? reasons : ['ambiguous_file_intent'], holdReason: 'ambiguous' };
  }
  return { ...file, routedType, confidence, reasons };
}

export function routeUploadIntentFiles(intent: UploadIntent): RoutingDecision[] {
  return intent.files.map((file) => {
    const routed = classifyBase(file);
    const text = (file.extractedText || '').toLowerCase();
    const actionId = intent.actionId;
    let biased = routed;

    if (actionId === 'update_menu' && biased.routedType === 'menu') {
      biased = {
        ...biased,
        confidence: Math.min(0.98, biased.confidence + 0.2),
        reasons: biased.reasons.concat('action_bias_update_menu')
      };
    } else if (actionId === 'update_schedule' && biased.routedType === 'schedule') {
      biased = {
        ...biased,
        confidence: Math.min(0.98, biased.confidence + 0.2),
        reasons: biased.reasons.concat('action_bias_update_schedule')
      };
    } else if (actionId === 'upload_logo' && biased.routedType === 'logo') {
      biased = {
        ...biased,
        confidence: Math.min(0.98, biased.confidence + 0.2),
        reasons: biased.reasons.concat('action_bias_upload_logo')
      };
    } else if (actionId === 'add_food_photos' && biased.routedType === 'photo') {
      biased = {
        ...biased,
        confidence: Math.min(0.98, biased.confidence + 0.2),
        reasons: biased.reasons.concat('action_bias_add_food_photos')
      };
    }

    if (intent.brand === 'MEALSCOUT' && /warranty|permit|invoice|contractor|home id/.test(text)) {
      return { ...biased, routedType: 'held', holdReason: 'AMBIGUOUS_OR_WRONG_DOMAIN', reasons: biased.reasons.concat('ambiguous_or_wrong_domain') };
    }
    if ((actionId === 'update_menu' && biased.routedType === 'schedule') || (actionId === 'update_schedule' && biased.routedType === 'menu')) {
      return { ...biased, routedType: 'held', holdReason: 'INTENT_EVIDENCE_CONFLICT', reasons: biased.reasons.concat('intent_evidence_conflict') };
    }
    return biased;
  });
}
