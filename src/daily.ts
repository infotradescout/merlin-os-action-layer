export function getDailyPayload() {
  return {
    date: new Date().toISOString().slice(0, 10),
    user_id: 'demo-user',
    sections: {
      changed: [
        {
          id: 'changed-1',
          title: 'Business profile updated',
          summary: 'A contractor profile uploaded a new verification document.'
        }
      ],
      needs_attention: [
        {
          id: 'attention-1',
          title: 'Insurance review needed',
          summary: 'One uploaded insurance document still needs review.'
        }
      ],
      waiting: [],
      stale: [],
      suggested_next_steps: [
        {
          id: 'next-1',
          title: 'Suggested next step',
          summary: 'Review the insurance document and send a follow-up.'
        }
      ]
    },
    source_refs: ['fixture'],
    generated_at: new Date().toISOString()
  };
}
