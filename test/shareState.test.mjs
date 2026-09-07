import test from 'node:test'
import assert from 'node:assert/strict'
import { buildShareUrl, decodeShareState, encodeShareState, readShareState, removeShareStateFromUrl } from '../src/domain/shareState.js'

const state = {
  criteria: { city: '新北市', cities: ['新北市'], district: '板橋區', maxPrice: 2500, rooms: 2, priority: 'mrt' },
  mode: 'mrt',
  selectedCandidateId: 'PUBLIC-123',
}

test('分享狀態只保留可重查條件與選取物件，不包含收藏或筆記', () => {
  const encoded = encodeShareState({ ...state, pinnedIds: ['PRIVATE'], favoriteMeta: { PRIVATE: { note: '私人筆記' } } })
  const decoded = decodeShareState(encoded)
  assert.equal(decoded.criteria.city, '新北市')
  assert.equal(decoded.criteria.district, '板橋區')
  assert.equal(decoded.criteria.maxPrice, 2500)
  assert.equal(decoded.mode, 'mrt')
  assert.equal(decoded.selectedCandidateId, 'PUBLIC-123')
  assert.equal('pinnedIds' in decoded, false)
  assert.equal(JSON.stringify(decoded).includes('私人筆記'), false)
})

test('分享網址會移除模式與舊參數，並能從網址還原', () => {
  const url = buildShareUrl(state, 'https://example.com/?mode=ai&old=1#map')
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.has('mode'), false)
  assert.equal(parsed.searchParams.has('old'), false)
  assert.equal(parsed.hash, '')
  assert.deepEqual(readShareState(parsed.search), decodeShareState(parsed.searchParams.get('share')))
  assert.equal(removeShareStateFromUrl(url), 'https://example.com/')
})

test('無效或過大的分享內容安全地視為沒有分享狀態', () => {
  assert.equal(decodeShareState('not-valid'), null)
  assert.equal(decodeShareState('a'.repeat(4001)), null)
})
