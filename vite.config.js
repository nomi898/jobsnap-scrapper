import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { enrichJobsWithCompanySize } from './api/companySize.js'
import { fetchJobAndCompanyDetails } from './api/fetch-job-details.js'
import { getLinkedInAccessInfo } from './api/linkedin-access.js'
import { resolveRequestLiAtCookie } from './api/linkedinHttp.js'
import { scrapeJobs } from './api/scrapeJobs.js'

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
      server.middlewares.use('/api/linkedin-access', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readRequestBody(req)
          const body = raw ? JSON.parse(raw) : {}
          const info = getLinkedInAccessInfo(body.liAtCookie)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(info))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Could not resolve LinkedIn access mode',
              details: err instanceof Error ? err.message : 'Unknown error',
            })
          )
        }
      })

      server.middlewares.use('/api/enrich-company-size', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readRequestBody(req)
          const body = raw ? JSON.parse(raw) : {}
          const jobs = Array.isArray(body.jobs) ? body.jobs : []
          const session = resolveRequestLiAtCookie(body.liAtCookie)
          const { jobs: enriched, enrichment } = await enrichJobsWithCompanySize(
            jobs,
            session.cookie
          )

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ jobs: enriched, enrichment }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Company size enrichment failed',
              details: err instanceof Error ? err.message : 'Unknown error',
            })
          )
        }
      })

      server.middlewares.use('/api/fetch-job-details', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readRequestBody(req)
          const body = raw ? JSON.parse(raw) : {}
          const session = resolveRequestLiAtCookie(body.liAtCookie)
          const { status, data } = await fetchJobAndCompanyDetails({
            jobUrl: body.jobUrl ?? body.url,
            companyUrl: body.companyUrl,
            liAtCookie: session.cookie,
          })

          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Job details request failed',
              details: err instanceof Error ? err.message : 'Unknown error',
            })
          )
        }
      })

      server.middlewares.use('/api/fetch-jobs', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readRequestBody(req)
          const body = raw ? JSON.parse(raw) : {}
          const session = resolveRequestLiAtCookie(body.liAtCookie)
          const { status, data } = await scrapeJobs({
            keywords: body.keywords,
            startPage: body.startPage,
            startOffset: body.startOffset,
            dateFilter: body.dateFilter,
            geoId: body.geoId ?? '92000000',
            workTypeFilter: body.workTypeFilter ?? 'all',
            fetchCompanySize: body.fetchCompanySize !== false,
            liAtCookie: session.cookie,
            sessionSource: session.source,
          })

          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Scrape request failed',
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
