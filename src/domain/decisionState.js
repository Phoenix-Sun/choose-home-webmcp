export const MAX_COMPARE = 4

export function addComparisonIds(current = [], incoming = [], validIds = [], limit = MAX_COMPARE) {
  const valid = new Set(validIds)
  return [...new Set([...current, ...incoming])].filter((id) => valid.has(id)).slice(0, limit)
}

export function removeComparisonIds(current = [], removing = []) {
  const removalSet = new Set(removing)
  return current.filter((id) => !removalSet.has(id))
}
