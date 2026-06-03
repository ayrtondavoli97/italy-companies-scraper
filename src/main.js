/**
 * Italy Companies Scraper v2
 * Source: infoimprese.it (InfoCamere — public, no login, search by province)
 * Input: regione or provincia (required) + ateco, formaGiuridica, stato (optional)
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const PROVINCE = {
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

// infoimprese.it search: leave denominazione empty, set only provincia
// URL: https://www.infoimprese.it/iimprese/action/ricerca.do
// POST params: denominazione=&provincia=NA&ateco=&formaGiuridica=&stato=A&submit=Cerca
const BASE = 'https://www.infoimprese.it';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
    regione = '', provincia = '', ateco = '',
    formaGiuridica = '', statoImpresa = 'A', // A=attiva, I=inattiva, C=cessata, ''=tutte
    maxItems = 5000, proxyConfig: proxyConfigInput,
} = input;

let provinceCodes = [];
const regioneUp = regione.toUpperCase().trim();
const provinciaUp = provincia.toUpperCase().trim();

if (provinciaUp) {
    const code = PROVINCE[provinciaUp] || (Object.values(PROVINCE).includes(provinciaUp) ? provinciaUp : null);
    if (!code) { console.error(`Provincia non riconosciuta: "${provincia}"`); await Actor.exit(1); }
    provinceCodes = [code];
} else if (regioneUp) {
    provinceCodes = REGIONE_PROVINCE[regioneUp];
    if (!provinceCodes) { console.error(`Regione non riconosciuta: "${regione}"`); await Actor.exit(1); }
} else {
    console.error('Obbligatorio: "regione" o "provincia"'); await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput ? await Actor.createProxyConfiguration(proxyConfigInput) : undefined;
console.log(`Province: ${provinceCodes.join(', ')} | ATECO: ${ateco||'tutti'} | Stato: ${statoImpresa||'tutti'}`);

let collected = 0;

// Build one start URL per province — POST form via GET-equivalent
// infoimprese.it supports GET with query params
const startUrls = provinceCodes.map(prov => ({
    url: `${BASE}/iimprese/action/ricerca.do`,
    userData: { prov, page: 1, isFirst: true },
    method: 'GET',
}));

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    launchContext: { launchOptions: { headless: true } },
    requestHandlerTimeoutSecs: 120,
    maxConcurrency: 2,

    async requestHandler({ page, request, log, addRequests }) {
        const { prov, page: pageNum, isFirst } = request.userData;
        log.info(`Scraping provincia=${prov} page=${pageNum}`);

        if (isFirst) {
            // Navigate to search page and fill the form
            await page.goto(`${BASE}/iimprese/action/ricerca.do`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

            // Wait for form
            await page.waitForSelector('form, input[name="provincia"], select[name="provincia"]', { timeout: 20_000 }).catch(() => {});

            // Debug: save first page HTML
            if (prov === provinceCodes[0]) {
                const html = await page.content();
                await Actor.setValue('debug_search_page', html, { contentType: 'text/html' });
                const txt = await page.evaluate(() => document.body.innerText.substring(0, 600));
                log.info(`Search page preview:\n${txt}`);
            }

            // Fill province
            try {
                const provSel = page.locator('select[name="provincia"]').first();
                if (await provSel.isVisible({ timeout: 3000 })) {
                    await provSel.selectOption(prov);
                    log.info(`Province selected via dropdown: ${prov}`);
                } else {
                    await page.locator('input[name="provincia"]').first().fill(prov);
                    log.info(`Province filled via input: ${prov}`);
                }
            } catch { log.warning('Could not fill province field'); }

            // Fill optional ATECO
            if (ateco) {
                await page.locator('input[name="ateco"], select[name="ateco"]').first().fill(ateco).catch(() => {});
            }

            // Fill optional forma giuridica
            if (formaGiuridica) {
                await page.locator('select[name="formaGiuridica"], input[name="formaGiuridica"]').first()
                    .fill(formaGiuridica).catch(() => {});
            }

            // Fill stato
            if (statoImpresa) {
                try {
                    await page.locator('select[name="stato"]').first().selectOption(statoImpresa).catch(() => {});
                } catch { /* ignore */ }
            }

            // Submit
            await page.locator('input[type="submit"], button[type="submit"]').first().click().catch(async () => {
                await page.evaluate(() => document.querySelector('form')?.submit());
            });
            await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
            log.info('Form submitted');
        } else {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        }

        // Save HTML for debugging on first run
        if (pageNum === 1 && prov === provinceCodes[0]) {
            const html = await page.content();
            await Actor.setValue(`debug_results_${prov}`, html, { contentType: 'text/html' });
            log.info(`Results HTML saved: debug_results_${prov}`);
        }

        const bodyTxt = await page.evaluate(() => document.body.innerText.substring(0, 800));
        log.info(`Page body preview:\n${bodyTxt}`);

        const { items, nextUrl, total } = await page.evaluate(() => {
            const g = (el, ...sels) => { for (const s of sels) { const f = el?.querySelector(s); if (f) return f.textContent.trim(); } return ''; };

            // Total results
            let total = 0;
            const totEl = document.querySelector('[class*="totale"], [class*="risultati"], [class*="total"]');
            if (totEl) { const m = totEl.textContent.match(/(\d[\d.]*)/); if (m) total = parseInt(m[1].replace(/\./g, ''), 10); }

            // Company rows — table-based layout common on infoimprese.it
            let items = [];
            const rows = [...document.querySelectorAll('table tbody tr, .risultato, [class*="impresa-row"], [class*="company-row"]')];
            for (const row of rows) {
                const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
                const name = g(row, '.denominazione', '.ragione-sociale', 'td:first-child', 'strong') || cells[0] || '';
                if (!name || name.length < 2) continue;
                const link = row.querySelector('a');
                items.push({
                    ragioneSociale: name,
                    comune: cells[1] || g(row, '.comune', '.localita') || '',
                    provincia: cells[2] || g(row, '.provincia') || '',
                    indirizzo: cells[3] || g(row, '.indirizzo', '.sede') || '',
                    formaGiuridica: cells[4] || g(row, '.forma-giuridica', '.tipo') || '',
                    ateco: cells[5] || g(row, '.ateco') || '',
                    stato: cells[6] || g(row, '.stato') || '',
                    detailUrl: link?.href || '',
                });
            }

            // Next page link
            const nextEl = document.querySelector('a[href*="pagina"], a.next, a:has-text("Successiva"), a:has-text("›"), .pagination a:last-child');
            const nextUrl = nextEl?.href || null;

            return { items, nextUrl, total };
        });

        log.info(`prov=${prov} pg=${pageNum}: ${items.length} items | total=${total} | next=${nextUrl ? 'yes' : 'no'}`);

        for (const item of items) {
            if (collected >= maxItems) break;
            await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp });
            collected++;
        }

        if (nextUrl && collected < maxItems) {
            await addRequests([{ url: nextUrl, userData: { prov, page: pageNum + 1, isFirst: false } }]);
        }
    },

    failedRequestHandler({ request, log }) { log.error(`Failed: ${request.url}`); },
});

await crawler.run(startUrls);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
