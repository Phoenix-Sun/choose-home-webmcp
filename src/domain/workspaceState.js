export const CLEARED_WORKSPACE_REQUEST = '尚未設定找房條件'
export const WORKSPACE_STORAGE_VERSION = 3

export function parseWorkspaceStore(raw = '') {
  try {
    const saved = JSON.parse(raw || '{}')
    if (saved.cleared === true) return { cleared: true, snapshot: null }
    if (saved.version !== WORKSPACE_STORAGE_VERSION || !saved.snapshot || typeof saved.snapshot !== 'object') return { cleared: false, snapshot: null }
    if (!saved.snapshot.criteria || !Array.isArray(saved.snapshot.candidates) || !saved.snapshot.sourceState) return { cleared: false, snapshot: null }
    return { cleared: false, snapshot: saved.snapshot }
  } catch {
    return { cleared: false, snapshot: null }
  }
}

export function createWorkspaceStorageEnvelope(snapshot, savedAt = new Date().toISOString()) {
  return { version: WORKSPACE_STORAGE_VERSION, cleared: false, savedAt, snapshot }
}

export function createAgentCandidateFilter(input = {}, loadedCandidateIds = []) {
  const loaded = new Set(loadedCandidateIds)
  const candidateIds = [...new Set(Array.isArray(input.candidateIds) ? input.candidateIds : [])]
    .filter((id) => typeof id === 'string' && loaded.has(id))
  const summary = typeof input.summary === 'string' ? input.summary.trim().slice(0, 160) : ''
  const methodLabel = typeof input.methodLabel === 'string' ? input.methodLabel.trim().slice(0, 60) : ''
  const scopeNote = typeof input.scopeNote === 'string' ? input.scopeNote.trim().slice(0, 120) : ''
  if (!summary || !candidateIds.length) return null
  return {
    summary,
    methodLabel: methodLabel || 'ChatGPT 快速初篩',
    scopeNote: scopeNote || '僅套用於目前已載入的物件',
    candidateIds,
    createdAt: new Date().toISOString(),
  }
}

export function createIdleSourceState() {
  return {
    status: 'idle',
    fetchedAt: null,
    totalCount: 0,
    inspectedCount: 0,
    returnedCount: 0,
    nextCursor: {},
    coverageByCity: {},
    hasMore: false,
    resultSetComplete: false,
    warnings: [],
  }
}

export function preserveSourceStateOnError(current = {}, error = 'unknown_error', failedAt = new Date().toISOString()) {
  const previous = current && typeof current === 'object' ? current : createIdleSourceState()
  return {
    ...previous,
    status: 'error',
    lastErrorAt: failedAt,
    warnings: [String(error || 'unknown_error')],
  }
}

export function createClearedWorkspaceSnapshot() {
  return {
    activeSearch: false,
    criteria: null,
    candidates: [],
    selectedCandidateId: '',
    pinnedCandidateIds: [],
    compareCandidateIds: [],
    favoriteMeta: {},
    sourceState: createIdleSourceState(),
    latestDecisionChange: null,
    pendingConstraintPreview: null,
    agentCandidateFilter: null,
  }
}
