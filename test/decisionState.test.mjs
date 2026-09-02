import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COMPARE, addComparisonIds, removeComparisonIds } from '../src/domain/decisionState.js'

test('comparison keeps order, removes duplicates and never exceeds four', () => {
  const result = addComparisonIds(['a', 'b'], ['b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(result, ['a', 'b', 'c', 'd'])
  assert.equal(result.length, MAX_COMPARE)
})

test('comparison ignores candidates that are not currently loaded', () => {
  assert.deepEqual(addComparisonIds([], ['a', 'missing'], ['a']), ['a'])
})

test('removing comparison candidates preserves the remaining order', () => {
  assert.deepEqual(removeComparisonIds(['a', 'b', 'c'], ['b']), ['a', 'c'])
})
