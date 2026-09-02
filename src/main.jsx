import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { DEFAULT_CRITERIA } from './domain/query.js'
import { createPropertyFeatureCollection } from './domain/mapData.js'
import { buildExplainableRecommendations } from './domain/recommendations.js'
import { MAX_COMPARE, addComparisonIds, removeComparisonIds } from './domain/decisionState.js'
import { getComparisonFacts, getPropertyEvidenceGaps, summarizeConstraintPreview, summarizeDecisionChange } from './domain/decisionInsights.js'
import { CLEARED_WORKSPACE_REQUEST, WORKSPACE_STORAGE_VERSION, createAgentCandidateFilter, createClearedWorkspaceSnapshot, createIdleSourceState, createWorkspaceStorageEnvelope, parseWorkspaceStore } from './domain/workspaceState.js'
import './styles.css'

const sourceLinks = {
  hbhousing: 'https://www.hbhousing.com.tw/buyhouse',
  actual: 'https://plvr.land.moi.gov.tw/Index',
}

const sourceCatalog = [
  { id: 'listing', short: '原始物件', url: sourceLinks.hbhousing },
  { id: 'actual', short: '實價登錄', url: sourceLinks.actual },
]

const scenarioConfig = {
  balanced: { label: '綜合折衷', price: 40, mrt: 35, life: 25 },
  budget: { label: '最省預算', price: 65, mrt: 20, life: 15 },
  mrt: { label: '近捷運優先', price: 20, mrt: 65, life: 15 },
}

const CONSTRAINT_SCHEMA_PROPERTIES = {
  city: { type: 'string' },
  cities: { type: 'array', items: { type: 'string' } },
  district: { type: 'string' },
  maxPrice: { type: ['number', 'null'] },
  rooms: { type: ['integer', 'null'] },
  minRooms: { type: ['integer', 'null'] },
  minArea: { type: ['number', 'null'] },
  maxArea: { type: ['number', 'null'] },
  maxAge: { type: ['number', 'null'] },
  maxMrtDistance: { type: ['number', 'null'] },
  keyword: { type: 'string' },
  requireElevator: { type: 'boolean' },
  requireParking: { type: 'boolean' },
  residentialOnly: { type: 'boolean' },
  priority: { type: 'string', enum: ['budget', 'mrt', 'balanced'] },
}

const PROPERTY_SOURCE_ID = 'public-properties'
const PROPERTY_CLUSTER_HALO_LAYER = 'property-cluster-halo'
const PROPERTY_CLUSTER_LAYER = 'property-clusters'
const PROPERTY_CLUSTER_COUNT_LAYER = 'property-cluster-count'
const PROPERTY_POINT_LAYER = 'property-points'
const PROPERTY_POINT_CENTER_LAYER = 'property-point-centers'
const FAVORITE_STORAGE_KEY = 'choose-home.favorite-context.v1'
const WORKSPACE_STORAGE_KEY = 'choose-home.workspace-context.v1'
const DEFAULT_MANUAL_DRAFT = { cityGroup: '台北市', maxPrice: 1800, rooms: '', minArea: '', maxArea: '', maxAge: '', maxMrtDistance: '', requireElevator: false, requireParking: false }
const EMPTY_MANUAL_DRAFT = { ...DEFAULT_MANUAL_DRAFT, maxPrice: '' }
const FAVORITE_REASONS = ['價格可以', '離捷運近', '喜歡格局', '地點適合', '屋況較新', '想再確認']
const FAVORITE_STATUSES = [
  { value: 'interested', label: '有興趣' },
  { value: 'priority', label: '優先考慮' },
  { value: 'viewing', label: '準備看屋' },
  { value: 'viewed', label: '已看過' },
  { value: 'paused', label: '暫不考慮' },
]

let maplibreModulePromise = null
function loadMaplibre() {
  if (!maplibreModulePromise) maplibreModulePromise = import('maplibre-gl').then((Maplibre) => {
    Maplibre.setWorkerUrl(maplibreWorkerUrl)
    return Maplibre
  })
  return maplibreModulePromise
}

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <><path d="m21 3-7.5 18-3.1-7.4L3 10.5 21 3Z" /><path d="M10.4 13.6 15 9" /></>,
    share: <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.6-4.8L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 14.6 4.8L20 16" /><path d="M20 20v-4h-4" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    pin: <><path d="m15 4 5 5" /><path d="m17 2 5 5-4 1-4 4 1 4-2 2-3-3-4 1-2-2 2-2 4 1 4-4 1-4 2-2Z" /><path d="m8 16-5 5" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-5" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    external: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></>,
    train: <><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M8 7h8M8 12h8M8 21l2-4M16 21l-2-4" /></>,
    school: <><path d="m3 10 9-5 9 5-9 5-9-5Z" /><path d="M7 12v5c3 2 7 2 10 0v-5M21 10v6" /></>,
    hospital: <><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" /><path d="M9 8h6M12 5v6M8 21v-5h8v5" /></>,
    park: <><path d="M12 21V9" /><path d="M7 12c-2-1-2-4 1-5 0-3 3-4 4-1 2-2 5 0 4 3 3 1 2 4 0 5" /><path d="M8 21h8" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 3-4 3 2 5-7" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    document: <><path d="M6 3h9l3 3v15H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    compare: <><rect x="3" y="5" width="7" height="14" rx="1" /><rect x="14" y="5" width="7" height="14" rx="1" /><path d="M6 9h1M6 13h1M17 9h1M17 13h1" /></>,
  }
  return <svg {...common}>{paths[name] || paths.chart}</svg>
}

function formatTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知時間'
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

async function postJson(url, payload) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function safeCandidate(candidate, matchesCurrentCriteria = !candidate.outsideCurrentSearch) {
  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address,
    priceWan: candidate.price,
    originalPriceWan: candidate.originalPrice,
    layout: candidate.layout,
    ageYears: candidate.age,
    sizePing: candidate.size,
    floor: candidate.floor,
    propertyType: candidate.propertyType,
    parking: candidate.parking,
    nearestMrt: candidate.station,
    mrtDistanceMeters: candidate.mrtDistanceMeters,
    location: candidate.location,
    sourceUrl: candidate.sourceUrl,
    source: candidate.source,
    evidence: candidate.evidence,
    actualPriceEvidence: candidate.actualPriceEvidence || null,
    matchesCurrentCriteria,
  }
}

function safeDecisionChange(change) {
  if (!change) return null
  return {
    ...change,
    addedCandidates: change.addedCandidates.map((candidate) => safeCandidate(candidate, true)),
    removedCandidates: change.removedCandidates.map((candidate) => safeCandidate(candidate, false)),
  }
}

function safeConstraintPreview(preview) {
  if (!preview) return null
  return {
    ...preview,
    addedCandidates: (preview.addedCandidates || []).map((candidate) => safeCandidate(candidate, true)),
    removedCandidates: (preview.removedCandidates || []).map((candidate) => safeCandidate(candidate, false)),
  }
}

function mergeRankedCandidates(...groups) {
  const unique = [...new Map(groups.flat().map((candidate) => [candidate.id, candidate])).values()]
  let searchRank = 0
  return unique
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((candidate) => ({ ...candidate, displayRank: candidate.outsideCurrentSearch ? 'P' : ++searchRank }))
}

function useDialogFocus(selector = null) {
  const dialogRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current || (selector ? document.querySelector(selector) : null)
    const previous = document.activeElement
    if (!dialog) return undefined
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = () => [...dialog.querySelectorAll(focusableSelector)]
    ;(focusables()[0] || dialog).focus()
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    dialog.addEventListener('keydown', trapFocus)
    return () => {
      dialog.removeEventListener('keydown', trapFocus)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [selector])
  return dialogRef
}

function criteriaToRequest(criteria) {
  const parts = [
    `${criteria.cities?.length > 1 ? '雙北市' : criteria.city}${criteria.district || ''}`,
    criteria.maxPrice == null ? '總價不限' : `總價 ${Number(criteria.maxPrice).toLocaleString()} 萬內`,
    criteria.rooms != null ? `${criteria.rooms} 房` : criteria.minRooms != null ? `${criteria.minRooms} 房以上` : '房數不限',
    criteria.minArea != null ? `${criteria.minArea} 坪以上` : null,
    criteria.maxArea != null ? `${criteria.maxArea} 坪內` : null,
    criteria.maxAge != null ? `屋齡 ${criteria.maxAge} 年內` : null,
    criteria.maxMrtDistance != null ? `距捷運站 ${criteria.maxMrtDistance} 公尺內` : null,
    criteria.requireElevator ? '電梯' : null,
    criteria.requireParking ? '含車位' : null,
    criteria.residentialOnly ? '住宅物件' : null,
    criteria.priority === 'budget' ? '價格優先' : criteria.priority === 'mrt' ? '近捷運優先' : '綜合折衷',
  ].filter(Boolean)
  return parts.join('、')
}

function detectAiMode() {
  const forcedMode = new URLSearchParams(window.location.search).get('mode')
  if (forcedMode === 'manual') return false
  if (forcedMode === 'ai') return Boolean(document.modelContext?.registerTool)
  return Boolean(document.modelContext?.registerTool)
}

function readFavoriteStore() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FAVORITE_STORAGE_KEY) || '{}')
    if (saved.version !== 1) return { favorites: [], items: {}, candidates: [] }
    return {
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      items: saved.items && typeof saved.items === 'object' ? saved.items : {},
      candidates: Array.isArray(saved.candidates) ? saved.candidates.map(sanitizeStoredCandidate).filter((candidate) => candidate.id) : [],
    }
  } catch {
    return { favorites: [], items: {}, candidates: [] }
  }
}

function nonNegativeStoredNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function sanitizeStoredCandidate(candidate = {}) {
  return {
    id: String(candidate.id || ''), name: String(candidate.name || '未命名物件'), address: String(candidate.address || ''),
    city: String(candidate.city || ''), district: String(candidate.district || ''), zipCode: String(candidate.zipCode || ''),
    price: Number(candidate.price) || 0, originalPrice: Number(candidate.originalPrice) || null,
    layout: String(candidate.layout || ''), rooms: Number(candidate.rooms) || null, halls: Number(candidate.halls) || null,
    baths: Number(candidate.baths) || null, age: nonNegativeStoredNumber(candidate.age), size: Number(candidate.size) || null,
    floor: String(candidate.floor || '未提供'), propertyType: String(candidate.propertyType || '未提供'),
    style: String(candidate.style || '未提供'), parking: String(candidate.parking || '未提供'),
    hasConfirmedParking: candidate.hasConfirmedParking === true, hasElevatorEvidence: candidate.hasElevatorEvidence === true,
    isStandaloneParking: candidate.isStandaloneParking === true, station: String(candidate.station || '未提供'),
    mrtDistanceMeters: nonNegativeStoredNumber(candidate.mrtDistanceMeters), life: Number(candidate.life) || 0,
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 10) : [],
    location: candidate.location && Number.isFinite(Number(candidate.location.lat)) && Number.isFinite(Number(candidate.location.lon))
      ? { lat: Number(candidate.location.lat), lon: Number(candidate.location.lon) }
      : null,
    sourceUrl: String(candidate.sourceUrl || ''),
    source: candidate.source && typeof candidate.source === 'object'
      ? { provider: String(candidate.source.provider || ''), status: String(candidate.source.status || ''), fetchedAt: String(candidate.source.fetchedAt || ''), publicOnly: candidate.source.publicOnly === true }
      : null,
    evidence: candidate.evidence && typeof candidate.evidence === 'object' ? candidate.evidence : {},
    actualPriceEvidence: candidate.actualPriceEvidence && typeof candidate.actualPriceEvidence === 'object' ? candidate.actualPriceEvidence : null,
    score: Number(candidate.score) || 0,
  }
}

function writeFavoriteStore(favorites, items, candidates) {
  const favoriteSet = new Set(favorites)
  const favoriteSnapshots = candidates.filter((candidate) => favoriteSet.has(candidate.id)).map(sanitizeStoredCandidate)
  window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify({ version: 1, favorites, items, candidates: favoriteSnapshots }))
}

function readWorkspaceStore() {
  return parseWorkspaceStore(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || '')
}

function writeWorkspaceStore(snapshot) {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(createWorkspaceStorageEnvelope(snapshot)))
  } catch {
    // Storage can be unavailable or full; the active page must remain usable.
  }
}

function criteriaToManualDraft(criteria = DEFAULT_CRITERIA) {
  return {
    cityGroup: criteria.cities?.length > 1 ? '雙北市' : criteria.city || '台北市',
    maxPrice: criteria.maxPrice ?? '',
    rooms: criteria.rooms != null ? String(criteria.rooms) : criteria.minRooms === 4 ? '4plus' : '',
    minArea: criteria.minArea ?? '',
    maxArea: criteria.maxArea ?? '',
    maxAge: criteria.maxAge ?? '',
    maxMrtDistance: criteria.maxMrtDistance ?? '',
    requireElevator: Boolean(criteria.requireElevator),
    requireParking: Boolean(criteria.requireParking),
  }
}

function App() {
  const initialWorkspace = useRef(readWorkspaceStore()).current
  const initialFavorites = useRef(readFavoriteStore()).current
  const restoredWorkspace = initialWorkspace.snapshot
  const initiallyCleared = initialWorkspace.cleared
  const initialAiMode = useRef(detectAiMode()).current
  const initialCriteria = restoredWorkspace?.criteria || DEFAULT_CRITERIA
  const [request, setRequest] = useState(() => initiallyCleared ? CLEARED_WORKSPACE_REQUEST : restoredWorkspace?.request || criteriaToRequest(initialCriteria))
  const [criteria, setCriteria] = useState(initialCriteria)
  const [hasActiveSearch, setHasActiveSearch] = useState(() => restoredWorkspace ? restoredWorkspace.hasActiveSearch !== false : !initiallyCleared)
  const [aiMode, setAiMode] = useState(initialAiMode)
  const [manualFiltersOpen, setManualFiltersOpen] = useState(!initialAiMode || initiallyCleared)
  const [manualDraft, setManualDraft] = useState(() => initiallyCleared ? EMPTY_MANUAL_DRAFT : criteriaToManualDraft(initialCriteria))
  const [mode, setMode] = useState(() => restoredWorkspace?.mode || initialCriteria.priority || 'balanced')
  const [pendingMode, setPendingMode] = useState(null)
  const [candidates, setCandidates] = useState(() => restoredWorkspace?.candidates || initialFavorites.candidates.map((candidate) => ({ ...candidate, displayRank: 'P', outsideCurrentSearch: true })))
  const [resultView, setResultView] = useState(() => restoredWorkspace?.resultView === 'recommended' ? 'recommended' : 'all')
  const [selectedId, setSelectedId] = useState(() => restoredWorkspace?.selectedId || initialFavorites.favorites[0] || '')
  const [mapFocusRequest, setMapFocusRequest] = useState(null)
  const [pinnedIds, setPinnedIds] = useState(() => initialFavorites.favorites)
  const [compareIds, setCompareIds] = useState(() => (restoredWorkspace?.compareIds || []).filter((id) => (restoredWorkspace?.candidates || []).some((candidate) => candidate.id === id)))
  const [favoriteMeta, setFavoriteMeta] = useState(() => initialFavorites.items)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [decisionChange, setDecisionChange] = useState(() => restoredWorkspace?.decisionChange || null)
  const [constraintPreview, setConstraintPreview] = useState(null)
  const [agentCandidateFilter, setAgentCandidateFilter] = useState(() => restoredWorkspace?.agentCandidateFilter || null)
  const [activity, setActivity] = useState(() => restoredWorkspace?.activity?.length ? restoredWorkspace.activity : [{ id: 'start', time: '剛剛', text: '正在為你搜尋符合條件的物件', type: 'system' }])
  const [sourceState, setSourceState] = useState(() => initiallyCleared ? createIdleSourceState() : restoredWorkspace?.sourceState || { status: 'loading', fetchedAt: null, totalCount: 0, warnings: [] })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [decisionCard, setDecisionCard] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [notice, setNotice] = useState('')
  const stateRef = useRef({})
  const actionRef = useRef({})
  const searchRequestSeqRef = useRef(0)
  const previewRequestSeqRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const noticeTimerRef = useRef(null)

  const selected = candidates.find((candidate) => candidate.id === selectedId) || candidates[0] || null
  const loadedCandidates = useMemo(() => candidates.filter((candidate) => !candidate.outsideCurrentSearch), [candidates])
  const matchingCandidates = useMemo(() => {
    if (!agentCandidateFilter) return loadedCandidates
    const visibleIds = new Set([...agentCandidateFilter.candidateIds, ...pinnedIds])
    return loadedCandidates.filter((candidate) => visibleIds.has(candidate.id))
  }, [agentCandidateFilter, loadedCandidates, pinnedIds])
  const compareCandidates = useMemo(() => compareIds.map((id) => candidates.find((candidate) => candidate.id === id)).filter(Boolean), [candidates, compareIds])
  const favoriteCandidates = useMemo(() => pinnedIds.map((id) => candidates.find((candidate) => candidate.id === id)).filter(Boolean), [candidates, pinnedIds])
  const visibleRecommendations = useMemo(() => buildExplainableRecommendations(matchingCandidates, mode), [matchingCandidates, mode])

  const addActivity = useCallback((text, type = 'agent') => {
    setActivity((current) => [{ id: `${Date.now()}-${Math.random()}`, time: formatTime(), text, type }, ...current].slice(0, 5))
  }, [])

  const showNotice = useCallback((text) => {
    setNotice(text)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2800)
  }, [])

  const runSearch = useCallback(async (input = {}, options = {}) => {
    const requestVersion = options.append ? searchRequestSeqRef.current : ++searchRequestSeqRef.current
    if (options.append) {
      if (loadMoreInFlightRef.current) return null
      loadMoreInFlightRef.current = true
      setIsLoadingMore(true)
    } else setIsRefreshing(true)
    setHasActiveSearch(true)
    setAgentCandidateFilter(null)
    setSourceState((current) => ({ ...current, status: options.append ? current.status : 'loading' }))
    try {
      const previousCriteria = stateRef.current.criteria || DEFAULT_CRITERIA
      const previousCandidatesForChange = (stateRef.current.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch)
      const data = await postJson('/api/properties/search', input)
      if (requestVersion !== searchRequestSeqRef.current) return { ...data, ignored: true, reason: 'superseded_by_newer_search' }
      const pinned = new Set(stateRef.current.pinnedIds || [])
      const previousSearchCandidates = options.append ? (stateRef.current.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch) : []
      const previousPinned = options.append ? [] : (stateRef.current.candidates || []).filter((candidate) => pinned.has(candidate.id) && !data.candidates.some((item) => item.id === candidate.id)).map((candidate) => ({ ...candidate, displayRank: 'P', outsideCurrentSearch: true }))
      const nextCandidates = mergeRankedCandidates(previousSearchCandidates, data.candidates, previousPinned)
      const currentSearchCandidates = nextCandidates.filter((candidate) => !candidate.outsideCurrentSearch)
      setCandidates(nextCandidates)
      setCriteria(data.criteria)
      setMode(data.criteria.priority)
      if (!options.append) {
        setConstraintPreview(null)
        setPendingMode(null)
        setDecisionCard(false)
        setChecklistOpen(false)
      }
      setSelectedId((current) => data.candidates.some((item) => item.id === current) ? current : data.candidates[0]?.id || previousPinned[0]?.id || '')
      setCompareIds((current) => current.filter((id) => nextCandidates.some((item) => item.id === id)))
      if (!options.append && !options.silent && options.actor !== 'system' && previousCandidatesForChange.length) {
        const nextChange = summarizeDecisionChange({ previousCriteria, nextCriteria: data.criteria, previousCandidates: previousCandidatesForChange, nextCandidates: currentSearchCandidates, favoriteIds: stateRef.current.pinnedIds || [], actor: options.actor === 'user' ? 'user' : 'agent' })
        if (nextChange.criteriaChanges.length || nextChange.addedCount || nextChange.removedCount) setDecisionChange(nextChange)
      }
      const previousSource = stateRef.current.sourceState || {}
      const coverageByCity = { ...(options.append ? previousSource.coverageByCity : {}) }
      Object.entries(data.coverageByCity || {}).forEach(([city, coverage]) => {
        const previous = coverageByCity[city]
        if (previous && coverage?.endPage == null) return
        coverageByCity[city] = previous && coverage?.endPage != null
          ? { ...coverage, startPage: 1, endPage: Math.max(previous.endPage || 0, coverage.endPage), inspectedCount: (previous.inspectedCount || 0) + (coverage.inspectedCount || 0) }
          : coverage
      })
      const nextSourceState = {
        ...data.source,
        totalCount: options.append ? previousSource.totalCount : data.totalCount,
        inspectedCount: options.append ? (previousSource.inspectedCount || 0) + data.inspectedCount : data.inspectedCount,
        returnedCount: nextCandidates.filter((candidate) => !candidate.outsideCurrentSearch).length,
        recommendationIds: nextCandidates.filter((candidate) => !candidate.outsideCurrentSearch).slice(0, 10).map((candidate) => candidate.id),
        nextCursor: data.nextCursor || {},
        coverageByCity,
        hasMore: data.hasMore,
        resultSetComplete: data.resultSetComplete,
        warnings: data.warnings || [],
      }
      setSourceState(nextSourceState)
      if (!options.silent) {
        const actor = options.actor === 'user' ? 'user' : options.actor === 'system' ? 'system' : 'agent'
        addActivity(options.append ? `已加入更多符合條件的物件，目前共有 ${currentSearchCandidates.length} 間` : `已找到 ${data.returnedCount} 間符合條件的物件`, actor)
        showNotice(data.source.status === 'live' ? '物件資料已更新' : '目前顯示最近一次可用資料')
      }
      return { ...data, candidates: nextCandidates, currentSearchCandidates, sourceState: nextSourceState, returnedCount: currentSearchCandidates.length }
    } catch (error) {
      if (requestVersion === searchRequestSeqRef.current) {
        setSourceState({ status: 'error', fetchedAt: new Date().toISOString(), totalCount: 0, warnings: [error.message] })
        addActivity(`查詢失敗：${error.message}`, 'system')
        showNotice('目前無法更新物件，請稍後再試')
      }
      throw error
    } finally {
      if (options.append) {
        loadMoreInFlightRef.current = false
        setIsLoadingMore(false)
      } else if (requestVersion === searchRequestSeqRef.current) setIsRefreshing(false)
    }
  }, [addActivity, showNotice])

  const previewConstraints = useCallback(async (nextCriteria, options = {}) => {
    const requestVersion = ++previewRequestSeqRef.current
    const current = stateRef.current
    const currentCandidates = (current.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch)
    setIsPreviewing(true)
    try {
      const pageCountsByCity = Object.fromEntries((nextCriteria.cities || [nextCriteria.city]).map((city) => [city, current.sourceState?.coverageByCity?.[city]?.endPage || options.batchPages || 5]))
      const data = await postJson('/api/properties/preview', { criteria: nextCriteria, pageCountsByCity })
      if (requestVersion !== previewRequestSeqRef.current) return { status: 'superseded_by_newer_preview' }
      const previewId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const preview = { ...summarizeConstraintPreview({
        previewId,
        currentCriteria: current.criteria,
        nextCriteria: data.criteria,
        currentCandidates,
        previewCandidates: data.candidates,
        favoriteIds: current.pinnedIds || [],
        currentSource: current.sourceState,
        previewSource: { ...data.source, totalCount: data.totalCount, inspectedCount: data.inspectedCount, resultSetComplete: data.resultSetComplete },
      }), actor: options.actor === 'user' ? 'user' : 'agent', pageCountsByCity }
      setConstraintPreview(preview)
      addActivity(`已預演新條件，尚未套用；目前已載入結果可能由 ${preview.currentLoadedCount} 間變成 ${preview.previewLoadedCount} 間`, options.actor === 'user' ? 'user' : 'agent')
      showNotice('已算出條件影響，尚未套用')
      return preview
    } catch (error) {
      addActivity(`條件試算失敗：${error.message}`, 'system')
      showNotice('目前無法試算條件影響，請稍後再試')
      throw error
    } finally {
      if (requestVersion === previewRequestSeqRef.current) setIsPreviewing(false)
    }
  }, [addActivity, showNotice])

  const applyConstraintPreview = useCallback(async (previewId, actor = 'user') => {
    const preview = stateRef.current.constraintPreview
    if (!preview || preview.previewId !== previewId) return { status: 'stale_or_missing_preview' }
    setRequest(criteriaToRequest(preview.nextCriteria))
    const data = await runSearch({ criteria: preview.nextCriteria, pageCountsByCity: preview.pageCountsByCity }, { actor })
    if (stateRef.current.constraintPreview?.previewId === previewId) setConstraintPreview(null)
    return { status: data.ignored ? 'superseded' : 'applied', criteria: data.criteria, loadedMatchCount: data.returnedCount, pinnedCandidateIds: stateRef.current.pinnedIds || [] }
  }, [runSearch])

  const discardConstraintPreview = useCallback((previewId) => {
    const preview = stateRef.current.constraintPreview
    if (!preview || (previewId && preview.previewId !== previewId)) return { status: 'stale_or_missing_preview' }
    setConstraintPreview(null)
    addActivity('已保留目前條件，沒有變更地圖與物件清單', 'system')
    showNotice('已保留目前條件')
    return { status: 'discarded' }
  }, [addActivity, showNotice])

  const applyAgentCandidateFilter = useCallback((input = {}) => {
    const current = stateRef.current
    const loaded = (current.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch)
    const next = createAgentCandidateFilter(input, loaded.map((candidate) => candidate.id))
    if (!next) return { status: 'invalid_or_empty_filter', loadedCandidateCount: loaded.length }
    setAgentCandidateFilter(next)
    setRequest(next.summary)
    setResultView('all')
    const firstVisible = loaded.find((candidate) => next.candidateIds.includes(candidate.id))
    if (firstVisible) setSelectedId(firstVisible.id)
    addActivity(`ChatGPT 已用「${next.methodLabel}」將目前 ${loaded.length} 間初篩為 ${next.candidateIds.length} 間`, 'agent')
    showNotice(`已顯示 ${next.candidateIds.length} 間初篩結果`)
    return { status: 'applied', filter: next, visibleCandidateCount: next.candidateIds.length, loadedCandidateCount: loaded.length }
  }, [addActivity, showNotice])

  const clearAgentCandidateFilter = useCallback((actor = 'user') => {
    if (!stateRef.current.agentCandidateFilter) return { status: 'no_filter' }
    setAgentCandidateFilter(null)
    setRequest(criteriaToRequest(stateRef.current.criteria || DEFAULT_CRITERIA))
    addActivity('已清除 ChatGPT 初篩，恢復顯示所有已載入物件', actor === 'agent' ? 'agent' : 'user')
    showNotice('已恢復全部已載入物件')
    return { status: 'cleared' }
  }, [addActivity, showNotice])

  const loadMoreResults = useCallback(async () => {
    const current = stateRef.current
    if (!current.sourceState?.hasMore || loadMoreInFlightRef.current) return null
    return runSearch({ criteria: current.criteria, cursor: current.sourceState.nextCursor }, { append: true })
  }, [runSearch])

  const enrichEvidence = useCallback(async (ids) => {
    const targets = stateRef.current.candidates.filter((candidate) => ids.includes(candidate.id)).slice(0, 5)
    if (!targets.length) return { ok: true, candidates: [] }
    setIsEnriching(true)
    try {
      const data = await postJson('/api/properties/enrich', { candidates: targets, criteria: stateRef.current.criteria })
      const updates = new Map(data.candidates.map((candidate) => [candidate.id, candidate]))
      setCandidates((current) => mergeRankedCandidates(current.map((candidate) => {
        const updated = updates.get(candidate.id)
        return updated ? { ...updated, outsideCurrentSearch: candidate.outsideCurrentSearch } : candidate
      })))
      addActivity(`已更新 ${data.candidates.length} 間物件與實價資訊`, 'system')
      showNotice('物件資訊已更新')
      return data
    } finally {
      setIsEnriching(false)
    }
  }, [addActivity, showNotice])

  const previewMode = useCallback((nextMode) => {
    setPendingMode(nextMode === stateRef.current.mode ? null : nextMode)
  }, [])

  const applyMode = useCallback(() => {
    if (!pendingMode || pendingMode === stateRef.current.mode) {
      setPendingMode(null)
      return
    }
    const current = stateRef.current
    const pageCountsByCity = Object.fromEntries((current.criteria.cities || [current.criteria.city]).map((city) => [city, current.sourceState?.coverageByCity?.[city]?.endPage || 5]))
    runSearch({ criteria: { ...current.criteria, priority: pendingMode }, pageCountsByCity }, { actor: 'user' }).catch(() => {})
  }, [pendingMode, runSearch])

  const selectCandidateFromList = useCallback((id) => {
    setSelectedId(id)
    setMapFocusRequest({ id, nonce: Date.now() })
  }, [])

  const prioritizeBudget = useCallback(() => {
    const next = { ...stateRef.current.criteria, priority: 'budget' }
    previewConstraints(next, { actor: 'user' }).catch(() => {})
  }, [previewConstraints])

  const ensureFavoriteMeta = useCallback((id) => {
    setFavoriteMeta((current) => current[id] ? current : { ...current, [id]: { status: 'interested', reasons: [], note: '' } })
  }, [])

  const updateFavoriteMeta = useCallback((id, patch) => {
    setFavoriteMeta((current) => ({ ...current, [id]: { status: 'interested', reasons: [], note: '', ...(current[id] || {}), ...patch } }))
  }, [])

  const resetSearchWorkspace = useCallback(async ({ clearSaved = false, actor = 'user' } = {}) => {
    if (isResetting) return { status: 'busy' }
    setIsResetting(true)
    setRestartOpen(false)
    setClearAllConfirm(false)
    setCompareIds([])
    setCompareOpen(false)
    setFavoritesOpen(false)
    setChecklistOpen(false)
    setDecisionCard(false)
    setConstraintPreview(null)
    setAgentCandidateFilter(null)
    setDecisionChange(null)
    setPendingMode(null)
    setResultView('all')
    setMapFocusRequest(null)
    setManualDraft(DEFAULT_MANUAL_DRAFT)
    const protectedFavorites = [...(stateRef.current.pinnedIds || [])]
    const protectedFavoriteMeta = { ...(stateRef.current.favoriteMeta || {}) }
    const nextState = { ...stateRef.current, compareIds: [], constraintPreview: null, decisionChange: null }
    if (clearSaved) {
      ++searchRequestSeqRef.current
      ++previewRequestSeqRef.current
      const cleared = createClearedWorkspaceSnapshot()
      setHasActiveSearch(false)
      setManualFiltersOpen(true)
      setManualDraft(EMPTY_MANUAL_DRAFT)
      setCriteria(DEFAULT_CRITERIA)
      setMode('balanced')
      setRequest(CLEARED_WORKSPACE_REQUEST)
      setCandidates([])
      setSelectedId('')
      setPinnedIds([])
      setCompareIds([])
      setFavoriteMeta({})
      setSourceState(cleared.sourceState)
      setIsRefreshing(false)
      setIsLoadingMore(false)
      setIsPreviewing(false)
      setActivity([{ id: `clear-${Date.now()}`, time: formatTime(), text: '已清除所有收藏、比較與找房條件', type: actor === 'agent' ? 'agent' : 'user' }])
      window.localStorage.removeItem(FAVORITE_STORAGE_KEY)
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, cleared: true }))
      stateRef.current = { ...stateRef.current, criteria: DEFAULT_CRITERIA, mode: 'balanced', selectedId: '', pinnedIds: [], compareIds: [], favoriteMeta: {}, candidates: [], sourceState: cleared.sourceState, decisionChange: null, constraintPreview: null, agentCandidateFilter: null, hasActiveSearch: false }
      showNotice('已清除全部，可以重新設定條件')
      setIsResetting(false)
      return { status: 'cleared', clearedSavedData: true, activeSearch: false, criteria: null, loadedMatchCount: 0, pinnedCandidateIds: [] }
    }
    setHasActiveSearch(true)
    setRequest(criteriaToRequest(DEFAULT_CRITERIA))
    stateRef.current = nextState
    try {
      const data = await runSearch({ criteria: DEFAULT_CRITERIA }, { actor, silent: true })
      writeFavoriteStore(protectedFavorites, protectedFavoriteMeta, data.candidates || [])
      const activityText = '已重設找房條件；收藏與筆記都已保留'
      addActivity(activityText, actor === 'agent' ? 'agent' : 'user')
      showNotice('已重設條件，收藏仍保留')
      return { status: 'reset', clearedSavedData: false, criteria: data.criteria, loadedMatchCount: data.returnedCount, pinnedCandidateIds: stateRef.current.pinnedIds || [] }
    } finally {
      setIsResetting(false)
    }
  }, [addActivity, isResetting, runSearch, showNotice])

  const togglePin = useCallback((id) => {
    const candidate = stateRef.current.candidates.find((item) => item.id === id)
    setPinnedIds((current) => {
      const removing = current.includes(id)
      if (!removing) ensureFavoriteMeta(id)
      addActivity(`${removing ? '已取消收藏' : '已收藏'}「${candidate?.name || id}」`, 'pin')
      return removing ? current.filter((item) => item !== id) : [...current, id]
    })
  }, [addActivity, ensureFavoriteMeta])

  const toggleCompare = useCallback((id) => {
    const candidate = stateRef.current.candidates.find((item) => item.id === id)
    setCompareIds((current) => {
      const removing = current.includes(id)
      if (removing) {
        addActivity(`已從比較移除「${candidate?.name || id}」`, 'system')
        return removeComparisonIds(current, [id])
      }
      if (current.length >= MAX_COMPARE) {
        showNotice(`一次最多比較 ${MAX_COMPARE} 間，請先移除一間`)
        return current
      }
      if (!stateRef.current.pinnedIds.includes(id)) {
        setPinnedIds((favorites) => [...new Set([...favorites, id])])
        ensureFavoriteMeta(id)
        addActivity(`已收藏並加入比較「${candidate?.name || id}」`, 'system')
      } else {
        addActivity(`已加入比較「${candidate?.name || id}」`, 'system')
      }
      return addComparisonIds(current, [id], stateRef.current.candidates.map((item) => item.id))
    })
  }, [addActivity, ensureFavoriteMeta, showNotice])

  stateRef.current = { criteria, mode, selectedId, pinnedIds, compareIds, favoriteMeta, candidates, sourceState, decisionChange, constraintPreview, agentCandidateFilter, recommendations: visibleRecommendations, hasActiveSearch }
  actionRef.current = { runSearch, loadMoreResults, enrichEvidence, previewConstraints, applyConstraintPreview, discardConstraintPreview, applyAgentCandidateFilter, clearAgentCandidateFilter, resetSearchWorkspace, addActivity, setPinnedIds, setCompareIds, setRequest, ensureFavoriteMeta }

  useEffect(() => {
    writeFavoriteStore(pinnedIds, favoriteMeta, candidates)
  }, [candidates, favoriteMeta, pinnedIds])

  useEffect(() => {
    if (sourceState.status === 'loading' || isRefreshing || isLoadingMore) return
    if (!hasActiveSearch) {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, cleared: true }))
      return
    }
    writeWorkspaceStore({ request, criteria, mode, candidates, selectedId, compareIds, resultView, decisionChange, agentCandidateFilter, activity, sourceState, hasActiveSearch: true })
  }, [activity, agentCandidateFilter, candidates, compareIds, criteria, decisionChange, hasActiveSearch, isLoadingMore, isRefreshing, mode, request, resultView, selectedId, sourceState])

  useEffect(() => {
    setManualDraft(hasActiveSearch ? criteriaToManualDraft(criteria) : EMPTY_MANUAL_DRAFT)
  }, [criteria, hasActiveSearch])

  useEffect(() => {
    const closeTopLayer = (event) => {
      if (event.key !== 'Escape') return
      setDecisionCard(false)
      setFavoritesOpen(false)
      setCompareOpen(false)
      setChecklistOpen(false)
      setRestartOpen(false)
      setClearAllConfirm(false)
    }
    window.addEventListener('keydown', closeTopLayer)
    return () => window.removeEventListener('keydown', closeTopLayer)
  }, [])

  useEffect(() => {
    if (initiallyCleared || restoredWorkspace) return
    runSearch({ criteria: DEFAULT_CRITERIA }, { silent: true })
      .then((data) => addActivity(`已更新物件，目前找到 ${data.returnedCount} 間`, 'system'))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const modelContext = document.modelContext
    if (!modelContext?.registerTool) return undefined
    if (new URLSearchParams(window.location.search).get('mode') === 'manual') return undefined
    setAiMode(true)
    const currentState = () => {
      const state = stateRef.current
      const loaded = state.candidates.filter((candidate) => !candidate.outsideCurrentSearch)
      const visibleIds = state.agentCandidateFilter ? new Set([...state.agentCandidateFilter.candidateIds, ...state.pinnedIds]) : null
      return { activeSearch: state.hasActiveSearch, criteria: state.hasActiveSearch ? state.criteria : null, scenario: state.hasActiveSearch ? state.mode : null, selectedCandidateId: state.selectedId, pinnedCandidateIds: state.pinnedIds, compareCandidateIds: state.compareIds, loadedCandidateCount: loaded.length, visibleCandidateCount: visibleIds ? loaded.filter((candidate) => visibleIds.has(candidate.id)).length : loaded.length, agentCandidateFilter: state.agentCandidateFilter, recommendationIds: (state.recommendations || []).map((item) => item.id), latestDecisionChange: safeDecisionChange(state.decisionChange), pendingConstraintPreview: safeConstraintPreview(state.constraintPreview), sourceStatus: { ...state.sourceState, publicOnly: true, fallbackPolicy: 'fail_closed_without_synthetic_results' } }
    }
    const tools = [
      { name: 'get_decision_state', title: '查看目前找房狀態', description: 'Read the current live public-property workspace without changing it.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => currentState() },
      { name: 'search_public_properties', title: '搜尋符合條件的物件', description: 'Start a new search against the public listing source adapter. Convert every user-requested constraint into a structured field; omitted fields remain unrestricted. The workspace keeps every loaded match visible, and recommendations are not presented as the whole result set.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The original user request, used only as the visible ChatGPT search summary.' }, ...CONSTRAINT_SCHEMA_PROPERTIES } }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (input = {}) => { const { query, ...constraints } = input; const structured = { ...DEFAULT_CRITERIA, ...constraints }; actionRef.current.setRequest(query || criteriaToRequest(structured)); const data = await actionRef.current.runSearch({ criteria: structured }); const recommendations = buildExplainableRecommendations((data.currentSearchCandidates || data.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch), data.criteria.priority); return { status: data.ignored ? 'superseded' : data.source.status, criteria: data.criteria, sourceTotalCount: data.totalCount, inspectedCount: data.inspectedCount, loadedMatchCount: data.returnedCount, resultSetComplete: data.resultSetComplete, hasMore: data.hasMore, recommendations: recommendations.map((item) => ({ ...safeCandidate(item.candidate), reasons: item.reasons })), warnings: data.warnings } } },
      { name: 'get_search_progress', title: '讀取完整搜尋進度', description: 'Read source total, inspected count, loaded matching count, and whether more public pages remain. No result is silently treated as excluded.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => { const state = stateRef.current; return { sourceTotalCount: state.sourceState.totalCount || 0, inspectedCount: state.sourceState.inspectedCount || 0, loadedMatchCount: state.candidates.filter((candidate) => !candidate.outsideCurrentSearch).length, resultSetComplete: Boolean(state.sourceState.resultSetComplete), hasMore: Boolean(state.sourceState.hasMore) } } },
      { name: 'get_decision_changes', title: '查看這次調整造成的差異', description: 'Read the latest visible before-and-after decision change: changed constraints, loaded candidates added or removed, minimum-price movement, and preserved favorites. Counts are explicitly scoped to currently loaded public results.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => ({ status: stateRef.current.decisionChange ? 'available' : 'no_change_yet', change: safeDecisionChange(stateRef.current.decisionChange) }) },
      { name: 'preview_constraint_change', title: '預演條件變更影響', description: 'Calculate how a proposed constraint change would affect loaded matches, distributions, and protected favorites without changing the active criteria, map, or result list. The returned scope states whether all public result pages were inspected.', inputSchema: { type: 'object', properties: CONSTRAINT_SCHEMA_PROPERTIES }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (input = {}) => { const preview = await actionRef.current.previewConstraints({ ...stateRef.current.criteria, ...input }, { actor: 'agent' }); return preview.status === 'superseded_by_newer_preview' ? preview : safeConstraintPreview(preview) } },
      { name: 'apply_previewed_constraints', title: '套用已確認的條件預演', description: 'Apply one currently visible preview by previewId after the user confirms it. Re-runs the public search, updates the map and list, and preserves favorites.', inputSchema: { type: 'object', properties: { previewId: { type: 'string' } }, required: ['previewId'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async ({ previewId } = {}) => actionRef.current.applyConstraintPreview(previewId, 'agent') },
      { name: 'discard_constraint_preview', title: '取消條件預演', description: 'Discard the currently visible preview without changing active criteria, map results, or favorites.', inputSchema: { type: 'object', properties: { previewId: { type: 'string' } }, required: ['previewId'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async ({ previewId } = {}) => actionRef.current.discardConstraintPreview(previewId) },
      { name: 'list_property_results', title: '查看物件清單', description: 'List any page of the currently loaded public matches. Use this instead of assuming the ten recommendations are the whole result set.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 }, view: { type: 'string', enum: ['all', 'recommended', 'pinned'] } } }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async ({ offset = 0, limit = 25, view = 'all' } = {}) => { const state = stateRef.current; const visibleIds = state.agentCandidateFilter ? new Set([...state.agentCandidateFilter.candidateIds, ...state.pinnedIds]) : null; const pool = view === 'recommended' ? (state.recommendations || []).map((item) => item.candidate) : state.candidates.filter((candidate) => view === 'pinned' ? state.pinnedIds.includes(candidate.id) : !candidate.outsideCurrentSearch && (!visibleIds || visibleIds.has(candidate.id))); const safeOffset = Math.max(0, Number(offset) || 0); const safeLimit = Math.min(50, Math.max(1, Number(limit) || 25)); return { view, offset: safeOffset, limit: safeLimit, totalLoadedInView: pool.length, hasMoreLoaded: safeOffset + safeLimit < pool.length, candidates: pool.slice(safeOffset, safeOffset + safeLimit).map(safeCandidate) } } },
      { name: 'apply_agent_candidate_filter', title: '顯示 ChatGPT 初篩結果', description: 'Apply a reversible view filter to currently loaded candidates after ChatGPT evaluates evidence that is not a native public-search field. This updates the visible request summary, map, list, and counts without pretending the heuristic is an official listing constraint. Existing favorites remain visible.', inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'Short user-facing description of the requested initial filter.' }, methodLabel: { type: 'string', description: 'Short label describing the heuristic, such as 交通快速概算.' }, scopeNote: { type: 'string', description: 'Visible limitation of the heuristic and result scope.' }, candidateIds: { type: 'array', items: { type: 'string' }, maxItems: 500 } }, required: ['summary', 'candidateIds'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (input = {}) => actionRef.current.applyAgentCandidateFilter(input) },
      { name: 'clear_agent_candidate_filter', title: '清除 ChatGPT 初篩', description: 'Remove the reversible Agent view filter and restore every currently loaded public match without changing search constraints or favorites.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async () => actionRef.current.clearAgentCandidateFilter('agent') },
      { name: 'load_more_property_results', title: '載入下一批公開物件', description: 'Fetch the next public result pages, merge matching items into the shared workspace, and immediately update the real map and result list.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async () => { const data = await actionRef.current.loadMoreResults(); if (!data) return { status: 'complete_or_busy', ...currentState() }; return { status: data.ignored ? 'superseded' : 'loaded', newlyInspectedCount: data.inspectedCount, loadedCandidateCount: data.currentSearchCandidates?.length || 0, sourceStatus: data.sourceState || data.source } } },
      { name: 'enrich_property_evidence', title: '更新物件與實價資訊', description: 'Fetch current public listing details and comparable Ministry of Interior actual-price records for up to five candidates. Missing evidence is reported explicitly.', inputSchema: { type: 'object', properties: { candidateIds: { type: 'array', items: { type: 'string' }, maxItems: 5 } }, required: ['candidateIds'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async ({ candidateIds = [] } = {}) => { const data = await actionRef.current.enrichEvidence(candidateIds); return { status: 'evidence_updated', candidates: data.candidates.map(safeCandidate) } } },
      { name: 'update_constraints', title: '立即調整找房條件', description: 'Immediately update constraints and replace the active map and result list. Use for the initial search or only when the user explicitly asks to apply without preview; otherwise call preview_constraint_change first.', inputSchema: { type: 'object', properties: CONSTRAINT_SCHEMA_PROPERTIES }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (input = {}) => { const nextCriteria = { ...stateRef.current.criteria, ...input }; actionRef.current.setRequest(criteriaToRequest(nextCriteria)); const data = await actionRef.current.runSearch({ criteria: nextCriteria }); const recommendations = buildExplainableRecommendations((data.currentSearchCandidates || data.candidates || []).filter((candidate) => !candidate.outsideCurrentSearch), data.criteria.priority); return { status: data.ignored ? 'superseded' : data.source.status, criteria: data.criteria, pinnedCandidateIds: stateRef.current.pinnedIds, sourceTotalCount: data.totalCount, inspectedCount: data.inspectedCount, loadedMatchCount: data.returnedCount, resultSetComplete: data.resultSetComplete, recommendations: recommendations.map((item) => ({ ...safeCandidate(item.candidate), reasons: item.reasons })) } } },
      { name: 'reset_search_workspace', title: '重設找房條件', description: 'Reset the active criteria, result list, map, and comparison selection to the default search. Favorites and their notes are always preserved; this Agent tool cannot delete saved user decisions.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async () => actionRef.current.resetSearchWorkspace({ clearSaved: false, actor: 'agent' }) },
      { name: 'pin_candidate', title: '收藏這間物件', description: 'Add a user-protected favorite. This tool cannot remove an existing favorite.', inputSchema: { type: 'object', properties: { candidateId: { type: 'string' } }, required: ['candidateId'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async ({ candidateId } = {}) => { const candidate = stateRef.current.candidates.find((item) => item.id === candidateId); if (!candidate) return { status: 'not_found', candidateId }; const next = [...new Set([...stateRef.current.pinnedIds, candidateId])]; stateRef.current.pinnedIds = next; actionRef.current.setPinnedIds(next); actionRef.current.ensureFavoriteMeta(candidateId); actionRef.current.addActivity(`已收藏「${candidate.name}」`, 'agent'); return { status: 'favorited', candidate: safeCandidate(candidate), pinnedCandidateIds: next } } },
      { name: 'compare_candidates', title: '管理物件比較', description: 'Add or remove loaded public candidates from the focused comparison view. Comparison is limited to four; adding also makes the candidate a visible favorite.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'remove'] }, candidateIds: { type: 'array', items: { type: 'string' } } }, required: ['action', 'candidateIds'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async ({ action, candidateIds = [] } = {}) => { const state = stateRef.current; const validIds = state.candidates.map((item) => item.id); const valid = candidateIds.filter((id) => validIds.includes(id)); const next = action === 'add' ? addComparisonIds(state.compareIds, valid, validIds) : removeComparisonIds(state.compareIds, valid); const overflow = action === 'add' && [...new Set([...state.compareIds, ...valid])].length > MAX_COMPARE; stateRef.current.compareIds = next; actionRef.current.setCompareIds(next); if (action === 'add') { const nextPinned = [...new Set([...(state.pinnedIds || []), ...next])]; stateRef.current.pinnedIds = nextPinned; actionRef.current.setPinnedIds(nextPinned); next.forEach(actionRef.current.ensureFavoriteMeta); actionRef.current.addActivity(`已將 ${valid.length} 間物件加入比較`, 'agent') } return { status: overflow ? 'limit_reached' : 'updated', limit: MAX_COMPARE, compareCandidateIds: next, candidates: state.candidates.filter((item) => next.includes(item.id)).map(safeCandidate) } } },
      { name: 'get_comparison_facts', title: '讀取物件比較事實', description: 'Return structured public facts, constraint checks, and evidence gaps for selected candidates. The website does not label winners, strengths, or tradeoffs; ChatGPT must explain them.', inputSchema: { type: 'object', properties: { candidateIds: { type: 'array', items: { type: 'string' }, maxItems: 10 } }, required: ['candidateIds'] }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async ({ candidateIds = [] } = {}) => getComparisonFacts(stateRef.current.candidates.filter((item) => candidateIds.includes(item.id)), stateRef.current.criteria) },
      { name: 'get_property_evidence_gaps', title: '讀取物件資料缺口', description: 'Return only missing, incomplete, or inferred public fields for one loaded candidate. It does not generate viewing questions or infer that a problem exists.', inputSchema: { type: 'object', properties: { candidateId: { type: 'string' } }, required: ['candidateId'] }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async ({ candidateId } = {}) => { const candidate = stateRef.current.candidates.find((item) => item.id === candidateId); return candidate ? { status: 'ready', candidate: safeCandidate(candidate), evidence: getPropertyEvidenceGaps(candidate) } : { status: 'not_found', candidateId } } },
    ]
    const controller = new AbortController()
    tools.forEach((tool) => Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })).catch(() => {}))
    return () => controller.abort()
  }, [])

  function applyManualCriteria(event) {
    event.preventDefault()
    const maxPrice = Number(manualDraft.maxPrice)
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      showNotice('請先輸入總價上限')
      return
    }
    const cities = manualDraft.cityGroup === '雙北市' ? ['台北市', '新北市'] : [manualDraft.cityGroup]
    const next = {
      ...criteria,
      city: cities[0],
      cities,
      district: '',
      maxPrice,
      rooms: manualDraft.rooms === '' || manualDraft.rooms === '4plus' ? null : Number(manualDraft.rooms),
      minRooms: manualDraft.rooms === '4plus' ? 4 : null,
      minArea: manualDraft.minArea === '' ? null : Number(manualDraft.minArea),
      maxArea: manualDraft.maxArea === '' ? null : Number(manualDraft.maxArea),
      maxAge: manualDraft.maxAge === '' ? null : Number(manualDraft.maxAge),
      maxMrtDistance: manualDraft.maxMrtDistance === '' ? null : Number(manualDraft.maxMrtDistance),
      requireElevator: manualDraft.requireElevator,
      requireParking: manualDraft.requireParking,
      residentialOnly: true,
    }
    if (!hasActiveSearch) {
      setRequest(criteriaToRequest(next))
      runSearch({ criteria: next }, { actor: 'user' }).catch(() => {})
      return
    }
    previewConstraints(next, { actor: 'user' }).catch(() => {})
  }

  const sourceLabel = sourceState.status === 'idle' ? '尚未開始搜尋' : sourceState.status === 'live' ? `資料更新於 ${formatTime(sourceState.fetchedAt)}` : sourceState.status === 'snapshot' ? `最近更新於 ${formatTime(sourceState.fetchedAt)}` : sourceState.status === 'loading' ? '正在更新物件' : '物件資料暫時無法更新'

  return (
    <div className={`app-shell ${compareIds.length ? 'has-compare-tray' : ''}`}>
      <header className="topbar"><div className="brand-lockup"><span className="brand-mark"><span></span><span></span><span></span></span><span className="brand-name">選好宅</span><span className="brand-slash">｜</span><span className="brand-cn">找房比較助手</span>{aiMode ? <span className="ai-connected"><span></span>ChatGPT 協作中</span> : null}</div><div className="topbar-actions"><div className={`source-status ${sourceState.status}`} aria-label={sourceLabel}><span className="status-dot"></span><span>{sourceLabel}</span></div><button className="quiet-button restart-button" aria-label="重新開始" onClick={() => setRestartOpen(true)} disabled={isResetting}><span>重新開始</span></button><button className="quiet-button" onClick={() => setDecisionCard(true)} disabled={!selected || selected.outsideCurrentSearch}><Icon name="share" size={17} /><span>分享</span></button></div></header>
      <main>
        <section className="hero-row"><div><h1>找到真正適合你的家</h1><p>一次比較價格、交通與生活機能，做出更安心的選擇</p></div></section>
        {aiMode ? <><AiRequestBar request={request} agentFilter={agentCandidateFilter} loadedCount={loadedCandidates.length} visibleCount={matchingCandidates.length} onClearAgentFilter={() => clearAgentCandidateFilter('user')} filtersOpen={manualFiltersOpen} onToggleFilters={() => setManualFiltersOpen((open) => !open)} />{manualFiltersOpen ? <section className="manual-filter-shell" aria-label="網站找房條件"><div className="manual-filter-heading"><div><strong>自己設定找房條件</strong><span>你與 ChatGPT 會看到同一組條件與結果</span></div></div><ManualSearchBar embedded hasActiveSearch={hasActiveSearch} draft={manualDraft} onChange={setManualDraft} onSubmit={applyManualCriteria} loading={isPreviewing || isRefreshing} /></section> : null}</> : <><ManualSearchBar hasActiveSearch={hasActiveSearch} draft={manualDraft} onChange={setManualDraft} onSubmit={applyManualCriteria} loading={isPreviewing || isRefreshing} />{agentCandidateFilter ? <ManualAgentFilterNotice filter={agentCandidateFilter} visibleCount={matchingCandidates.length} loadedCount={loadedCandidates.length} onClear={() => clearAgentCandidateFilter('user')} /> : null}</>}
        <section className={`criteria-strip ${hasActiveSearch ? '' : 'is-empty'}`} aria-label="你的找房條件"><span className="criteria-label">你的條件</span>{hasActiveSearch ? <><span className="criteria-chip">{criteria.cities?.length > 1 ? '雙北市' : criteria.city}{criteria.district}</span>{criteria.residentialOnly ? <span className="criteria-chip"><strong>住宅</strong></span> : null}{criteria.maxPrice != null ? <span className="criteria-chip"><strong>{criteria.maxPrice.toLocaleString()}</strong> 萬內</span> : null}<span className="criteria-chip">{criteria.rooms != null ? <><strong>{criteria.rooms}</strong> 房</> : criteria.minRooms != null ? <><strong>{criteria.minRooms}</strong> 房以上</> : '房數不限'}</span>{criteria.maxMrtDistance != null ? <span className="criteria-chip">捷運 <strong>{criteria.maxMrtDistance}</strong> 公尺內</span> : null}{criteria.minArea != null ? <span className="criteria-chip"><strong>{criteria.minArea}</strong> 坪以上</span> : null}{criteria.maxArea != null ? <span className="criteria-chip"><strong>{criteria.maxArea}</strong> 坪內</span> : null}{criteria.maxAge != null ? <span className="criteria-chip">屋齡 <strong>{criteria.maxAge}</strong> 年內</span> : null}{criteria.requireElevator ? <span className="criteria-chip"><strong>電梯</strong></span> : null}{criteria.requireParking ? <span className="criteria-chip"><strong>含車位</strong></span> : null}<span className="criteria-chip">比較方式：<strong>{scenarioConfig[mode].label}</strong></span>{mode !== 'budget' ? <button type="button" className="criteria-edit" onClick={prioritizeBudget}>改成價格優先</button> : null}</> : <span className="criteria-empty">{aiMode ? '尚未設定，可自行設定或從 ChatGPT 告訴我你的需求' : '尚未設定，請使用上方欄位開始找房'}</span>}</section>
        {constraintPreview ? <ConstraintPreviewPanel preview={constraintPreview} onApply={() => applyConstraintPreview(constraintPreview.previewId, 'user').catch(() => {})} onDiscard={() => discardConstraintPreview(constraintPreview.previewId)} applying={isRefreshing} /> : null}
        {!constraintPreview && decisionChange ? <DecisionChangePanel change={decisionChange} /> : null}
        <section className="workspace-grid"><MapPanel candidates={matchingCandidates} selected={selected?.outsideCurrentSearch ? null : selected} selectedId={selectedId} pinnedIds={pinnedIds} onSelect={setSelectedId} focusRequest={mapFocusRequest} criteria={criteria} loading={isRefreshing} hasActiveSearch={hasActiveSearch} /><EvidencePanel candidates={matchingCandidates} recommendations={visibleRecommendations} selected={selected?.outsideCurrentSearch ? null : selected} selectedId={selectedId} pinnedIds={pinnedIds} compareIds={compareIds} onSelect={selectCandidateFromList} onPin={togglePin} onCompare={toggleCompare} onOpenFavorites={() => setFavoritesOpen(true)} activity={activity} sourceState={sourceState} onEnrich={enrichEvidence} isEnriching={isEnriching} resultView={resultView} onResultView={setResultView} onLoadMore={loadMoreResults} isLoadingMore={isLoadingMore} hasActiveSearch={hasActiveSearch} /><InsightsPanel selected={selected?.outsideCurrentSearch ? null : selected} criteria={criteria} activity={activity} aiMode={aiMode} onOpenChecklist={() => setChecklistOpen(true)} /></section>
        <DecisionRail mode={mode} pendingMode={pendingMode} onPreviewMode={previewMode} onApplyMode={applyMode} onCancelMode={() => setPendingMode(null)} pinnedCount={pinnedIds.length} candidates={matchingCandidates} onOpenFavorites={() => setFavoritesOpen(true)} onGenerate={() => setDecisionCard(true)} hasActiveSearch={hasActiveSearch} />
      </main>
      {notice ? <div className="toast"><Icon name="check" size={17} />{notice}</div> : null}
      {decisionCard && selected && !selected.outsideCurrentSearch ? <DecisionCard selected={selected} criteria={criteria} mode={mode} onClose={() => setDecisionCard(false)} /> : null}
      {favoritesOpen ? <FavoritesModal candidates={favoriteCandidates} favoriteMeta={favoriteMeta} onUpdate={updateFavoriteMeta} onCompare={toggleCompare} compareIds={compareIds} onClose={() => setFavoritesOpen(false)} /> : null}
      {compareOpen ? <CompareModal candidates={compareCandidates} favoriteMeta={favoriteMeta} onUpdate={updateFavoriteMeta} onRemove={toggleCompare} onClose={() => setCompareOpen(false)} /> : null}
      {checklistOpen && selected && !selected.outsideCurrentSearch ? <ViewingChecklistModal candidate={selected} onClose={() => setChecklistOpen(false)} /> : null}
      {restartOpen ? <RestartModal clearAllConfirm={clearAllConfirm} favoriteCount={pinnedIds.length} comparisonCount={compareIds.length} loading={isResetting} onReset={() => resetSearchWorkspace({ actor: 'user' }).catch(() => {})} onAskClearAll={() => setClearAllConfirm(true)} onBack={() => setClearAllConfirm(false)} onClearAll={() => resetSearchWorkspace({ clearSaved: true, actor: 'user' }).catch(() => {})} onClose={() => { setRestartOpen(false); setClearAllConfirm(false) }} /> : null}
      {compareIds.length ? <CompareTray candidates={compareCandidates} onRemove={toggleCompare} onOpen={() => setCompareOpen(true)} /> : null}
    </div>
  )
}

function AiRequestBar({ request, agentFilter, loadedCount, visibleCount, onClearAgentFilter, filtersOpen, onToggleFilters }) {
  return <div className={`request-bar ai-request ${agentFilter ? 'has-agent-filter' : ''}`} aria-label="ChatGPT 查找需求"><Icon name="search" size={21} /><span className="request-mode-label">ChatGPT 查找</span><div className="ai-request-copy"><p>{request}</p>{agentFilter ? <small>{agentFilter.methodLabel} · 顯示 {visibleCount} / {loadedCount} 間 · {agentFilter.scopeNote}</small> : null}</div>{agentFilter ? <button type="button" className="clear-agent-filter" onClick={onClearAgentFilter}>清除初篩</button> : null}<button type="button" className="manual-filter-toggle" aria-expanded={filtersOpen} onClick={onToggleFilters}>{filtersOpen ? '收起條件' : '自己設定條件'}</button></div>
}

function ManualAgentFilterNotice({ filter, visibleCount, loadedCount, onClear }) {
  return <div className="manual-agent-filter-notice" role="status"><div><strong>目前沿用上次 ChatGPT 的篩選結果</strong><span>{filter.summary}</span><small>顯示 {visibleCount} / {loadedCount} 間 · {filter.scopeNote}</small></div><button type="button" onClick={onClear}>顯示全部 {loadedCount} 間</button></div>
}

function ManualSearchBar({ draft, onChange, onSubmit, loading, hasActiveSearch, embedded = false }) {
  const update = (key) => (event) => onChange((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  return <form className={`manual-search-bar ${embedded ? 'embedded' : ''}`} onSubmit={onSubmit} aria-label="自行設定找房條件"><label><span>地區</span><select value={draft.cityGroup} onChange={update('cityGroup')}><option>台北市</option><option>新北市</option><option>雙北市</option></select></label><label><span>總價上限</span><span className="field-with-unit"><input type="number" min="1" required placeholder="請輸入" value={draft.maxPrice} onChange={update('maxPrice')} /><small>萬</small></span></label><label><span>房數</span><select value={draft.rooms} onChange={update('rooms')}><option value="">不限</option><option value="1">1 房</option><option value="2">2 房</option><option value="3">3 房</option><option value="4plus">4 房以上</option></select></label><label><span>坪數</span><span className="area-range"><input aria-label="最小坪數" type="number" min="0" placeholder="不限" value={draft.minArea} onChange={update('minArea')} /><small>至</small><input aria-label="最大坪數" type="number" min="0" placeholder="不限" value={draft.maxArea} onChange={update('maxArea')} /><small>坪</small></span></label><label><span>屋齡上限</span><span className="field-with-unit"><input type="number" min="0" placeholder="不限" value={draft.maxAge} onChange={update('maxAge')} /><small>年</small></span></label><label><span>捷運距離</span><span className="field-with-unit"><input type="number" min="0" placeholder="不限" value={draft.maxMrtDistance} onChange={update('maxMrtDistance')} /><small>公尺</small></span></label><div className="manual-checks"><label><input type="checkbox" checked={draft.requireElevator} onChange={update('requireElevator')} />需要電梯</label><label><input type="checkbox" checked={draft.requireParking} onChange={update('requireParking')} />需要車位</label></div><button className="manual-submit" type="submit" disabled={loading}>{loading ? hasActiveSearch ? '正在試算…' : '正在搜尋…' : hasActiveSearch ? '先看結果差異' : '開始找房'}</button></form>
}

function ConstraintPreviewPanel({ preview, onApply, onDiscard, applying }) {
  const currentPrice = preview.distributions.current.medianPriceWan
  const nextPrice = preview.distributions.preview.medianPriceWan
  return <section className="constraint-preview-panel" aria-label="條件變更預演" aria-live="polite">
    <div className="preview-heading"><span className="preview-icon"><Icon name="chart" size={18} /></span><div><div className="preview-title-row"><h2>新條件會帶來什麼變化</h2><span>尚未套用</span></div><p>{preview.actor === 'agent' ? 'ChatGPT 正在等你確認；目前地圖與清單沒有改變' : '先確認影響，再決定是否更新目前結果'}</p></div></div>
    <div className="preview-criteria">{preview.criteriaChanges.slice(0, 4).map((item) => <div key={item.key}><span>{item.label}</span><strong>{item.before}</strong><Icon name="arrow" size={13} /><strong>{item.after}</strong></div>)}</div>
    <div className="preview-metrics"><div><small>符合物件</small><strong>{preview.currentLoadedCount} → {preview.previewLoadedCount}</strong></div><div className="added"><small>可能新出現</small><strong>+{preview.addedCount}</strong></div><div className="removed"><small>可能不再符合</small><strong>−{preview.removedCount}</strong></div><div><small>總價中位數</small><strong>{currentPrice == null || nextPrice == null ? '資料不足' : `${currentPrice.toLocaleString()} → ${nextPrice.toLocaleString()} 萬`}</strong></div><div className={preview.favoritesOutsidePreview ? 'warning' : 'preserved'}><small>收藏受影響</small><strong>{preview.favoritesOutsidePreview} 間</strong></div></div>
    <div className="preview-footer"><span><Icon name="shield" size={14} />{preview.dataScope.note}</span><div><button type="button" className="preview-discard" onClick={onDiscard} disabled={applying}>保留目前條件</button><button type="button" className="preview-apply" onClick={onApply} disabled={applying}>{applying ? '更新中…' : '套用這組條件'}</button></div></div>
  </section>
}

function DecisionChangePanel({ change }) {
  const priceDelta = change.previousMinPrice != null && change.nextMinPrice != null ? change.nextMinPrice - change.previousMinPrice : null
  return <section className={`decision-change-panel ${change.actor}`} aria-label="這次調整帶來的差異">
    <div className="decision-change-title"><span className="change-agent-icon"><Icon name={change.actor === 'agent' ? 'chart' : 'check'} size={17} /></span><div><h2>這次調整帶來的差異</h2><p>{change.actor === 'agent' ? 'ChatGPT 已調整條件，結果同步更新' : '你調整了條件，結果已重新整理'}</p></div></div>
    <div className="criteria-deltas">{change.criteriaChanges.slice(0, 3).map((item) => <div key={item.key}><span>{item.label}</span><strong>{item.before}</strong><Icon name="arrow" size={13} /><strong>{item.after}</strong></div>)}</div>
    <div className="result-deltas"><div><small>目前已載入</small><strong>{change.previousLoadedCount} → {change.nextLoadedCount}</strong></div><div className="added"><small>新出現</small><strong>+{change.addedCount}</strong></div><div className="removed"><small>不再符合</small><strong>−{change.removedCount}</strong></div>{priceDelta != null ? <div><small>最低總價</small><strong>{priceDelta === 0 ? '不變' : `${priceDelta > 0 ? '+' : ''}${priceDelta.toLocaleString()} 萬`}</strong></div> : null}<div className="preserved"><small>收藏保留</small><strong>{change.preservedFavoriteIds.length} 間</strong></div></div>
    <small className="decision-scope"><Icon name="shield" size={13} />{change.scopeNote}</small>
  </section>
}

function propertyPopupNode(candidate) {
  const root = document.createElement('div')
  root.className = 'property-popup'
  const title = document.createElement('strong')
  title.textContent = candidate.name
  const address = document.createElement('span')
  address.textContent = candidate.address
  const facts = document.createElement('span')
  facts.textContent = `${candidate.price.toLocaleString()} 萬 · ${candidate.station !== '未提供' ? `${candidate.station} ${candidate.mrtDistanceMeters ?? '—'} 公尺` : '捷運距離未提供'}`
  const link = document.createElement('a')
  link.href = candidate.sourceUrl
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = '查看原始物件頁'
  root.append(title, address, facts, link)
  return root
}

function MapPanel({ candidates, selected, selectedId, pinnedIds, onSelect, focusRequest, criteria, loading, hasActiveSearch }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const maplibreModuleRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const candidatesRef = useRef(new Map())
  const propertyDataRef = useRef(createPropertyFeatureCollection([]))
  const [mapReady, setMapReady] = useState(false)
  const [clusterDetails, setClusterDetails] = useState(null)
  onSelectRef.current = onSelect
  candidatesRef.current = new Map(candidates.map((candidate) => [candidate.id, candidate]))

  const validCandidates = useMemo(() => candidates.filter((candidate) => Number.isFinite(candidate.location?.lat) && Number.isFinite(candidate.location?.lon)), [candidates])
  const propertyData = useMemo(() => createPropertyFeatureCollection(validCandidates, selectedId, pinnedIds), [pinnedIds, selectedId, validCandidates])
  propertyDataRef.current = propertyData
  const missingCount = candidates.length - validCandidates.length
  const locationSignature = useMemo(() => validCandidates.map((candidate) => `${candidate.id}:${candidate.location.lat}:${candidate.location.lon}`).join('|'), [validCandidates])
  const locationLabel = hasActiveSearch ? `${criteria.cities?.length > 1 ? '雙北市' : criteria.city}${criteria.district ? ` · ${criteria.district}` : ''}` : '尚未設定地區'

  const fitAllResults = useCallback((animate = true) => {
    const map = mapRef.current
    if (!map || !validCandidates.length) return
    if (validCandidates.length === 1) {
      map.easeTo({ center: [validCandidates[0].location.lon, validCandidates[0].location.lat], zoom: 15, duration: animate ? 500 : 0 })
      return
    }
    const Maplibre = maplibreModuleRef.current
    if (!Maplibre) return
    const bounds = new Maplibre.LngLatBounds()
    validCandidates.forEach((candidate) => bounds.extend([candidate.location.lon, candidate.location.lat]))
    map.fitBounds(bounds, { padding: { top: 70, right: 50, bottom: 50, left: 50 }, maxZoom: 14, duration: animate ? 650 : 0 })
  }, [validCandidates])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined
    let disposed = false
    let resizeObserver = null
    const initialize = async () => {
      const Maplibre = await loadMaplibre()
      if (disposed || !containerRef.current) return
      maplibreModuleRef.current = Maplibre
      const map = new Maplibre.Map({
      container: containerRef.current,
      center: [121.52, 25.05],
      zoom: 9,
      minZoom: 7,
      maxZoom: 18,
      dragPan: { maxSpeed: 450, deceleration: 6500, linearity: 0.18 },
      attributionControl: false,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      })
      mapRef.current = map
      map.addControl(new Maplibre.NavigationControl({ showCompass: false }), 'bottom-right')
      map.addControl(new Maplibre.AttributionControl({ compact: true }), 'bottom-left')
      resizeObserver = new ResizeObserver(() => map.resize())
      resizeObserver.observe(containerRef.current)

      map.on('load', () => setMapReady(true))
    }
    initialize()

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      popupRef.current?.remove()
      mapRef.current?.remove()
      mapRef.current = null
      maplibreModuleRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const Maplibre = maplibreModuleRef.current
    if (!mapReady || !map || !Maplibre) return undefined
    map.addSource(PROPERTY_SOURCE_ID, {
      type: 'geojson',
      data: propertyDataRef.current,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 54,
    })
    map.addLayer({
      id: PROPERTY_CLUSTER_HALO_LAYER,
      type: 'circle',
      source: PROPERTY_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['step', ['get', 'point_count'], 22, 20, 26, 75, 31],
        'circle-opacity': 0.92,
      },
    })
    map.addLayer({
      id: PROPERTY_CLUSTER_LAYER,
      type: 'circle',
      source: PROPERTY_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#34495a', 20, '#2c7faf', 75, '#eb4d3d'],
        'circle-radius': ['step', ['get', 'point_count'], 18, 20, 22, 75, 27],
        'circle-opacity': 0.96,
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(255,255,255,.75)',
      },
    })
    map.addLayer({
      id: PROPERTY_CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: PROPERTY_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-width': 0 },
    })
    map.addLayer({
      id: PROPERTY_POINT_LAYER,
      type: 'circle',
      source: PROPERTY_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['get', 'emphasized'], 13, 8],
        'circle-color': ['case', ['get', 'emphasized'], '#eb4d3d', '#263746'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.98,
      },
    })
    map.addLayer({
      id: PROPERTY_POINT_CENTER_LAYER,
      type: 'circle',
      source: PROPERTY_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['get', 'emphasized'], 4, 2.5],
        'circle-color': '#ffffff',
      },
    })

    const handleClusterClick = async (event) => {
      const feature = event.features?.[0]
      if (!feature) return
      const clusterId = feature.properties.cluster_id
      const count = feature.properties.point_count
      const source = map.getSource(PROPERTY_SOURCE_ID)
      const [leaves, expansionZoom] = await Promise.all([
        source.getClusterLeaves(clusterId, 8, 0),
        source.getClusterExpansionZoom(clusterId),
      ])
      const items = leaves.map((leaf) => candidatesRef.current.get(leaf.properties.candidateId)).filter(Boolean)
      setClusterDetails({ count, items, loading: false })
      map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(expansionZoom, 17), duration: 500 })
    }
    const handlePointClick = (event) => {
      const feature = event.features?.[0]
      const candidate = feature ? candidatesRef.current.get(feature.properties.candidateId) : null
      if (!candidate) return
      setClusterDetails(null)
      onSelectRef.current(candidate.id)
      map.easeTo({ center: [candidate.location.lon, candidate.location.lat], zoom: Math.max(map.getZoom(), 15), duration: 450 })
      popupRef.current?.remove()
      popupRef.current = new Maplibre.Popup({ offset: 14, closeButton: true }).setLngLat([candidate.location.lon, candidate.location.lat]).setDOMContent(propertyPopupNode(candidate)).addTo(map)
    }
    const showPointer = () => { map.getCanvas().style.cursor = 'pointer' }
    const showGrab = () => { map.getCanvas().style.cursor = '' }
    map.on('click', PROPERTY_CLUSTER_LAYER, handleClusterClick)
    map.on('click', PROPERTY_POINT_LAYER, handlePointClick)
    map.on('mouseenter', PROPERTY_CLUSTER_LAYER, showPointer)
    map.on('mouseleave', PROPERTY_CLUSTER_LAYER, showGrab)
    map.on('mouseenter', PROPERTY_POINT_LAYER, showPointer)
    map.on('mouseleave', PROPERTY_POINT_LAYER, showGrab)
    return () => {
      map.off('click', PROPERTY_CLUSTER_LAYER, handleClusterClick)
      map.off('click', PROPERTY_POINT_LAYER, handlePointClick)
      map.off('mouseenter', PROPERTY_CLUSTER_LAYER, showPointer)
      map.off('mouseleave', PROPERTY_CLUSTER_LAYER, showGrab)
      map.off('mouseenter', PROPERTY_POINT_LAYER, showPointer)
      map.off('mouseleave', PROPERTY_POINT_LAYER, showGrab)
    }
  }, [mapReady])

  useEffect(() => {
    const source = mapRef.current?.getSource(PROPERTY_SOURCE_ID)
    if (mapReady && source) source.setData(propertyData)
  }, [mapReady, propertyData])

  useEffect(() => {
    if (!mapReady || !locationSignature) return
    fitAllResults(false)
    setClusterDetails(null)
  }, [fitAllResults, locationSignature, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const candidate = focusRequest ? candidatesRef.current.get(focusRequest.id) : null
    if (!mapReady || !map || !candidate || !Number.isFinite(candidate.location?.lat) || !Number.isFinite(candidate.location?.lon)) return
    const center = [candidate.location.lon, candidate.location.lat]
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 15), duration: 500 })
    popupRef.current?.remove()
    const Maplibre = maplibreModuleRef.current
    if (Maplibre) popupRef.current = new Maplibre.Popup({ offset: 14, closeButton: true }).setLngLat(center).setDOMContent(propertyPopupNode(candidate)).addTo(map)
    setClusterDetails(null)
  }, [focusRequest, mapReady])

  return <section className="panel map-panel"><div className="map-head"><div className="map-count"><span>{loading ? '…' : validCandidates.length}</span> 間顯示在地圖{!loading && missingCount ? <small>另 {missingCount} 間缺少位置資料</small> : null}</div><div className="map-tools"><button aria-label="顯示全部物件" onClick={() => fitAllResults(true)} disabled={!validCandidates.length}><Icon name="target" size={17} />顯示全部</button></div></div><div className="map-canvas interactive-map-wrap"><div ref={containerRef} className="interactive-map" role="application" aria-label={`${locationLabel}物件地圖，可拖曳、縮放並點選區域或物件`} />{!validCandidates.length ? <div className="map-empty"><Icon name="target" size={25} /><strong>{hasActiveSearch ? '目前沒有可顯示位置的物件' : '尚未有物件結果'}</strong><span>{hasActiveSearch ? '你仍可從物件清單查看結果。' : '請先設定找房條件，再從地圖比較位置。'}</span></div> : null}<div className="map-area-label">{locationLabel}</div>{selected ? <div className="route-callout"><span>{selected.name}</span><small>{selected.station !== '未提供' ? `距 ${selected.station} 約 ${selected.mrtDistanceMeters ?? '—'} 公尺` : '尚無捷運距離資料'}</small></div> : null}{clusterDetails ? <div className="cluster-detail-card"><div><strong>這個區域有 {clusterDetails.count} 間</strong><button aria-label="關閉區域物件" onClick={() => setClusterDetails(null)}><Icon name="close" size={15} /></button></div><p>地圖已放大，先看看其中 {clusterDetails.items.length} 間</p><div>{clusterDetails.items.map((candidate) => <button key={candidate.id} onClick={() => { onSelect(candidate.id); mapRef.current?.easeTo({ center: [candidate.location.lon, candidate.location.lat], zoom: 16, duration: 450 }); popupRef.current?.remove(); const Maplibre = maplibreModuleRef.current; if (Maplibre) popupRef.current = new Maplibre.Popup({ offset: 14 }).setLngLat([candidate.location.lon, candidate.location.lat]).setDOMContent(propertyPopupNode(candidate)).addTo(mapRef.current); setClusterDetails(null) }}><span>{candidate.name}</span><small>{candidate.price.toLocaleString()} 萬 · {candidate.mrtDistanceMeters ?? '—'} 公尺</small></button>)}</div>{clusterDetails.count > clusterDetails.items.length ? <small>繼續放大可查看另外 {clusterDetails.count - clusterDetails.items.length} 間</small> : null}</div> : null}</div><div className="map-footer"><span><i className="legend-dot red"></i>紅色為已選／已收藏</span><span><i className="legend-dot blue"></i>數字代表這個區域的物件數</span><span className="map-footer-note">拖曳查看周邊 · 點數字放大區域</span></div></section>
}

function EvidencePanel({ candidates, recommendations, selected, selectedId, pinnedIds, compareIds, onSelect, onPin, onCompare, onOpenFavorites, activity, sourceState, onEnrich, isEnriching, resultView, onResultView, onLoadMore, isLoadingMore, hasActiveSearch }) {
  const evidenceText = selected?.actualPriceEvidence?.status === 'live' ? `同區相近條件成交 ${selected.actualPriceEvidence.count} 筆（最多 5 筆），中位單價 ${selected.actualPriceEvidence.medianUnitPrice} 萬／坪` : selected?.actualPriceEvidence?.status === 'missing' ? '同區暫無足夠相近條件成交資料' : selected?.actualPriceEvidence?.status === 'error' ? '同區成交資料更新失敗' : '選取物件後可查看同區相近條件成交'
  const recommendationById = new Map(recommendations.map((item) => [item.id, item]))
  const visibleCandidates = resultView === 'recommended' ? recommendations.map((item) => item.candidate) : candidates
  return <section className="panel evidence-panel">
    <div className="panel-heading"><div><h2>物件清單</h2><button className="text-link" disabled={!selected || isEnriching} onClick={() => selected && onEnrich([selected.id])}>{isEnriching ? '正在更新物件資訊' : '更新物件與實價資訊'} <Icon name="refresh" size={13} /></button></div><button className="pinned-count" onClick={onOpenFavorites}><Icon name="heart" size={15} />已收藏 {pinnedIds.length} 間</button></div>
    <div className="result-controls"><div><button className={resultView === 'all' ? 'active' : ''} onClick={() => onResultView('all')}>全部 <strong>{candidates.length}</strong></button><button className={resultView === 'recommended' ? 'active' : ''} onClick={() => onResultView('recommended')}>值得先看 <strong>{recommendations.length}</strong></button></div><span>{resultView === 'recommended' ? '依目前結果的價格、捷運、屋齡與坪數整理' : sourceState.resultSetComplete ? sourceState.status === 'snapshot' ? '已顯示備援快照全部結果' : '已顯示全部結果' : '還有更多物件可以載入'}</span></div>
    <div className="table-head"><span>物件</span><span>總價<br /><small>(萬元)</small></span><span>格局</span><span>捷運距離</span><span>屋齡</span><span>坪數<br /><small>(權狀)</small></span><span>收藏／比較</span></div>
    <div className="candidate-list">{visibleCandidates.length ? visibleCandidates.map((candidate) => {
      const isSelected = candidate.id === selectedId
      const isPinned = pinnedIds.includes(candidate.id)
      const isCompared = compareIds.includes(candidate.id)
      const recommendation = recommendationById.get(candidate.id)
      return <article key={candidate.id} className={`candidate-row ${isSelected ? 'selected' : ''} ${recommendation ? 'is-recommended' : ''}`} role="button" tabIndex="0" aria-label={`選取 ${candidate.name}`} onKeyDown={(event) => { if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return; event.preventDefault(); onSelect(candidate.id) }} onClick={() => onSelect(candidate.id)}><div className="candidate-name"><span className={`rank-box ${isSelected ? 'active' : ''}`}>{candidate.displayRank}</span><div><a href={candidate.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><strong>{candidate.name}</strong></a><small>{candidate.address}</small>{resultView === 'recommended' && recommendation ? <em className="recommendation-reason">{recommendation.reasons.join(' · ')}</em> : null}</div></div><div className={`candidate-price ${candidate.price < 1650 ? 'good' : ''}`}>{candidate.price.toLocaleString()}</div><div>{candidate.layout}</div><div className="commute-value"><strong>{candidate.mrtDistanceMeters != null ? `${candidate.mrtDistanceMeters} 公尺` : '—'}</strong><small>{candidate.station && candidate.station !== '未提供' ? candidate.station : '暫無捷運資料'}</small></div><div>{candidate.age != null && candidate.age >= 0 ? `${candidate.age} 年` : '—'}</div><div>{candidate.size != null ? `${candidate.size.toFixed(2)} 坪` : '—'}</div><div className="row-actions"><button title={isPinned ? '取消收藏' : '收藏物件'} className={isPinned ? 'is-pinned' : ''} onClick={(event) => { event.stopPropagation(); onPin(candidate.id) }} aria-label={isPinned ? '取消收藏' : '收藏物件'}><Icon name="heart" size={16} /></button><button title={isCompared ? '移出比較' : '加入比較'} className={isCompared ? 'is-compared' : ''} onClick={(event) => { event.stopPropagation(); onCompare(candidate.id) }} aria-label={isCompared ? '移出比較' : '加入比較'}><Icon name="compare" size={16} /></button></div></article>
    }) : <div className="candidate-empty"><strong>{hasActiveSearch ? '目前沒有完全符合的物件' : '尚未開始找房'}</strong><span>{hasActiveSearch ? '試著放寬預算、捷運距離或地區條件。' : '設定條件後，符合的公開物件會顯示在這裡。'}</span></div>}</div>
    {sourceState.hasMore ? <button className="load-more" onClick={onLoadMore} disabled={isLoadingMore}>{isLoadingMore ? '正在尋找更多物件…' : '載入更多符合物件'}</button> : null}
    <div className={`evidence-source-card ${sourceState.status}`}><div className="source-icon"><Icon name="shield" size={21} /></div><div><strong>{sourceState.status === 'idle' ? '尚未搜尋物件' : sourceState.status === 'live' ? '物件資料已更新' : sourceState.status === 'snapshot' ? '目前顯示具時間標記的備援快照' : '物件資料狀態'}</strong><p>{sourceState.status === 'idle' ? '設定找房條件後，這裡會顯示資料範圍與更新狀態。' : <>{sourceState.status === 'snapshot' ? `備援快照中找到 ${sourceState.returnedCount ?? 0} 間` : `公開來源共有 ${sourceState.totalCount || 0} 筆相關物件，目前顯示 ${sourceState.returnedCount ?? 0} 間`}｜{evidenceText}</>}</p>{sourceState.status !== 'idle' ? <div className="source-links">{sourceCatalog.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.short}</a>)}<small>個人開源作品，非原始資料網站官方服務</small></div> : null}</div>{sourceState.status !== 'idle' ? <Icon name="arrow" size={18} /> : null}</div>
    {sourceState.warnings?.length ? <div className="source-warning">{sourceState.warnings.join(' ')}</div> : null}
    <div className="activity-log"><div className="activity-title"><span><Icon name="clock" size={16} />最近調整</span><small>已同步到地圖與清單</small></div>{activity.slice(0, 2).map((item) => <div className="activity-item" key={item.id}><span className={`activity-icon ${item.type}`}><Icon name={item.type === 'pin' ? 'heart' : item.type === 'agent' ? 'compare' : 'check'} size={13} /></span><span>{item.type === 'agent' ? <small className="activity-source ai">ChatGPT</small> : item.type === 'user' ? <small className="activity-source user">你</small> : null}{item.text}</span><time>{item.time}</time></div>)}</div>
  </section>
}

function InsightsPanel({ selected, criteria, activity, aiMode, onOpenChecklist }) {
  if (!selected) return <section className="panel insights-panel empty-insights"><div><h2>物件重點比較</h2><p>選一間物件，就能查看價格、捷運距離與生活機能。</p></div></section>
  const latestRelevantActivity = aiMode ? activity.find((item) => item.type === 'agent') : activity.find((item) => item.type === 'user')
  const budgetRoom = criteria.maxPrice != null && Number.isFinite(selected.price) ? criteria.maxPrice - selected.price : null
  const stationAvailable = selected.station && selected.station !== '未提供'
  const ageAvailable = Number.isFinite(selected.age) && selected.age >= 0
  const publicTags = (selected.tags || []).filter((tag) => ['近學校', '近公園', '近市場'].includes(tag))
  const actualPriceText = selected.actualPriceEvidence?.status === 'live'
    ? `${selected.actualPriceEvidence.count} 筆樣本，中位單價 ${selected.actualPriceEvidence.medianUnitPrice} 萬／坪`
    : selected.actualPriceEvidence?.status === 'missing' ? '同區暫無足夠相近條件成交資料' : selected.actualPriceEvidence?.status === 'error' ? '資料更新失敗' : '尚未更新同區相近條件成交'
  return <section className="panel insights-panel"><div className="insights-heading"><div><h2>這間房的公開資訊</h2><p>{selected.name}</p></div></div><div className="property-fact-grid"><article className="property-fact primary"><span>總價</span><strong>{selected.price.toLocaleString()} 萬</strong><small>{budgetRoom == null ? '物件公開售價' : budgetRoom >= 0 ? `比預算上限少 ${budgetRoom.toLocaleString()} 萬` : `超出預算 ${Math.abs(budgetRoom).toLocaleString()} 萬`}</small></article><article className="property-fact"><span>最近捷運</span><strong>{stationAvailable ? selected.station : '未提供'}</strong><small>{selected.mrtDistanceMeters != null ? `距離約 ${selected.mrtDistanceMeters.toLocaleString()} 公尺` : '物件頁未提供距離'}</small></article><article className="property-fact"><span>屋齡</span><strong>{ageAvailable ? `${selected.age} 年` : '未提供'}</strong><small>{ageAvailable ? '物件公開欄位' : '待向物件方確認'}</small></article><article className="property-fact"><span>權狀坪數</span><strong>{Number.isFinite(selected.size) ? `${selected.size.toFixed(2)} 坪` : '未提供'}</strong><small>{selected.layout || '格局未提供'}</small></article></div><div className="public-facilities"><div className="insight-title"><strong>物件頁標示</strong><span>未標示不代表附近沒有</span></div>{publicTags.length ? <div className="facility-tags">{publicTags.map((tag) => <span key={tag}>{tag.replace('近', '')}</span>)}</div> : <p>物件頁沒有標示學校、公園或市場資訊。</p>}<div className="actual-price-line"><span>同區相近條件成交</span><strong>{actualPriceText}</strong></div></div><div className={`agent-change-card ${aiMode ? 'ai-mode' : 'manual-mode'}`}><div className="change-header"><span><Icon name="clock" size={16} />{aiMode ? 'ChatGPT 最近調整' : '你最近調整'}</span><time>{latestRelevantActivity?.time || '—'}</time></div><p>{latestRelevantActivity?.text || (aiMode ? '可直接在 ChatGPT 對話中告訴我想調整的條件' : '調整上方條件後，變更會顯示在這裡')}</p></div><button className="viewing-checklist-button" onClick={onOpenChecklist}><Icon name="document" size={16} />查看尚待確認的資料<Icon name="arrow" size={15} /></button><div className="insight-footnote"><Icon name="shield" size={14} />以上欄位來自公開物件頁；缺少的資訊會直接標示</div></section>
}

function DecisionRail({ mode, pendingMode, onPreviewMode, onApplyMode, onCancelMode, pinnedCount, candidates, onOpenFavorites, onGenerate, hasActiveSearch }) {
  const prices = candidates.map((candidate) => candidate.price); const mrtDistances = candidates.map((candidate) => candidate.mrtDistanceMeters).filter(Number.isFinite)
  const lowestPrice = prices.length ? Math.min(...prices) : null; const nearestMrt = mrtDistances.length ? Math.min(...mrtDistances) : null
  const pendingLabel = pendingMode ? scenarioConfig[pendingMode].label : null
  return <section className="decision-rail"><div className="scenario-tabs" aria-label="比較方式，點選後需確認才會套用"><button disabled={!hasActiveSearch} aria-pressed={hasActiveSearch && mode === 'budget'} className={`${mode === 'budget' ? 'active' : ''} ${pendingMode === 'budget' ? 'pending' : ''}`} onClick={() => onPreviewMode('budget')}><Icon name="home" size={18} /><span>最省預算<small>{lowestPrice == null ? '等待查詢' : `${lowestPrice.toLocaleString()} 萬起`}</small></span></button><button disabled={!hasActiveSearch} aria-pressed={hasActiveSearch && mode === 'mrt'} className={`${mode === 'mrt' ? 'active' : ''} ${pendingMode === 'mrt' ? 'pending' : ''}`} onClick={() => onPreviewMode('mrt')}><Icon name="train" size={18} /><span>近捷運優先<small>{nearestMrt == null ? '等待捷運資料' : `${nearestMrt} 公尺起`}</small></span></button><button disabled={!hasActiveSearch} aria-pressed={hasActiveSearch && mode === 'balanced'} className={`${mode === 'balanced' ? 'active' : ''} ${pendingMode === 'balanced' ? 'pending' : ''}`} onClick={() => onPreviewMode('balanced')}><Icon name="chart" size={18} /><span>綜合折衷<small>{hasActiveSearch ? '平衡價格、捷運與機能' : '等待查詢'}</small></span></button></div>{pendingMode ? <div className="preference-confirm" role="status"><div><strong>尚未變更結果</strong><span>要套用「{pendingLabel}」並重新排序嗎？</span></div><button className="cancel" onClick={onCancelMode}>取消</button><button onClick={onApplyMode}>確認套用</button></div> : <div className="decision-action"><button className="favorites-button" onClick={onOpenFavorites}><Icon name="heart" size={16} />我的收藏 {pinnedCount}</button><button onClick={onGenerate} disabled={!candidates.length}><Icon name="document" size={18} />產生選房摘要</button></div>}</section>
}

function FavoriteEditor({ candidate, meta = {}, onUpdate }) {
  const reasons = meta.reasons || []
  const toggleReason = (reason) => onUpdate(candidate.id, { reasons: reasons.includes(reason) ? reasons.filter((item) => item !== reason) : [...reasons, reason] })
  return <div className="favorite-editor"><label><span>目前狀態</span><select value={meta.status || 'interested'} onChange={(event) => onUpdate(candidate.id, { status: event.target.value })}>{FAVORITE_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><div className="reason-field"><span>收藏原因</span><div>{FAVORITE_REASONS.map((reason) => <button key={reason} aria-pressed={reasons.includes(reason)} className={reasons.includes(reason) ? 'active' : ''} onClick={() => toggleReason(reason)}>{reason}</button>)}</div></div><label><span>我的筆記</span><textarea value={meta.note || ''} maxLength={300} placeholder="例如：想確認採光、管理費或停車位" onChange={(event) => onUpdate(candidate.id, { note: event.target.value })} /></label></div>
}

function RestartModal({ clearAllConfirm, favoriteCount, comparisonCount, loading, onReset, onAskClearAll, onBack, onClearAll, onClose }) {
  const dialogRef = useDialogFocus()
  return <div className="modal-backdrop" onClick={onClose}><section ref={dialogRef} tabIndex="-1" className="restart-modal" role="dialog" aria-modal="true" aria-label={clearAllConfirm ? '確認清除所有紀錄' : '重新開始找房'} onClick={(event) => event.stopPropagation()}><div className="workspace-modal-head"><div><h2>{clearAllConfirm ? '確定清除所有紀錄？' : '重新開始找房'}</h2><p>{clearAllConfirm ? '這個動作無法復原，請確認後再繼續。' : '選擇要保留哪些已整理的內容。'}</p></div><button className="modal-close" onClick={onClose} aria-label="關閉"><Icon name="close" /></button></div>{clearAllConfirm ? <div className="restart-confirm"><Icon name="shield" size={26} /><strong>將清除 {favoriteCount} 間收藏、筆記與 {comparisonCount} 間比較</strong><p>目前的找房條件與搜尋結果也會一併清空，但不會影響原始物件網站上的任何資料。</p><div><button className="secondary" onClick={onBack} disabled={loading}>返回</button><button className="danger" onClick={onClearAll} disabled={loading}>{loading ? '正在清除…' : '確定清除全部'}</button></div></div> : <div className="restart-options"><article><div><Icon name="refresh" size={21} /><span><strong>重設找房條件</strong><small>回到台北市住宅預設並清除目前比較；收藏、原因與筆記都會保留。</small></span></div><button onClick={onReset} disabled={loading}>{loading ? '正在重設…' : '重設條件'}</button></article><article className="danger-option"><div><Icon name="close" size={21} /><span><strong>全部清除並重新開始</strong><small>清除收藏、筆記、比較、找房條件與目前結果。</small></span></div><button onClick={onAskClearAll} disabled={loading}>清除全部</button></article></div>}</section></div>
}

function FavoritesModal({ candidates, favoriteMeta, onUpdate, onCompare, compareIds, onClose }) {
  const [activeId, setActiveId] = useState(candidates[0]?.id || '')
  const dialogRef = useDialogFocus()
  const active = candidates.find((candidate) => candidate.id === activeId) || candidates[0]
  return <div className="modal-backdrop" onClick={onClose}><section ref={dialogRef} tabIndex="-1" className="workspace-modal favorites-modal" role="dialog" aria-modal="true" aria-label="我的收藏" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-head"><div><h2>我的收藏</h2><p>把有興趣的物件留下來，記錄看屋進度與在意的原因。</p></div><button className="modal-close" onClick={onClose} aria-label="關閉"><Icon name="close" /></button></div>{active ? <div className="favorites-layout"><nav>{candidates.map((candidate) => <button key={candidate.id} className={candidate.id === active.id ? 'active' : ''} onClick={() => setActiveId(candidate.id)}><span>{candidate.name}</span><small>{candidate.price.toLocaleString()} 萬 · {candidate.layout}{candidate.outsideCurrentSearch ? ' · 不符合目前條件' : ''}</small></button>)}</nav><div className="favorite-detail"><div className="favorite-property-head"><div><h3>{active.name}</h3><p>{active.address}{active.outsideCurrentSearch ? ' · 不符合目前條件' : ''}</p></div><button className={compareIds.includes(active.id) ? 'in-compare' : ''} onClick={() => onCompare(active.id)}><Icon name="compare" size={16} />{compareIds.includes(active.id) ? '移出比較' : '加入比較'}</button></div><FavoriteEditor candidate={active} meta={favoriteMeta[active.id]} onUpdate={onUpdate} /><a className="source-link-button" href={active.sourceUrl} target="_blank" rel="noreferrer">查看物件原始頁 <Icon name="external" size={14} /></a></div></div> : <div className="empty-favorites"><Icon name="heart" size={28} /><strong>還沒有收藏物件</strong><span>在物件清單點愛心，就能放進這裡慢慢整理。</span></div>}</section></div>
}

function formatCompareValue(candidate, key) {
  const values = {
    price: `${candidate.price?.toLocaleString() || '—'} 萬`,
    unitPrice: candidate.price && candidate.size ? `${(candidate.price / candidate.size).toFixed(1)} 萬／坪` : '—',
    layout: candidate.layout || '—',
    size: candidate.size != null ? `${candidate.size.toFixed(2)} 坪` : '—',
    age: candidate.age != null ? `${candidate.age} 年` : '—',
    mrt: candidate.mrtDistanceMeters != null ? `${candidate.mrtDistanceMeters} 公尺` : '—',
    station: candidate.station || '—',
    life: candidate.tags?.length ? candidate.tags.join('、') : '未標示',
    actual: candidate.actualPriceEvidence?.status === 'live' ? `${candidate.actualPriceEvidence.medianUnitPrice} 萬／坪（同區相近條件，最多 5 筆中的 ${candidate.actualPriceEvidence.count} 筆有效樣本）` : candidate.actualPriceEvidence?.status === 'missing' ? '無足夠可比資料' : candidate.actualPriceEvidence?.status === 'error' ? '更新失敗' : '尚未查詢',
  }
  return values[key]
}

function CompareModal({ candidates, favoriteMeta, onUpdate, onRemove, onClose }) {
  const [differencesOnly, setDifferencesOnly] = useState(false)
  useDialogFocus('.compare-modal')
  const rows = [{ key: 'price', label: '總價' }, { key: 'unitPrice', label: '每坪單價' }, { key: 'layout', label: '格局' }, { key: 'size', label: '權狀坪數' }, { key: 'age', label: '屋齡' }, { key: 'mrt', label: '捷運距離' }, { key: 'station', label: '最近捷運站' }, { key: 'life', label: '生活機能' }, { key: 'actual', label: '同區相近條件成交' }]
  const visibleRows = differencesOnly ? rows.filter((row) => new Set(candidates.map((candidate) => formatCompareValue(candidate, row.key))).size > 1) : rows
  return <div className="modal-backdrop compare-backdrop" onClick={onClose}><section className="workspace-modal compare-modal" role="dialog" aria-modal="true" aria-label="比較已選物件" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-head"><div><h2>比較已選物件</h2><p>一次聚焦最多四間，差異較容易看清楚。<span className="mobile-swipe-hint">左右滑動可查看其他物件。</span></p></div><div className="compare-head-actions"><label><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} />只看差異</label><button className="modal-close" onClick={onClose} aria-label="關閉"><Icon name="close" /></button></div></div><div className="compare-scroll"><div className="compare-grid" style={{ '--candidate-count': candidates.length }}><div className="compare-corner">比較項目</div>{candidates.map((candidate) => <div className="compare-candidate-head" key={candidate.id}><button onClick={() => onRemove(candidate.id)} aria-label={`移除${candidate.name}`}><Icon name="close" size={14} /></button><strong>{candidate.name}</strong><span>{candidate.address}</span></div>)}{visibleRows.map((row) => <React.Fragment key={row.key}><div className="compare-label">{row.label}</div>{candidates.map((candidate) => <div className="compare-value" key={`${row.key}-${candidate.id}`}>{formatCompareValue(candidate, row.key)}</div>)}</React.Fragment>)}</div><div className="compare-notes" style={{ '--candidate-count': candidates.length }}><div></div>{candidates.map((candidate) => <div key={candidate.id}><h3>{candidate.name}</h3><FavoriteEditor candidate={candidate} meta={favoriteMeta[candidate.id]} onUpdate={onUpdate} /><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">查看物件原始頁</a></div>)}</div></div></section></div>
}

function CompareTray({ candidates, onRemove, onOpen }) {
  const slots = Array.from({ length: MAX_COMPARE }, (_, index) => candidates[index] || null)
  return <aside className="compare-tray" aria-label="比較列"><div className="compare-tray-inner"><div className="tray-title"><Icon name="compare" size={18} /><span>比較物件<small>{candidates.length}/{MAX_COMPARE}</small></span></div><div className="tray-slots">{slots.map((candidate, index) => candidate ? <div className="tray-slot filled" key={candidate.id}><span>{candidate.name}</span><small>{candidate.price.toLocaleString()} 萬</small><button onClick={() => onRemove(candidate.id)} aria-label={`移除${candidate.name}`}><Icon name="close" size={13} /></button></div> : <div className="tray-slot" key={`empty-${index}`}><span>再選一間</span></div>)}</div><button className="open-compare" disabled={candidates.length < 2} onClick={onOpen}>比較 {candidates.length} 間</button></div></aside>
}

function ViewingChecklistModal({ candidate, onClose }) {
  useDialogFocus('.checklist-modal')
  const evidence = getPropertyEvidenceGaps(candidate)
  return <div className="modal-backdrop" onClick={onClose}><section className="workspace-modal checklist-modal" role="dialog" aria-modal="true" aria-label="公開資訊待確認" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-head"><div><h2>公開資訊待確認</h2><p>{candidate.name} · 僅列出目前公開資料缺口</p></div><button className="modal-close" onClick={onClose} aria-label="關閉"><Icon name="close" /></button></div><div className="checklist-body">{evidence.gaps.length ? evidence.gaps.map((item, index) => <article key={item.field}><span>{index + 1}</span><div><h3>{item.label}</h3><p>{item.detail}</p><small>資料狀態：{item.status}</small></div></article>) : <div className="evidence-complete"><Icon name="check" size={20} /><strong>目前主要公開欄位都有資料</strong><span>仍請以物件原始頁與現場確認為準。</span></div>}</div><div className="checklist-foot"><span><Icon name="shield" size={14} />資料缺口不代表物件本身有問題</span><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">查看物件原始頁</a></div></section></div>
}

function DecisionCard({ selected, criteria, mode, onClose }) {
  useDialogFocus('.decision-modal')
  const actual = selected.actualPriceEvidence?.status === 'live' ? `同區相近條件成交中位單價 ${selected.actualPriceEvidence.medianUnitPrice} 萬／坪（${selected.actualPriceEvidence.count} 筆）` : '尚未取得足夠可比成交，不能自行補估'
  const roomsLabel = criteria.rooms != null ? `${criteria.rooms} 房` : criteria.minRooms != null ? `${criteria.minRooms} 房以上` : '房數不限'
  const priceLabel = criteria.maxPrice == null ? '總價不限' : `預算 ${criteria.maxPrice.toLocaleString()} 萬內`
  const mrtLabel = criteria.maxMrtDistance == null ? null : `捷運 ${criteria.maxMrtDistance} 公尺內`
  const selectedMrt = selected.mrtDistanceMeters == null ? '捷運距離未提供' : `${selected.station !== '未提供' ? selected.station : '最近捷運站'}約 ${selected.mrtDistanceMeters} 公尺`
  return <div className="modal-backdrop" onClick={onClose}><div className="decision-modal" role="dialog" aria-modal="true" aria-label="你的選房摘要" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><h2>你的選房摘要</h2></div><button className="modal-close" onClick={onClose} aria-label="關閉"><Icon name="close" size={19} /></button></div><div className="modal-summary"><div className="summary-label">比較方式</div><strong>{scenarioConfig[mode].label}</strong><p>{criteria.city}{criteria.district} · {priceLabel} · {roomsLabel}{mrtLabel ? ` · ${mrtLabel}` : ''}</p></div><div className="modal-selected"><div className="selected-index">{selected.displayRank}</div><div><h3>{selected.name}</h3><p>{selected.address}</p><div className="summary-facts"><span><b>{selected.price.toLocaleString()}</b> 萬</span><span><b>{selected.mrtDistanceMeters ?? '—'}</b> 公尺至捷運</span><span><b>{selected.size ?? '—'}</b> 坪</span></div></div></div><div className="decision-reason"><div><Icon name="check" size={16} /><span>價格參考</span><p>{actual}</p></div><div><Icon name="check" size={16} /><span>捷運參考</span><p>{selectedMrt}</p></div><div><Icon name="check" size={16} /><span>周邊機能</span><p>{selected.tags?.length ? selected.tags.join('、') : '物件頁目前未標示'}</p></div></div><div className="modal-foot"><span><Icon name="shield" size={14} />資料僅供選房參考，不構成估價或交易建議</span><a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看物件原始頁</a><button onClick={onClose}>關閉</button></div></div></div>
}

createRoot(document.getElementById('root')).render(<App />)
