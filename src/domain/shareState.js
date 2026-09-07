import { DEFAULT_CRITERIA, sanitizeCriteria } from './query.js'

export const SHARE_QUERY_KEY = 'share'
export const SHARE_STATE_VERSION = 1

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export function createSharePayload({ criteria = DEFAULT_CRITERIA, mode, selectedCandidateId } = {}) {
  const safeCriteria = sanitizeCriteria(criteria)
  const safeMode = ['budget', 'mrt', 'balanced'].includes(mode) ? mode : safeCriteria.priority
  return {
    v: SHARE_STATE_VERSION,
    criteria: { ...safeCriteria, priority: safeMode },
    mode: safeMode,
    selectedCandidateId: typeof selectedCandidateId === 'string' ? selectedCandidateId.slice(0, 100) : '',
  }
}

export function encodeShareState(state) {
  return encodeBase64Url(JSON.stringify(createSharePayload(state)))
}

export function decodeShareState(encoded = '') {
  try {
    if (!encoded || encoded.length > 4000) return null
    const parsed = JSON.parse(decodeBase64Url(encoded))
    if (parsed?.v !== SHARE_STATE_VERSION || !parsed.criteria || typeof parsed.criteria !== 'object') return null
    return createSharePayload(parsed)
  } catch {
    return null
  }
}

export function readShareState(search = '') {
  return decodeShareState(new URLSearchParams(search).get(SHARE_QUERY_KEY) || '')
}

export function buildShareUrl(state, currentHref) {
  const url = new URL(currentHref)
  url.search = ''
  url.hash = ''
  url.searchParams.set(SHARE_QUERY_KEY, encodeShareState(state))
  return url.toString()
}

export function removeShareStateFromUrl(currentHref) {
  const url = new URL(currentHref)
  url.searchParams.delete(SHARE_QUERY_KEY)
  return url.toString()
}
