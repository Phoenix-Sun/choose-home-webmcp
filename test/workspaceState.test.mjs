import test from 'node:test'
import assert from 'node:assert/strict'
import { CLEARED_WORKSPACE_REQUEST, WORKSPACE_STORAGE_VERSION, createAgentCandidateFilter, createClearedWorkspaceSnapshot, createWorkspaceStorageEnvelope, parseWorkspaceStore, preserveSourceStateOnError } from '../src/domain/workspaceState.js'

test('cleared workspace has no active criteria, results, or saved decisions', () => {
  const state = createClearedWorkspaceSnapshot()
  assert.equal(state.activeSearch, false)
  assert.equal(state.criteria, null)
  assert.deepEqual(state.candidates, [])
  assert.deepEqual(state.pinnedCandidateIds, [])
  assert.deepEqual(state.compareCandidateIds, [])
  assert.equal(state.sourceState.status, 'idle')
  assert.equal(state.sourceState.returnedCount, 0)
  assert.equal(state.agentCandidateFilter, null)
  assert.equal(CLEARED_WORKSPACE_REQUEST, '尚未設定找房條件')
})

test('agent candidate filter keeps only unique currently loaded candidates', () => {
  const filter = createAgentCandidateFilter({
    summary: ' 較有可能 30 分鐘內 ',
    methodLabel: '交通快速概算',
    candidateIds: ['a', 'missing', 'a', 'b'],
  }, ['a', 'b', 'c'])
  assert.equal(filter.summary, '較有可能 30 分鐘內')
  assert.equal(filter.methodLabel, '交通快速概算')
  assert.deepEqual(filter.candidateIds, ['a', 'b'])
})

test('agent candidate filter rejects empty or entirely stale selections', () => {
  assert.equal(createAgentCandidateFilter({ summary: '測試', candidateIds: ['missing'] }, ['a']), null)
  assert.equal(createAgentCandidateFilter({ summary: '', candidateIds: ['a'] }, ['a']), null)
})

test('completed workspace can be serialized and restored across page navigation', () => {
  const snapshot = {
    request: '雙北市 2,500 萬內',
    criteria: { city: '台北市', cities: ['台北市', '新北市'], maxPrice: 2500 },
    candidates: [{ id: 'A', price: 765 }],
    selectedId: 'A',
    sourceState: { status: 'live', returnedCount: 1 },
    agentCandidateFilter: { candidateIds: ['A'], summary: '交通初篩' },
  }
  const envelope = createWorkspaceStorageEnvelope(snapshot, '2026-09-02T00:00:00.000Z')
  assert.equal(envelope.version, WORKSPACE_STORAGE_VERSION)
  assert.deepEqual(parseWorkspaceStore(JSON.stringify(envelope)), { cleared: false, snapshot })
})

test('cleared, malformed, and incomplete saved workspaces fail safely', () => {
  assert.deepEqual(parseWorkspaceStore(JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, cleared: true })), { cleared: true, snapshot: null })
  assert.deepEqual(parseWorkspaceStore('{bad json'), { cleared: false, snapshot: null })
  assert.deepEqual(parseWorkspaceStore(JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, snapshot: { criteria: {} } })), { cleared: false, snapshot: null })
})

test('source errors preserve successful search progress so users can retry', () => {
  const previous = {
    status: 'live',
    fetchedAt: '2026-09-02T01:00:00.000Z',
    totalCount: 2824,
    inspectedCount: 300,
    returnedCount: 195,
    nextCursor: { 台北市: 6, 新北市: 6 },
    hasMore: true,
    resultSetComplete: false,
    warnings: [],
  }

  const result = preserveSourceStateOnError(previous, 'public_source_unavailable', '2026-09-02T01:05:00.000Z')

  assert.equal(result.status, 'error')
  assert.equal(result.lastErrorAt, '2026-09-02T01:05:00.000Z')
  assert.deepEqual(result.warnings, ['public_source_unavailable'])
  assert.equal(result.fetchedAt, previous.fetchedAt)
  assert.equal(result.totalCount, 2824)
  assert.equal(result.inspectedCount, 300)
  assert.equal(result.returnedCount, 195)
  assert.deepEqual(result.nextCursor, previous.nextCursor)
  assert.equal(result.hasMore, true)
  assert.equal(result.resultSetComplete, false)
  assert.equal(previous.status, 'live')
  assert.deepEqual(previous.warnings, [])
})
