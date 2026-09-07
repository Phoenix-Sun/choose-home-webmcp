import http from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CRITERIA, parseNaturalLanguageQuery, sanitizeCriteria, toHbhousingSearchBody } from './src/domain/query.js'
import { isDistrictZipShared } from './src/domain/districts.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const IS_DEV = process.argv.includes('--dev')
const PORT = Number(process.env.PORT || (IS_DEV ? 5173 : 4173))
const HOST = process.env.HOST || '0.0.0.0'
const HB_ORIGIN = 'https://www.hbhousing.com.tw'
const SEARCH_URL = `${HB_ORIGIN}/proxy/api/HB/BuyHouseRelated/GetHouseDataCount`
const ENRICH_URL = `${HB_ORIGIN}/proxy/api/HB/BuyHouseRelated/GetMultipleHouseDatas`
const REAL_PRICE_URL = `${HB_ORIGIN}/proxy/api/HB/RealPriceRelated/GetSearchRPListDatas`
const CACHE_TTL_MS = 45_000
const cache = new Map()
const requestWindows = new Map()

const cityNamesByCode = new Map([[3, '台北市'], [4, '新北市'], [2, '基隆市'], [1, '宜蘭縣'], [5, '桃園市'], [6, '新竹市'], [7, '新竹縣'], [8, '苗栗縣'], [9, '台中市'], [11, '南投縣'], [12, '彰化縣'], [13, '雲林縣'], [14, '嘉義市'], [15, '嘉義縣'], [16, '台南市'], [18, '高雄市'], [20, '屏東縣'], [21, '台東縣'], [22, '花蓮縣'], [23, '澎湖縣'], [24, '金門縣'], [25, '連江縣']])
const realPriceStyleCodes = { 公寓: '2', 大樓: '3', 華廈: '1', 透天: '4', 別墅: '4', 土地: '11' }

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJson(req) {
  if (req.body != null) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (raw.length > 65_536) throw new Error('request_too_large')
    if (typeof req.body === 'object') return req.body
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error('invalid_json')
    }
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 65_536) throw new Error('request_too_large')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('invalid_json')
  }
}

function isRateLimited(req) {
  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  const key = forwardedFor || req.socket?.remoteAddress || 'local'
  const now = Date.now()
  for (const [address, window] of requestWindows) {
    if (now - window.startedAt > 60_000) requestWindows.delete(address)
  }
  const current = requestWindows.get(key)
  if (!current || now - current.startedAt > 60_000) {
    requestWindows.set(key, { startedAt: now, count: 1 })
    return false
  }
  current.count += 1
  return current.count > 60
}

async function fetchPublicJson(url, options = {}, acceptedCodes = [200]) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(9_000),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'DecisionMap/1.0 public-property-demo',
      ...options.headers,
    },
  })
  if (!response.ok) throw new Error(`upstream_http_${response.status}`)
  const payload = await response.json()
  if (!acceptedCodes.includes(payload?.code)) throw new Error(`upstream_code_${payload?.code || 'unknown'}`)
  return payload
}

async function fetchPublicSearch(body, startPage = 1, batchPages = 5) {
  const firstBody = { ...body, page: startPage }
  const first = await fetchPublicJson(SEARCH_URL, { method: 'POST', body: JSON.stringify(firstBody) }, [200, 201])
  const totalCount = Number(first.data?.cnts || 0)
  const pageRows = Number(body.pageRows || 30)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageRows))
  const endPage = Math.min(totalPages, startPage + batchPages - 1)
  const remaining = endPage > startPage
    ? await Promise.all(Array.from({ length: endPage - startPage }, (_, index) => {
      const pageBody = { ...body, page: startPage + index + 1 }
      return fetchPublicJson(SEARCH_URL, { method: 'POST', body: JSON.stringify(pageBody) }, [200, 201])
    }))
    : []
  const items = [first, ...remaining].flatMap((payload) => payload.data?.buyHouseListDatas || [])
  const uniqueItems = [...new Map(items.map((item) => [String(item.sn), item])).values()]
  return {
    payload: first,
    totalCount,
    totalPages,
    items: uniqueItems,
    inspectedCount: uniqueItems.length,
    startPage,
    endPage,
    nextPage: endPage < totalPages ? endPage + 1 : null,
  }
}

function isValidTaiwanCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 20 && lat <= 27 && lon >= 118 && lon <= 123
}

function nonNegativeNumberOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function publicTags(item) {
  const feature = String(item.feature || '')
  return [feature.includes('s') ? '近學校' : null, feature.includes('g') ? '近公園' : null, feature.includes('m') ? '近市場' : null].filter(Boolean)
}

function hasConfirmedParking(value) {
  const normalized = String(value || '').replaceAll(' ', '')
  return Boolean(normalized) && !/^(?:無|無車位|無汽車位|未提供|未知|0)$/.test(normalized)
}

function hasExplicitElevator(item) {
  if (item.elevator === true || item.hasElevator === true) return true
  const value = String(item.elevator ?? item.hasElevator ?? '').trim()
  if (/^(?:有|是|1|true)$/i.test(value)) return true
  return /電梯/.test([item.objName, item.emphasis1, item.special].map((part) => String(part || '')).join(' '))
}

function isStandaloneParking(item) {
  const name = String(item.objName || item.name || '')
  const rooms = Number(item.room ?? item.rooms)
  const area = Number(item.area ?? item.size)
  const parkingIntent = /(?:獨立產權|單售|純|專售|好停)?車位|停車位/.test(name)
  return parkingIntent && (!Number.isFinite(rooms) || rooms <= 0) && Number.isFinite(area) && area <= 8
}

function normalizeCandidate(item, criteria, fetchedAt, sourceStatus = 'live') {
  const category = String(item.category || '').split(',').map((part) => part.replaceAll('臺', '台'))
  const city = category[1] || cityNamesByCode.get(Number(item.cityNo)) || criteria.city
  const district = category[2] || ''
  const tags = publicTags(item)
  const life = Math.min(92, 50 + tags.length * 12 + (item.mrt ? 10 : 0))
  const lat = Number(item.lat)
  const lon = Number(item.lon)
  const location = isValidTaiwanCoordinate(lat, lon) ? { lat, lon } : null
  return {
    id: String(item.sn),
    name: String(item.objName || '未命名物件'),
    address: `${city}${item.doorplate || ''}`,
    city,
    district,
    zipCode: String(item.zipCode || ''),
    price: Number(item.price || item.salePrice || 0),
    originalPrice: Number(item.originalPrice) || null,
    layout: item.special || `${item.room || 0}房 ${item.hall || 0}廳 ${item.bath || 0}衛`,
    rooms: Number(item.room) || null,
    halls: Number(item.hall) || null,
    baths: Number(item.bath) || null,
    age: nonNegativeNumberOrNull(item.age),
    size: Number(item.area) || null,
    floor: [item.floor, item.floorTotal].filter(Boolean).join(' / ') || '未提供',
    propertyType: item.type || '未提供',
    style: item.style || '未提供',
    parking: item.parking || '未提供',
    hasConfirmedParking: hasConfirmedParking(item.parking),
    hasElevatorEvidence: hasExplicitElevator(item),
    isStandaloneParking: isStandaloneParking(item),
    station: item.mrt ? String(item.mrt).replace(/^捷運-/, '') : '未提供',
    mrtDistanceMeters: nonNegativeNumberOrNull(item.mrtDis),
    life,
    tags,
    location,
    sourceUrl: `${HB_ORIGIN}/detail?sn=${encodeURIComponent(item.sn)}`,
    source: {
      provider: '公開物件來源',
      status: sourceStatus,
      fetchedAt,
      publicOnly: true,
    },
    evidence: {
      listing: sourceStatus,
      transit: Number(item.mrtDis) > 0 ? 'public_listing' : 'missing',
      facilities: tags.length ? 'public_listing_tags' : 'missing',
      actualPrice: 'not_requested',
    },
  }
}

function scoreCandidate(candidate, criteria) {
  const weights = criteria.priority === 'budget'
    ? { price: 0.65, mrt: 0.2, life: 0.15 }
    : criteria.priority === 'mrt'
      ? { price: 0.2, mrt: 0.65, life: 0.15 }
      : { price: 0.4, mrt: 0.35, life: 0.25 }
  const priceReference = criteria.maxPrice || 5000
  const priceScore = Math.max(0, Math.min(100, 110 - (candidate.price / priceReference) * 85))
  const mrtReference = criteria.maxMrtDistance || 1000
  const mrtScore = candidate.mrtDistanceMeters == null ? 20 : Math.max(0, Math.min(100, 110 - (candidate.mrtDistanceMeters / mrtReference) * 80))
  return Math.round(priceScore * weights.price + mrtScore * weights.mrt + candidate.life * weights.life)
}

function filterAndRank(candidates, criteria) {
  const filtered = candidates.filter((item) => {
    if (criteria.district && item.district !== criteria.district) return false
    if (criteria.residentialOnly && (item.propertyType !== '住宅' || item.isStandaloneParking)) return false
    if (criteria.requireParking && !(item.hasConfirmedParking ?? hasConfirmedParking(item.parking))) return false
    if (criteria.requireElevator && item.hasElevatorEvidence !== true) return false
    if (criteria.maxMrtDistance != null && (item.mrtDistanceMeters == null || item.mrtDistanceMeters > criteria.maxMrtDistance)) return false
    return true
  })
  return filtered
    .map((item) => ({ ...item, score: scoreCandidate(item, criteria) }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, displayRank: index + 1 }))
}

function buildSearchPlan(criteria, cursor, pageCountsByCity) {
  const hasCursor = cursor && typeof cursor === 'object'
  return criteria.cities.flatMap((city) => {
    if (hasCursor && Object.hasOwn(cursor, city) && cursor[city] == null) return []
    const startPage = hasCursor ? Number(cursor[city]) || 1 : 1
    const requestedPages = Number(pageCountsByCity?.[city])
    const batchPages = Math.min(10, Math.max(1, Number.isFinite(requestedPages) ? requestedPages : 5))
    return [{ city, startPage, batchPages, body: toHbhousingSearchBody(criteria, startPage, 30, city) }]
  })
}

async function searchProperties(input = {}) {
  const criteria = input.query
    ? parseNaturalLanguageQuery(input.query, input.criteria || DEFAULT_CRITERIA)
    : sanitizeCriteria(input.criteria || input)
  const cursor = input.cursor && typeof input.cursor === 'object' ? input.cursor : null
  const defaultBatchPages = Math.min(5, Math.max(1, Number(input.batchPages) || 5))
  const pageCountsByCity = input.pageCountsByCity || Object.fromEntries(criteria.cities.map((city) => [city, defaultBatchPages]))
  const upstreamBodies = buildSearchPlan(criteria, cursor, pageCountsByCity)
  const cacheKey = JSON.stringify({ upstreamBodies })
  const cached = cache.get(cacheKey)
  if (!input.bypassCache && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return { ...cached.value, cache: 'hit' }
  const fetchedAt = new Date().toISOString()
  try {
    const cityResults = await Promise.all(upstreamBodies.map(({ body, startPage, batchPages }) => fetchPublicSearch(body, startPage, batchPages)))
    const resultByCity = new Map(cityResults.map((result, index) => [upstreamBodies[index].city, result]))
    const nextCursor = Object.fromEntries(criteria.cities.map((city) => [city, resultByCity.get(city)?.nextPage ?? null]))
    const coverageByCity = Object.fromEntries(criteria.cities.map((city) => {
      const result = resultByCity.get(city)
      return [city, result ? { startPage: result.startPage, endPage: result.endPage, totalPages: result.totalPages, totalCount: result.totalCount, inspectedCount: result.inspectedCount } : { startPage: null, endPage: null, totalPages: null, totalCount: null, inspectedCount: 0 }]
    }))
    const searchResult = {
      totalCount: cityResults.reduce((sum, result) => sum + result.totalCount, 0),
      inspectedCount: cityResults.reduce((sum, result) => sum + result.inspectedCount, 0),
      items: [...new Map(cityResults.flatMap((result) => result.items).map((item) => [String(item.sn), item])).values()],
    }
    const normalized = searchResult.items.map((item) => normalizeCandidate(item, criteria, fetchedAt))
    const rankedCandidates = filterAndRank(normalized, criteria)
    const candidates = rankedCandidates
    const warnings = []
    const requiresExactDistrictPostFilter = isDistrictZipShared(criteria.city, criteria.district)
    const value = {
      ok: true,
      criteria,
      totalCount: searchResult.totalCount,
      inspectedCount: searchResult.inspectedCount,
      matchedInFetchedPage: rankedCandidates.length,
      returnedCount: candidates.length,
      recommendationIds: candidates.slice(0, 10).map((candidate) => candidate.id),
      nextCursor,
      coverageByCity,
      hasMore: Object.values(nextCursor).some(Number.isFinite),
      resultSetComplete: Object.values(nextCursor).every((value) => value == null),
      candidates,
      warnings,
      source: { status: 'live', provider: '公開物件來源', fetchedAt, url: `${HB_ORIGIN}/buyhouse`, cacheTtlSeconds: CACHE_TTL_MS / 1000, requiresExactDistrictPostFilter, countScope: requiresExactDistrictPostFilter ? 'postal_area_before_exact_district_check' : 'active_source_query' },
    }
    cache.set(cacheKey, { cachedAt: Date.now(), value })
    if (cache.size > 50) cache.delete(cache.keys().next().value)
    return { ...value, cache: 'miss' }
  } catch {
    return {
      ok: false,
      error: 'public_source_unavailable',
      criteria,
      totalCount: 0,
      inspectedCount: 0,
      matchedInFetchedPage: 0,
      returnedCount: 0,
      recommendationIds: [],
      nextCursor: Object.fromEntries(criteria.cities.map((city) => [city, null])),
      coverageByCity: {},
      hasMore: false,
      resultSetComplete: true,
      candidates: [],
      warnings: ['公開物件來源暫時無法取得；系統不會用過期或模擬資料代替。'],
      source: { status: 'error', provider: '公開物件來源', fetchedAt, url: `${HB_ORIGIN}/buyhouse`, publicOnly: true },
    }
  }
}

function comparableBody(candidate) {
  const styleCode = realPriceStyleCodes[candidate.style] || '3'
  const size = Number(candidate.size) || null
  return {
    zipCode: String(candidate.zipCode || candidate.sourceZipCode || ''),
    style: [styleCode],
    ageStart: null,
    ageFinish: null,
    source: 1,
    distance: 1000,
    dealtime: 1,
    priceStart: null,
    priceFinish: null,
    areaStart: size ? Math.max(1, Math.floor(size * 0.7)) : null,
    areaFinish: size ? Math.ceil(size * 1.3) : null,
    roomStart: candidate.rooms || null,
    roomFinish: candidate.rooms || null,
    upriceStart: null,
    upriceFinish: null,
    parking: null,
    exclude: 0,
    sort: null,
    address: candidate.district || '',
    page: 1,
    pageRows: 5,
  }
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100
}

async function enrichCandidate(candidate, criteria = DEFAULT_CRITERIA) {
  const fetchedAt = new Date().toISOString()
  const enriched = { ...candidate, source: { ...candidate.source, fetchedAt } }
  const [detailResult, realPriceResult] = await Promise.allSettled([
      fetchPublicJson(ENRICH_URL, { method: 'POST', body: JSON.stringify({ snList: [candidate.id], sort: null, rentSell: 2 }) }, [200, 201]),
      candidate.zipCode || candidate.sourceZipCode
        ? fetchPublicJson(REAL_PRICE_URL, { method: 'POST', body: JSON.stringify(comparableBody(candidate)) }, [200, 201])
        : Promise.resolve({ data: [] }),
    ])
  if (detailResult.status === 'fulfilled') {
    const detailPayload = detailResult.value
    const detail = detailPayload.data?.[0]
    if (detail) {
      const normalized = normalizeCandidate(detail, criteria, fetchedAt)
      normalized.location = {
        ...normalized.location,
        x: candidate.location?.x,
        y: candidate.location?.y,
      }
      Object.assign(enriched, normalized)
    }
    enriched.evidence = { ...enriched.evidence, listing: 'live' }
  } else {
    enriched.evidence = { ...enriched.evidence, listing: 'error' }
  }
  if (realPriceResult.status === 'fulfilled') {
    const realPricePayload = realPriceResult.value
    const comparables = (realPricePayload.data || []).map((item) => ({
      id: String(item.sn),
      dealYearMonth: item.dealYearMonth,
      address: item.doorplate,
      price: Number(item.dealMoney),
      area: Number(item.area),
      unitPrice: Number(item.uprice),
      style: item.style,
      age: Number(item.age),
      source: '內政部實價登錄（原始物件網站公開查詢介面）',
    }))
    const validComparables = comparables.filter((item) => Number.isFinite(item.unitPrice) && item.unitPrice > 0)
    enriched.actualPriceEvidence = validComparables.length
      ? { status: 'live', fetchedAt, count: validComparables.length, sampleLimit: 5, medianUnitPrice: median(validComparables.map((item) => item.unitPrice)), scope: { district: candidate.district || null, style: candidate.style || null, rooms: candidate.rooms || null, areaRatio: '70%-130%', radiusApplied: false }, comparables: validComparables }
      : { status: 'missing', fetchedAt, count: 0, message: '目前條件下無足夠可比成交資料' }
  } else {
    enriched.actualPriceEvidence = { status: 'error', fetchedAt, message: '目前無法更新實價資訊，請稍後再試' }
  }
  enriched.evidence = { ...enriched.evidence, actualPrice: enriched.actualPriceEvidence.status }
  return { ...enriched, score: scoreCandidate(enriched, criteria) }
}

async function handleApi(req, res, url) {
  if (isRateLimited(req)) return json(res, 429, { ok: false, error: 'rate_limited' })
  if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'decision-map', liveAdapter: true, now: new Date().toISOString() })
  if (url.pathname === '/api/properties/search' && req.method === 'POST') {
    const input = await readJson(req)
    return json(res, 200, await searchProperties(input))
  }
  if (url.pathname === '/api/properties/preview' && req.method === 'POST') {
    const input = await readJson(req)
    const preview = await searchProperties({ criteria: input.criteria, batchPages: input.batchPages, pageCountsByCity: input.pageCountsByCity, bypassCache: input.bypassCache })
    return json(res, 200, { ...preview, previewOnly: true })
  }
  if (url.pathname === '/api/properties/enrich' && req.method === 'POST') {
    const input = await readJson(req)
    const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 5) : []
    const criteria = sanitizeCriteria(input.criteria || DEFAULT_CRITERIA)
    const enriched = await Promise.all(candidates.map((candidate) => enrichCandidate(candidate, criteria)))
    return json(res, 200, { ok: true, candidates: enriched, source: { status: 'live', fetchedAt: new Date().toISOString(), publicOnly: true } })
  }
  return json(res, 404, { ok: false, error: 'not_found' })
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }

async function serveStatic(req, res, url) {
  const decoded = decodeURIComponent(url.pathname)
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  let filePath = path.resolve(DIST, relative)
  const relativeToDist = path.relative(DIST, filePath)
  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) return json(res, 403, { ok: false, error: 'forbidden' })
  if (!existsSync(filePath) || (await stat(filePath)).isDirectory()) filePath = path.join(DIST, 'index.html')
  const content = await readFile(filePath)
  res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
  res.end(content)
}

let vite = null
if (IS_DEV) {
  const { createServer: createViteServer } = await import('vite')
  vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' })
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    if (vite) return vite.middlewares(req, res, (error) => error ? json(res, 500, { ok: false, error: error.message }) : json(res, 404, { ok: false, error: 'not_found' }))
    return await serveStatic(req, res, url)
  } catch (error) {
    return json(res, error.message === 'invalid_json' ? 400 : error.message === 'request_too_large' ? 413 : 500, { ok: false, error: error.message })
  }
})

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  server.listen(PORT, HOST, () => {
    console.log(`選好宅 ${IS_DEV ? 'development' : 'production'} server listening on ${HOST}:${PORT}`)
  })
}

export { buildSearchPlan, filterAndRank, handleApi, hasConfirmedParking, isStandaloneParking, isValidTaiwanCoordinate, normalizeCandidate, readJson, searchProperties }
