import { enrichJobsWithCompanySize } from './companySize.js'
import { resolveRequestLiAtCookie } from './linkedinHttp.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body ?? {}
  const jobs = Array.isArray(body.jobs) ? body.jobs : []
  const session = resolveRequestLiAtCookie(body.liAtCookie)

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const writeEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  try {
    const { jobs: enriched, enrichment } = await enrichJobsWithCompanySize(
      jobs,
      session.cookie,
      (update) => writeEvent({ ...update, phase: 'enriching' })
    )

    writeEvent({ done: true, jobs: enriched, enrichment })
  } catch (err) {
    writeEvent({
      error: 'Company size enrichment failed',
      details: err instanceof Error ? err.message : 'Unknown error',
    })
  } finally {
    res.end()
  }
}
