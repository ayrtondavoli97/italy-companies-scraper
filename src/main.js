/**
 * Aziende.it Scraper v9
 * Source: aziende.it — public directory of Italian companies, organized by
 *         ATECO category. Server-rendered HTML, no captcha, no JS. Same
 *         underlying Registro Imprese data, on a far less defended site.
 *
 * Per category URL (e.g. /categorie/<sezione>/<div>/<code>) we paginate with
 * ?pag=N and extract one row per company:
 *   ragioneSociale, detailUrl, fatturato (band), ateco, provincia, citta
 *
 * Listing only for now; detailUrl is captured so a detail phase (P.IVA, REA,
 * address, PEC) can be added later. RECON: first page HTML dumped to KV Store
 * (debug=true) to confirm the table structure on the first run.
 */

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

const BASE = 'https://www.aziende.it';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrls = ['https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.02.0'],
    maxItems = 5000,
    maxPagesPerCategory = 10,
    debug = true,
    proxyConfig: proxyConfigInput,
} = input;

const urls = (Array.isArray(startUrls) ? startUrls : [startUrls])
    .map(u => (typeof u === 'string' ? u : u?.url))
    .filter(Boolean);
if (urls.length === 0) { console.error('Obbligatorio: almeno un URL in "startUrls".'); await Actor.exit(1); }

const proxyConfiguration = proxyConfigInput
    ? await Actor.createProxyConfiguration(proxyConfigInput)
    : undefined;

console.log(`Categorie: ${urls.length} | maxItems=${maxItems} | maxPagesPerCategory=${maxPagesPerCategory}`);

let collected = 0;
const seen = new Set();

// Append/replace the ?pag=N param on a category URL.
function withPage(rawUrl, n) {
    const u = new URL(rawUrl);
    u.searchParams.set('pag', String(n));
    return u.toString();
}

// Detail links are single-segment slugs (e.g. /parentesikuadra-s-r-l),
// not nav/section links.
const NON_COMPANY = /^\/(categorie|ateco|localita|fatturato|elenco|servizi|blog|about|login|p|down_loads|noRegistrazione|img|download)\b/i;
function isCompanyHref(href) {
    if (!href) return false;
    if (/^https?:\/\//i.test(href) && !href.startsWith(BASE)) return false;
    const path = href.replace(BASE, '');
    if (!path.startsWith('/')) return false;
    if (NON_COMPANY.test(path)) return false;
    // single path segment, slug-like
    return /^\/[a-z0-9][a-z0-9-]+\/?$/i.test(path.split('?')[0]);
}

function parseRows($, categoria) {
    const out = [];
    // Each company is a Bootstrap grid row: div.row.border-bottom with 5 col-* divs:
    // [0]=name(<a>), [1]=fatturato, [2]=ateco, [3]=provincia, [4]=citta
    $('div.row.border-bottom').each((_, row) => {
        const $row = $(row);
        const cols = $row.children('div');
        if (cols.length < 5) return;
        const $a = $row.find('a').filter((__, a) => isCompanyHref($(a).attr('href'))).first();
        if ($a.length === 0) return;
        const name = $a.text().replace(/\s+/g, ' ').trim();
        if (!name || name.length < 2) return;
        const txt = i => $(cols[i]).text().replace(/\s+/g, ' ').trim();
        const href = $a.attr('href');
        out.push({
            ragioneSociale: name,
            fatturato: txt(1),
            ateco: txt(2),
            provincia: txt(3),
            citta: txt(4),
            categoria,
            detailUrl: href.startsWith('http') ? href : `${BASE}${href}`,
        });
    });
    return out;
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    maxConcurrency: 4,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...request.headers,
                'Accept-Language': 'it-IT,it;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            };
        },
    ],

    async requestHandler({ $, request, body, log, addRequests }) {
        const { categoryUrl, pageNum } = request.userData;

        if (debug && pageNum === 1) {
            const html = typeof body === 'string' ? body : body.toString();
            const safe = (categoryUrl.split('/').pop() || 'cat').replace(/[^\w.-]/g, '_');
            await Actor.setValue(`page_${safe}_p1.html`, html, { contentType: 'text/html; charset=utf-8' });
        }

        // Category label (breadcrumb / heading) for traceability.
        let categoria = '';
        $('h1, .breadcrumb li, ol.breadcrumb li').each((_, el) => {
            const t = $(el).text().replace(/\s+/g, ' ').trim();
            if (t && t.length > categoria.length && t.length < 120 && !/aziende con codice/i.test(t)) categoria = t;
        });

        // Total results (page 1 only) — log it so we know the category size.
        if (pageNum === 1) {
            const m = (typeof body === 'string' ? body : body.toString()).match(/Totale risultati:\s*([\d.]+)/i);
            log.info(`[${categoryUrl}] Totale risultati: ${m ? m[1] : '?'}`);
        }

        const rows = parseRows($, categoria);
        log.info(`[p${pageNum}] parsed ${rows.length} rows (total ${collected}) — ${categoryUrl}`);

        for (const row of rows) {
            if (collected >= maxItems) break;
            if (seen.has(row.detailUrl)) continue;
            seen.add(row.detailUrl);
            await Dataset.pushData(row);
            collected++;
        }

        if (collected >= maxItems) { log.info('maxItems reached.'); return; }
        if (rows.length === 0) { log.info(`[${categoryUrl}] no rows on p${pageNum} — end.`); return; }
        if (pageNum >= maxPagesPerCategory) { log.info(`[${categoryUrl}] maxPagesPerCategory reached.`); return; }

        await addRequests([{
            url: withPage(categoryUrl, pageNum + 1),
            userData: { categoryUrl, pageNum: pageNum + 1 },
            uniqueKey: `${categoryUrl}::pag=${pageNum + 1}`,
        }]);
    },

    failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

const startRequests = urls.map(u => ({
    url: withPage(u, 1),
    userData: { categoryUrl: u, pageNum: 1 },
    uniqueKey: `${u}::pag=1`,
}));

await crawler.run(startRequests);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
