# Italian Company Data Scraper

Extract structured Italian company data from aziende.it by business category.

This Actor is built for users who need clean Italian business datasets for market research, B2B research, CRM preparation, territory mapping, competitive intelligence, SEO analysis, supplier discovery, investment scouting, and BI or AI data workflows.

The default mode is fast and lightweight. It collects company listing data such as company name, revenue range, ATECO code, province, city and source detail URL. An optional details mode opens each company page and enriches the dataset with VAT number, address, postal code and employee range when available.

## What you can scrape

Validated categories currently supported:

- `informatica`
- `software`
- `consulenza`
- `marketing`
- `edilizia`
- `immobiliare`
- `turismo`
- `trasporti`

Categories such as food, textile, restaurants and mechanics were tested but are not exposed as validated presets yet because the tested source URLs returned no compatible rows. You can still use **Advanced category URLs** if you have a specific aziende.it category URL you want to scrape.

## Main use cases

- Build Italian company datasets by business sector
- Map companies by city, province, ATECO code or revenue range
- Prepare CRM imports before email/contact enrichment
- Identify companies in a target industry or region
- Analyze market density and regional business distribution
- Build lead research datasets without claiming direct email coverage
- Feed dashboards, spreadsheets, BI tools, data warehouses or AI workflows
- Research suppliers, competitors, agencies, transport companies, real estate firms or construction businesses

## Fast listing mode

By default, **Include company details** is disabled.

This mode is much faster because it only reads category listing pages.

Listing fields include:

- Company name
- Requested category
- Revenue range
- Parsed revenue minimum in EUR
- Parsed revenue maximum in EUR
- ATECO code
- Province
- City
- Source category label
- Company detail page URL
- Source category URL

Use this mode when you need thousands of records quickly.

## Optional full-detail mode

Enable **Include company details** when you need richer registry-style fields.

Full-detail enrichment can add:

- VAT number
- Address
- Postal code
- Employee range
- Tax code, when available
- REA registry number, when available
- Legal form, when available
- Activity status, when available
- Foundation date, when available

Full-detail mode is slower because each company requires an additional detail-page request.

Based on current tests, about **100 companies with details are pushed to the dataset in roughly 1 minute**. The exact speed depends on source response time, proxy performance and Apify runtime conditions.

For full-detail runs, increase the Actor timeout in **Run options**:

- 500 companies with details: use at least **900 seconds**
- 1,000 companies with details: use at least **1,800 seconds**
- 5,000 companies with details: use around **7,200 seconds**

For larger full-detail runs, increasing memory from 1 GB to 2 GB can be useful.

## Balanced multi-category runs

Use **Maximum results per category** when scraping multiple categories and you want a balanced dataset.

Example: if you select `software`, `marketing` and `edilizia`, and set:

```json
"maxItemsPerCategory": 1000
```

then the Actor will try to collect up to 1,000 companies per requested category, while still respecting the overall **Maximum results** limit.

Set **Maximum results per category** to `0` to disable category-level balancing and use only the global **Maximum results** limit.

## Input fields

### Business category

Main business category to scrape.

Validated values:

- `informatica`
- `software`
- `consulenza`
- `marketing`
- `edilizia`
- `immobiliare`
- `turismo`
- `trasporti`

### Additional categories

Optional extra categories to merge into the same dataset.

Example:

```json
["software", "consulenza", "marketing"]
```

### Maximum results per category

Optional category-level limit.

Use it when scraping more than one category and you want balanced results.

Examples:

- `0`: disabled
- `100`: up to 100 companies per category
- `1000`: up to 1,000 companies per category

### Maximum results

Overall maximum number of companies to save.

This always acts as a global safety cap.

### Include company details

Optional checkbox.

- Disabled: fast listing-only dataset
- Enabled: slower full-detail dataset with VAT number, address, postal code and employee range when available

### Try website contact enrichment

Advanced optional setting.

If a real company website is found, the Actor can try to inspect it for public contact data. This is slower and often returns few results because aziende.it rarely exposes company websites.

### Scrape all validated categories

Runs all validated preset categories.

Recommended only when you want a broad dataset. Use it with **Maximum results per category** to avoid one large category dominating the output.

### Advanced category URLs

Optional direct aziende.it category URLs for users who want to bypass the preset category mapping.

## Example: fast default run

```json
{
  "category": "informatica",
  "categories": ["software"],
  "maxItemsPerCategory": 0,
  "maxItems": 5000,
  "includeDetails": false,
  "includeWebsiteContacts": false,
  "proxyConfig": {
    "useApifyProxy": true
  }
}
```

## Example: balanced multi-category run

```json
{
  "category": "software",
  "categories": ["marketing", "edilizia", "immobiliare"],
  "maxItemsPerCategory": 1000,
  "maxItems": 4000,
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
  "category": "software",
  "categories": ["consulenza"],
  "maxItemsPerCategory": 250,
  "maxItems": 500,
  "includeDetails": true,
  "includeWebsiteContacts": false,
  "proxyConfig": {
    "useApifyProxy": true
  }
}
```

For this full-detail example, set the run timeout to at least 900 seconds.

## Output schema

The dataset table uses English labels for international buyers. Raw field keys are source-compatible and may use Italian names internally.

| Dataset label | Raw field | Mode | Description |
|---|---|---|---|
| Company name | `ragioneSociale` | Listing | Legal/company name |
| Requested category | `categoryKey` | Listing | User-selected/preset category key |
| Revenue range | `fatturato` | Listing | Revenue range from the source |
| Revenue min EUR | `fatturatoMinEur` | Listing | Parsed lower revenue estimate |
| Revenue max EUR | `fatturatoMaxEur` | Listing | Parsed upper revenue estimate |
| ATECO code | `ateco` | Listing | Italian business activity code |
| Province | `provincia` | Listing | Italian province |
| City | `citta` | Listing | City |
| Source category label | `categoria` | Listing | Category label shown by the source |
| Company detail page | `detailUrl` | Listing | Company detail page URL |
| VAT number | `partitaIva` | Details | Italian VAT number, when detail mode is enabled |
| Address | `indirizzo` | Details | Company address, when detail mode is enabled |
| Postal code | `cap` | Details | Italian postal code, when detail mode is enabled |
| Employees | `dipendenti` | Details | Employee range, when detail mode is enabled |
| Tax code | `codiceFiscale` | Details | Tax code, when available |
| REA | `rea` | Details | REA registry number, when available |
| Phone | `telefono` | Rare | Phone, rarely available from the source |
| Email | `email` | Rare | Email, rarely available from the source |
| PEC | `pec` | Rare | Certified email, rarely available from the source |
| Website | `sitoWeb` | Rare | Website, rarely available from the source |
| Legal form | `formaGiuridica` | Details | Legal form, when available |
| Activity status | `statoAttivita` | Details | Activity status, when available |
| Foundation date | `dataCostituzione` | Details | Foundation/incorporation date, when available |
| Source category URL | `sourceCategoryUrl` | Listing | aziende.it category URL used as source |
| Details included | `detailScraped` | System | Boolean flag indicating whether detail enrichment was performed |

## Important limitation about contacts

This Actor should be positioned as an **Italian company registry dataset scraper**, not as an email scraper.

azienda.it rarely exposes real email, PEC, phone or website fields on company detail pages. These fields are included in the output schema because they may appear in some cases, but they are often null.

For email, PEC, phone or website discovery at scale, use a separate contact-enrichment workflow after exporting this dataset.

## Performance guidance

Listing-only mode is the recommended default for large datasets.

Full-detail mode is useful when VAT number, address, postal code and employee range are required, but it is slower because every company requires an additional detail-page request.

Current tested speed for full-detail enrichment is roughly **100 enriched companies per minute pushed to the dataset**. For large full-detail runs, always increase timeout and monitor retries.

## Recommended positioning

Recommended product positioning:

> Extract structured Italian company data by validated business category, including company name, revenue range, ATECO code, location and optional VAT/address/employee enrichment.

Avoid positioning this Actor as:

> Italian business email scraper

The source is strong for company registry-style fields, not for contact emails.
