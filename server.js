import { createApp } from './backend/server/createApp.js'

const port = Number(process.env.PORT) || 3000
const app = createApp()

app.listen(port, () => {
  console.log(`JobSnap server listening on http://localhost:${port}`)
})
