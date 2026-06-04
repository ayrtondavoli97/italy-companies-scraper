/**
 * Italy Companies Scraper v4
 * Source: imprese.openapi.it — free API, 100 req/day no token
 * Fallback: Playwright scraping of company directories
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

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

// ── Strategy 1: Try openapi.it JSON API (100 free req/day) ───────────────────
// Endpoint: GET https://imprese.openapi.it/advance?provincia=BA&limit=100&skip=0
// No token required for first 100 requests

let collected = 0;
let apiWorked = false;

for (const prov of provinceCodes) {
    if (collected >= maxItems) break;
    let skip = 0;
    let total = Infinity;

    while (collected < maxItems && skip < total) {
        const url = `https://imprese.openapi.it/advance?provincia=${prov}&limit=100&skip=${skip}${ateco ? `&codice_ateco=${ateco}` : ''}`;
        console.log(`API call: ${url}`);

        try {
            const { createPlaywrightRouter } = await import('crawlee');
            // Use fetch via page evaluation instead
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            });
            const json = await response.json();

            // Save raw response for debug
            await Actor.setValue(`debug_api_${prov}_skip${skip}`, json);
            console.log(`API response keys: ${Object.keys(json).join(', ')}`);

            if (json.items || json.companies || json.data || Array.isArray(json)) {
                apiWorked = true;
                const items = json.items || json.companies || json.data || json;
                total = json.total || json.count || json.meta?.total || items.length;
                console.log(`Got ${items.length} companies, total=${total}`);

                for (const c of items) {
                    if (collected >= maxItems) break;
                    await Actor.pushData({
                        ragioneSociale: c.denominazione || c.name || c.ragioneSociale || '',
                        cf: c.codice_fiscale || c.cf || '',
                        piva: c.partita_iva || c.piva || c.vat || '',
                        indirizzo: c.indirizzo || c.address || '',
                        comune: c.comune || c.city || c.municipality || '',
                        provincia: c.provincia || prov,
                        cap: c.cap || c.zip || '',
                        ateco: c.codice_ateco || c.ateco || '',
                        descrizioneAteco: c.descrizione_ateco || c.attivita || '',
                        formaGiuridica: c.natura_giuridica || c.forma_giuridica || c.legalForm || '',
                        stato: c.stato || c.status || '',
                        pec: c.pec || '',
                        email: c.email || '',
                        telefono: c.telefono || c.phone || '',
                        _provincia: prov,
                        _regione: regioneUp,
                        _source: 'openapi.it',
                    });
                    collected++;
                }
                skip += 100;
                if (items.length === 0) break;
            } else {
                console.log(`Unexpected API response: ${JSON.stringify(json).substring(0, 200)}`);
                break;
            }
        } catch(e) {
            console.log(`API error: ${e.message}`);
            await Actor.setValue('debug_api_error', { error: e.message, url });
            break;
        }
    }
}

// ── Strategy 2: Playwright fallback if API didn't work ───────────────────────
if (!apiWorked && collected === 0) {
    console.log('API strategy failed, switching to Playwright scraping...');

    // Target: imprese.info — public Italian company directory
    const startUrls = provinceCodes.map(prov => ({
        url: `https://www.imprese.info/imprese/provincia/${prov.toLowerCase()}/`,
        userData: { prov, page: 1 },
    }));

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
            const { prov, page: pageNum } = request.userData;
            log.info(`Playwright: Prov=${prov} page=${pageNum} | ${request.url}`);

            await page.waitForTimeout(2000);

            // Save full HTML for debug
            const html = await page.content();
            await Actor.setValue(`debug_playwright_${prov}_p${pageNum}`, html, { contentType: 'text/html' });

            // Save body text
            const bodyText = await page.evaluate(() => document.body.innerText);
            await Actor.setValue(`debug_text_${prov}_p${pageNum}`, bodyText, { contentType: 'text/plain' });

            log.info(`HTML saved (${html.length} chars) | Text: ${bodyText.substring(0, 300)}`);

            // Try to parse companies
            const items = await page.evaluate(() => {
                const g = (el, ...sels) => { for (const s of sels) { try { const f = el.querySelector(s); if (f) return f.textContent.trim(); } catch {} } return ''; };
                const cards = [...document.querySelectorAll('tr, [class*="company"], [class*="impresa"], article, li')].filter(el =>
                    el.textContent.trim().length > 10 && !el.closest('nav') && !el.closest('header')
                );
                return cards.slice(0, 50).map(card => {
                    const cells = [...card.querySelectorAll('td')].map(td => td.textContent.trim());
                    const name = g(card, 'td:first-child', '[class*="name"]', 'strong', 'h3', 'h4') || cells[0] || '';
                    if (!name || name.length < 2) return null;
                    return { ragioneSociale: name, comune: cells[1]||'', provincia: cells[2]||'', indirizzo: cells[3]||'', ateco: cells[4]||'', detailUrl: card.querySelector('a')?.href||'' };
                }).filter(Boolean);
            });

            log.info(`Found ${items.length} companies on page ${pageNum}`);
            for (const item of items) {
                if (collected >= maxItems) break;
                await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp, _source: 'playwright' });
                collected++;
            }

            // Next page
            const nextUrl = await page.evaluate(() => {
                const a = [...document.querySelectorAll('a')].find(a => /successiv|next|›|>>/i.test(a.textContent));
                return a?.href || null;
            });
            if (nextUrl && collected < maxItems) {
                await addRequests([{ url: nextUrl, userData: { prov, page: pageNum + 1 } }]);
            }
        },
        failedRequestHandler({ request, log }) { log.error(`Failed: ${request.url}`); },
    });

    await crawler.run(startUrls);
}

console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
