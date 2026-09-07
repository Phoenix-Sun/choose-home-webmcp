import { expect, test } from '@playwright/test'
import { WEBMCP_TOOL_NAMES } from '../src/domain/webmcpContract.js'

function candidate(id, overrides = {}) {
  return {
    id,
    name: `公開物件 ${id}`,
    address: `新北市板橋區測試路 ${id} 號`,
    city: '新北市',
    district: '板橋區',
    zipCode: '220',
    price: id === 'A' ? 1680 : id === 'B' ? 1880 : 2080,
    layout: '2房 1廳 1衛',
    rooms: 2,
    halls: 1,
    baths: 1,
    age: 12,
    size: 25,
    floor: '5 / 12',
    propertyType: '住宅',
    style: '大樓',
    parking: '無',
    station: '板橋站',
    mrtDistanceMeters: id === 'A' ? 350 : 520,
    life: 70,
    tags: ['近學校'],
    location: { lat: 25.012, lon: 121.462 },
    sourceUrl: `https://example.com/property/${id}`,
    source: { provider: '公開物件來源', status: 'live', fetchedAt: '2026-09-07T00:00:00.000Z', publicOnly: true },
    evidence: { listing: 'live', transit: 'public_listing', facilities: 'public_listing_tags', actualPrice: 'not_requested' },
    score: id === 'A' ? 90 : id === 'B' ? 80 : 70,
    ...overrides,
  }
}

function searchResponse(body = {}) {
  const criteria = body.criteria || { city: '台北市', cities: ['台北市'], district: '', maxPrice: null, rooms: null, minRooms: null, minArea: null, maxArea: null, maxAge: null, maxMrtDistance: null, keyword: '', requireElevator: false, requireParking: false, residentialOnly: true, priority: 'balanced' }
  const isContinuation = Boolean(body.cursor)
  const narrowed = criteria.maxPrice === 1600
  const candidates = isContinuation ? [candidate('C')] : narrowed ? [candidate('B', { price: 1580 })] : [candidate('A'), candidate('B')]
  return {
    ok: true,
    criteria,
    totalCount: 3,
    inspectedCount: isContinuation ? 1 : 2,
    returnedCount: candidates.length,
    candidates,
    warnings: [],
    nextCursor: { [criteria.city || '台北市']: isContinuation || narrowed ? null : 6 },
    coverageByCity: { [criteria.city || '台北市']: { startPage: isContinuation ? 6 : 1, endPage: isContinuation ? 6 : 5, totalPages: 6, totalCount: 3, inspectedCount: isContinuation ? 1 : 2 } },
    hasMore: !isContinuation && !narrowed,
    resultSetComplete: isContinuation || narrowed,
    source: { status: 'live', provider: '公開物件來源', fetchedAt: '2026-09-07T00:00:00.000Z', countScope: 'active_source_query' },
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.__webmcpTools = []
    window.__copiedShareUrl = ''
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool(tool) { window.__webmcpTools.push(tool); return tool } },
    })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(value) { window.__copiedShareUrl = value } },
    })
  })

  await page.route('**/api/properties/search', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(searchResponse(body)) })
  })
  await page.route('**/api/properties/preview', async (route) => {
    const body = route.request().postDataJSON()
    const response = searchResponse({ criteria: body.criteria })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...response, candidates: [candidate('A')], returnedCount: 1 }) })
  })
})

async function invokeTool(page, name, input = {}) {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const tool = window.__webmcpTools.find((item) => item.name === toolName)
    if (!tool) throw new Error(`Missing tool: ${toolName}`)
    return tool.execute(toolInput)
  }, { toolName: name, toolInput: input })
}

test('WebMCP 查詢、完整載入、確認變更、收藏保護與分享形成同一個可見流程', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/?mode=ai')
  await expect(page.getByRole('heading', { name: '找到真正適合你的家' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__webmcpTools.map((tool) => tool.name))).toEqual(WEBMCP_TOOL_NAMES)

  const search = await invokeTool(page, 'search_public_properties', {
    query: '新北市板橋區 2,500 萬內、兩房、近捷運',
    city: '新北市', cities: ['新北市'], district: '板橋區', maxPrice: 2500, rooms: 2,
    maxMrtDistance: 800, residentialOnly: true, priority: 'balanced',
  })
  expect(search.loadedMatchCount).toBe(2)
  await expect(page.getByLabel('你的找房條件')).toContainText('新北市板橋區')
  await expect(page.locator('.candidate-row')).toHaveCount(2)

  const loaded = await invokeTool(page, 'load_all_property_results')
  expect(loaded.status).toBe('complete')
  expect(loaded.resultSetComplete).toBe(true)

  const loadedAgain = await invokeTool(page, 'load_all_property_results')
  expect(loadedAgain.status).toBe('complete')
  expect(loadedAgain.batches).toBe(0)
  await expect(page.locator('.candidate-row')).toHaveCount(3)
  await expect(page.locator('.result-controls')).toContainText('已顯示全部結果')

  const preview = await invokeTool(page, 'preview_constraint_change', { maxPrice: 1800 })
  expect(preview.status).not.toBe('superseded_by_newer_preview')
  await expect(page.getByRole('heading', { name: '新條件會帶來什麼變化' })).toBeVisible()
  const applied = await invokeTool(page, 'apply_previewed_constraints', { previewId: preview.previewId })
  expect(applied.status).toBe('applied')
  await expect(page.getByLabel('你的找房條件')).toContainText('1,800')

  await invokeTool(page, 'pin_candidate', { candidateId: 'A' })
  await invokeTool(page, 'update_constraints', { maxPrice: 1600 })
  const state = await invokeTool(page, 'get_decision_state')
  expect(state.pinnedCandidateIds).toContain('A')
  expect(state.loadedCandidateCount).toBe(1)
  await expect(page.getByRole('button', { name: /我的收藏 1/u })).toBeVisible()

  await page.getByRole('button', { name: '分享' }).click()
  await expect(page.getByRole('dialog', { name: '你的選房摘要' })).toContainText('不包含收藏和私人筆記')
  await page.getByRole('button', { name: '複製分享連結' }).click()
  const sharedUrl = await page.evaluate(() => window.__copiedShareUrl)
  expect(new URL(sharedUrl).searchParams.has('share')).toBe(true)
  expect(sharedUrl).not.toContain('mode=ai')

  await page.goto(sharedUrl)
  await expect(page.getByLabel('你的找房條件')).toContainText('1,600')
  await expect(page.locator('.candidate-row')).toHaveCount(1)
  expect(pageErrors).toEqual([])
})
