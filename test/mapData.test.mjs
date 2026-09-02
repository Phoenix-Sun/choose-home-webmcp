import test from 'node:test'
import assert from 'node:assert/strict'
import { createPropertyFeatureCollection } from '../src/domain/mapData.js'

test('map feature collection keeps only public coordinates and marks selected or pinned items', () => {
  const candidates = [
    { id: 'selected', location: { lon: 121.5, lat: 25.05 } },
    { id: 'pinned', location: { lon: 121.51, lat: 25.06 } },
    { id: 'normal', location: { lon: 121.52, lat: 25.07 } },
    { id: 'missing', location: { lon: null, lat: null } },
  ]
  const result = createPropertyFeatureCollection(candidates, 'selected', ['pinned'])
  assert.equal(result.type, 'FeatureCollection')
  assert.equal(result.features.length, 3)
  assert.deepEqual(result.features.map((feature) => feature.properties), [
    { candidateId: 'selected', emphasized: true },
    { candidateId: 'pinned', emphasized: true },
    { candidateId: 'normal', emphasized: false },
  ])
})
