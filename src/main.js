/**
 * Italy Companies Scraper
 * Source: registroaziende.it
 * Filter by: regione / provincia (required) + ATECO, forma giuridica, stato (optional)
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

const BASE = 'https://www.registroaziende.it';

await Actor.init();

const input = await Actor.getInput() ?? {};
const { regione='', provincia='', ateco='', formaGiuridica='', statoImpresa='ATTIVA', maxItems=5000, proxyConfig: proxyConfigInput } = input;

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
console.log(`Province: ${provinceCodes.join(', ')} | ATECO: ${ateco||'tutti'} | Stato: ${statoImpresa}`);

let collected = 0;

// ── Cookie banner helper ──────────────────────────────────────────────────────
async function dismissCookieBanner(page, log) {
    // Sourcepoint iframe banner (registroaziende.it uses this)
    try {
        const iframeEl = await page.$('iframe[id*="sp_message_iframe"], iframe[src*="sourcepoint"], iframe[src*="privacy"]');
        if (iframeEl) {
            const frame = await iframeEl.contentFrame();
            if (frame) {
                const btn = await frame.$('button:has-text("Continua senza accettare"), button:has-text("Reject"), button[title*="Reject"]');
                if (btn) {
                    await btn.click();
                    log.info('Cookie dismissed via Sourcepoint iframe');
                    await page.waitForTimeout(1500);
                    return true;
                }
            }
        }
    } catch { /* ignore */ }

    // Direct buttons on page (fallback)
    const texts = ['Continua senza accettare', 'Rifiuta', 'Reject all', 'Decline', 'Solo necessari'];
    for (const text of texts) {
        try {
            const btn = page.getByText(text, { exact: false }).first();
            if (await btn.isVisible({ timeout: 2000 })) {
                await btn.click();
                log.info(`Cookie dismissed: "${text}"`);
                await page.waitForTimeout(1500);
                return true;
            }
        } catch { /* ignore */ }
    }

    // Last resort: inject cookie consent via JS
    try {
        await page.evaluate(() => {
            // Set common consent cookies
            document.cookie = 'cookieConsent=rejected; path=/; max-age=86400';
            document.cookie = 'euconsent-v2=rejected; path=/; max-age=86400';
            // Hide overlay elements
            document.querySelectorAll('[id*="sp_message"], [class*="sp-message"], [id*="cookie-banner"], [class*="cookie-banner"], [id*="consent"]')
                .forEach(el => el.style.display = 'none');
        });
        log.info('Cookie overlay hidden via JS');
        return true;
    } catch { /* ignore */ }

    return false;
}

const startUrls = provinceCodes.map(prov => {
    const params = new URLSearchParams();
    params.set('provincia', prov);
    if (ateco) params.set('ateco', ateco);
    if (formaGiuridica) params.set('forma_giuridica', formaGiuridica);
    if (statoImpresa) params.set('stato', statoImpresa);
    params.set('page', '1');
    return { url: `${BASE}/ricerca?${params.toString()}`, userData: { prov, page: 1 } };
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    launchContext: { launchOptions: { headless: true } },
    requestHandlerTimeoutSecs: 120,
    maxConcurrency: 2,

    async requestHandler({ page, request, log, addRequests }) {
        const { prov, page: pageNum } = request.userData;
        log.info(`Scraping provincia=${prov} page=${pageNum}`);

        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Wait a moment for banner to appear, then dismiss
        await page.waitForTimeout(2000);
        await dismissCookieBanner(page, log);

        // Wait for results
        try {
            await page.waitForSelector(
                '.company-card, .azienda-card, .result-item, table tbody tr, [class*="company"], [class*="azienda"], [class*="result"]',
                { timeout: 20_000 }
            );
        } catch {
            if (pageNum === 1 && prov === provinceCodes[0]) {
                const html = await page.content();
                await Actor.setValue(`debug_html_${prov}_p${pageNum}`, html, { contentType: 'text/html' });
                log.info(`HTML saved to KV: debug_html_${prov}_p${pageNum}`);
            }
            const txt = await page.evaluate(() => document.body.innerText.substring(0, 800));
            log.warning(`No results prov=${prov} pg=${pageNum}:\n${txt}`);
            return;
        }

        const { items, totalPages } = await page.evaluate(() => {
            let totalPages = 1;
            const pagEl = document.querySelector('.pagination, [class*="pagina"], nav[aria-label*="page"]');
            if (pagEl) {
                const nums = [...pagEl.querySelectorAll('a,span,button,li')]
                    .map(el => parseInt(el.textContent.trim()))
                    .filter(n => !isNaN(n) && n > 0 && n < 10000);
                if (nums.length) totalPages = Math.max(...nums);
            }

            let cards = [...document.querySelectorAll(
                '.company-card,.azienda-card,.result-item,[class*="company-row"],[class*="azienda-row"],[class*="result-row"]'
            )];
            if (!cards.length) cards = [...document.querySelectorAll('table tbody tr')].filter(tr => tr.querySelectorAll('td').length >= 2);
            if (!cards.length) {
                cards = [...document.querySelectorAll('div,li,article')].filter(el =>
                    el.querySelector('a[href*="/azienda/"],a[href*="/impresa/"],a[href*="/company/"],a[href*="dettaglio"]') &&
                    el.textContent.trim().length > 10
                ).slice(0, 300);
            }

            const g = (el, ...sels) => { for (const s of sels) { const f = el.querySelector(s); if (f) return f.textContent.trim(); } return ''; };

            const items = cards.map(card => {
                const cells = [...card.querySelectorAll('td')].map(td => td.textContent.trim());
                const name = g(card, '.company-name','.denominazione','.ragione-sociale','.nome-azienda','h2','h3','h4','strong','.name','[class*="name"]','[class*="denom"]') || cells[0] || '';
                if (!name || name.length < 2) return null;
                const link = card.querySelector('a[href*="/azienda/"],a[href*="/impresa/"],a[href*="/company/"],a[href*="dettaglio"]');
                return {
                    ragioneSociale: name,
                    piva: g(card,'.piva','.partita-iva','[class*="piva"]') || cells[1] || '',
                    codiceFiscale: g(card,'.cf','.codice-fiscale','[class*="codfis"]') || '',
                    indirizzo: g(card,'.indirizzo','.address','.sede','[class*="address"]','[class*="sede"]') || cells[2] || '',
                    comune: g(card,'.comune','.city','[class*="comune"]') || '',
                    provincia: g(card,'.provincia','.province','[class*="prov"]') || '',
                    cap: g(card,'.cap','.zip','[class*="cap"]') || '',
                    ateco: g(card,'.ateco','[class*="ateco"]') || cells[3] || '',
                    descrizioneAteco: g(card,'.ateco-desc','[class*="attivita"]','[class*="settore"]') || '',
                    formaGiuridica: g(card,'.forma-giuridica','.tipo-societa','[class*="forma"]','[class*="tipo"]') || cells[4] || '',
                    stato: g(card,'.stato','.status','[class*="stato"]') || '',
                    dataIscrizione: g(card,'.data-iscrizione','[class*="data"]') || '',
                    telefono: g(card,'.telefono','.tel','[class*="tel"]','[class*="phone"]') || '',
                    email: g(card,'.email','[class*="email"]') || '',
                    pec: g(card,'.pec','[class*="pec"]') || '',
                    website: card.querySelector('a[href^="http"]:not([href*="registroaziende"])')?.href || '',
                    detailUrl: link?.href || '',
                };
            }).filter(Boolean);

            return { items, totalPages };
        });

        log.info(`prov=${prov} pg=${pageNum}/${totalPages}: ${items.length} companies`);

        for (const item of items) {
            if (collected >= maxItems) break;
            await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp });
            collected++;
        }

        if (pageNum === 1 && totalPages > 1) {
            const nextPages = [];
            for (let p = 2; p <= totalPages; p++) {
                if (collected >= maxItems) break;
                const url = new URL(request.url);
                url.searchParams.set('page', p);
                nextPages.push({ url: url.toString(), userData: { prov, page: p } });
            }
            if (nextPages.length) {
                await addRequests(nextPages);
                log.info(`Queued ${nextPages.length} pages for prov=${prov}`);
            }
        }
    },

    failedRequestHandler({ request, log }) { log.error(`Failed: ${request.url}`); },
});

await crawler.run(startUrls);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
