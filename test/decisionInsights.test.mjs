import test from 'node:test'
import assert from 'node:assert/strict'
import { getComparisonFacts, getPropertyEvidenceGaps, summarizeConstraintPreview, summarizeDecisionChange } from '../src/domain/decisionInsights.js'

test('decision change reports criteria and loaded candidate movement without hiding scope', () => {
  const result = summarizeDecisionChange({
    previousCriteria: { cities: ['台北市'], maxPrice: 2500, rooms: null },
    nextCriteria: { cities: ['台北市', '新北市'], maxPrice: 2200, rooms: null },
    previousCandidates: [{ id: 'a', price: 1800 }, { id: 'b', price: 2100 }],
    nextCandidates: [{ id: 'a', price: 1800 }, { id: 'c', price: 1600 }],
    favoriteIds: ['b'], actor: 'agent',
  })
  assert.deepEqual(result.criteriaChanges.map((item) => item.key), ['cities', 'maxPrice'])
  assert.equal(result.addedCount, 1)
  assert.equal(result.removedCount, 1)
  assert.equal(result.nextMinPrice, 1600)
  assert.match(result.scopeNote, /目前已載入/)
})

test('條件差異包含行政區、坪數與關鍵字', () => {
  const result = summarizeDecisionChange({
    previousCriteria: { cities: ['台北市'], district: '', minArea: null, maxArea: null, keyword: '' },
    nextCriteria: { cities: ['台北市'], district: '中山區', minArea: 20, maxArea: 40, keyword: '公園' },
  })
  assert.deepEqual(result.criteriaChanges.map((item) => item.key), ['district', 'minArea', 'maxArea', 'keyword'])
})

test('constraint preview is non-mutating data with favorite impact and explicit scope', () => {
  const currentCriteria = { cities: ['台北市'], maxPrice: 2500, rooms: null }
  const nextCriteria = { cities: ['台北市'], maxPrice: 2200, rooms: null }
  const result = summarizeConstraintPreview({
    previewId: 'p1', currentCriteria, nextCriteria,
    currentCandidates: [{ id: 'a', price: 1800, age: 20, mrtDistanceMeters: 300 }, { id: 'b', price: 2400, age: 30, mrtDistanceMeters: 500 }],
    previewCandidates: [{ id: 'a', price: 1800, age: 20, mrtDistanceMeters: 300 }, { id: 'c', price: 2100, age: null, mrtDistanceMeters: 700 }],
    favoriteIds: ['b'],
    currentSource: { totalCount: 2, inspectedCount: 2, resultSetComplete: true },
    previewSource: { totalCount: 10, inspectedCount: 2, resultSetComplete: false },
  })
  assert.equal(result.status, 'awaiting_confirmation')
  assert.equal(result.addedCount, 1)
  assert.equal(result.removedCount, 1)
  assert.equal(result.favoritesOutsidePreview, 1)
  assert.equal(result.dataScope.comparisonComplete, false)
  assert.match(result.dataScope.note, /尚有結果頁未載入/)
  assert.deepEqual(currentCriteria, { cities: ['台北市'], maxPrice: 2500, rooms: null })
})

test('evidence gaps return facts without generating advice or questions', () => {
  const evidence = getPropertyEvidenceGaps({ id: 'a', name: 'A', age: null, layout: '--房', actualPriceEvidence: { status: 'missing' }, mrtDistanceMeters: null, parking: '未提供', source: { status: 'live' } })
  assert.deepEqual(evidence.gaps.map((item) => item.field), ['age', 'layout', 'actual_price', 'mrt_distance', 'parking'])
  assert.ok(evidence.gaps.every((item) => !('question' in item)))
})

test('comparison facts do not label winners or invent tradeoffs', () => {
  const result = getComparisonFacts([{ id: 'a', name: 'A', price: 1800, size: 20, age: 15, layout: '2房', station: '中山', mrtDistanceMeters: 300, propertyType: '住宅', parking: '無', sourceUrl: 'https://example.com', source: { status: 'live' } }], { maxPrice: 2000, maxMrtDistance: 500 })
  assert.equal(result.candidates[0].withinBudget, true)
  assert.equal(result.candidates[0].withinMrtDistanceLimit, true)
  assert.equal('commuteMinutes' in result.candidates[0], false)
  assert.equal('strengths' in result.candidates[0], false)
  assert.equal('tradeoffs' in result.candidates[0], false)
})
