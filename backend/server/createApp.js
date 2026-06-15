import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { API_ROUTES } from '../router.js'
import { requireCronSecret, requireSitePassword } from './auth.js'

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

function registerRoute(app, route, middlewares = []) {
  const method = route.method.toLowerCase()
  app[method](
    route.path,
    ...middlewares,
    asyncRoute((body) => route.handler(body))
  )
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '12mb' }))

  for (const route of API_ROUTES.filter((entry) => entry.auth === 'none')) {
    app[route.method.toLowerCase()](route.path, async (_req, res) => {
      try {
        sendHandler(res, await route.handler())
      } catch (err) {
        res.status(500).json({
          error: 'Request failed',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    })
  }

  for (const route of API_ROUTES.filter((entry) => entry.auth === 'cron')) {
    app[route.method.toLowerCase()](route.path, requireCronSecret, async (_req, res) => {
      try {
        sendHandler(res, await route.handler())
      } catch (err) {
        res.status(500).json({
          error: 'Cron scrape failed',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    })
  }

  app.use(requireSitePassword)

  for (const route of API_ROUTES.filter((entry) => entry.auth === 'site')) {
    registerRoute(app, route)
  }

  app.use(express.static(DIST_DIR, { index: false }))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })

  return app
}
