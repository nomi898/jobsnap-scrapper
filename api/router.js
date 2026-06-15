import {
  handleCronFetchJobs,
  handleEnrichCompanySize,
  handleFetchJobDetails,
  handleFetchJobs,
  handleGetJobs,
  handleGetSettings,
  handleHealth,
  handleLinkedInAccess,
  handlePostSettings,
} from './server/handlers.js'

/** @typedef {'none' | 'cron' | 'site'} ApiAuth */

/**
 * @type {Array<{
 *   method: string
 *   path: string
 *   auth: ApiAuth
 *   handler: (body?: unknown) => Promise<{ status: number, data: unknown }>
 * }>}
 */
export const API_ROUTES = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'none',
    handler: () => handleHealth(),
  },
  {
    method: 'POST',
    path: '/api/cron/fetch-jobs',
    auth: 'cron',
    handler: () => handleCronFetchJobs(),
  },
  {
    method: 'GET',
    path: '/api/jobs',
    auth: 'site',
    handler: () => handleGetJobs(),
  },
  {
    method: 'GET',
    path: '/api/settings',
    auth: 'site',
    handler: () => handleGetSettings(),
  },
  {
    method: 'POST',
    path: '/api/settings',
    auth: 'site',
    handler: (body) => handlePostSettings(body),
  },
  {
    method: 'POST',
    path: '/api/linkedin-access',
    auth: 'site',
    handler: (body) => handleLinkedInAccess(body),
  },
  {
    method: 'POST',
    path: '/api/enrich-company-size',
    auth: 'site',
    handler: (body) => handleEnrichCompanySize(body),
  },
  {
    method: 'POST',
    path: '/api/fetch-job-details',
    auth: 'site',
    handler: (body) => handleFetchJobDetails(body),
  },
  {
    method: 'POST',
    path: '/api/fetch-jobs',
    auth: 'site',
    handler: (body) => handleFetchJobs(body),
  },
]

export function resolveApiPath(pathname) {
  const normalized = String(pathname ?? '')
    .split('?')[0]
    .replace(/\/+$/, '')
  return normalized || '/'
}

export function matchApiRoute(method, pathname) {
  const path = resolveApiPath(pathname)
  return API_ROUTES.find(
    (route) => route.method === method && route.path === path
  )
}

export async function handleApiRequest({ method, path, body }) {
  const route = matchApiRoute(method, path)
  if (!route) {
    return { status: 404, data: { error: 'Not found' } }
  }

  try {
    return await route.handler(body)
  } catch (err) {
    return {
      status: 500,
      data: {
        error: 'Request failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
    }
  }
}
