export const WEBMCP_TOOL_NAMES = Object.freeze([
  'get_decision_state',
  'search_public_properties',
  'get_search_progress',
  'get_decision_changes',
  'preview_constraint_change',
  'apply_previewed_constraints',
  'discard_constraint_preview',
  'list_property_results',
  'apply_agent_candidate_filter',
  'clear_agent_candidate_filter',
  'load_more_property_results',
  'load_all_property_results',
  'enrich_property_evidence',
  'update_constraints',
  'reset_search_workspace',
  'pin_candidate',
  'compare_candidates',
  'get_comparison_facts',
  'get_property_evidence_gaps',
])

export function validateWebMcpTools(tools = []) {
  const names = tools.map((tool) => tool?.name)
  const unique = new Set(names)
  const missing = WEBMCP_TOOL_NAMES.filter((name) => !unique.has(name))
  const unexpected = names.filter((name) => !WEBMCP_TOOL_NAMES.includes(name))
  if (unique.size !== names.length || missing.length || unexpected.length) {
    throw new Error(`Invalid WebMCP tool contract: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`)
  }
  return tools
}
