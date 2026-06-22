import { resolveRequestLiAtCookie } from './linkedinHttp.js'
import { scrapeJobs } from './scrapeJobs.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body ?? {}
  const session = resolveRequestLiAtCookie(body.liAtCookie)
  const { status, data } = await scrapeJobs({
    keywords: body.keywords,
    startPage: body.startPage,
    startOffset: body.startOffset,
    maxPages: body.maxPages,
    dateFilter: body.dateFilter,
    geoId: body.geoId ?? '92000000',
    workTypeFilter: body.workTypeFilter ?? 'all',
    fetchCompanySize: body.fetchCompanySize !== false,
    liAtCookie: session.cookie,
    sessionSource: session.source,
    scrapeRunId: body.scrapeRunId,
    pageIndex: body.pageIndex,
    previousKeyword: body.previousKeyword,
    keywordIndex: body.keywordIndex,
    keywordCount: body.keywordCount,
  })

  res.status(status).json(data)
}
