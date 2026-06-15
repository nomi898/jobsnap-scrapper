# JobSnap Scraper

A standalone fork of JobSnap that scrapes LinkedIn jobs via fast HTTP + HTML parsing (same approach as the n8n workflow) instead of headless Chrome.

The original **JobSnap** project (n8n webhook version) is unchanged at `../JobSnap`.

## Features

- Search multiple keywords with configurable pages per keyword
- Filter by region, date range, company, location, and keyword
- Track viewed and applied jobs locally in the browser
- Load more batches with pagination
- Optional LinkedIn authentication via `li_at` cookie

## Requirements

- Node.js 18+

## Setup

```bash
cd /Users/naumanzahidkhan/Downloads/JobSnap-Scraper
npm install
cp .env.example .env
```

Optionally set `LI_AT_COOKIE` in `.env` if anonymous scraping fails in your environment.

## Development

```bash
npm run dev
```

Open http://localhost:5173, configure keywords in **Settings**, then click **Fetch Jobs**.

## Settings

| Field | Description |
| --- | --- |
| Keywords | Comma-separated search terms |
| Pages per keyword | How many LinkedIn result pages to scrape per keyword (~25 jobs/page) |
| Job region | LinkedIn `geoId` used in the search URL |
| Scrape date range | How far back to search |
| li_at cookie | Optional LinkedIn session cookie |

## Deployment note

The scraper fetches public LinkedIn search pages over HTTP. Run locally or self-host with Node.js. Heavy rate limiting may still require waiting between fetches or setting an optional `li_at` cookie.

## Disclaimer

For personal or educational use only. Scraped data is publicly available on LinkedIn and remains owned by LinkedIn.
