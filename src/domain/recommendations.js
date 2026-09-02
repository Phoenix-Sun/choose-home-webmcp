const MODES = {
  balanced: { price: 0.35, mrt: 0.35, age: 0.15, size: 0.15 },
  budget: { price: 0.6, mrt: 0.2, age: 0.1, size: 0.1 },
  mrt: { price: 0.2, mrt: 0.55, age: 0.15, size: 0.1 },
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}

function rankMap(candidates, getter, direction = 'asc') {
  const ranked = candidates
    .map((candidate) => ({ id: candidate.id, value: finite(getter(candidate)) }))
    .filter((item) => item.value != null)
    .sort((a, b) => direction === 'asc' ? a.value - b.value : b.value - a.value)
  const denominator = Math.max(1, ranked.length - 1)
  return new Map(ranked.map((item, index) => [item.id, index / denominator]))
}

function formatStrength(candidate, key) {
  if (key === 'price') return `總價 ${candidate.price.toLocaleString()} 萬`
  if (key === 'mrt') {
    const station = candidate.station && candidate.station !== '未提供' ? candidate.station : '捷運站'
    return `${station} ${candidate.mrtDistanceMeters.toLocaleString()} 公尺`
  }
  if (key === 'age') return `屋齡 ${candidate.age} 年`
  return `權狀 ${candidate.size.toFixed(2)} 坪`
}

function formatConcreteFallback(candidate) {
  const facts = []
  if (Number.isFinite(candidate.price)) facts.push(`總價 ${candidate.price.toLocaleString()} 萬`)
  if (Number.isFinite(candidate.mrtDistanceMeters)) {
    const station = candidate.station && candidate.station !== '未提供' ? candidate.station : '捷運站'
    facts.push(`距${station} ${candidate.mrtDistanceMeters.toLocaleString()} 公尺`)
  }
  return facts.length ? facts.join(' · ') : '公開資訊較完整'
}

export function buildExplainableRecommendations(input = [], mode = 'balanced', limit = 10) {
  const candidates = [...new Map(input.filter((candidate) => candidate?.id).map((candidate) => [candidate.id, candidate])).values()]
  if (!candidates.length || limit <= 0) return []

  const ranks = {
    price: rankMap(candidates, (candidate) => candidate.price),
    mrt: rankMap(candidates, (candidate) => candidate.mrtDistanceMeters),
    age: rankMap(candidates, (candidate) => candidate.age >= 0 ? candidate.age : null),
    size: rankMap(candidates, (candidate) => candidate.size, 'desc'),
  }
  const weights = MODES[mode] || MODES.balanced
  const fallbackRank = 1

  return candidates
    .map((candidate, originalIndex) => {
      const score = Object.entries(weights).reduce((total, [key, weight]) => total + (ranks[key].get(candidate.id) ?? fallbackRank) * weight, 0)
      const strengths = [
        { key: 'price' },
        { key: 'mrt' },
        { key: 'age' },
        { key: 'size' },
      ]
        .filter(({ key }) => (ranks[key].get(candidate.id) ?? 1) <= 0.25)
        .sort((a, b) => weights[b.key] - weights[a.key])
        .slice(0, 2)
        .map(({ key }) => formatStrength(candidate, key))
      return {
        id: candidate.id,
        candidate,
        score,
        originalIndex,
        reasons: strengths.length ? strengths : [formatConcreteFallback(candidate)],
      }
    })
    .sort((a, b) => a.score - b.score || a.originalIndex - b.originalIndex)
    .slice(0, Math.min(limit, candidates.length))
}
