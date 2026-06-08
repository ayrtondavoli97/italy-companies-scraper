# Italy Companies Scraper

Apify actor for scraping Italian company registry-style data from aziende.it by simple business category.

## Current architecture

The actor uses a two-phase pipeline:

1. **Listing phase**
   - Collects company rows from category pages.
   - Extracts company name, revenue range, ATECO code, province, city and detail URL.
   - This phase is fast and bounded by `maxItems`.

2. **Detail phase**
   - Opens the collected company detail URLs.
   - Enriches records with VAT number, address, postal code, employees and other public fields when available.
   - This phase is naturally slower because each company requires one extra detail request.

## Recommended test input

```json
{
  "category": "informatica",
  "categories": ["software"],
  "dataDepth": "full",
  "maxItems": 500,
  "maxPagesPerCategory": 200,
  "includeWebsiteContacts": false,
  "listingConcurrency": 24,
  "detailConcurrency": 14,
  "listingMaxRequestsPerMinute": 240,
  "detailMaxRequestsPerMinute": 150,
  "debug": false,
  "proxyConfig": {
    "useApifyProxy": true
  },
  "startUrls": []
}
```

## Runtime defaults

Default run timeout is set in `.actor/actor.json`:

```json
{
  "defaultRunOptions": {
    "timeoutSecs": 900,
    "memoryMbytes": 1024
  }
}
```

For large production runs, increase timeout manually in Apify Run options. Suggested values:

- 500 full-detail records: 900 seconds
- 5,000 full-detail records: 7,200 seconds

## Notes

- `dataDepth: "listing"` is much faster but returns only listing data.
- `dataDepth: "full"` is slower but returns the useful registry fields.
- aziende.it rarely exposes real email, PEC, phone or website fields, so these values are often null.
- Core reliable fields are currently company name, VAT number, address, postal code, employees, ATECO, revenue range, province and city.
