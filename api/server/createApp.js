import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireCronSecret, requireSitePassword } from './auth.js'
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
} from './handlers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '../../dist')

function sendHandler(res, result) {
  res.status(result.status).json(result.data)
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req.body)
      sendHandler(res, result)
    } catch (err) {
      res.status(500).json({
        error: 'Request failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '12mb' }))

  app.get('/api/health', async (_req, res) => {
    sendHandler(res, await handleHealth())
  })

  app.post('/api/cron/fetch-jobs', requireCronSecret, async (_req, res) => {
    try {
      sendHandler(res, await handleCronFetchJobs())
    } catch (err) {
      res.status(500).json({
        error: 'Cron scrape failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })

  app.use(requireSitePassword)

  app.get('/api/jobs', async (_req, res) => {
    try {
      sendHandler(res, await handleGetJobs())
    } catch (err) {
      res.status(500).json({
        error: 'Failed to load jobs',
        details: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })

  app.get('/api/settings', async (_req, res) => {
    try {
      sendHandler(res, await handleGetSettings())
    } catch (err) {
      res.status(500).json({
        error: 'Failed to load settings',
        details: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })

  app.post('/api/settings', asyncRoute((body) => handlePostSettings(body)))
  app.post('/api/linkedin-access', asyncRoute((body) => handleLinkedInAccess(body)))
  app.post('/api/enrich-company-size', asyncRoute((body) => handleEnrichCompanySize(body)))
  app.post('/api/fetch-job-details', asyncRoute((body) => handleFetchJobDetails(body)))
  app.post('/api/fetch-jobs', asyncRoute((body) => handleFetchJobs(body)))

  app.use(express.static(DIST_DIR, { index: false }))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })

  return app
}
