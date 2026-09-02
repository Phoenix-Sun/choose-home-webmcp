export function createPropertyFeatureCollection(candidates, selectedId, pinnedIds = []) {
  const pinnedSet = new Set(pinnedIds)
  return {
    type: 'FeatureCollection',
    features: candidates
      .filter((candidate) => Number.isFinite(candidate.location?.lat) && Number.isFinite(candidate.location?.lon))
      .map((candidate) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [candidate.location.lon, candidate.location.lat],
        },
        properties: {
          candidateId: String(candidate.id),
          emphasized: candidate.id === selectedId || pinnedSet.has(candidate.id),
        },
      })),
  }
}
