import { handleApi } from '../server.mjs'

export default async function handler(req, res) {
  const url = new URL(req.url || '/api/health', `https://${req.headers.host || 'localhost'}`)
  return handleApi(req, res, url)
}
