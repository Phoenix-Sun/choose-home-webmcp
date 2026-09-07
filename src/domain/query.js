import { DISTRICT_NAMES, getDistrictOptions, getDistrictOwners, getDistrictZipCode } from './districts.js'

export const CITY_CODES = {
  台北市: 3,
  新北市: 4,
  基隆市: 2,
  宜蘭縣: 1,
  桃園市: 5,
  新竹市: 6,
  新竹縣: 7,
  苗栗縣: 8,
  台中市: 9,
  南投縣: 11,
  彰化縣: 12,
  雲林縣: 13,
  嘉義市: 14,
  嘉義縣: 15,
  台南市: 16,
  高雄市: 18,
  屏東縣: 20,
  台東縣: 21,
  花蓮縣: 22,
  澎湖縣: 23,
  金門縣: 24,
  連江縣: 25,
}

export const CITY_OPTION_GROUPS = [
  { label: '常用', cities: ['雙北市'] },
  { label: '北部', cities: ['基隆市', '台北市', '新北市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'] },
  { label: '中部', cities: ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'] },
  { label: '南部', cities: ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣'] },
  { label: '東部與離島', cities: ['花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣'] },
]

export function isTwinCitySelection(cities = []) {
  const unique = [...new Set(Array.isArray(cities) ? cities : [])]
  return unique.length === 2 && unique.includes('台北市') && unique.includes('新北市')
}

export function formatCitySelection(cities = [], fallback = '不限') {
  const unique = [...new Set((Array.isArray(cities) ? cities : []).filter((city) => CITY_CODES[city]))]
  if (!unique.length) return fallback
  if (isTwinCitySelection(unique)) return '雙北市'
  return unique.join('、')
}

export const DEFAULT_CRITERIA = {
  city: '台北市',
  cities: ['台北市'],
  district: '',
  maxPrice: null,
  rooms: null,
  minRooms: null,
  minArea: null,
  maxArea: null,
  maxAge: null,
  maxMrtDistance: null,
  keyword: '',
  priority: 'balanced',
  requireParking: false,
  requireElevator: false,
  residentialOnly: true,
}

const ROOM_NUMBERS = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const DISTRICT_PATTERN = new RegExp(DISTRICT_NAMES.join('|'))

function findDistrictSelection(text, cityHints = []) {
  const hintedOptions = getDistrictOptions(cityHints)
  const explicit = hintedOptions.find(({ city, name }) => text.includes(`${city}${name}`))
  if (explicit) return explicit
  const name = text.match(DISTRICT_PATTERN)?.[0]
  if (!name) return null
  const hintedOwners = [...new Set(hintedOptions.filter((option) => option.name === name).map((option) => option.city))]
  if (hintedOwners.length === 1) return { city: hintedOwners[0], name }
  const owners = getDistrictOwners(name)
  return owners.length === 1 ? { city: owners[0], name } : null
}

function numberFromMatch(value) {
  if (!value) return null
  return Number(String(value).replaceAll(',', ''))
}

export function parseNaturalLanguageQuery(text = '', base = DEFAULT_CRITERIA) {
  const next = { ...DEFAULT_CRITERIA, ...base }
  const normalized = String(text).trim().replaceAll('臺', '台')
  const price = normalized.match(/(?:總價\s*)?([0-9][0-9,]{2,5})\s*萬(?:元)?(?:內|以下|以內)?/)
  const room = normalized.match(/([一二兩三四五六1-6])\s*房/)
  const areaMin = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*坪(?:以上|起)/)
  const areaMax = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*坪(?:內|以下|以內)/)
  const ageMax = normalized.match(/屋齡\s*([0-9]+(?:\.[0-9]+)?)\s*年(?:內|以下|以內)/)
  const mrtDistanceMax = normalized.match(/(?:距(?:離)?\s*)?捷運(?:站)?\s*(?:約|步行)?\s*([0-9][0-9,]{1,4})\s*公尺(?:內|以下|以內)?/)
  const twinCities = /雙北(?:市)?/.test(normalized)
  const mentionedCities = Object.keys(CITY_CODES)
    .filter((name) => normalized.includes(name))
    .sort((left, right) => normalized.indexOf(left) - normalized.indexOf(right))
  const city = mentionedCities[0]
  const baseCities = Array.isArray(base.cities) && base.cities.length ? base.cities : [base.city].filter(Boolean)
  const cityHints = twinCities ? ['台北市', '新北市'] : mentionedCities.length ? mentionedCities : baseCities
  const districtSelection = findDistrictSelection(normalized, cityHints)

  if (price) next.maxPrice = numberFromMatch(price[1])
  if (room) {
    const roomCount = ROOM_NUMBERS[room[1]] || Number(room[1])
    if (new RegExp(`${room[1]}\\s*房\\s*(?:以上|起)`).test(normalized)) {
      next.rooms = null
      next.minRooms = roomCount
    } else {
      next.rooms = roomCount
      next.minRooms = null
    }
  }
  if (areaMin) next.minArea = numberFromMatch(areaMin[1])
  if (areaMax) next.maxArea = numberFromMatch(areaMax[1])
  if (ageMax) next.maxAge = numberFromMatch(ageMax[1])
  if (mrtDistanceMax) next.maxMrtDistance = numberFromMatch(mrtDistanceMax[1])
  if (/房數不限|房型不限|不限房數/.test(normalized)) {
    next.rooms = null
    next.minRooms = null
  }
  if (twinCities) {
    next.city = '台北市'
    next.cities = ['台北市', '新北市']
    next.district = ''
  } else if (city) {
    if (city !== next.city && !districtSelection) next.district = ''
    next.city = city
    next.cities = mentionedCities
  }
  if (districtSelection) {
    next.city = districtSelection.city
    next.cities = [districtSelection.city]
    next.district = districtSelection.name
  }

  next.requireParking = /車位|停車位|含車位/.test(normalized)
  next.requireElevator = /電梯|華廈|大樓/.test(normalized)
  next.residentialOnly = !/(?:單售|純)?車位|土地|店面|辦公|廠房/.test(normalized)
  next.priority = /價格優先|總價更重要|最省|便宜/.test(normalized)
    ? 'budget'
    : /近捷運優先|捷運優先|交通優先/.test(normalized)
      ? 'mrt'
      : next.priority || 'balanced'

  const keywordMatch = normalized.match(/(?:關鍵字|靠近|近)\s*[「「]?([^，。；;]{2,18})/)
  const keyword = keywordMatch?.[1]?.replace(/[」」]$/, '').trim() || ''
  if (keyword && !/^捷運(?:站)?(?:的)?(?:住宅|物件)?$/.test(keyword)) next.keyword = keyword
  return sanitizeCriteria(next)
}

export function sanitizeCriteria(input = {}) {
  const city = CITY_CODES[input.city] ? input.city : DEFAULT_CRITERIA.city
  const requestedCities = Array.isArray(input.cities) ? input.cities.filter((name) => CITY_CODES[name]) : []
  const cityConflictsWithList = CITY_CODES[input.city] && requestedCities.length && !requestedCities.includes(input.city)
  const cities = [...new Set(cityConflictsWithList ? [city] : requestedCities.length ? requestedCities : [city])]
  const priority = input.priority === 'commute' ? 'mrt' : ['balanced', 'budget', 'mrt'].includes(input.priority) ? input.priority : 'balanced'
  const finiteOr = (value, fallback, min, max) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }
  const requestedDistrict = String(input.district || '').trim()
  const matchingOwners = requestedDistrict ? getDistrictOwners(requestedDistrict).filter((owner) => cities.includes(owner)) : []
  const districtOwner = matchingOwners.length === 1 ? matchingOwners[0] : null
  const district = districtOwner ? requestedDistrict : ''
  const scopedCities = districtOwner ? [districtOwner] : cities
  let minArea = input.minArea == null ? null : finiteOr(input.minArea, null, 0, 5000)
  let maxArea = input.maxArea == null ? null : finiteOr(input.maxArea, null, 0, 5000)
  if (minArea != null && maxArea != null && minArea > maxArea) [minArea, maxArea] = [maxArea, minArea]
  return {
    city: scopedCities[0],
    cities: scopedCities,
    district,
    maxPrice: input.maxPrice == null ? null : finiteOr(input.maxPrice, null, 1, 200000),
    rooms: input.rooms == null ? null : finiteOr(input.rooms, DEFAULT_CRITERIA.rooms, 1, 20),
    minRooms: input.rooms == null && input.minRooms != null ? finiteOr(input.minRooms, null, 1, 20) : null,
    minArea,
    maxArea,
    maxAge: input.maxAge == null ? null : finiteOr(input.maxAge, null, 0, 200),
    maxMrtDistance: input.maxMrtDistance == null ? null : finiteOr(input.maxMrtDistance, null, 0, 10000),
    keyword: String(input.keyword || '').trim().slice(0, 60),
    priority,
    requireParking: Boolean(input.requireParking),
    requireElevator: Boolean(input.requireElevator),
    residentialOnly: input.residentialOnly !== false,
  }
}

export function toHbhousingSearchBody(criteria, page = 1, pageRows = 30, cityOverride = null) {
  const safe = sanitizeCriteria(criteria)
  return {
    page,
    pageRows: Math.min(30, Math.max(1, pageRows)),
    sort: safe.priority === 'budget' ? 2 : null,
    cityNo: CITY_CODES[cityOverride || safe.city],
    zipCode: safe.district ? [getDistrictZipCode(safe.city, safe.district)] : [],
    type: safe.residentialOnly ? ['1'] : [],
    priceFinish: safe.maxPrice,
    areaType: safe.minArea != null || safe.maxArea != null ? 'B' : null,
    areaStart: safe.minArea,
    areaFinish: safe.maxArea,
    ageFinish: safe.maxAge,
    roomStart: safe.rooms ?? safe.minRooms,
    roomFinish: safe.rooms,
    keyWord: safe.keyword || null,
    tag: [],
  }
}
