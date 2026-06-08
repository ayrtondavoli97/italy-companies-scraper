# Italy Companies Scraper

Build targeted datasets of Italian companies from aziende.it using simple business categories such as software, IT consulting, food, textile, construction, real estate, restaurants, transport, tourism and mechanics.

The Actor is designed for buyers who need structured Italian business data for market research, B2B prospecting preparation, competitive intelligence, local business analysis, data enrichment workflows, CRM seeding, territory mapping, SEO research, investment scouting or lead-list building before adding a separate contact-enrichment layer.

## What this Actor does

Italy Companies Scraper collects company records from Italian business category pages and exports them to an Apify dataset in a clean tabular format.

By default, the Actor runs in **fast listing mode**. This mode is optimized for speed and returns the fields available directly from category listing pages.

An optional checkbox, **Include company details**, enables a slower enrichment pass that opens each company detail page and adds registry-style fields such as VAT number, address, postal code and employee range when available.

## Default mode: fast listing dataset

The default run does **not** open every company detail page. This keeps runs fast and lightweight.

Default listing fields include:

- Company name
- Revenue range
- Revenue minimum estimate in EUR
- Revenue maximum estimate in EUR
- ATECO code
- Province
- City
- Source category
- Source detail page URL

Use this mode when you need thousands of Italian company records quickly.

## Optional full-detail mode

Enable **Include company details** when you need richer registry-style data.

Full-detail enrichment can add:

- VAT number
- Address
- Postal code
- Employee range
- Tax code, when available
- REA, when available
- Legal form, when available
- Activity status, when available
- Foundation date, when available

Based on current tests, about **100 companies with details are pushed to the dataset in roughly 1 minute**. The exact speed depends on source response time, proxy performance and Apify runtime conditions.

For full-detail runs, increase the Actor timeout in **Run options**:

- 500 companies with details: use at least **900 seconds**
- 1,000 companies with details: use at least **1,800 seconds**
- 5,000 companies with details: use around **7,200 seconds**

For larger full-detail runs, increase memory from 1 GB to 2 GB if needed.

## Category QA / preset validation mode

The Actor includes a testing mode to validate all preset categories before publishing or scaling a run.

Use **Test all preset categories** together with **Maximum results per category** set to `1` or `2`.

This mode is useful to check which category presets return valid company rows and which presets need to be replaced or removed.

Example QA input:

```json
{
  "allCategories": true,
  "maxItemsPerCategory": 2,
  "maxItems": 100,
  "includeDetails": false,
  "includeWebsiteContacts": false,
  "proxyConfig": {
    "useApifyProxy": true
  }
}
```

The Actor also writes a `category-summary.json` file to the key-value store. This summary reports each tested preset URL with:

- category key
- category URL
- parsed total results, when detected
- pages processed
- rows parsed
- records collected
- status (`quota_reached`, `valid_partial`, `empty_or_invalid`, or `pending`)

Use this QA output before deciding which categories should be exposed commercially.

## Important limitation about contacts

This Actor should be positioned as an **Italian companies registry dataset scraper**, not as an email lead scraper.

aziende.it rarely exposes real email, PEC, phone or website fields on company detail pages. These fields are included in the output schema because they may appear in some cases, but they are often null.

For email, PEC, phone or website discovery at scale, use a separate contact-enrichment workflow after exporting this dataset.

## Input fields

### Business category

Main business category to scrape.

Supported examples:

- `informatica`
- `software`
- `consulenza`
- `marketing`
- `alimentare`
- `tessile`
- `edilizia`
- `immobiliare`
- `ristorazione`
- `trasporti`
- `turismo`
- `meccanica`

### Additional categories

Optional list of extra categories to merge into the same dataset.

Example:

```json
["software", "consulenza"]
```

### Test all preset categories

QA/testing option. Runs all preset categories. Use this mainly while validating the Actor, not for normal production scraping.

### Maximum results per category

Optional category-level limit. Use `1` or `2` for quick validation runs. Leave it set to `0` for normal production scraping.

### Maximum results

Maximum number of companies to save overall.

### Include company details

Optional checkbox.

- Disabled: fast listing-only dataset
- Enabled: slower full-detail dataset with VAT number, address, postal code and employee range when available

### Try website contact enrichment

Advanced optional setting. If a company website is found, the Actor can try to inspect it for public contact data. This is usually slow and often returns few results because company websites are rarely exposed by the source.

### Advanced category URLs

Optional direct aziende.it category URLs for users who want to bypass the preset category mapping.

## Example: fast default run

```json
{
  "category": "informatica",
  "categories": ["software"],
  "maxItems": 5000,
  "includeDetails": false,
  "includeWebsiteContacts": false,
  "proxyConfig": {
    "useApifyProxy": true
  }
}
```

## Example: full-detail run

```json
{
  "category": "informatica",
  "categories": ["software"],
  "maxItems": 500,
  "includeDetails": true,
  "includeWebsiteContacts": false,
  "proxyConfig": {
    "useApifyProxy": true
  }
}
```

For this full-detail example, set the run timeout to at least 900 seconds.

## Output fields

The dataset table uses English labels for international buyers. Raw source-compatible field keys may still use Italian names internally.

| Dataset label | Raw field | Description |
|---|---|---|
| Company name | `ragioneSociale` | Legal/company name |
| Revenue range | `fatturato` | Revenue range from the source |
| Revenue min EUR | `fatturatoMinEur` | Parsed lower revenue estimate |
| Revenue max EUR | `fatturatoMaxEur` | Parsed upper revenue estimate |
| ATECO code | `ateco` | Italian business activity code |
| Province | `provincia` | Italian province |
| City | `citta` | City |
| Source category | `categoria` | Source category label |
| Source detail page | `detailUrl` | Company detail page URL |
| VAT number | `partitaIva` | Italian VAT number, detail mode |
| Address | `indirizzo` | Company address, detail mode |
| Postal code | `cap` | Italian postal code, detail mode |
| Employees | `dipendenti` | Employee range, detail mode |
| Tax code | `codiceFiscale` | Tax code, when available |
| REA | `rea` | REA registry number, when available |
| Phone | `telefono` | Phone, rarely available |
| Email | `email` | Email, rarely available |
| PEC | `pec` | Certified email, rarely available |
| Website | `sitoWeb` | Website, rarely available |
| Legal form | `formaGiuridica` | Legal form, when available |
| Activity status | `statoAttivita` | Activity status, when available |
| Foundation date | `dataCostituzione` | Foundation/incorporation date, when available |
| Details included | `detailScraped` | Boolean flag indicating whether detail enrichment was performed |

## Practical use cases

- Build a list of companies by Italian business sector
- Create market maps by city, province, category or ATECO code
- Estimate company size using revenue and employee ranges
- Prepare CRM imports before contact enrichment
- Analyze regional business density
- Source companies for B2B sales research
- Build datasets for AI, BI dashboards or business intelligence workflows
- Find companies in specific industries for partnership, investment or supplier research

## Performance guidance

Listing-only mode is much faster and is the recommended default for large datasets.

Full-detail mode is useful when VAT number, address, postal code and employee range are required, but it is slower because every company requires an additional detail-page request.

Current tested speed for full-detail enrichment is roughly **100 enriched companies per minute pushed to the dataset**. For large full-detail runs, always increase timeout and monitor retries.

## Recommended positioning

Recommended product positioning:

> Extract structured Italian company registry-style data by business category, including company name, revenue range, ATECO code, location and optional VAT/address/employee enrichment.

Avoid positioning this Actor as:

> Italian business email scraper

The source is strong for company registry-style fields, not for contact emails.
