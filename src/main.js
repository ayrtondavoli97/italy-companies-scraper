/**
 * Italy Companies Scraper
 * Source: registroimprese.it — official Italian business registry
 * Input: provincia (required), ateco (optional), forma_giuridica (optional)
 * Output: ragione sociale, provincia, indirizzo, ateco, forma giuridica, CF/PIVA, stato
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const BASE = 'https://www.registroimprese.it';

// Province italiane
const PROVINCE_MAP = {
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
    regione = '',
    provincia = '',
    ateco = '',
    formaGiuridica = '',
    statoImpresa = 'ATTIVA',
    maxItems = 5000,
    proxyConfig: proxyConfigInput,
} = input;

// Resolve province codes
let provinceCodes = [];
const regioneUp = regione.toUpperCase().trim();
const provinciaUp = provincia.toUpperCase().trim();

if (provinciaUp) {
    const code = PROVINCE_MAP[provinciaUp] || (Object.values(PROVINCE_MAP).includes(provinciaUp) ? provinciaUp : null);
    if (!code) { console.error(`Provincia non riconosciuta: "${provincia}"`); await Actor.exit(1); }
    provinceCodes = [code];
} else if (regioneUp) {
    provinceCodes = REGIONE_PROVINCE[regioneUp];
    if (!provinceCodes) { console.error(`Regione non riconosciuta: "${regione}"`); await Actor.exit(1); }
} else {
    console.error('Input obbligatorio: inserisci "regione" o "provincia"');
    await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput
    ? await Actor.createProxyConfiguration(proxyConfigInput)
    : undefined;

console.log(`Province: ${provinceCodes.join(', ')} | ATECO: ${ateco||'tutti'} | Stato: ${statoImpresa}`);

let collected = 0;

// Build one start URL per province — registroimprese.it search page
const startUrls = provinceCodes.map(prov => ({
    url: `${BASE}/ricerca-imprese`,
    userData: { prov, page: 1, isFirst: true },
}));

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    launchContext: { launchOptions: { headless: true } },
    requestHandlerTimeoutSecs: 120,
    maxConcurrency: 1, // single to avoid detection
    navigationTimeoutSecs: 45,
    preNavigationHooks: [
        async (_ctx, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
        },
    ],

    async requestHandler({ page, request, log, addRequests }) {
        const { prov, page: pageNum, isFirst } = request.userData;
        log.info(`Provincia=${prov} page=${pageNum}`);

        if (isFirst) {
            await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(2000);

            // Dismiss Didomi cookie banner
            try {
                const didomiBtn = page.locator('#didomi-notice-agree-button, button[id*="didomi"][id*="agree"], button:has-text("Accetta")').first();
                if (await didomiBtn.isVisible({ timeout: 4000 })) {
                    await didomiBtn.click();
                    await page.waitForTimeout(1000);
                    log.info('Didomi cookie dismissed');
                }
            } catch {
                // Try hiding via JS if button click fails
                await page.evaluate(() => {
                    const host = document.getElementById('didomi-host');
                    if (host) host.style.display = 'none';
                }).catch(() => {});
                log.info('Didomi hidden via JS');
            }

            // Save debug HTML on first run
            if (collected === 0) {
                const html = await page.content();
                await Actor.setValue('debug_home', html, { contentType: 'text/html' });
                const txt = await page.evaluate(() => document.body.innerText.substring(0, 600));
                log.info(`Home preview:\n${txt}`);
            }

            // Fill search form: select province by full name
            // Reverse map: BA -> BARI
            const PROV_FULL = Object.fromEntries(Object.entries(PROVINCE_MAP).map(([k,v]) => [v,k]));
            const provFullName = PROV_FULL[prov] || prov;
            try {
                const provSel = page.locator('select').filter({ hasText: 'Tutta Italia' }).first();
                if (await provSel.isVisible({ timeout: 3000 })) {
                    // Try by label text first
                    await provSel.selectOption({ label: provFullName }).catch(async () => {
                        // Try by value
                        await provSel.selectOption(prov).catch(async () => {
                            // Try partial match
                            await provSel.selectOption({ label: prov });
                        });
                    });
                    const selected = await provSel.evaluate(el => el.options[el.selectedIndex]?.text);
                    log.info(`Province selected: "${selected}"`);
                }
            } catch(e) {
                log.warning(`Could not set province: ${e.message}`);
            }

            // ATECO filter if provided
            if (ateco) {
                try {
                    const atecoInput = page.locator('input[name*="ateco"], input[placeholder*="ateco"], input[id*="ateco"]').first();
                    if (await atecoInput.isVisible({ timeout: 2000 })) {
                        await atecoInput.fill(ateco);
                        log.info(`ATECO filled: ${ateco}`);
                    }
                } catch { /* ignore */ }
            }

            // Submit — use force:true to bypass overlay issues
            try {
                // Try desktop search button first (not mobile)
                const submitBtn = page.locator('#btnCercaGratuitaDesk, .buttonCerca:not(.btnCercaGratuitaMob), button[onclick*="submitCaptchaCerca"]:not([id*="Mob"])').first();
                const isBtnVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
                if (isBtnVisible) {
                    await submitBtn.click({ force: true });
                    log.info('Clicked desktop search button (force)');
                } else {
                    // Fallback: JS click on form submit
                    await page.evaluate(() => {
                        const btn = document.querySelector('#btnCercaGratuitaDesk') ||
                                    document.querySelector('button[onclick*="submitCaptchaCerca"]');
                        if (btn) btn.click();
                    });
                    log.info('Clicked submit via JS');
                }
                await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
                log.info(`After submit URL: ${page.url()}`);
            } catch(e) {
                log.warning(`Submit error: ${e.message}`);
            }

            // Save results HTML
            if (collected === 0) {
                const html = await page.content();
                await Actor.setValue(`debug_results_${prov}`, html, { contentType: 'text/html' });
                log.info(`Results HTML saved: debug_results_${prov}`);
            }
        } else {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }

        await page.waitForTimeout(1000);

        // Preview page text
        const txt = await page.evaluate(() => document.body.innerText.substring(0, 600));
        log.info(`Page preview:\n${txt}`);

        // Parse results
        const { items, nextUrl, total } = await page.evaluate(() => {
            const g = (el, ...sels) => {
                for (const s of sels) { try { const f = el.querySelector(s); if (f) return f.textContent.trim(); } catch {} }
                return '';
            };

            // Total count
            let total = 0;
            const totEl = document.querySelector('[class*="totale"], [class*="risultati"], [class*="total"], [class*="count"]');
            if (totEl) { const m = totEl.textContent.match(/(\d[\d.]*)/); if (m) total = parseInt(m[1].replace(/\./g,''),10); }

            // Result rows — registroimprese.it typically uses table or list layout
            const rows = [...document.querySelectorAll('table tbody tr, .risultato, [class*="impresa-row"], [class*="company-row"], .row-impresa')];

            const items = rows.map(row => {
                const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
                const name = g(row, '.denominazione', '.ragione-sociale', 'td:first-child', 'strong', 'b') || cells[0] || '';
                if (!name || name.length < 2) return null;
                const link = row.querySelector('a');
                return {
                    ragioneSociale: name,
                    provincia: cells[1] || g(row, '.provincia') || '',
                    comune: cells[2] || g(row, '.comune', '.localita') || '',
                    indirizzo: cells[3] || g(row, '.indirizzo', '.sede') || '',
                    ateco: cells[4] || g(row, '.ateco', '.attivita') || '',
                    formaGiuridica: cells[5] || g(row, '.forma-giuridica', '.tipo') || '',
                    stato: g(row, '.stato', '.status') || '',
                    cf: g(row, '.cf', '.codice-fiscale', '.piva') || '',
                    detailUrl: link?.href || '',
                };
            }).filter(Boolean);

            // Next page
            const nextEl = document.querySelector('a[rel="next"], a.next') ||
                [...document.querySelectorAll('a')].find(a => /successiv/i.test(a.textContent));
            const nextUrl = nextEl?.href || null;

            return { items, nextUrl, total };
        });

        log.info(`Prov=${prov} pg=${pageNum}: ${items.length} companies | total=${total}`);

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
