/**
 * Italy Companies Scraper
 * Source: registroaziende.it (public data, no login required)
 * Filter by: regione / provincia (required) + ATECO, forma giuridica, stato (optional)
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// ── Province → codice mappings ────────────────────────────────────────────────
// registroaziende.it uses province abbreviations in URL
const PROVINCE = {
    'AGRIGENTO': 'AG', 'ALESSANDRIA': 'AL', 'ANCONA': 'AN', 'AOSTA': 'AO',
    'AREZZO': 'AR', 'ASCOLI PICENO': 'AP', 'ASTI': 'AT', 'AVELLINO': 'AV',
    'BARI': 'BA', 'BARLETTA-ANDRIA-TRANI': 'BT', 'BELLUNO': 'BL', 'BENEVENTO': 'BN',
    'BERGAMO': 'BG', 'BIELLA': 'BI', 'BOLOGNA': 'BO', 'BOLZANO': 'BZ',
    'BRESCIA': 'BS', 'BRINDISI': 'BR', 'CAGLIARI': 'CA', 'CALTANISSETTA': 'CL',
    'CAMPOBASSO': 'CB', 'CASERTA': 'CE', 'CATANIA': 'CT', 'CATANZARO': 'CZ',
    'CHIETI': 'CH', 'COMO': 'CO', 'COSENZA': 'CS', 'CREMONA': 'CR',
    'CROTONE': 'KR', 'CUNEO': 'CN', 'ENNA': 'EN', 'FERMO': 'FM',
    'FERRARA': 'FE', 'FIRENZE': 'FI', 'FOGGIA': 'FG', 'FORLI-CESENA': 'FC',
    'FROSINONE': 'FR', 'GENOVA': 'GE', 'GORIZIA': 'GO', 'GROSSETO': 'GR',
    'IMPERIA': 'IM', 'ISERNIA': 'IS', 'LA SPEZIA': 'SP', 'LATINA': 'LT',
    'LECCE': 'LE', 'LECCO': 'LC', 'LIVORNO': 'LI', 'LODI': 'LO',
    'LUCCA': 'LU', 'MACERATA': 'MC', 'MANTOVA': 'MN', 'MASSA-CARRARA': 'MS',
    'MATERA': 'MT', 'MESSINA': 'ME', 'MILANO': 'MI', 'MODENA': 'MO',
    'MONZA E BRIANZA': 'MB', 'NAPOLI': 'NA', 'NOVARA': 'NO', 'NUORO': 'NU',
    'ORISTANO': 'OR', 'PADOVA': 'PD', 'PALERMO': 'PA', 'PARMA': 'PR',
    'PAVIA': 'PV', 'PERUGIA': 'PG', 'PESARO E URBINO': 'PU', 'PESCARA': 'PE',
    'PIACENZA': 'PC', 'PISA': 'PI', 'PISTOIA': 'PT', 'PORDENONE': 'PN',
    'POTENZA': 'PZ', 'PRATO': 'PO', 'RAGUSA': 'RG', 'RAVENNA': 'RA',
    'REGGIO CALABRIA': 'RC', 'REGGIO EMILIA': 'RE', 'RIETI': 'RI', 'RIMINI': 'RN',
    'ROMA': 'RM', 'ROVIGO': 'RO', 'SALERNO': 'SA', 'SASSARI': 'SS',
    'SAVONA': 'SV', 'SIENA': 'SI', 'SIRACUSA': 'SR', 'SONDRIO': 'SO',
    'SUD SARDEGNA': 'SU', 'TARANTO': 'TA', 'TERAMO': 'TE', 'TERNI': 'TR',
    'TORINO': 'TO', 'TRAPANI': 'TP', 'TRENTO': 'TN', 'TREVISO': 'TV',
    'TRIESTE': 'TS', 'UDINE': 'UD', 'VARESE': 'VA', 'VENEZIA': 'VE',
    'VERBANO-CUSIO-OSSOLA': 'VB', 'VERCELLI': 'VC', 'VERONA': 'VR',
    'VIBO VALENTIA': 'VV', 'VICENZA': 'VI', 'VITERBO': 'VT',
};

// Regione → lista province (per quando l'utente passa solo la regione)
const REGIONE_PROVINCE = {
    'ABRUZZO': ['CH','AQ','PE','TE'],
    'BASILICATA': ['MT','PZ'],
    'CALABRIA': ['CZ','KR','RC','CS','VV'],
    'CAMPANIA': ['AV','BN','CE','NA','SA'],
    'EMILIA-ROMAGNA': ['BO','FE','FC','MO','PR','PC','RA','RE','RN'],
    'FRIULI-VENEZIA GIULIA': ['GO','PN','TS','UD'],
    'LAZIO': ['FR','LT','RI','RM','VT'],
    'LIGURIA': ['GE','IM','SP','SV'],
    'LOMBARDIA': ['BG','BS','CO','CR','LC','LO','MN','MI','MB','MN','PV','SO','VA'],
    'MARCHE': ['AN','FM','MC','PU','AP'],
    'MOLISE': ['CB','IS'],
    'PIEMONTE': ['AL','AT','BI','CN','NO','TO','VB','VC'],
    'PUGLIA': ['BA','BT','BR','FG','LE','TA'],
    'SARDEGNA': ['CA','NU','OR','SS','SU'],
    'SICILIA': ['AG','CL','CT','EN','ME','PA','RG','SR','TP'],
    'TOSCANA': ['AR','FI','GR','LI','LU','MS','PI','PT','PO','SI'],
    'TRENTINO-ALTO ADIGE': ['BZ','TN'],
    'UMBRIA': ['PG','TR'],
    "VALLE D'AOSTA": ['AO'],
    'VENETO': ['BL','PD','RO','TV','VE','VR','VI'],
};

const BASE = 'https://www.registroaziende.it';

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

// Resolve which province codes to scrape
let provinceCodes = [];
const regioneUp = regione.toUpperCase().trim();
const provinciaUp = provincia.toUpperCase().trim();

if (provinciaUp) {
    // Direct province name or abbreviation
    const code = PROVINCE[provinciaUp] || (Object.values(PROVINCE).includes(provinciaUp) ? provinciaUp : null);
    if (!code) {
        console.error(`Provincia non riconosciuta: "${provincia}". Usa nome completo (es. NAPOLI) o sigla (es. NA)`);
        await Actor.exit(1);
    }
    provinceCodes = [code];
} else if (regioneUp) {
    provinceCodes = REGIONE_PROVINCE[regioneUp];
    if (!provinceCodes) {
        console.error(`Regione non riconosciuta: "${regione}"`);
        await Actor.exit(1);
    }
} else {
    console.error('Input obbligatorio: inserisci almeno "regione" o "provincia"');
    await Actor.exit(1);
}

const proxyConfiguration = proxyConfigInput
    ? await Actor.createProxyConfiguration(proxyConfigInput)
    : undefined;

console.log(`Provinces to scrape: ${provinceCodes.join(', ')} | ATECO: ${ateco || 'tutti'} | Forma: ${formaGiuridica || 'tutte'} | Stato: ${statoImpresa}`);

let collected = 0;

// Build start URLs — one per province
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
        log.info(`Scraping provincia=${prov} page=${pageNum} | url=${request.url}`);

        // Wait for results to load
        await page.waitForLoadState('domcontentloaded');
        try {
            await page.waitForSelector('.company-card, .azienda-card, .result-item, table tbody tr, [class*="company"], [class*="azienda"]', { timeout: 15_000 });
        } catch {
            // Log page text for debugging selectors
            const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
            log.warning(`No results selector found on prov=${prov} pg=${pageNum}. Preview:\n${txt}`);
            // Save full HTML to KV for selector debugging on first page
            if (pageNum === 1) {
                const html = await page.content();
                await Actor.setValue(`debug_html_${prov}`, html, { contentType: 'text/html' });
                log.info(`Full HTML saved to KV: debug_html_${prov}`);
            }
            return;
        }

        const { items, totalPages } = await page.evaluate(() => {
            // ── Parse total pages ─────────────────────────────────────────
            let totalPages = 1;
            const pagEl = document.querySelector('.pagination, [class*="pagina"]');
            if (pagEl) {
                const nums = [...pagEl.querySelectorAll('a, span, li')]
                    .map(el => parseInt(el.textContent.trim()))
                    .filter(n => !isNaN(n) && n > 0);
                if (nums.length) totalPages = Math.max(...nums);
            }

            // ── Parse company cards ───────────────────────────────────────
            // Try multiple selectors progressively
            let cards = [
                ...document.querySelectorAll('.company-card, .azienda-card, .result-item, [class*="company-row"], [class*="azienda-row"]')
            ];

            // Fallback: table rows
            if (!cards.length) {
                cards = [...document.querySelectorAll('table tbody tr')].filter(tr => tr.querySelectorAll('td').length >= 2);
            }

            // Fallback: any div/li with a link containing /azienda/ or /impresa/
            if (!cards.length) {
                cards = [...document.querySelectorAll('div, li, article')].filter(el =>
                    el.querySelector('a[href*="/azienda/"], a[href*="/impresa/"], a[href*="/company/"]') &&
                    el.textContent.trim().length > 10
                ).slice(0, 200);
            }

            const g = (el, ...sels) => {
                for (const s of sels) {
                    const found = el.querySelector(s);
                    if (found) return found.textContent.trim();
                }
                return '';
            };

            const items = cards.map(card => {
                const name = g(card,
                    '.company-name', '.denominazione', '.ragione-sociale', '.nome-azienda',
                    'h2', 'h3', 'h4', 'strong', '.name', '[class*="name"]', '[class*="denom"]'
                );
                if (!name || name.length < 2) return null;

                const link = card.querySelector('a[href*="/azienda/"], a[href*="/impresa/"], a[href*="/company/"], a[href*="dettaglio"]');

                // From table cells
                const cells = [...card.querySelectorAll('td')].map(td => td.textContent.trim());

                return {
                    ragioneSociale: name,
                    piva: g(card, '.piva', '.partita-iva', '[class*="piva"]', '[class*="fiscal"]') || cells[1] || '',
                    codiceFiscale: g(card, '.cf', '.codice-fiscale', '[class*="codfis"]') || '',
                    indirizzo: g(card, '.indirizzo', '.address', '.sede', '[class*="address"]', '[class*="sede"]') || cells[2] || '',
                    comune: g(card, '.comune', '.city', '[class*="comune"]', '[class*="city"]') || '',
                    provincia: g(card, '.provincia', '.province', '[class*="prov"]') || '',
                    cap: g(card, '.cap', '.zip', '[class*="cap"]') || '',
                    ateco: g(card, '.ateco', '.settore', '[class*="ateco"]', '[class*="settore"]') || cells[3] || '',
                    descrizioneAteco: g(card, '.ateco-desc', '.settore-desc', '[class*="attivita"]') || '',
                    formaGiuridica: g(card, '.forma-giuridica', '.tipo-societa', '[class*="forma"]', '[class*="tipo"]') || cells[4] || '',
                    stato: g(card, '.stato', '.status', '[class*="stato"]', '[class*="status"]') || '',
                    dataIscrizione: g(card, '.data-iscrizione', '.data', '[class*="data"]') || '',
                    telefono: g(card, '.telefono', '.tel', '.phone', '[class*="tel"]') || '',
                    email: g(card, '.email', '.mail', '[class*="email"]') || '',
                    pec: g(card, '.pec', '[class*="pec"]') || '',
                    website: card.querySelector('a[href^="http"]:not([href*="registroaziende"])')?.href || '',
                    detailUrl: link?.href || '',
                };
            }).filter(Boolean);

            return { items, totalPages };
        });

        log.info(`Prov=${prov} pg=${pageNum}/${totalPages}: ${items.length} companies`);

        for (const item of items) {
            if (collected >= maxItems) break;
            await Actor.pushData({ ...item, _provincia: prov, _regione: regioneUp || '' });
            collected++;
        }

        // Queue next pages (only from page 1 to avoid duplicates)
        if (pageNum === 1 && totalPages > 1) {
            const nextPages = [];
            for (let p = 2; p <= totalPages && collected < maxItems; p++) {
                const url = new URL(request.url);
                url.searchParams.set('page', p);
                nextPages.push({ url: url.toString(), userData: { prov, page: p } });
            }
            if (nextPages.length) {
                await addRequests(nextPages);
                log.info(`Queued ${nextPages.length} more pages for prov=${prov}`);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

await crawler.run(startUrls);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
