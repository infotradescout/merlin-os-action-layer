import type { MerlinBrand, UploadIntentFileRef } from './intakeTypes.js';
import {
  buildUniversalProductUpdatePacketPreview,
  type MerlinUniversalProductUpdatePacketPreview
} from './universalProductUpdatePacketPreview.js';

export type UniversalProductUpdatePacketPreviewBridgeInput = {
  brand: MerlinBrand;
  files: UploadIntentFileRef[];
  explicitPreviewInput?: unknown;
};

function extractStructuredPacketCandidate(
  input: UniversalProductUpdatePacketPreviewBridgeInput
): unknown {
  if (input.explicitPreviewInput !== undefined) {
    return input.explicitPreviewInput;
  }

  for (const file of input.files) {
    if (file.metadata && 'universalProductUpdatePacket' in file.metadata) {
      return file.metadata.universalProductUpdatePacket;
    }
  }

  return undefined;
}

export function buildUniversalProductUpdatePacketPreviewBridge(
  input: UniversalProductUpdatePacketPreviewBridgeInput
): MerlinUniversalProductUpdatePacketPreview | undefined {
  if (input.brand !== 'MEALSCOUT') {
    return undefined;
  }

  const packetCandidate = extractStructuredPacketCandidate(input);
  if (packetCandidate === undefined) {
    return undefined;
  }

  return buildUniversalProductUpdatePacketPreview(packetCandidate);
}
