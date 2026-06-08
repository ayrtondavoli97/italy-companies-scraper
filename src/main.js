/**
 * Italy Companies Scraper v8
 * Source: registroimprese.it — "Ricerca libera e acquisto" (official CCIAA registry)
 * Mode:   LISTING ONLY (no detail / no PEC).
 *
 * Why Playwright: the free search is gated by reCAPTCHA Enterprise
 * (grecaptcha.enterprise.execute(sitekey,{action:'submit'}) -> captchaResp).
 * A pure-HTTP POST is rejected with 403 (empty token => low score). The only
 * robust path is to drive the real browser: fill the box, pick the province,
 * click the real button, and let the site's own JS mint the Enterprise token
 * with genuine behavioral signals. Pagination ("Successivo") is plain GET and
 * is NOT captcha-gated, so the captcha cost is once per (keyword, province).
 *
 * IMPORTANT: Enterprise scores datacenter IPs poorly — use RESIDENTIAL proxy.
 * The remaining unknown is whether the residential score is high enough; the
 * recon screenshot + HTML dump (debug=true) tell us immediately.
 *
 * RECON: row selectors are finalized from results_*.html / screenshot_*.png on
 * the first successful run (we have never seen a real results page yet).
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const BASE = 'https://www.registroimprese.it';
const SEARCH_URL = `${BASE}/ricerca-libera-e-acquisto`;

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
    'AQUILA':'AQ',"L'AQUILA":'AQ',
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

const input = (await Actor.getInput()) ?? {};
const {
    keyword = 'INFORMATICA',
    ateco = '',
    regione = '',
    provincia = '',
    maxItems = 5000,
    maxPagesPerQuery = 50,
    debug = true,
    proxyConfig: proxyConfigInput,
} = input;

const searchTerm = String(keyword || ateco || '').trim();
if (!searchTerm) { console.error('Obbligatorio: "keyword".'); await Actor.exit(1); }

const regioneUp = String(regione).toUpperCase().trim();
const provinciaUp = String(provincia).toUpperCase().trim();
let provinces;
if (provinciaUp) {
    const code = PROVINCE_CODES[provinciaUp]
        || (Object.values(PROVINCE_CODES).includes(provinciaUp) ? provinciaUp : null);
    if (!code) { console.error(`Provincia non riconosciuta: "${provincia}"`); await Actor.exit(1); }
    provinces = [code];
} else if (regioneUp) {
    provinces = REGIONE_PROVINCE[regioneUp];
    if (!provinces) { console.error(`Regione non riconosciuta: "${regione}"`); await Actor.exit(1); }
} else {
    provinces = [null]; // Tutta Italia
}

// Default to RESIDENTIAL — Enterprise penalizes datacenter IPs.
const proxyConfiguration = await Actor.createProxyConfiguration(
    proxyConfigInput || { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
);

console.log(`Term="${searchTerm}" | province=${provinces.map(p => p || 'IT').join(',')} | maxItems=${maxItems}`);

let collected = 0;
const seen = new Set();

const startRequests = provinces.map(code => ({
    url: SEARCH_URL,
    userData: { prov: code, term: searchTerm },
    uniqueKey: `q-${code || 'IT'}-${searchTerm}`,
}));

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    headless: true,
    maxConcurrency: 1,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 300,
    launchContext: { launchOptions: { args: ['--disable-blink-features=AutomationControlled'] } },
    preNavigationHooks: [
        async ({ page }, goto) => {
            await page.setViewportSize({ width: 1366, height: 900 });
            // Block heavy assets (slow over residential). Keep CSS+JS (grecaptcha
            // + the submit JS) and document/xhr/fetch.
            await page.route('**/*', (route) => {
                const t = route.request().resourceType();
                if (t === 'image' || t === 'media' || t === 'font') return route.abort();
                return route.continue();
            });
            goto.waitUntil = 'commit'; // fire early; we wait for the form below
            goto.timeout = 90000;
        },
    ],

    async requestHandler({ page, request, log }) {
        const { prov, term } = request.userData;
        const tag = prov || 'IT';

        // Wait for the search form to be present (not the whole page load).
        try {
            await page.waitForSelector('#inputSearchField, input.inputFiltroRicerca', { timeout: 60000 });
        } catch {
            log.warning(`[${tag}] search form never appeared. Dumping for inspection.`);
            if (debug) {
                try {
                    await Actor.setValue(`screenshot_${tag}.png`, await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
                    await Actor.setValue(`results_${tag}.html`, await page.content(), { contentType: 'text/html; charset=utf-8' });
                } catch { /* ignore */ }
            }
            return;
        }
        await page.waitForTimeout(1500); // let grecaptcha attach

        // Dismiss Didomi consent banner if present (it can swallow clicks).
        for (const sel of ['#didomi-notice-agree-button', 'button:has-text("Accetta")', 'button:has-text("Acconsenti")', '.didomi-continue-without-agreeing']) {
            try {
                const b = page.locator(sel).first();
                if (await b.isVisible({ timeout: 1500 })) { await b.click(); await page.waitForTimeout(400); break; }
            } catch { /* ignore */ }
        }

        // Fill the search box (try id, then the autocomplete class, desktop one).
        let filled = false;
        for (const sel of ['#inputSearchField', 'input.inputFiltroRicerca:not(.inputFiltroRicercaMob)', 'input.inputFiltroRicerca']) {
            try {
                const inp = page.locator(sel).first();
                if (await inp.isVisible({ timeout: 2000 })) {
                    await inp.click();
                    await inp.fill(term);
                    filled = true;
                    log.info(`[${tag}] filled search via ${sel}`);
                    break;
                }
            } catch { /* try next */ }
        }
        if (!filled) log.warning(`[${tag}] could not find the search input`);

        // Select province on the underlying <select> (site JS reads it on submit).
        if (prov) {
            try {
                await page.selectOption('#selectPrv', prov, { timeout: 3000 });
                log.info(`[${tag}] province selected: ${prov}`);
            } catch (e) { log.warning(`[${tag}] selectPrv failed: ${e.message}`); }
        }
        await page.waitForTimeout(600);

        // Click the real search button -> triggers grecaptcha.enterprise + submit.
        let clicked = false;
        for (const sel of ['#btnCercaGratuita', 'button:has-text("CERCA")', '.btn-cerca-gratuita']) {
            try {
                const b = page.locator(sel).first();
                if (await b.isVisible({ timeout: 2000 })) {
                    await Promise.all([
                        page.waitForLoadState('domcontentloaded', { timeout: 35000 }).catch(() => {}),
                        b.click(),
                    ]);
                    clicked = true;
                    log.info(`[${tag}] clicked search via ${sel}`);
                    break;
                }
            } catch { /* try next */ }
        }
        if (!clicked) log.warning(`[${tag}] could not find/click the search button`);

        // Give the results render time to settle.
        await page.waitForTimeout(4000);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // RECON artifacts.
        if (debug) {
            try {
                const shot = await page.screenshot({ fullPage: true });
                await Actor.setValue(`screenshot_${tag}.png`, shot, { contentType: 'image/png' });
                await Actor.setValue(`results_${tag}.html`, await page.content(), { contentType: 'text/html; charset=utf-8' });
            } catch (e) { log.warning(`[${tag}] dump failed: ${e.message}`); }
        }

        // Did the search execute, or are we blocked / still on the form?
        const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
        const executed = /hai cercato/i.test(bodyText) || /risultati/i.test(bodyText);
        log.info(`[${tag}] after submit: url=${page.url()} executed=${executed}`);
        if (!executed) {
            log.warning(`[${tag}] no results detected — likely reCAPTCHA Enterprise score block. Check screenshot_${tag}.png.`);
        }

        // Parse + paginate.
        let pageNum = 1;
        while (true) {
            const probe = await page.evaluate(() => {
                const scope = document.querySelector('[id*="RiRisultatiRicercaImpreseGratuita"]') || document.body;
                const tries = {
                    'table tbody tr': scope.querySelectorAll('table tbody tr').length,
                    '[class*=risultat] [class*=row]': scope.querySelectorAll('[class*="risultat"] [class*="row"]').length,
                    '[class*=elenco] [class*=row]': scope.querySelectorAll('[class*="elenco"] [class*="row"]').length,
                    'div[class*=card]': scope.querySelectorAll('div[class*="card"]').length,
                    'li[class*=item]': scope.querySelectorAll('li[class*="item"]').length,
                };
                return tries;
            });
            log.info(`[${tag}] p${pageNum} selector probe: ${JSON.stringify(probe)}`);

            const rows = await page.evaluate(() => {
                const scope = document.querySelector('[id*="RiRisultatiRicercaImpreseGratuita"]') || document.body;
                let nodes = [...scope.querySelectorAll('table tbody tr')];
                if (nodes.length === 0) nodes = [...scope.querySelectorAll('[class*="risultat"] [class*="row"], [class*="elenco"] [class*="row"]')];
                const clean = s => (s || '').replace(/\s+/g, ' ').trim();
                return nodes.map(n => {
                    const tds = [...n.querySelectorAll('td')].map(td => clean(td.textContent));
                    const a = n.querySelector('a[href]');
                    if (tds.length >= 4 && tds[0] && tds[0].length > 1) {
                        return {
                            ragioneSociale: tds[0], comune: tds[2] || '',
                            formaGiuridica: tds[3] || '', descrizione: tds[4] || '',
                            stato: tds[5] || '', detailUrl: a ? a.href : '',
                        };
                    }
                    return null;
                }).filter(Boolean);
            });

            log.info(`[${tag}] page ${pageNum}: parsed ${rows.length} rows (total ${collected})`);
            for (const row of rows) {
                if (collected >= maxItems) break;
                const k = `${row.ragioneSociale}|${row.comune}|${row.descrizione}`;
                if (seen.has(k)) continue;
                seen.add(k);
                await Actor.pushData({ ...row, provincia: prov || '' });
                collected++;
            }
            if (collected >= maxItems) { log.info('maxItems reached.'); break; }
            if (pageNum >= maxPagesPerQuery) { log.info('maxPagesPerQuery reached.'); break; }

            // "Successivo" — plain navigation, no captcha.
            const next = page.locator('a:has-text("Successivo")').first();
            const hasNext = await next.count() > 0 && await next.isVisible().catch(() => false);
            if (!hasNext) { log.info(`[${tag}] no "Successivo" — end of results or cap.`); break; }
            try {
                await Promise.all([
                    page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
                    next.click(),
                ]);
                await page.waitForTimeout(1500);
                pageNum++;
            } catch (e) { log.warning(`[${tag}] pagination failed: ${e.message}`); break; }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

await crawler.run(startRequests);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
