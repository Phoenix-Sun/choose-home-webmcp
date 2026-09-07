import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CRITERIA, sanitizeCriteria } from '../src/domain/query.js'
import { buildSearchPlan, filterAndRank, hasConfirmedParking, isStandaloneParking, isValidTaiwanCoordinate, normalizeCandidate, readJson } from '../server.mjs'

test('Vercel 已解析及本機串流 JSON request 使用相同輸入結果', async () => {
  const parsedByVercel = await readJson({ body: { criteria: { city: '台北市' } } })
  assert.deepEqual(parsedByVercel, { criteria: { city: '台北市' } })

  const streamedLocally = {
    body: null,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"criteria":{"city":"台北市"}}')
    },
  }
  assert.deepEqual(await readJson(streamedLocally), parsedByVercel)
})

test('Vercel request 的無效或過大 JSON 會安全拒絕', async () => {
  await assert.rejects(() => readJson({ body: '{broken' }), /invalid_json/)
  await assert.rejects(() => readJson({ body: '"' + 'x'.repeat(65_536) + '"' }), /request_too_large/)
})

test('無效或非台灣座標不會產生地圖位置', () => {
  assert.equal(isValidTaiwanCoordinate(25.04, 121.52), true)
  assert.equal(isValidTaiwanCoordinate(2504, 12152), false)
  const candidate = normalizeCandidate({ sn: 'bad', cityNo: 3, lat: 2504, lon: 12152, price: 1000, type: '住宅' }, DEFAULT_CRITERIA, '2026-01-01T00:00:00Z')
  assert.equal(candidate.location, null)
  assert.equal('commute' in candidate, false)
  assert.equal('commuteEvidence' in candidate, false)
})

test('公開候選只保留比較所需欄位，不轉存照片或行銷文案', () => {
  const candidate = normalizeCandidate({ sn: 'public', cityNo: 3, price: 1000, type: '住宅', age: 0, mrtDis: 0, photo1: 'https://example.com/photo.jpg', emphasis1: '行銷文案' }, DEFAULT_CRITERIA, '2026-01-01T00:00:00Z')
  assert.equal('photo' in candidate, false)
  assert.equal('photoCount' in candidate, false)
  assert.equal('description' in candidate, false)
  assert.equal(candidate.age, 0)
  assert.equal(candidate.mrtDistanceMeters, 0)
})

test('有捷運距離上限時，未知或超過距離的物件不會被當成符合', () => {
  const criteria = sanitizeCriteria({ ...DEFAULT_CRITERIA, maxMrtDistance: 800 })
  const base = { propertyType: '住宅', parking: '無', style: '大樓', price: 1000, life: 60 }
  const result = filterAndRank([{ ...base, id: 'unknown', mrtDistanceMeters: null }, { ...base, id: 'far', mrtDistanceMeters: 900 }, { ...base, id: 'ok', mrtDistanceMeters: 300 }], criteria)
  assert.deepEqual(result.map((item) => item.id), ['ok'])
})

test('行政區會以公開物件欄位再次核對，避免共用郵遞區號混入其他區', () => {
  const criteria = sanitizeCriteria({ city: '新竹市', cities: ['新竹市'], district: '北區' })
  const base = { propertyType: '住宅', parking: '無', style: '大樓', price: 1000, life: 60 }
  const result = filterAndRank([
    { ...base, id: 'north', district: '北區' },
    { ...base, id: 'east', district: '東區' },
  ], criteria)
  assert.deepEqual(result.map((item) => item.id), ['north'])
})

test('公開來源使用臺字時仍能與網站行政區條件正確比對', () => {
  const criteria = sanitizeCriteria({ city: '雲林縣', cities: ['雲林縣'], district: '台西鄉' })
  const candidate = normalizeCandidate({ sn: 'taisi', category: '中部,雲林縣,臺西鄉', type: '住宅', price: 800 }, criteria, '2026-01-01T00:00:00Z')
  assert.equal(candidate.district, '台西鄉')
  assert.deepEqual(filterAndRank([candidate], criteria).map((item) => item.id), ['taisi'])
})

test('車位硬條件只接受明確有車位的公開資料', () => {
  assert.equal(hasConfirmedParking('未提供'), false)
  assert.equal(hasConfirmedParking('無車位'), false)
  assert.equal(hasConfirmedParking('私有'), true)
  const criteria = sanitizeCriteria({ ...DEFAULT_CRITERIA, requireParking: true })
  const base = { propertyType: '住宅', style: '大樓', mrtDistanceMeters: 200, price: 1000, life: 60 }
  assert.deepEqual(filterAndRank([{ ...base, id: 'unknown', parking: '未提供' }, { ...base, id: 'yes', parking: '私有' }], criteria).map((item) => item.id), ['yes'])
})

test('近捷運優先依公開捷運距離重新排序', () => {
  const criteria = sanitizeCriteria({ ...DEFAULT_CRITERIA, maxPrice: 3000, priority: 'mrt' })
  const base = { propertyType: '住宅', parking: '無', life: 60 }
  const result = filterAndRank([
    { ...base, id: 'cheap-far', price: 1000, mrtDistanceMeters: 900 },
    { ...base, id: 'near', price: 1800, mrtDistanceMeters: 100 },
  ], criteria)
  assert.equal(result[0].id, 'near')
})

test('住宅搜尋排除低坪數無房數的獨立車位', () => {
  assert.equal(isStandaloneParking({ objName: '阿曼社區獨立產權室內車位', room: 0, area: 4.83 }), true)
  assert.equal(isStandaloneParking({ objName: '三房含平面車位', room: 3, area: 42 }), false)
  const criteria = sanitizeCriteria(DEFAULT_CRITERIA)
  const result = filterAndRank([
    { id: 'parking', propertyType: '住宅', isStandaloneParking: true, parking: '私有', price: 160, life: 50 },
    { id: 'home', propertyType: '住宅', isStandaloneParking: false, parking: '私有', price: 1000, life: 50 },
  ], criteria)
  assert.deepEqual(result.map((item) => item.id), ['home'])
})

test('雙城分頁不會重新查詢已完成的縣市', () => {
  const criteria = sanitizeCriteria({ ...DEFAULT_CRITERIA, cities: ['台北市', '新北市'] })
  const plan = buildSearchPlan(criteria, { '台北市': null, '新北市': 6 }, null)
  assert.deepEqual(plan.map((item) => [item.city, item.startPage]), [['新北市', 6]])
})
