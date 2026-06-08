/**
 * Aziende.it Scraper v11.3.1
 *
 * Production mode:
 * - Fast listing by default.
 * - Optional details enrichment.
 *
 * Category QA mode:
 * - allCategories=true tests every preset category.
 * - maxItemsPerCategory limits records per category, useful for validating presets.
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
    allCategories = false,
    maxItemsPerCategory = null,
    startUrls = [],
    maxItems = 5000,
    maxPagesPerCategory = 200,
    includeDetails = false,
    includeWebsiteContacts = false,
    dataDepth: rawDataDepth,
    listingConcurrency = 24,
    detailConcurrency = 16,
    listingMaxRequestsPerMinute = 240,
    detailMaxRequestsPerMinute = 170,
    debug = false,
    proxyConfig: proxyConfigInput,
} = input;

const dataDepth = rawDataDepth || (includeDetails ? 'full' : 'listing');
const shouldScrapeDetails = dataDepth !== 'listing';
const perCategoryLimit = Number(maxItemsPerCategory) > 0 ? Number(maxItemsPerCategory) : null;
const categoryQuotaMode = Boolean(perCategoryLimit);

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

const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeKey = value => normalizeText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const asArray = value => Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]);

function resolveCategoryTargets() {
    const directUrls = asArray(startUrls).map((u, i) => {
        const url = typeof u === 'string' ? u : u?.url;
        return url ? { categoryKey: `custom-${i + 1}`, url } : null;
    }).filter(Boolean);

    const names = allCategories
        ? Object.keys(CATEGORY_PRESETS)
        : [...asArray(category), ...asArray(categories)].map(normalizeKey).filter(Boolean);

    const targets = [];
    for (const name of names.length ? names : [DEFAULT_CATEGORY]) {
        if (/^https?:\/\//i.test(name)) {
            targets.push({ categoryKey: 'custom', url: name });
        } else if (CATEGORY_PRESETS[name]) {
            CATEGORY_PRESETS[name].forEach(url => targets.push({ categoryKey: name, url }));
        } else {
            console.warn(`Category "${name}" is not recognized. Falling back to informatica. Supported values: ${Object.keys(CATEGORY_PRESETS).join(', ')}`);
            targets.push({ categoryKey: DEFAULT_CATEGORY, url: DEFAULT_CATEGORY_URL });
        }
    }

    const seen = new Set();
    return [...directUrls, ...targets].filter(t => {
        const key = `${t.categoryKey}::${t.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

const categoryTargets = resolveCategoryTargets();
if (!categoryTargets.length) {
    console.error('No valid category URL. Provide category, categories, allCategories, or startUrls.');
    await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput ? await Actor.createProxyConfiguration(proxyConfigInput) : undefined;
console.log(`Mode=${dataDepth} | allCategories=${allCategories} | categoryTargets=${categoryTargets.length} | maxItems=${maxItems} | maxItemsPerCategory=${perCategoryLimit ?? 'off'} | maxPagesPerCategory=${maxPagesPerCategory} | listingConcurrency=${listingConcurrency} | detailConcurrency=${detailConcurrency} | listingRPM=${listingMaxRequestsPerMinute} | detailRPM=${detailMaxRequestsPerMinute} | includeWebsiteContacts=${includeWebsiteContacts}`);

function withPage(rawUrl, n) {
    const u = new URL(rawUrl);
    u.searchParams.set('pag', String(n));
    return u.toString();
}

function parseTotalResults(body) {
    const html = typeof body === 'string' ? body : body.toString();
    const match = html.match(/Totale risultati:\s*([\d.]+)/i);
    return match ? Number(match[1].replace(/\./g, '')) || null : null;
}

function calculatePageLimit(totalResults, targetCount) {
    const totalPages = totalResults ? Math.ceil(totalResults / 25) : maxPagesPerCategory;
    const needed = targetCount ? Math.ceil(targetCount / 25) + 1 : Math.ceil(maxItems / Math.max(1, categoryTargets.length) / 25) + 3;
    return Math.max(1, Math.min(maxPagesPerCategory, totalPages, needed));
}

function normalizeUrl(href, base = BASE) {
    try { return href ? new URL(href, base).toString() : ''; }
    catch { return ''; }
}

const NON_COMPANY = /^\/(categorie|ateco|localita|fatturato|elenco|servizi|blog|about|login|p|down_loads|noRegistrazione|img|download)\b/i;
function isCompanyHref(href) {
    if (!href) return false;
    if (/^https?:\/\//i.test(href) && !href.startsWith(BASE)) return false;
    const path = href.replace(BASE, '');
    return path.startsWith('/') && !NON_COMPANY.test(path) && /^\/[a-z0-9][a-z0-9-]+\/?$/i.test(path.split('?')[0]);
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
        if (!$a.length) return;
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
    $('tr, li, p, div.row, div[class*="row"], div[class*="col"], dt, dd').each((_, el) => {
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
    if (/(^|@|\.)aziende\.it$|(^|@|\.)adintend\.com$/i.test(e)) return false;
    if (/^(privacy|cookie|noreply|no-reply|newsletter|abuse|postmaster)@/i.test(e)) return false;
    return true;
}

function extractEmailsFromText(value) {
    const raw = normalizeText(value)
        .replace(/\s*\[at\]\s*|\s*\(at\)\s*|\s+at\s+/gi, '@')
        .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*|\s+dot\s+/gi, '.')
        .replace(/\s*@\s*/g, '@')
        .replace(/\s*\.\s*/g, '.');
    return [...new Set(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])].filter(isValidEmail);
}

const cleanEmail = value => extractEmailsFromText(value)[0] || null;

function decodeCloudflareEmail(encoded) {
    if (!encoded || !/^[a-f0-9]+$/i.test(encoded) || encoded.length < 4) return null;
    const key = parseInt(encoded.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < encoded.length; i += 2) out += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ key);
    return isValidEmail(out) ? out : null;
}

function cleanWebsite(value, baseUrl = '') {
    const raw = normalizeText(value);
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null;
    try {
        const u = new URL(raw, baseUrl || undefined);
        if (!/^https?:$/i.test(u.protocol)) return null;
        const host = u.hostname.replace(/^www\./i, '').toLowerCase();
        if (host === 'aziende.it' || host.endsWith('.aziende.it') || host === 'adintend.com' || host.endsWith('.adintend.com')) return null;
        if (['google.com', 'facebook.com', 'linkedin.com', 'instagram.com', 'youtube.com'].some(d => host === d || host.endsWith(`.${d}`))) return null;
        return u.toString();
    } catch { return null; }
}

function cleanPhone(value, partitaIva = '') {
    const raw = normalizeText(value);
    if (!raw) return null;
    const match = raw.match(/(?:\+39\s*)?(?:0\d{1,4}[\s./-]?\d{5,8}|3\d{2}[\s./-]?\d{6,7})/);
    if (!match) return null;
    const phone = normalizeText(match[0]);
    const digits = phone.replace(/\D/g, '');
    const piva = String(partitaIva || '').replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 13) return null;
    if (digits.startsWith('3') && digits.length !== 10) return null;
    if (digits.startsWith('0') && (digits.length < 9 || digits.length > 11)) return null;
    if (piva && (piva.includes(digits) || digits.includes(piva))) return null;
    return phone;
}

function extractCapFromAddress(indirizzo) {
    const match = normalizeText(indirizzo).match(/(?:^|[,\s])(\d{5})(?:[,\s]|$)/);
    return match?.[1] || null;
}

function parseJsonLd($) {
    const result = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse($(el).text());
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                if (item.url && !result.sitoWeb) result.sitoWeb = cleanWebsite(item.url);
                if (item.email && !result.email) result.email = cleanEmail(item.email);
                if (item.telephone && !result.telefono) result.telefono = cleanPhone(item.telephone);
                if (item.address) {
                    const address = typeof item.address === 'string'
                        ? item.address
                        : [item.address.streetAddress, item.address.postalCode, item.address.addressLocality, item.address.addressRegion].filter(Boolean).join(', ');
                    if (address && !result.indirizzo) result.indirizzo = normalizeText(address);
                    if (typeof item.address === 'object' && item.address.postalCode && !result.cap) result.cap = normalizeText(item.address.postalCode);
                }
            }
        } catch {}
    });
    return result;
}

function extractContactData($, body, pageUrl, partitaIva = '', scanTextPhone = false) {
    const text = normalizeText(typeof body === 'string' ? body : body.toString());
    const mailtoEmails = $('a[href^="mailto:"]').map((_, a) => $(a).attr('href')?.replace(/^mailto:/i, '').split('?')[0]).get();
    const cfEmails = $('a.__cf_email__, span.__cf_email__').map((_, el) => decodeCloudflareEmail($(el).attr('data-cfemail'))).get().filter(Boolean);
    const emails = [...new Set([...mailtoEmails, ...cfEmails, ...extractEmailsFromText(text)])].filter(isValidEmail);
    const pec = emails.find(e => /pec|legalmail|postacert|cert/i.test(e)) || null;
    const email = emails.find(e => e !== pec) || null;
    const telHref = $('a[href^="tel:"]').map((_, a) => $(a).attr('href')?.replace(/^tel:/i, '')).get().map(v => cleanPhone(v, partitaIva)).find(Boolean) || null;
    const telefono = telHref || (scanTextPhone ? cleanPhone(text, partitaIva) : null);
    return { email, pec, telefono, sitoWeb: cleanWebsite(pageUrl) };
}

function findContactPageUrl($, baseUrl) {
    const candidates = $('a[href]').map((_, a) => {
        const label = normalizeKey($(a).text());
        const url = cleanWebsite(normalizeText($(a).attr('href')), baseUrl);
        if (!url) return null;
        let score = 0;
        if (/contatti|contatto|contact|contacts|about|chi siamo|azienda|dove siamo/.test(label)) score += 2;
        if (/contatti|contatto|contact|contacts|about|chi-siamo|azienda|dove-siamo/i.test(url)) score += 2;
        return score > 0 ? { url, score } : null;
    }).get().filter(Boolean).sort((a, b) => b.score - a.score);
    return candidates[0]?.url || null;
}

function parseDetail($, body) {
    const text = normalizeText(typeof body === 'string' ? body : body.toString());
    const pairs = collectLabelValues($);
    const jsonLd = parseJsonLd($);
    const partitaIvaRaw = findLabel(pairs, ['Partita IVA', 'P IVA', 'P.IVA']) || pickByRegex(text, /(?:Partita\s*IVA|P\.?\s*IVA)\s*[:\-]?\s*(\d{11})/i);
    const partitaIva = partitaIvaRaw.replace(/\D/g, '').slice(0, 11) || null;
    const codiceFiscaleRaw = findLabel(pairs, ['Codice fiscale', 'C F', 'C.F.']) || pickByRegex(text, /(?:Codice\s*fiscale|C\.?\s*F\.?)\s*[:\-]?\s*([A-Z0-9]{11,16})/i);
    const indirizzo = jsonLd.indirizzo || findLabel(pairs, ['Sede legale', 'Indirizzo', 'Sede']) || null;
    const detailContacts = extractContactData($, body, BASE, partitaIva, false);
    const labelEmail = cleanEmail(findLabel(pairs, ['Email', 'E-mail']));
    const labelWebsite = cleanWebsite(findLabel(pairs, ['Sito web', 'Website']));
    const websiteHref = $('a[href^="http"]').map((_, a) => $(a).attr('href')).get().map(h => cleanWebsite(h)).find(Boolean) || null;

    return {
        partitaIva,
        codiceFiscale: codiceFiscaleRaw || null,
        rea: findLabel(pairs, ['REA', 'Numero REA', 'Repertorio economico amministrativo']) || pickByRegex(text, /(?:\bREA\b|Numero\s*REA)\s*[:\-]?\s*([A-Z]{2}\s*[-/]?\s*\d+|\d{3,})/i) || null,
        indirizzo,
        cap: jsonLd.cap || extractCapFromAddress(indirizzo),
        telefono: jsonLd.telefono || detailContacts.telefono || cleanPhone(findLabel(pairs, ['Telefono', 'Tel']), partitaIva),
        email: jsonLd.email || labelEmail || detailContacts.email,
        pec: detailContacts.pec,
        sitoWeb: jsonLd.sitoWeb || labelWebsite || websiteHref,
        formaGiuridica: findLabel(pairs, ['Forma giuridica', 'Natura giuridica']) || null,
        statoAttivita: findLabel(pairs, ['Stato attivita', 'Stato attività', 'Stato']) || null,
        dipendenti: findLabel(pairs, ['Dipendenti', 'Numero dipendenti', 'Addetti']) || null,
        dataCostituzione: findLabel(pairs, ['Data costituzione', 'Anno fondazione', 'Data iscrizione']) || null,
    };
}

function needsWebsiteContactPass(company) {
    return includeWebsiteContacts && company.sitoWeb && (!company.email || !company.telefono || !company.pec);
}

const listingRecords = [];
const categoryCounts = new Map();
const categorySummary = new Map();
const seenGlobalDetailUrls = new Set();
let listingPagesFinished = 0;

function getSummary(targetKey, categoryKey, categoryUrl) {
    if (!categorySummary.has(targetKey)) {
        categorySummary.set(targetKey, {
            categoryKey,
            categoryUrl,
            totalResults: null,
            pagesFinished: 0,
            rowsParsed: 0,
            recordsCollected: 0,
            status: 'pending',
        });
    }
    return categorySummary.get(targetKey);
}

function targetReached(categoryKey) {
    if (!categoryQuotaMode) return listingRecords.length >= maxItems;
    return (categoryCounts.get(categoryKey) || 0) >= perCategoryLimit;
}

const listingCrawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    maxConcurrency: listingConcurrency,
    maxRequestsPerMinute: listingMaxRequestsPerMinute,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 90,
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [async ({ request }) => {
        request.headers = {
            ...request.headers,
            'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (compatible; ItalyCompaniesScraper/11.3.1; +https://apify.com/)'
        };
    }],

    async requestHandler({ $, request, body, log, addRequests }) {
        const { categoryKey, categoryUrl, targetKey, pageNum } = request.userData;
        const summary = getSummary(targetKey, categoryKey, categoryUrl);
        summary.pagesFinished++;
        listingPagesFinished++;

        if (debug && pageNum === 1) {
            const safe = `${categoryKey}_${categoryUrl.split('/').pop() || 'cat'}`.replace(/[^\w.-]/g, '_');
            await Actor.setValue(`listing_${safe}_p1.html`, typeof body === 'string' ? body : body.toString(), { contentType: 'text/html; charset=utf-8' });
        }

        let categoria = '';
        $('h1, .breadcrumb li, ol.breadcrumb li').each((_, el) => {
            const t = normalizeText($(el).text());
            if (t && t.length > categoria.length && t.length < 120 && !/aziende con codice/i.test(t)) categoria = t;
        });

        if (pageNum === 1) {
            const totalResults = parseTotalResults(body);
            summary.totalResults = totalResults;
            const targetCount = categoryQuotaMode ? perCategoryLimit : null;
            const pageLimit = calculatePageLimit(totalResults, targetCount);
            const pageRequests = [];
            for (let p = 2; p <= pageLimit; p++) {
                pageRequests.push({
                    url: withPage(categoryUrl, p),
                    userData: { label: 'LISTING', categoryKey, categoryUrl, targetKey, pageNum: p },
                    uniqueKey: `${targetKey}::pag=${p}`,
                });
            }
            if (pageRequests.length) await addRequests(pageRequests);
            log.info(`[listing] ${categoryKey} | ${categoryUrl} total=${totalResults ?? '?'} pageLimit=${pageLimit} scheduledPages=${pageRequests.length}`);
        }

        const rows = parseRows($, categoria);
        summary.rowsParsed += rows.length;

        for (const row of rows) {
            if (listingRecords.length >= maxItems) break;
            if (targetReached(categoryKey)) break;
            if (!row.detailUrl) continue;

            const seenKey = categoryQuotaMode ? `${categoryKey}::${row.detailUrl}` : row.detailUrl;
            if (seenGlobalDetailUrls.has(seenKey)) continue;
            seenGlobalDetailUrls.add(seenKey);

            const record = {
                ...row,
                categoryKey,
                categoryUrl,
                sourceCategoryUrl: categoryUrl,
            };
            listingRecords.push(record);
            categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) || 0) + 1);
            summary.recordsCollected++;
        }

        if (summary.rowsParsed === 0 && summary.pagesFinished > 0) summary.status = 'empty_or_invalid';
        else if (summary.recordsCollected > 0) summary.status = targetReached(categoryKey) ? 'quota_reached' : 'valid_partial';
        else if (summary.rowsParsed > 0) summary.status = 'skipped_quota';

        log.info(`[listing p${pageNum}] ${categoryKey} rows=${rows.length} collected=${listingRecords.length}/${maxItems} categoryCollected=${categoryCounts.get(categoryKey) || 0}${perCategoryLimit ? `/${perCategoryLimit}` : ''} pagesFinished=${listingPagesFinished} — ${categoryUrl}`);
    },
});

const startRequests = categoryTargets.map((t, i) => {
    const targetKey = `${t.categoryKey}::${i + 1}::${t.url}`;
    getSummary(targetKey, t.categoryKey, t.url);
    return {
        url: withPage(t.url, 1),
        userData: { label: 'LISTING', categoryKey: t.categoryKey, categoryUrl: t.url, targetKey, pageNum: 1 },
        uniqueKey: `${targetKey}::pag=1`,
    };
});

await listingCrawler.run(startRequests);
const summaryArray = [...categorySummary.values()].map(s => ({ ...s }));
await Actor.setValue('category-summary.json', JSON.stringify(summaryArray, null, 2), { contentType: 'application/json; charset=utf-8' });
console.log(`Category summary: ${JSON.stringify(summaryArray)}`);
console.log(`Listing phase done. Collected ${listingRecords.length} companies.`);

if (!shouldScrapeDetails) {
    await Dataset.pushData(listingRecords.map(r => ({ ...r, detailScraped: false })));
    console.log(`Done. Saved ${listingRecords.length} listing-only companies.`);
    await Actor.exit();
}

let savedDetails = 0;
const detailCrawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    maxConcurrency: detailConcurrency,
    maxRequestsPerMinute: detailMaxRequestsPerMinute,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 120,
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [async ({ request }) => {
        request.headers = {
            ...request.headers,
            'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (compatible; ItalyCompaniesScraper/11.3.1-detail; +https://apify.com/)'
        };
    }],

    async requestHandler({ $, request, body, addRequests, log }) {
        if (request.userData.label === 'CONTACT_HOME' || request.userData.label === 'CONTACT_PAGE') {
            const base = request.userData.company ?? {};
            const contacts = extractContactData($, body, request.url, base.partitaIva, true);
            const merged = {
                ...base,
                email: base.email || contacts.email,
                pec: base.pec || contacts.pec,
                telefono: base.telefono || contacts.telefono,
                sitoWeb: base.sitoWeb || contacts.sitoWeb,
                websiteContactScraped: true,
                detailScraped: true,
            };
            if (request.userData.label === 'CONTACT_HOME' && (!merged.email || !merged.telefono)) {
                const contactUrl = findContactPageUrl($, request.url);
                if (contactUrl) {
                    await addRequests([{ url: contactUrl, userData: { label: 'CONTACT_PAGE', company: merged }, uniqueKey: `contact-page::${contactUrl}::${merged.detailUrl}` }]);
                    return;
                }
            }
            await Dataset.pushData(merged);
            savedDetails++;
            return;
        }

        const base = request.userData.company ?? {};
        const detail = parseDetail($, body);
        const merged = { ...base, ...detail, detailScraped: true };

        if (needsWebsiteContactPass(merged)) {
            const websiteUrl = cleanWebsite(merged.sitoWeb);
            if (websiteUrl) {
                await addRequests([{ url: websiteUrl, userData: { label: 'CONTACT_HOME', company: merged }, uniqueKey: `contact-home::${websiteUrl}::${merged.detailUrl}` }]);
                return;
            }
        }

        await Dataset.pushData(merged);
        savedDetails++;
        if (savedDetails % 100 === 0) log.info(`[detail] saved=${savedDetails}/${listingRecords.length}`);
    },

    async failedRequestHandler({ request, log }) {
        const base = request.userData?.company ?? {};
        log.warning(`[detail failed] ${request.url}`);
        await Dataset.pushData({ ...base, detailScraped: false, detailError: request.errorMessages?.join(' | ') || 'Request failed' });
        savedDetails++;
    },
});

const detailRequests = listingRecords.map(company => ({
    url: company.detailUrl,
    userData: { label: 'DETAIL', company },
    uniqueKey: `detail::${company.categoryKey || 'cat'}::${company.detailUrl}`,
}));

await detailCrawler.run(detailRequests);
console.log(`Done. Saved ${savedDetails} enriched companies.`);
await Actor.exit();
