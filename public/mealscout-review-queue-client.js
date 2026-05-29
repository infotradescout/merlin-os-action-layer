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
