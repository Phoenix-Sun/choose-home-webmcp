import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExplainableRecommendations } from '../src/domain/recommendations.js'

const candidates = Array.from({ length: 14 }, (_, index) => ({
  id: `P${index + 1}`,
  price: 1000 + index * 80,
  mrtDistanceMeters: 900 - index * 45,
  age: index === 0 ? -1 : 30 - index,
  size: 20 + index,
}))

test('recommendations are recomputed only from the currently visible candidates', () => {
  const visible = candidates.slice(4)
  const recommendations = buildExplainableRecommendations(visible, 'balanced')
  assert.equal(recommendations.length, 10)
  assert.ok(recommendations.every((item) => visible.some((candidate) => candidate.id === item.id)))
  assert.ok(recommendations.every((item) => item.reasons.length > 0))
})

test('recommendation count never claims more candidates than exist', () => {
  const recommendations = buildExplainableRecommendations(candidates.slice(0, 3), 'budget')
  assert.equal(recommendations.length, 3)
})

test('negative age is treated as unavailable instead of newest', () => {
  const recommendations = buildExplainableRecommendations(candidates, 'balanced', 14)
  const unknownAge = recommendations.find((item) => item.id === 'P1')
  assert.ok(!unknownAge.reasons.some((reason) => reason.startsWith('屋齡 ')))
})

test('recommendation reasons use concrete facts instead of repetitive batch wording', () => {
  const recommendations = buildExplainableRecommendations([{ id: 'A', price: 765, mrtDistanceMeters: 172, station: '台北車站', age: 17.2, size: 14.28 }])
  assert.deepEqual(recommendations[0].reasons, ['總價 765 萬', '台北車站 172 公尺'])
  assert.ok(recommendations[0].reasons.every((reason) => !reason.includes('這批中')))
})
