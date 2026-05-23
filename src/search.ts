export function getSearchPayload(query) {
  return {
    source: 'lisa',
    query,
    results: [
      {
        id: 'search-1',
        title: 'Context result',
        summary: 'Placeholder for future LISA-backed search results.'
      }
    ]
  };
}
