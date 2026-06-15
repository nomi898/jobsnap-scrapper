import {
  checkCronSecret,
  checkSitePassword,
} from './server/auth.js'
import { handleApiRequest, matchApiRoute, resolveApiPath } from './router.js'

function resolveRequestPath(req) {
  const queryPath = req.query?.path
  if (queryPath != null && queryPath !== '') {
    const segments = Array.isArray(queryPath) ? queryPath : [queryPath]
    return resolveApiPath(`/api/${segments.join('/')}`)
  }

  const url = req.url ?? '/'
  const pathname = url.includes('?') ? url.slice(0, url.indexOf('?')) : url
  return resolveApiPath(pathname)
}

function sendJson(res, status, data) {
  res.status(status).json(data)
}

export default async function handler(req, res) {
  const method = req.method ?? 'GET'
  const path = resolveRequestPath(req)
  const route = matchApiRoute(method, path)

  if (!route) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  if (route.auth === 'cron') {
    const cronAuth = checkCronSecret(req)
    if (!cronAuth.ok) {
      sendJson(res, cronAuth.status, cronAuth.data)
      return
    }
  } else if (route.auth === 'site') {
    const siteAuth = checkSitePassword(req)
    if (!siteAuth.ok) {
      if (siteAuth.wwwAuthenticate) {
        res.setHeader('WWW-Authenticate', siteAuth.wwwAuthenticate)
      }
      res.status(siteAuth.status).send(siteAuth.data)
      return
    }
  }

  const result = await handleApiRequest({
    method,
    path,
    body: req.body,
  })

  sendJson(res, result.status, result.data)
}
