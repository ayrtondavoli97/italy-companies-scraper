/**
 * Aziende.it Scraper v10.1
 *
 * Scrapes Italian company listings from aziende.it by simple business category
 * names or direct category URLs. Optional detail scraping enriches each company
 * with fields discovered on the detail page.
 */

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

const BASE = 'https://www.aziende.it';
const DEFAULT_CATEGORY = 'informatica';
const DEFAULT_CATEGORY_URL = 'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.02.0';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    category = DEFAULT_CATEGORY,
    categories = [],
    startUrls = [],
    maxItems = 5000,
    maxPagesPerCategory = 200,
    includeDetails = true,
    debug = false,
    proxyConfig: proxyConfigInput,
} = input;

const CATEGORY_PRESETS = {
    informatica: [
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.02.0',
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.01.0',
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/63/63.11.1',
    ],
    software: [
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.01.0',
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.02.0',
    ],
    consulenza: [
        'https://www.aziende.it/categorie/servizi-di-informazione-e-comunicazione/62/62.02.0',
        'https://www.aziende.it/categorie/attivita-professionali-scientifiche-e-tecniche/70/70.22.0',
    ],
    marketing: [
        'https://www.aziende.it/categorie/attivita-professionali-scientifiche-e-tecniche/73/73.11.0',
        'https://www.aziende.it/categorie/attivita-professionali-scientifiche-e-tecniche/73/73.12.0',
    ],
    alimentare: [
        'https://www.aziende.it/categorie/industrie-alimentari/10/10.89.0',
        'https://www.aziende.it/categorie/industrie-alimentari/10/10.85.0',
        'https://www.aziende.it/categorie/commercio-all-ingrosso-e-al-dettaglio/46/46.38.0',
    ],
    tessile: [
        'https://www.aziende.it/categorie/industrie-tessili/13/13.20.0',
        'https://www.aziende.it/categorie/confezione-di-articoli-di-abbigliamento/14/14.13.0',
        'https://www.aziende.it/categorie/commercio-all-ingrosso-e-al-dettaglio/46/46.41.0',
    ],
    edilizia: [
        'https://www.aziende.it/categorie/costruzioni/41/41.20.0',
        'https://www.aziende.it/categorie/costruzioni/43/43.21.0',
        'https://www.aziende.it/categorie/costruzioni/43/43.22.0',
    ],
    immobiliare: [
        'https://www.aziende.it/categorie/attivita-immobiliari/68/68.31.0',
        'https://www.aziende.it/categorie/attivita-immobiliari/68/68.20.0',
    ],
    ristorazione: [
        'https://www.aziende.it/categorie/attivita-dei-servizi-di-alloggio-e-di-ristorazione/56/56.10.1',
        'https://www.aziende.it/categorie/attivita-dei-servizi-di-alloggio-e-di-ristorazione/56/56.30.0',
    ],
    trasporti: [
        'https://www.aziende.it/categorie/trasporto-e-magazzinaggio/49/49.41.0',
        'https://www.aziende.it/categorie/trasporto-e-magazzinaggio/52/52.29.2',
    ],
    turismo: [
        'https://www.aziende.it/categorie/attivita-dei-servizi-di-alloggio-e-di-ristorazione/55/55.10.0',
        'https://www.aziende.it/categorie/noleggio-agenzie-di-viaggio-servizi-di-supporto-alle-imprese/79/79.11.0',
    ],
    meccanica: [
        'https://www.aziende.it/categorie/fabbricazione-di-macchinari-ed-apparecchiature-nca/28/28.29.9',
        'https://www.aziende.it/categorie/fabbricazione-di-prodotti-in-metallo/25/25.62.0',
    ],
};

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
    return normalizeText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

function resolveCategoryUrls() {
    const directUrls = asArray(startUrls).map(u => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
    const categoryNames = [...asArray(category), ...asArray(categories)].map(normalizeKey).filter(Boolean);
    const resolved = [];

    for (const name of categoryNames.length ? categoryNames : [DEFAULT_CATEGORY]) {
        if (/^https?:\/\//i.test(name)) {
            resolved.push(name);
        } else if (CATEGORY_PRESETS[name]) {
            resolved.push(...CATEGORY_PRESETS[name]);
        } else {
            console.warn(`Categoria "${name}" non riconosciuta. Uso fallback informatica. Valori supportati: ${Object.keys(CATEGORY_PRESETS).join(', ')}`);
            resolved.push(DEFAULT_CATEGORY_URL);
        }
    }

    return [...new Set([...directUrls, ...resolved])];
}

const urls = resolveCategoryUrls();
if (urls.length === 0) {
    console.error('Nessuna categoria valida. Inserisci category, categories o startUrls.');
    await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput ? await Actor.createProxyConfiguration(proxyConfigInput) : undefined;
console.log(`Categorie URL: ${urls.length} | maxItems=${maxItems} | maxPagesPerCategory=${maxPagesPerCategory} | includeDetails=${includeDetails}`);

let savedItems = 0;
let scheduledDetails = 0;
const seenListingUrls = new Set();
const seenDetailUrls = new Set();

function outputBudgetUsed() {
    return savedItems + scheduledDetails;
}

function withPage(rawUrl, n) {
    const u = new URL(rawUrl);
    u.searchParams.set('pag', String(n));
    return u.toString();
}

const NON_COMPANY = /^\/(categorie|ateco|localita|fatturato|elenco|servizi|blog|about|login|p|down_loads|noRegistrazione|img|download)\b/i;
function isCompanyHref(href) {
    if (!href) return false;
    if (/^https?:\/\//i.test(href) && !href.startsWith(BASE)) return false;
    const path = href.replace(BASE, '');
    if (!path.startsWith('/')) return false;
    if (NON_COMPANY.test(path)) return false;
    return /^\/[a-z0-9][a-z0-9-]+\/?$/i.test(path.split('?')[0]);
}

function normalizeUrl(href) {
    if (!href) return '';
    return href.startsWith('http') ? href : `${BASE}${href}`;
}

function parseRevenueRange(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text || /non\s+pervenuto/i.test(text)) return { fatturatoMinEur: null, fatturatoMaxEur: null };
    const nums = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => Number(m[0].replace(',', '.')));
    const mult = text.includes('miliard') ? 1_000_000_000 : text.includes('milion') ? 1_000_000 : 1;
    if (nums.length >= 2) return { fatturatoMinEur: Math.round(nums[0] * mult), fatturatoMaxEur: Math.round(nums[1] * mult) };
    if (nums.length === 1 && /oltre|piu|superiore|>/i.test(text)) return { fatturatoMinEur: Math.round(nums[0] * mult), fatturatoMaxEur: null };
    if (nums.length === 1) return { fatturatoMinEur: null, fatturatoMaxEur: Math.round(nums[0] * mult) };
    return { fatturatoMinEur: null, fatturatoMaxEur: null };
}

function parseRows($, categoria) {
    const out = [];
    $('div.row.border-bottom').each((_, row) => {
        const $row = $(row);
        const cols = $row.children('div');
        if (cols.length < 5) return;
        const $a = $row.find('a').filter((__, a) => isCompanyHref($(a).attr('href'))).first();
        if ($a.length === 0) return;
        const ragioneSociale = normalizeText($a.text());
        if (!ragioneSociale || ragioneSociale.length < 2) return;
        const txt = i => normalizeText($(cols[i]).text());
        const fatturato = txt(1);
        out.push({
            ragioneSociale,
            fatturato,
            ...parseRevenueRange(fatturato),
            ateco: txt(2),
            provincia: txt(3),
            citta: txt(4),
            categoria,
            detailUrl: normalizeUrl($a.attr('href')),
        });
    });
    return out;
}

function pickByRegex(text, regex, group = 1) {
    const match = text.match(regex);
    return normalizeText(match?.[group] ?? '');
}

function collectLabelValues($) {
    const pairs = [];
    const selectors = 'tr, li, p, div.row, div[class*="row"], div[class*="col"], dt, dd';
    $(selectors).each((_, el) => {
        const $el = $(el);
        const text = normalizeText($el.text());
        if (!text || text.length > 500) return;

        const split = text.match(/^([^:]{2,80})\s*[:\-]\s*(.{1,350})$/);
        if (split) pairs.push({ label: normalizeKey(split[1]), value: normalizeText(split[2]) });

        const strong = normalizeText($el.find('strong,b,label,dt').first().text());
        if (strong) {
            const value = normalizeText(text.replace(strong, ''));
            if (value) pairs.push({ label: normalizeKey(strong), value });
        }

        if ($el.is('dt')) {
            const value = normalizeText($el.next('dd').text());
            if (value) pairs.push({ label: normalizeKey(text), value });
        }
    });
    return pairs;
}

function findLabel(pairs, labels) {
    const wanted = labels.map(normalizeKey);
    const hit = pairs.find(p => wanted.some(label => p.label === label || p.label.includes(label)));
    return normalizeText(hit?.value ?? '');
}

function isValidEmail(email) {
    if (!email) return false;
    const e = normalizeText(email).toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e)) return false;
    return !/(^|@|\.)aziende\.it$|(^|@|\.)adintend\.com$/i.test(e);
}

function cleanEmail(value) {
    const match = normalizeText(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = match?.[0] || '';
    return isValidEmail(email) ? email : null;
}

function cleanWebsite(value) {
    const raw = normalizeText(value);
    if (!raw) return null;
    try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        const host = u.hostname.replace(/^www\./i, '').toLowerCase();
        if (host === 'aziende.it' || host.endsWith('.aziende.it') || host === 'adintend.com' || host.endsWith('.adintend.com')) return null;
        if (['google.com', 'facebook.com', 'linkedin.com', 'instagram.com'].some(d => host === d || host.endsWith(`.${d}`))) return null;
        return u.toString();
    } catch {
        return null;
    }
}

function cleanPhone(value, partitaIva = '') {
    const raw = normalizeText(value);
    if (!raw) return null;
    const match = raw.match(/(?:\+39\s*)?(?:0\d{1,4}[\s./-]?\d{5,8}|3\d{2}[\s./-]?\d{6,7})/);
    if (!match) return null;
    const phone = normalizeText(match[0]);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 13) return null;
    if (partitaIva && digits.endsWith(partitaIva.replace(/\D/g, ''))) return null;
    return phone;
}

function extractCapFromAddress(indirizzo) {
    const match = normalizeText(indirizzo).match(/(?:^|[,\s])(\d{5})(?:[,\s]|$)/);
    return match?.[1] || null;
}

function parseJsonLd($) {
    const result = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).text();
        try {
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                if (item.name && !result.ragioneSociale) result.ragioneSociale = normalizeText(item.name);
                if (item.url && !result.sitoWeb) result.sitoWeb = cleanWebsite(item.url);
                if (item.email && !result.email) result.email = cleanEmail(item.email);
                if (item.telephone && !result.telefono) result.telefono = cleanPhone(item.telephone);
                if (item.address) {
                    const address = typeof item.address === 'string'
                        ? item.address
                        : [item.address.streetAddress, item.address.postalCode, item.address.addressLocality, item.address.addressRegion].filter(Boolean).join(', ');
                    if (address && !result.indirizzo) result.indirizzo = normalizeText(address);
                }
            }
        } catch {
            // Ignore malformed JSON-LD blocks.
        }
    });
    return result;
}

function parseDetail($, body) {
    const text = normalizeText(typeof body === 'string' ? body : body.toString());
    const pairs = collectLabelValues($);
    const jsonLd = parseJsonLd($);

    const partitaIvaRaw = findLabel(pairs, ['Partita IVA', 'P IVA', 'P.IVA'])
        || pickByRegex(text, /(?:Partita\s*IVA|P\.?\s*IVA)\s*[:\-]?\s*(\d{11})/i);
    const partitaIva = partitaIvaRaw.replace(/\D/g, '').slice(0, 11) || null;

    const codiceFiscaleRaw = findLabel(pairs, ['Codice fiscale', 'C F', 'C.F.'])
        || pickByRegex(text, /(?:Codice\s*fiscale|C\.?\s*F\.?)\s*[:\-]?\s*([A-Z0-9]{11,16})/i);

    const indirizzo = jsonLd.indirizzo || findLabel(pairs, ['Sede legale', 'Indirizzo', 'Sede']) || null;
    const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])].filter(isValidEmail);
    const pec = emails.find(e => /pec|legalmail|postacert|cert/i.test(e)) || null;
    const email = jsonLd.email || cleanEmail(findLabel(pairs, ['Email', 'E-mail'])) || emails.find(e => e !== pec) || null;

    const websiteHref = $('a[href^="http"]').map((_, a) => $(a).attr('href')).get().map(cleanWebsite).find(Boolean) || null;
    const sitoWeb = jsonLd.sitoWeb || cleanWebsite(findLabel(pairs, ['Sito web', 'Website'])) || websiteHref;
    const telefono = cleanPhone(jsonLd.telefono || findLabel(pairs, ['Telefono', 'Tel']) || pickByRegex(text, /(?:Telefono|Tel\.?)\s*[:\-]?\s*([+]?\d[\d\s()./-]{5,})/i), partitaIva);

    return {
        partitaIva,
        codiceFiscale: codiceFiscaleRaw || null,
        rea: findLabel(pairs, ['REA', 'Numero REA', 'Repertorio economico amministrativo'])
            || pickByRegex(text, /(?:\bREA\b|Numero\s*REA)\s*[:\-]?\s*([A-Z]{2}\s*[-/]?\s*\d+|\d{3,})/i) || null,
        indirizzo,
        cap: extractCapFromAddress(indirizzo),
        telefono,
        email,
        pec,
        sitoWeb,
        formaGiuridica: findLabel(pairs, ['Forma giuridica', 'Natura giuridica']) || null,
        statoAttivita: findLabel(pairs, ['Stato attivita', 'Stato attività', 'Stato']) || null,
        dipendenti: findLabel(pairs, ['Dipendenti', 'Numero dipendenti', 'Addetti']) || null,
        dataCostituzione: findLabel(pairs, ['Data costituzione', 'Anno fondazione', 'Data iscrizione']) || null,
    };
}

async function pushCompany(record) {
    if (savedItems >= maxItems) return;
    await Dataset.pushData(record);
    savedItems++;
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    maxConcurrency: includeDetails ? 6 : 4,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...request.headers,
                'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (compatible; ItalyCompaniesScraper/10.1; +https://apify.com/)'
            };
        },
    ],

    async requestHandler({ $, request, body, log, addRequests }) {
        const { label } = request.userData;

        if (label === 'DETAIL') {
            scheduledDetails = Math.max(0, scheduledDetails - 1);
            const base = request.userData.company ?? {};
            const detail = parseDetail($, body);
            await pushCompany({ ...base, ...detail, detailScraped: true });
            return;
        }

        const { categoryUrl, pageNum } = request.userData;

        if (debug && pageNum === 1) {
            const html = typeof body === 'string' ? body : body.toString();
            const safe = (categoryUrl.split('/').pop() || 'cat').replace(/[^\w.-]/g, '_');
            await Actor.setValue(`category_${safe}_p1.html`, html, { contentType: 'text/html; charset=utf-8' });
        }

        let categoria = '';
        $('h1, .breadcrumb li, ol.breadcrumb li').each((_, el) => {
            const t = normalizeText($(el).text());
            if (t && t.length > categoria.length && t.length < 120 && !/aziende con codice/i.test(t)) categoria = t;
        });

        if (pageNum === 1) {
            const m = (typeof body === 'string' ? body : body.toString()).match(/Totale risultati:\s*([\d.]+)/i);
            log.info(`[${categoryUrl}] Totale risultati: ${m ? m[1] : '?'}`);
        }

        const rows = parseRows($, categoria);
        log.info(`[p${pageNum}] parsed ${rows.length} rows (saved=${savedItems}, queuedDetails=${scheduledDetails}) — ${categoryUrl}`);

        const detailRequests = [];
        for (const row of rows) {
            if (outputBudgetUsed() >= maxItems) break;
            if (seenListingUrls.has(row.detailUrl)) continue;
            seenListingUrls.add(row.detailUrl);

            if (includeDetails) {
                if (seenDetailUrls.has(row.detailUrl)) continue;
                seenDetailUrls.add(row.detailUrl);
                scheduledDetails++;
                detailRequests.push({
                    url: row.detailUrl,
                    userData: { label: 'DETAIL', company: row },
                    uniqueKey: `detail::${row.detailUrl}`,
                });
            } else {
                await pushCompany({ ...row, detailScraped: false });
            }
        }

        if (detailRequests.length) await addRequests(detailRequests);

        if (outputBudgetUsed() >= maxItems) { log.info('maxItems reached.'); return; }
        if (rows.length === 0) { log.info(`[${categoryUrl}] no rows on p${pageNum} — end.`); return; }
        if (pageNum >= maxPagesPerCategory) { log.info(`[${categoryUrl}] maxPagesPerCategory reached.`); return; }

        await addRequests([{
            url: withPage(categoryUrl, pageNum + 1),
            userData: { label: 'CATEGORY', categoryUrl, pageNum: pageNum + 1 },
            uniqueKey: `${categoryUrl}::pag=${pageNum + 1}`,
        }]);
    },

    async failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
        if (request.userData?.label === 'DETAIL' && request.userData?.company) {
            scheduledDetails = Math.max(0, scheduledDetails - 1);
            await pushCompany({ ...request.userData.company, detailScraped: false, detailError: request.errorMessages?.join(' | ') || 'Detail request failed' });
        }
    },
});

const startRequests = urls.map(u => ({
    url: withPage(u, 1),
    userData: { label: 'CATEGORY', categoryUrl: u, pageNum: 1 },
    uniqueKey: `${u}::pag=1`,
}));

await crawler.run(startRequests);
console.log(`Done. Total saved: ${savedItems} companies.`);
await Actor.exit();
