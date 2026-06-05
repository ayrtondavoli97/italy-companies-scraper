/**
 * Italy Companies Scraper v5
 * Source: inipec.gov.it — public government registry (no auth required by law)
 * Scrapes: ragione sociale, PEC, provincia, CF
 * Input: regione or provincia (required)
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

console.log(`Province: ${provinceCodes.join(', ')} | maxItems: ${maxItems}`);

let collected = 0;

const BASE_URL = 'https://www.inipec.gov.it/cerca-pec/-/pec/imprese';

const startUrls = provinceCodes.map(prov => ({
    url: BASE_URL,
    userData: { prov, page: 1, isFirst: true },
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
        const { prov, page: pageNum, isFirst } = request.userData;
        log.info(`INI-PEC | Prov=${prov} page=${pageNum}`);

        if (isFirst) {
            // Load page and fill the search form
            await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(2000);

            // Dismiss cookie banner if present
            try {
                const okBtn = page.locator('a:has-text("OK"), button:has-text("OK"), .cookie-btn').first();
                if (await okBtn.isVisible({ timeout: 2000 })) { await okBtn.click(); await page.waitForTimeout(500); }
            } catch { /* ignore */ }

            // Debug: save form HTML before filling
            const html0 = await page.content();
            await Actor.setValue(`debug_form_${prov}`, html0, { contentType: 'text/html' });
            const txt0 = await page.evaluate(() => document.body.innerText);
            log.info(`Form page preview:\n${txt0.substring(0, 400)}`);

            // Find and fill provincia field
            // INI-PEC has a select dropdown for provincia
            try {
                // Try select dropdown first
                const provSel = page.locator('select[name*="provincia"], select[id*="provincia"]').first();
                if (await provSel.isVisible({ timeout: 3000 })) {
                    await provSel.selectOption(prov);
                    log.info(`Province selected in dropdown: ${prov}`);
                } else {
                    // Try text input
                    const provInput = page.locator('input[name*="provincia"], input[id*="provincia"]').first();
                    if (await provInput.isVisible({ timeout: 3000 })) {
                        await provInput.fill(prov);
                        log.info(`Province typed in input: ${prov}`);
                    }
                }
            } catch(e) { log.warning(`Province field error: ${e.message}`); }

            // Submit
            try {
                const submitBtn = page.locator('input[type="submit"], button[type="submit"], .btn-cerca, button:has-text("Cerca")').first();
                if (await submitBtn.isVisible({ timeout: 3000 })) {
                    await submitBtn.click();
                    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
                    log.info(`Submitted | URL: ${page.url()}`);
                }
            } catch(e) { log.warning(`Submit error: ${e.message}`); }

            await page.waitForTimeout(1000);
        } else {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(1000);
        }

        // Full debug on first page
        if (pageNum === 1) {
            const html = await page.content();
            await Actor.setValue(`debug_results_${prov}_p1`, html, { contentType: 'text/html' });
            const txt = await page.evaluate(() => document.body.innerText);
            await Actor.setValue(`debug_text_${prov}_p1`, txt, { contentType: 'text/plain' });
            log.info(`Results debug saved | Text preview:\n${txt.substring(0, 500)}`);
        }

        // Parse results table
        const { items, totalPages } = await page.evaluate(() => {
            // INI-PEC shows results in a table
            const rows = [...document.querySelectorAll('table tbody tr, .risultati tr, [class*="result"] tr')];

            const items = rows.map(row => {
                const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
                if (cells.length < 2) return null;
                return {
                    ragioneSociale: cells[0] || '',
                    cf: cells[1] || '',
                    provincia: cells[2] || '',
                    pec: cells[3] || '',
                };
            }).filter(r => r && r.ragioneSociale && r.ragioneSociale.length > 1);

            // Total pages from pagination
            const pagLinks = [...document.querySelectorAll('a[href*="cur="], .pagination a, [class*="page"] a')]
                .map(a => parseInt(a.textContent.trim()))
                .filter(n => !isNaN(n) && n > 0);
            const totalPages = pagLinks.length ? Math.max(...pagLinks) : 1;

            return { items, totalPages };
        });

        log.info(`Prov=${prov} p${pageNum}/${totalPages}: ${items.length} companies`);

        for (const item of items) {
            if (collected >= maxItems) break;
            await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp });
            collected++;
        }

        // Queue next pages from page 1
        if (pageNum === 1 && totalPages > 1) {
            const nextPages = [];
            for (let p = 2; p <= totalPages && collected < maxItems; p++) {
                nextPages.push({ url: buildUrl(prov, p), userData: { prov, page: p } });
            }
            if (nextPages.length) {
                await addRequests(nextPages);
                log.info(`Queued ${nextPages.length} more pages`);
            }
        }
    },

    failedRequestHandler({ request, log }) { log.error(`Failed: ${request.url}`); },
});

await crawler.run(startUrls);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
