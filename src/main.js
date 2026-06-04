/**
 * Italy Companies Scraper v3
 * Source: atoka.io — web scraping (no API key needed for public data)
 * Filter by: provincia/regione (required), ateco, forma giuridica
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const BASE = 'https://atoka.io';

const PROVINCE_CODES = {
    'AGRIGENTO':'AG','ALESSANDRIA':'AL','ANCONA':'AN','AOSTA':'AO','AREZZO':'AR',
    'ASCOLI PICENO':'AP','ASTI':'AT','AVELLINO':'AV','BARI':'BA','BARLETTA-ANDRIA-TRANI':'BT',
    'BELLUNO':'BL','BENEVENTO':'BN','BERGAMO':'BG','BIELLA':'BI','BOLOGNA':'BO',
    'BOLZANO':'BZ','BRESCIA':'BS','BRINDISI':'BR','CAGLIARI':'CA','CALTANISSETTA':'CL',
    'CAMPOBASSO':'CB','CASERTA':'CE','CATANIA':'CT','CATANZARO':'CZ','CHIETI':'CH',
    'COMO':'CO','COSENZA':'CS','CREMONA':'CR','CROTONE':'KR','CUNEO':'CN','ENNA':'EN',
    'FERMO':'FM','FERRARA':'FE','FIRENZE':'FI','FOGGIA':'FG','FORLI-CESENA':'FC',
    'FROSINONE':'FR','GENOVA':'GE','GORIZIA':'GO','GROSSETO':'GR','IMPERIA':'IM',
    'ISERNIA':'IS','LA SPEZIA':'SP','LATINA':'LT','LECCE':'LE','LECCO':'LC',
    'LIVORNO':'LI','LODI':'LO','LUCCA':'LU','MACERATA':'MC','MANTOVA':'MN',
    'MASSA-CARRARA':'MS','MATERA':'MT','MESSINA':'ME','MILANO':'MI','MODENA':'MO',
    'MONZA E BRIANZA':'MB','NAPOLI':'NA','NOVARA':'NO','NUORO':'NU','ORISTANO':'OR',
    'PADOVA':'PD','PALERMO':'PA','PARMA':'PR','PAVIA':'PV','PERUGIA':'PG',
    'PESARO E URBINO':'PU','PESCARA':'PE','PIACENZA':'PC','PISA':'PI','PISTOIA':'PT',
    'PORDENONE':'PN','POTENZA':'PZ','PRATO':'PO','RAGUSA':'RG','RAVENNA':'RA',
    'REGGIO CALABRIA':'RC','REGGIO EMILIA':'RE','RIETI':'RI','RIMINI':'RN','ROMA':'RM',
    'ROVIGO':'RO','SALERNO':'SA','SASSARI':'SS','SAVONA':'SV','SIENA':'SI',
    'SIRACUSA':'SR','SONDRIO':'SO','SUD SARDEGNA':'SU','TARANTO':'TA','TERAMO':'TE',
    'TERNI':'TR','TORINO':'TO','TRAPANI':'TP','TRENTO':'TN','TREVISO':'TV',
    'TRIESTE':'TS','UDINE':'UD','VARESE':'VA','VENEZIA':'VE','VERBANO-CUSIO-OSSOLA':'VB',
    'VERCELLI':'VC','VERONA':'VR','VIBO VALENTIA':'VV','VICENZA':'VI','VITERBO':'VT',
};

const REGIONE_PROVINCE = {
    'ABRUZZO':['CH','AQ','PE','TE'],'BASILICATA':['MT','PZ'],
    'CALABRIA':['CZ','KR','RC','CS','VV'],'CAMPANIA':['AV','BN','CE','NA','SA'],
    'EMILIA-ROMAGNA':['BO','FE','FC','MO','PR','PC','RA','RE','RN'],
    'FRIULI-VENEZIA GIULIA':['GO','PN','TS','UD'],'LAZIO':['FR','LT','RI','RM','VT'],
    'LIGURIA':['GE','IM','SP','SV'],
    'LOMBARDIA':['BG','BS','CO','CR','LC','LO','MN','MI','MB','PV','SO','VA'],
    'MARCHE':['AN','FM','MC','PU','AP'],'MOLISE':['CB','IS'],
    'PIEMONTE':['AL','AT','BI','CN','NO','TO','VB','VC'],
    'PUGLIA':['BA','BT','BR','FG','LE','TA'],'SARDEGNA':['CA','NU','OR','SS','SU'],
    'SICILIA':['AG','CL','CT','EN','ME','PA','RG','SR','TP'],
    'TOSCANA':['AR','FI','GR','LI','LU','MS','PI','PT','PO','SI'],
    'TRENTINO-ALTO ADIGE':['BZ','TN'],'UMBRIA':['PG','TR'],
    "VALLE D'AOSTA":['AO'],'VENETO':['BL','PD','RO','TV','VE','VR','VI'],
};

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
    regione = '', provincia = '', ateco = '',
    formaGiuridica = '', statoImpresa = 'attiva',
    maxItems = 5000, proxyConfig: proxyConfigInput,
} = input;

let provinceCodes = [];
const regioneUp = regione.toUpperCase().trim();
const provinciaUp = provincia.toUpperCase().trim();

if (provinciaUp) {
    const code = PROVINCE_CODES[provinciaUp] || (Object.values(PROVINCE_CODES).includes(provinciaUp) ? provinciaUp : null);
    if (!code) { console.error(`Provincia non riconosciuta: "${provincia}"`); await Actor.exit(1); }
    provinceCodes = [code];
} else if (regioneUp) {
    provinceCodes = REGIONE_PROVINCE[regioneUp];
    if (!provinceCodes) { console.error(`Regione non riconosciuta: "${regione}"`); await Actor.exit(1); }
} else {
    console.error('Obbligatorio: "regione" o "provincia"'); await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput
    ? await Actor.createProxyConfiguration(proxyConfigInput)
    : undefined;

console.log(`Province: ${provinceCodes.join(', ')} | ATECO: ${ateco||'tutti'}`);

// Atoka URL: /it/aziende/?province=BA&active=true&offset=0
// province param uses sigla (BA, NA, etc.)
const buildUrl = (prov, offset = 0) => {
    const params = new URLSearchParams();
    params.set('province', prov);
    if (statoImpresa === 'attiva') params.set('active', 'true');
    if (ateco) params.set('ateco', ateco);
    if (formaGiuridica) params.set('legalForm', formaGiuridica);
    params.set('offset', offset);
    return `${BASE}/it/aziende/?${params.toString()}`;
};

const startUrls = provinceCodes.map(prov => ({
    url: buildUrl(prov, 0),
    userData: { prov, offset: 0 },
}));

let collected = 0;

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    launchContext: { launchOptions: { headless: true } },
    requestHandlerTimeoutSecs: 120,
    maxConcurrency: 1,
    navigationTimeoutSecs: 45,
    preNavigationHooks: [
        async (_ctx, gotoOptions) => { gotoOptions.waitUntil = 'domcontentloaded'; },
    ],

    async requestHandler({ page, request, log, addRequests }) {
        const { prov, offset } = request.userData;
        log.info(`Prov=${prov} offset=${offset} | ${request.url}`);

        // Intercept API responses — atoka uses internal API
        const apiCompanies = [];
        page.on('response', async response => {
            const url = response.url();
            const ct = response.headers()['content-type'] || '';
            if (!ct.includes('json')) return;
            if (!url.includes('/api/') && !url.includes('companies') && !url.includes('aziende')) return;
            try {
                const json = await response.json();
                const companies = extractCompanies(json);
                if (companies.length > 0) {
                    apiCompanies.push(...companies);
                    log.info(`API: ${url.substring(0,80)} → ${companies.length} companies`);
                }
            } catch { /* ignore */ }
        });

        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(3000);

        // Dismiss cookie/login banners
        await page.evaluate(() => {
            document.querySelectorAll('[class*="cookie"], [class*="Cookie"], [id*="cookie"], [class*="modal"], [class*="overlay"]')
                .forEach(el => el.style.display = 'none');
        }).catch(() => {});

        // Save debug on first run
        if (offset === 0 && collected === 0) {
            const html = await page.content();
            await Actor.setValue(`debug_${prov}`, html, { contentType: 'text/html' });
            const txt = await page.evaluate(() => document.body.innerText.substring(0, 800));
            log.info(`Preview:\n${txt}`);
        }

        log.info(`API companies intercepted: ${apiCompanies.length}`);

        // Parse from DOM if no API
        let items = apiCompanies.length > 0 ? apiCompanies : await parseDom(page, prov);
        log.info(`Prov=${prov} offset=${offset}: ${items.length} companies`);

        // Check total
        const total = await page.evaluate(() => {
            const el = document.querySelector('[class*="count"], [class*="total"], [class*="risultat"]');
            const m = el?.textContent.match(/(\d[\d.]*)/);
            return m ? parseInt(m[1].replace(/\./g,''),10) : 0;
        });
        if (offset === 0) log.info(`Total companies: ${total}`);

        for (const item of items) {
            if (collected >= maxItems) break;
            await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp });
            collected++;
        }

        // Next page (atoka paginates by 10 or 20)
        const pageSize = items.length || 10;
        if (items.length > 0 && collected < maxItems && collected < total) {
            const nextOffset = offset + pageSize;
            await addRequests([{
                url: buildUrl(prov, nextOffset),
                userData: { prov, offset: nextOffset },
            }]);
        }
    },

    failedRequestHandler({ request, log }) { log.error(`Failed: ${request.url}`); },
});

await crawler.run(startUrls);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();

function extractCompanies(json) {
    const candidates = [
        json.items, json.companies, json.results, json.data?.items,
        json.data?.companies, Array.isArray(json) ? json : null,
    ].filter(Array.isArray);

    for (const arr of candidates) {
        if (arr.length === 0) continue;
        const first = arr[0];
        if (first.name || first.denominazione || first.ragioneSociale) {
            return arr.map(c => ({
                ragioneSociale: c.name || c.denominazione || c.ragioneSociale || '',
                cf: c.taxCode || c.cf || c.codiceFiscale || '',
                piva: c.vatNumber || c.piva || c.partitaIva || '',
                indirizzo: c.address || c.indirizzo || c.sede || '',
                comune: c.municipality || c.comune || c.city || '',
                provincia: c.province || c.provincia || '',
                cap: c.zipCode || c.cap || '',
                ateco: c.ateco || c.atecoCode || '',
                descrizioneAteco: c.atecoDescription || c.attivita || '',
                formaGiuridica: c.legalForm || c.formaGiuridica || c.natura || '',
                stato: c.active !== undefined ? (c.active ? 'ATTIVA' : 'CESSATA') : (c.stato || ''),
                dipendenti: c.employees || c.dipendenti || '',
                fatturato: c.revenue || c.fatturato || '',
                email: c.email || '',
                pec: c.pec || '',
                telefono: c.phone || c.telefono || '',
                website: c.website || c.url || '',
                detailUrl: c.url ? `${c.url}` : '',
            })).filter(c => c.ragioneSociale);
        }
    }
    return [];
}

async function parseDom(page, prov) {
    return page.evaluate((prov) => {
        const g = (el, ...sels) => {
            for (const s of sels) { try { const f = el.querySelector(s); if (f) return f.textContent.trim(); } catch {} }
            return '';
        };
        const cards = [...document.querySelectorAll(
            '[class*="company-card"], [class*="CompanyCard"], [class*="company-item"], ' +
            '[class*="CompanyItem"], [class*="result-item"], article, [class*="card"]'
        )].filter(el => el.textContent.trim().length > 20 && !el.closest('nav') && !el.closest('header'));

        return cards.map(card => {
            const name = g(card, '[class*="name"], [class*="Name"], h2, h3, strong');
            if (!name || name.length < 2) return null;
            const link = card.querySelector('a[href*="/aziende/"], a[href*="/company/"]');
            return {
                ragioneSociale: name,
                cf: g(card, '[class*="cf"], [class*="taxCode"], [class*="fiscal"]'),
                piva: g(card, '[class*="vat"], [class*="piva"]'),
                indirizzo: g(card, '[class*="address"], [class*="indirizzo"]'),
                comune: g(card, '[class*="city"], [class*="comune"], [class*="municipality"]'),
                provincia: prov,
                ateco: g(card, '[class*="ateco"]'),
                descrizioneAteco: g(card, '[class*="activity"], [class*="attivita"]'),
                formaGiuridica: g(card, '[class*="legal"], [class*="forma"]'),
                stato: g(card, '[class*="status"], [class*="stato"]'),
                detailUrl: link?.href || '',
            };
        }).filter(Boolean);
    }, prov);
}
