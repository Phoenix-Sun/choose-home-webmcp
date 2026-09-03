import test from 'node:test'
import assert from 'node:assert/strict'
import { CITY_CODES, CITY_OPTION_GROUPS, formatCitySelection, parseNaturalLanguageQuery, sanitizeCriteria, toHbhousingSearchBody } from '../src/domain/query.js'

test('自然語言只轉成網站能正確履行的公開搜尋條件', () => {
  const criteria = parseNaturalLanguageQuery('新北市板橋區總價 1,500 萬內、兩房、距捷運 600 公尺內、價格優先')
  assert.equal(criteria.city, '新北市')
  assert.equal(criteria.district, '板橋區')
  assert.equal(criteria.maxPrice, 1500)
  assert.equal(criteria.rooms, 2)
  assert.equal(criteria.maxMrtDistance, 600)
  assert.equal('commuteMinutes' in criteria, false)
  assert.equal('destination' in criteria, false)
  assert.equal(criteria.priority, 'budget')
})

test('條件正確映射到公開搜尋介面欄位', () => {
  const body = toHbhousingSearchBody({ city: '新北市', district: '板橋區', maxPrice: 1500, rooms: 2, priority: 'budget' })
  assert.equal(body.cityNo, 4)
  assert.deepEqual(body.zipCode, ['220'])
  assert.equal(body.priceFinish, 1500)
  assert.equal(body.roomStart, 2)
  assert.equal(body.roomFinish, 2)
  assert.equal(body.sort, 2)
  assert.equal('storeID' in body, false)
  assert.equal('employeeID' in body, false)
  assert.equal('partnerNo' in body, false)
})

test('自行設定地區完整提供所有公開來源支援的縣市', () => {
  const selectableCities = CITY_OPTION_GROUPS.flatMap((group) => group.cities).filter((city) => city !== '雙北市')
  assert.deepEqual(new Set(selectableCities), new Set(Object.keys(CITY_CODES)))
  assert.equal(selectableCities.length, Object.keys(CITY_CODES).length)
})

test('自然語言可同時保留多個縣市且不會誤稱雙北', () => {
  const criteria = parseNaturalLanguageQuery('桃園市、新竹縣總價 2,000 萬內')
  assert.deepEqual(criteria.cities, ['桃園市', '新竹縣'])
  assert.equal(formatCitySelection(criteria.cities), '桃園市、新竹縣')

  const reversed = parseNaturalLanguageQuery('先看新竹縣，再比較桃園市')
  assert.deepEqual(reversed.cities, ['新竹縣', '桃園市'])
})

test('行政區條件會收斂到所屬縣市，避免把郵遞區號送往其他縣市', () => {
  const criteria = sanitizeCriteria({ cities: ['台北市', '新北市'], district: '板橋區' })
  assert.deepEqual(criteria.cities, ['新北市'])
  assert.equal(criteria.city, '新北市')
  assert.equal(criteria.district, '板橋區')
})

test('4 房以上是最少房數，不是精確 4 房', () => {
  const criteria = parseNaturalLanguageQuery('台北市 2500 萬內 4 房以上')
  const body = toHbhousingSearchBody(criteria)
  assert.equal(criteria.rooms, null)
  assert.equal(criteria.minRooms, 4)
  assert.equal(body.roomStart, 4)
  assert.equal(body.roomFinish, null)
})

test('精確 4 房仍同時設定房數上下限', () => {
  const criteria = sanitizeCriteria({ city: '台北市', rooms: 4, minRooms: 2 })
  const body = toHbhousingSearchBody(criteria)
  assert.equal(criteria.rooms, 4)
  assert.equal(criteria.minRooms, null)
  assert.equal(body.roomStart, 4)
  assert.equal(body.roomFinish, 4)
})

test('不合法條件被限制在安全範圍並移除未知行政區', () => {
  const criteria = sanitizeCriteria({ city: '不存在市', district: '不存在區', maxPrice: -20, rooms: 999, keyword: 'A'.repeat(100) })
  assert.equal(criteria.city, '台北市')
  assert.equal(criteria.district, '')
  assert.equal(criteria.maxPrice, 1)
  assert.equal(criteria.rooms, 20)
  assert.equal(criteria.keyword.length, 60)
})

test('行政區必須屬於已選縣市，坪數上下限顛倒時會正規化', () => {
  const mismatch = sanitizeCriteria({ city: '台北市', cities: ['台北市'], district: '板橋區', minArea: 50, maxArea: 20 })
  assert.equal(mismatch.district, '')
  assert.equal(mismatch.minArea, 20)
  assert.equal(mismatch.maxArea, 50)

  const valid = sanitizeCriteria({ city: '新北市', cities: ['新北市'], district: '板橋區' })
  assert.equal(valid.district, '板橋區')
})

test('明確切換縣市時不沿用上一輪行政區', () => {
  const criteria = parseNaturalLanguageQuery('台北市 1,300 萬內兩房', {
    city: '新北市',
    district: '板橋區',
    maxPrice: 1500,
    rooms: 2,
  })

  assert.equal(criteria.city, '台北市')
  assert.equal(criteria.district, '')
  assert.equal(criteria.maxPrice, 1300)
})

test('設備需求會保留為後端公開欄位篩選條件', () => {
  const parking = parseNaturalLanguageQuery('板橋兩房含車位')
  const elevator = parseNaturalLanguageQuery('台北市電梯兩房')

  assert.equal(parking.requireParking, true)
  assert.equal(elevator.requireElevator, true)
})

test('雙北近捷運探索需求不會偷偷加入房數限制', () => {
  const criteria = parseNaturalLanguageQuery('雙北市 2,500 萬內、距捷運站 800 公尺內、屋齡 30 年內、房數不限、通勤時間不限')

  assert.deepEqual(criteria.cities, ['台北市', '新北市'])
  assert.equal(criteria.maxPrice, 2500)
  assert.equal(criteria.maxMrtDistance, 800)
  assert.equal(criteria.maxAge, 30)
  assert.equal(criteria.rooms, null)
  assert.equal('commuteMinutes' in criteria, false)
  assert.equal(criteria.residentialOnly, true)
})

test('找房預設限定住宅，使用者明確找車位時才解除', () => {
  assert.equal(parseNaturalLanguageQuery('雙北市住宅物件').residentialOnly, true)
  assert.equal(parseNaturalLanguageQuery('台北市單售車位').residentialOnly, false)
})

test('新的探索查詢不會沿用未提及的房數條件', () => {
  const criteria = parseNaturalLanguageQuery('我想先看雙北市 2500萬內、近捷運的住宅，屋齡不要太老')

  assert.deepEqual(criteria.cities, ['台北市', '新北市'])
  assert.equal(criteria.maxPrice, 2500)
  assert.equal(criteria.rooms, null)
  assert.equal('commuteMinutes' in criteria, false)
  assert.equal(criteria.maxAge, null)
  assert.equal(criteria.keyword, '')
})

test('Agent 明確以既有條件做增量調整時仍可保留上下文', () => {
  const criteria = parseNaturalLanguageQuery('總價更重要', {
    city: '新北市', cities: ['新北市'], maxPrice: 2500, rooms: 3, maxMrtDistance: 800,
  })

  assert.equal(criteria.rooms, 3)
  assert.equal(criteria.maxMrtDistance, 800)
  assert.equal(criteria.priority, 'budget')
})

test('未指定總價時不會偷偷加入預算限制', () => {
  const criteria = parseNaturalLanguageQuery('台北市兩房住宅')
  assert.equal(criteria.maxPrice, null)
  assert.equal(toHbhousingSearchBody(criteria).priceFinish, null)
})

test('舊版通勤偏好只遷移為近捷運偏好，不保留假通勤欄位', () => {
  const criteria = sanitizeCriteria({ priority: 'commute', commuteMinutes: 25, destination: '台北車站' })
  assert.equal(criteria.priority, 'mrt')
  assert.equal('commuteMinutes' in criteria, false)
  assert.equal('destination' in criteria, false)
})
