/** @typedef {'acknowledged' | 'needs_manual_review' | 'false_positive' | 'defer' | 'resolved_externally'} DriveReviewDecision */
/** @typedef {'ready' | 'disabled'} DriveStatus */

export const DRIVE_REVIEW_DECISIONS = [
  'acknowledged',
  'needs_manual_review',
  'false_positive',
  'defer',
  'resolved_externally'
];

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

export function createDriveReviewQueueClient({ baseUrl = '' } = {}) {
  const endpoint = (path) => `${baseUrl}${path}`;

  return {
    getAuthHealth() {
      return requestJson(endpoint('/api/drive/auth-health'));
    },
    getReconciliation() {
      return requestJson(endpoint('/api/drive/reconciliation'));
    },
    getReviewQueue() {
      return requestJson(endpoint('/api/drive/review-queue'));
    },
    getReviewQueueItem(itemId) {
      return requestJson(endpoint(`/api/drive/review-queue/${encodeURIComponent(itemId)}`));
    },
    postDecision(itemId, decision, note, decidedBy) {
      if (!DRIVE_REVIEW_DECISIONS.includes(decision)) {
        throw new Error(`Unsupported decision: ${decision}`);
      }
      return requestJson(endpoint(`/api/drive/review-queue/${encodeURIComponent(itemId)}/decision`), {
        method: 'POST',
        body: JSON.stringify({
          decision,
          note,
          decided_by: decidedBy
        })
      });
    }
  };
}

