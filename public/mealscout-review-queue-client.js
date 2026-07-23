export const REVIEW_ACTIONS = ['same_truck', 'keep_separate', 'needs_review'];

function requestJson(url, options = {}) {
  const init = {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  };

  return fetch(url, init).then(async (response) => {
    const rawBody = await response.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (!response.ok) {
      const error = new Error(body?.error || `Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  });
}

export function createMealScoutReviewQueueClient({ baseUrl = '' } = {}) {
  const endpoint = (path) => `${baseUrl}${path}`;

  return {
    getPreview({ loadFromDriveFolder = true, includeDebugOcr = true, inputs, existingProfiles } = {}) {
      const payload = {
        loadFromDriveFolder,
        includeDebugOcr
      };
      if (Array.isArray(inputs)) payload.inputs = inputs;
      if (Array.isArray(existingProfiles)) payload.existingProfiles = existingProfiles;
      return requestJson(endpoint('/api/mealscout/intake/preview'), {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    getReviewDecisions({ draftId } = {}) {
      const query = draftId ? `?draftId=${encodeURIComponent(draftId)}` : '';
      return requestJson(endpoint(`/api/mealscout/review-decisions${query}`));
    },
    saveReviewDecision(payload) {
      return requestJson(endpoint('/api/mealscout/review-decisions'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    updateReviewDecision(decisionId, payload) {
      return requestJson(endpoint(`/api/mealscout/review-decisions/${encodeURIComponent(decisionId)}`), {
        method: 'PATCH',
        body: JSON.stringify(payload || {})
      });
    },
    getFieldCorrections({ recordId, draftId } = {}) {
      const params = new URLSearchParams();
      if (recordId) params.set('recordId', String(recordId));
      if (draftId) params.set('draftId', String(draftId));
      const query = params.toString();
      return requestJson(endpoint(`/api/mealscout/review-corrections${query ? `?${query}` : ''}`));
    },
    saveFieldCorrection(payload) {
      return requestJson(endpoint('/api/mealscout/review-corrections'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    getAttachmentDecisions({ draftId, sourceFileId } = {}) {
      const params = new URLSearchParams();
      if (draftId) params.set('draftId', String(draftId));
      if (sourceFileId) params.set('sourceFileId', String(sourceFileId));
      const query = params.toString();
      return requestJson(endpoint(`/api/mealscout/attachment-decisions${query ? `?${query}` : ''}`));
    },
    saveAttachmentDecision(payload) {
      return requestJson(endpoint('/api/mealscout/attachment-decisions'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    executePublishPlan(payload) {
      return requestJson(endpoint('/api/mealscout/intake/publish-plan/execute'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    runBatchIntake(payload) {
      return requestJson(endpoint('/api/mealscout/intake/batches/run'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    getBatchHistory() {
      return requestJson(endpoint('/api/mealscout/intake/batches'));
    },
    getBatchDetail(batchId) {
      return requestJson(endpoint(`/api/mealscout/intake/batches/${encodeURIComponent(batchId)}`));
    },
    getFileAudit({ folderId } = {}) {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      return requestJson(endpoint(`/api/mealscout/intake/file-audit${query}`));
    },
    importCandidateSummary(payload) {
      return requestJson(endpoint('/api/mealscout/intake/candidate-import'), {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    getFolderContext({ folderId } = {}) {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      return requestJson(endpoint(`/api/mealscout/intake/folder-context${query}`));
    },
    getPublishAudit(filters = {}) {
      const params = new URLSearchParams();
      if (filters.planId) params.set('planId', String(filters.planId));
      if (filters.executionId) params.set('executionId', String(filters.executionId));
      if (filters.recordId) params.set('recordId', String(filters.recordId));
      const query = params.toString();
      return requestJson(endpoint(`/api/mealscout/intake/publish-plan/audit${query ? `?${query}` : ''}`));
    },
    setDraftReviewDecision(reviewState, draftId, decision) {
      if (!REVIEW_ACTIONS.includes(decision)) {
        throw new Error(`Unsupported review decision: ${decision}`);
      }
      return {
        ...reviewState,
        [draftId]: {
          decision,
          updatedAt: new Date().toISOString()
        }
      };
    },
    setMergeGroupReviewDecision(reviewState, groupId, decision) {
      if (!REVIEW_ACTIONS.includes(decision)) {
        throw new Error(`Unsupported review decision: ${decision}`);
      }
      return {
        ...reviewState,
        [groupId]: {
          decision,
          updatedAt: new Date().toISOString()
        }
      };
    }
  };
}
