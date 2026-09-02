const CRITERIA_LABELS = {
  cities: '地區', district: '行政區', maxPrice: '總價上限', rooms: '房數', minRooms: '最少房數', minArea: '最小坪數', maxArea: '最大坪數', maxAge: '屋齡上限',
  maxMrtDistance: '捷運距離',
  keyword: '關鍵字', priority: '比較方式', requireElevator: '電梯', requireParking: '車位', residentialOnly: '用途',
}

function sameValue(left, right) {
  return Array.isArray(left) || Array.isArray(right)
    ? JSON.stringify(left || []) === JSON.stringify(right || [])
    : left === right
}

function formatCriteriaValue(key, value) {
  if (key === 'cities') return value?.length > 1 ? '雙北市' : value?.[0] || '不限'
  if (key === 'maxPrice') return value == null ? '不限' : `${Number(value).toLocaleString()} 萬`
  if (key === 'rooms') return value == null ? '不限' : `${value} 房`
  if (key === 'minRooms') return value == null ? '不限' : `${value} 房以上`
  if (key === 'minArea') return value == null ? '不限' : `${value} 坪以上`
  if (key === 'maxArea') return value == null ? '不限' : `${value} 坪內`
  if (key === 'maxAge') return value == null ? '不限' : `${value} 年內`
  if (key === 'maxMrtDistance') return value == null ? '不限' : `${value} 公尺內`
  if (key === 'priority') return value === 'budget' ? '價格優先' : value === 'mrt' ? '近捷運優先' : '綜合折衷'
  if (['requireElevator', 'requireParking', 'residentialOnly'].includes(key)) return value ? '需要' : '不限'
  return value || '不限'
}

export function describeCriteriaChanges(previousCriteria = {}, nextCriteria = {}) {
  return Object.keys(CRITERIA_LABELS)
    .filter((key) => !sameValue(previousCriteria[key], nextCriteria[key]))
    .map((key) => ({ key, label: CRITERIA_LABELS[key], before: formatCriteriaValue(key, previousCriteria[key]), after: formatCriteriaValue(key, nextCriteria[key]) }))
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10
}

function distribution(candidates = []) {
  const prices = candidates.map((candidate) => Number(candidate.price)).filter(Number.isFinite)
  const ages = candidates.map((candidate) => candidate.age == null ? null : Number(candidate.age)).filter(Number.isFinite)
  const mrtDistances = candidates.map((candidate) => candidate.mrtDistanceMeters == null ? null : Number(candidate.mrtDistanceMeters)).filter(Number.isFinite)
  return {
    minPriceWan: prices.length ? Math.min(...prices) : null,
    medianPriceWan: median(prices),
    medianAgeYears: median(ages),
    ageCoverageCount: ages.length,
    medianMrtDistanceMeters: median(mrtDistances),
    mrtCoverageCount: mrtDistances.length,
  }
}

export function summarizeDecisionChange({ previousCriteria = {}, nextCriteria = {}, previousCandidates = [], nextCandidates = [], favoriteIds = [], actor = 'user' }) {
  const criteriaChanges = describeCriteriaChanges(previousCriteria, nextCriteria)
  const previousIds = new Set(previousCandidates.map((candidate) => candidate.id))
  const nextIds = new Set(nextCandidates.map((candidate) => candidate.id))
  const addedCandidates = nextCandidates.filter((candidate) => !previousIds.has(candidate.id))
  const removedCandidates = previousCandidates.filter((candidate) => !nextIds.has(candidate.id))
  const previousMinPrice = previousCandidates.length ? Math.min(...previousCandidates.map((candidate) => candidate.price)) : null
  const nextMinPrice = nextCandidates.length ? Math.min(...nextCandidates.map((candidate) => candidate.price)) : null
  const preservedFavoriteIds = favoriteIds.filter((id) => previousIds.has(id) || nextIds.has(id))
  return {
    actor,
    createdAt: new Date().toISOString(),
    criteriaChanges,
    previousLoadedCount: previousCandidates.length,
    nextLoadedCount: nextCandidates.length,
    addedCount: addedCandidates.length,
    removedCount: removedCandidates.length,
    addedCandidates: addedCandidates.slice(0, 5),
    removedCandidates: removedCandidates.slice(0, 5),
    previousMinPrice,
    nextMinPrice,
    preservedFavoriteIds,
    scopeNote: '候選變化依目前已載入的公開物件計算',
  }
}

export function summarizeConstraintPreview({ previewId, currentCriteria = {}, nextCriteria = {}, currentCandidates = [], previewCandidates = [], favoriteIds = [], currentSource = {}, previewSource = {} }) {
  const currentIds = new Set(currentCandidates.map((candidate) => candidate.id))
  const previewIds = new Set(previewCandidates.map((candidate) => candidate.id))
  const addedCandidates = previewCandidates.filter((candidate) => !currentIds.has(candidate.id))
  const removedCandidates = currentCandidates.filter((candidate) => !previewIds.has(candidate.id))
  const favoriteImpact = favoriteIds.map((id) => ({ candidateId: id, status: previewIds.has(id) ? 'still_matches' : 'outside_preview' }))
  const currentComplete = Boolean(currentSource.resultSetComplete)
  const previewComplete = Boolean(previewSource.resultSetComplete)
  return {
    previewId,
    status: 'awaiting_confirmation',
    createdAt: new Date().toISOString(),
    currentCriteria,
    nextCriteria,
    criteriaChanges: describeCriteriaChanges(currentCriteria, nextCriteria),
    currentLoadedCount: currentCandidates.length,
    previewLoadedCount: previewCandidates.length,
    addedCount: addedCandidates.length,
    removedCount: removedCandidates.length,
    addedCandidates: addedCandidates.slice(0, 10),
    removedCandidates: removedCandidates.slice(0, 10),
    favoriteImpact,
    favoritesStillMatching: favoriteImpact.filter((item) => item.status === 'still_matches').length,
    favoritesOutsidePreview: favoriteImpact.filter((item) => item.status === 'outside_preview').length,
    distributions: { current: distribution(currentCandidates), preview: distribution(previewCandidates) },
    dataScope: {
      current: { sourceTotalCount: Number(currentSource.totalCount) || 0, inspectedCount: Number(currentSource.inspectedCount) || 0, loadedMatchCount: currentCandidates.length, resultSetComplete: currentComplete },
      preview: { sourceTotalCount: Number(previewSource.totalCount) || 0, inspectedCount: Number(previewSource.inspectedCount) || 0, loadedMatchCount: previewCandidates.length, resultSetComplete: previewComplete },
      comparisonComplete: currentComplete && previewComplete,
      note: currentComplete && previewComplete ? '已比較兩組條件的完整公開搜尋結果' : '目前差異依已檢查的公開物件計算；尚有結果頁未載入',
    },
  }
}

export function getPropertyEvidenceGaps(candidate) {
  if (!candidate) return { candidateId: null, gaps: [], availableFields: [] }
  const gaps = []
  const availableFields = []
  if (candidate.age == null) gaps.push({ field: 'age', label: '屋齡', status: 'missing', detail: '公開物件資料未提供完整屋齡' })
  else availableFields.push('age')
  if (!candidate.layout || /--/.test(candidate.layout)) gaps.push({ field: 'layout', label: '格局', status: 'incomplete', detail: `公開格局標示為「${candidate.layout || '未提供'}」` })
  else availableFields.push('layout')
  if (candidate.actualPriceEvidence?.status !== 'live') gaps.push({ field: 'actual_price', label: '同區相近條件成交', status: candidate.actualPriceEvidence?.status || 'not_requested', detail: candidate.actualPriceEvidence?.message || '尚未取得足夠可比成交資料' })
  else availableFields.push('actual_price')
  if (candidate.mrtDistanceMeters == null) gaps.push({ field: 'mrt_distance', label: '捷運距離', status: 'missing', detail: '公開物件資料未提供捷運距離' })
  else availableFields.push('mrt_distance')
  if (!candidate.parking || /未提供/.test(candidate.parking)) gaps.push({ field: 'parking', label: '停車資訊', status: 'missing', detail: '公開物件資料未完整標示停車資訊' })
  else availableFields.push('parking')
  if (candidate.source?.status === 'snapshot') gaps.push({ field: 'listing_freshness', label: '物件更新狀態', status: 'snapshot', detail: `目前使用 ${candidate.source.fetchedAt || '未標示時間'} 的公開快照` })
  else availableFields.push('listing_freshness')
  return { candidateId: candidate.id, candidateName: candidate.name, sourceUrl: candidate.sourceUrl, sourceFetchedAt: candidate.source?.fetchedAt || null, gaps, availableFields }
}

export function getComparisonFacts(candidates = [], criteria = {}) {
  const mrtLimit = Number.isFinite(criteria.maxMrtDistance) ? criteria.maxMrtDistance : null
  return {
    criteria,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      priceWan: candidate.price,
      withinBudget: criteria.maxPrice == null ? null : candidate.price <= criteria.maxPrice,
      sizePing: candidate.size,
      ageYears: candidate.age,
      layout: candidate.layout,
      nearestMrt: candidate.station,
      mrtDistanceMeters: candidate.mrtDistanceMeters,
      withinMrtDistanceLimit: mrtLimit == null || candidate.mrtDistanceMeters == null ? null : candidate.mrtDistanceMeters <= mrtLimit,
      propertyType: candidate.propertyType,
      parking: candidate.parking,
      evidenceGaps: getPropertyEvidenceGaps(candidate).gaps,
      sourceUrl: candidate.sourceUrl,
    })),
  }
}
