import test from 'node:test'
import assert from 'node:assert/strict'
import { WEBMCP_TOOL_NAMES, validateWebMcpTools } from '../src/domain/webmcpContract.js'

test('WebMCP 公開契約包含完整搜尋、載入全部、決策保護與比較工具', () => {
  assert.equal(WEBMCP_TOOL_NAMES.length, 19)
  assert.equal(new Set(WEBMCP_TOOL_NAMES).size, WEBMCP_TOOL_NAMES.length)
  for (const name of ['search_public_properties', 'load_all_property_results', 'preview_constraint_change', 'pin_candidate', 'compare_candidates']) {
    assert.equal(WEBMCP_TOOL_NAMES.includes(name), true)
  }
})

test('WebMCP 工具註冊前會拒絕缺漏、重複或未定義工具', () => {
  const valid = WEBMCP_TOOL_NAMES.map((name) => ({ name }))
  assert.equal(validateWebMcpTools(valid), valid)
  assert.throws(() => validateWebMcpTools(valid.slice(1)), /missing=get_decision_state/u)
  assert.throws(() => validateWebMcpTools([...valid, { name: valid[0].name }]), /Invalid WebMCP tool contract/u)
  assert.throws(() => validateWebMcpTools([...valid, { name: 'unknown_tool' }]), /unexpected=unknown_tool/u)
})
