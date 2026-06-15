import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleApiRequest, matchApiRoute, resolveApiPath } from './backend/router.js'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function scraperApiPlugin() {
  return {
    name: 'scraper-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }

        const url = new URL(req.url, 'http://localhost')
        const path = resolveApiPath(url.pathname)
        const route = matchApiRoute(req.method ?? 'GET', path)
        if (!route) {
          next()
          return
        }

        try {
          let body = {}
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const raw = await readRequestBody(req)
            body = raw ? JSON.parse(raw) : {}
          }

          const result = await handleApiRequest({
            method: req.method ?? 'GET',
            path,
            body,
          })

          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.data))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'API request failed',
              details: err instanceof Error ? err.message : 'Unknown error',
            })
          )
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), scraperApiPlugin()],
})
