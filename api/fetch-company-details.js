import { fetchCompanyDetailsForModal } from './fetch-job-details.js'
import { resolveRequestLiAtCookie } from './linkedinHttp.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body ?? {}
  const session = resolveRequestLiAtCookie(body.liAtCookie)
  const { status, data } = await fetchCompanyDetailsForModal({
    companyUrl: body.companyUrl,
    liAtCookie: session.cookie,
    fallbackCompany: body.fallbackCompany,
  })

  res.status(status).json(data)
}
