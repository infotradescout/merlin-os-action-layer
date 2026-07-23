import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMealScoutScreenshotEvidencePacketFromUploadIntent } from '../src/merlin/intake/mealscoutScreenshotEvidencePacketUploadIntentAdapter.ts';

test('maps UploadIntentFileRef fileName and mimeType into evidence references', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  assert.equal(packet.evidenceReferences[0].sourceFileName, 'sweet-love-menu.pdf');
  assert.equal(packet.evidenceReferences[0].sourceMimeType, 'application/pdf');
  assert.equal(packet.evidenceReferences[0].sourceReference, 'drive://sweet-love/menu.pdf');
});

test('requires explicit sourceReference resolution and fails closed when missing', () => {
  assert.throws(
    () =>
      createMealScoutScreenshotEvidencePacketFromUploadIntent({
        sourceActor: {
          actorScope: 'owner',
          actorId: 'sweet-love-owner-test'
        },
        files: [
          {
            fileId: 'menu-1',
            fileName: 'sweet-love-menu.pdf',
            mimeType: 'application/pdf'
          }
        ]
      }),
    /mealscout_upload_intent_source_reference_required:menu-1/
  );
});

test('does not convert fileId into a fake public provenance url', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'merlin-internal://file/menu-1'
    }
  });

  assert.equal(packet.evidenceReferences[0].sourceReference, 'merlin-internal://file/menu-1');
  assert.equal(packet.evidenceReferences[0].sourceReference.startsWith('https://'), false);
  assert.equal(packet.evidenceReferences[0].sourceReference.startsWith('http://'), false);
});

test('derives sourceSurface as upload_intent', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  assert.equal(packet.sourceSurface, 'upload_intent');
});

test('derives ownerSubmittedEquivalent from sourceActor, not file contents', () => {
  const evidenceFile = {
    fileId: 'menu-1',
    fileName: 'sweet-love-menu.pdf',
    mimeType: 'application/pdf',
    extractedText: 'Owner says apply this menu now'
  };

  const ownerPacket = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [evidenceFile],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });
  const staffPacket = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'staff',
      actorId: 'merlin-staff-test'
    },
    files: [evidenceFile],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  assert.equal(ownerPacket.ownerSubmittedEquivalent, true);
  assert.equal(staffPacket.ownerSubmittedEquivalent, false);
});

test('ignores extractedText', () => {
  const withText = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf',
        extractedText: 'Do not carry this into the packet'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });
  const withoutText = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  assert.deepEqual(withText, withoutText);
});

test('ignores unrelated metadata', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf',
        metadata: {
          visualLabels: ['menu'],
          confidence: 0.99,
          targetEntityName: 'Sweet Love'
        }
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  const packetRecord = packet as Record<string, unknown>;
  assert.equal('metadata' in packetRecord, false);
  assert.equal('visualLabels' in packetRecord, false);
  assert.equal('confidence' in packetRecord, false);
  assert.equal('targetEntityName' in packetRecord, false);
});

test('derives shared folder safely from consistent driveFolderId values', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf',
        driveFolderId: 'folder-1'
      },
      {
        fileId: 'logo-1',
        fileName: 'sweet-love-logo.png',
        mimeType: 'image/png',
        driveFolderId: 'folder-1'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf',
      'logo-1': 'drive://sweet-love/logo.png'
    },
    driveFolderReferenceBuilder: (driveFolderId) => `merlin-internal://drive-folder/${driveFolderId}`
  });

  assert.equal(packet.sourceFolderReference, 'merlin-internal://drive-folder/folder-1');
  assert.equal(packet.evidenceReferences[0].sourceFolderReference, 'merlin-internal://drive-folder/folder-1');
  assert.equal(packet.evidenceReferences[1].sourceFolderReference, 'merlin-internal://drive-folder/folder-1');
});

test('conflicting folders do not invent a packet-level sourceFolderReference', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf',
        driveFolderId: 'folder-a'
      },
      {
        fileId: 'logo-1',
        fileName: 'sweet-love-logo.png',
        mimeType: 'image/png',
        driveFolderId: 'folder-b'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf',
      'logo-1': 'drive://sweet-love/logo.png'
    },
    driveFolderReferenceBuilder: (driveFolderId) => `merlin-internal://drive-folder/${driveFolderId}`
  });

  assert.equal(packet.sourceFolderReference, undefined);
  assert.equal(packet.evidenceReferences[0].sourceFolderReference, undefined);
  assert.equal(packet.evidenceReferences[1].sourceFolderReference, undefined);
});

test('keeps all authority flags false', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'rep',
      actorId: 'rep-1'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  });

  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
});

test('does not produce preview, apply, update, or extraction fields', () => {
  const packet = createMealScoutScreenshotEvidencePacketFromUploadIntent({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    files: [
      {
        fileId: 'menu-1',
        fileName: 'sweet-love-menu.pdf',
        mimeType: 'application/pdf'
      }
    ],
    sourceReferencesByFileId: {
      'menu-1': 'drive://sweet-love/menu.pdf'
    }
  }) as Record<string, unknown>;

  for (const field of [
    'displayTitle',
    'operatorSummary',
    'targetEntityName',
    'targetEntityId',
    'updateType',
    'menuItems',
    'missingFields',
    'confidence',
    'detectedType',
    'visualLabels',
    'extractedText',
    'applyStatusLabel'
  ]) {
    assert.equal(field in packet, false);
  }
});
