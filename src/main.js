/**
 * Italy Companies Scraper v6
 * Source: registroimprese.it — "Ricerca libera e acquisto" (official CCIAA registry)
 * Mode:   LISTING ONLY (no detail / no PEC) — base to iterate on.
 *
 * Strategy:
 *   - Free-text search: the keyword can be a CATEGORY (es. "INFORMATICA"),
 *     a company name, or an ATECO code/description. The portlet matches it
 *     against name + activity description + ATECO.
 *   - Geographic segmentation to beat the result cap: search is repeated per
 *     province (from `regione` expansion or a single `provincia`). Without a
 *     geo filter it runs one "Tutta Italia" pass (will hit the portlet cap).
 *   - Pagination by FOLLOWING the "Successivo" link, which carries the
 *     pageToken of the next page (a Liferay JWT). We never build tokens.
 *
 * HTTP-only (CheerioCrawler / got-scraping). The results page is server-side
 * rendered, so no browser is needed. The Didomi consent banner is a JS overlay
 * and does not affect HTTP requests.
 *
 * RECON: on the first results page per province we dump the raw HTML to the
 * KV Store (debug=true) so the row selectors and the exact search params can
 * be finalized against the real markup on the first Apify run.
 */

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

const BASE = 'https://www.registroimprese.it';
const SEARCH_PATH = '/ricerca-libera-e-acquisto';
const PORTLET_ID = 'ricercaportlet_WAR_ricercaRIportlet';
const NS = `_${PORTLET_ID}_`; // Liferay namespaced-parameter prefix

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
    keyword = 'INFORMATICA',   // free-text term: category / name / ATECO
    ateco = '',
    regione = '',
    provincia = '',
    maxItems = 5000,
    maxPagesPerQuery = 50,     // cap per (keyword, provincia) result set
    debug = true,              // dump raw HTML/KV artifacts for recon
    proxyConfig: proxyConfigInput,
} = input;

const searchTerm = String(keyword || ateco || '').trim();
if (!searchTerm) {
    console.error('Obbligatorio: "keyword" (o "ateco") come termine di ricerca.');
    await Actor.exit(1);
}

// Resolve province segmentation list.
const regioneUp = String(regione).toUpperCase().trim();
const provinciaUp = String(provincia).toUpperCase().trim();
let provinces; // array of {code, name} | [{code:null}] for Tutta Italia
if (provinciaUp) {
    const code = PROVINCE_CODES[provinciaUp]
        || (Object.values(PROVINCE_CODES).includes(provinciaUp) ? provinciaUp : null);
    if (!code) { console.error(`Provincia non riconosciuta: "${provincia}"`); await Actor.exit(1); }
    const name = Object.keys(PROVINCE_CODES).find(k => PROVINCE_CODES[k] === code) || code;
    provinces = [{ code, name }];
} else if (regioneUp) {
    const codes = REGIONE_PROVINCE[regioneUp];
    if (!codes) { console.error(`Regione non riconosciuta: "${regione}"`); await Actor.exit(1); }
    provinces = codes.map(code => ({
        code,
        name: Object.keys(PROVINCE_CODES).find(k => PROVINCE_CODES[k] === code) || code,
    }));
} else {
    provinces = [{ code: null, name: null }]; // Tutta Italia (will hit cap)
}

const proxyConfiguration = proxyConfigInput
    ? await Actor.createProxyConfiguration(proxyConfigInput)
    : undefined;

console.log(`Term="${searchTerm}" | province=${provinces.map(p => p.code || 'IT').join(',')} | maxItems=${maxItems}`);

let collected = 0;
const seen = new Set();

/** Build the search URL. Param names are the best reconstruction of the Liferay
 *  portlet render request; finalized on first run from the dumped landing form. */
function buildSearchUrl({ token, term, provName }) {
    const params = new URLSearchParams({
        p_p_id: PORTLET_ID,
        p_p_lifecycle: '0',
        p_p_state: 'normal',
    });
    if (token) params.set(`${NS}pageToken`, token);
    params.set(`${NS}keyword`, term);
    if (provName) params.set(`${NS}provincia`, provName);
    return `${BASE}${SEARCH_PATH}?${params.toString()}`;
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 60,
    maxRequestRetries: 3,
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...request.headers,
                'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            };
        },
    ],

    async requestHandler({ $, request, body, log, addRequests }) {
        const { label, prov, provName, term, pageNum } = request.userData;

        // ---- LANDING: capture token + discover the real form params -------
        if (label === 'LANDING') {
            const html = typeof body === 'string' ? body : body.toString();

            // Token from a link/hidden field on the landing page.
            const m = html.match(new RegExp(`${NS}pageToken=([A-Za-z0-9._\\-]+)`));
            const token = m ? m[1] : null;

            // Discover the search form's real input names (so we stop guessing).
            const forms = [];
            $('form').each((_, f) => {
                const inputs = [];
                $(f).find('input,select,textarea').each((__, el) => {
                    const name = $(el).attr('name');
                    if (name) inputs.push({ name, type: $(el).attr('type') || el.tagName });
                });
                forms.push({ action: $(f).attr('action') || '', method: $(f).attr('method') || 'get', inputs });
            });
            log.info(`[${prov || 'IT'}] LANDING token=${token ? 'ok' : 'MISSING'} | forms=${JSON.stringify(forms).slice(0, 1200)}`);

            if (debug) {
                await Actor.setValue(`landing_${prov || 'IT'}.html`, html, { contentType: 'text/html; charset=utf-8' });
            }

            await addRequests([{
                url: buildSearchUrl({ token, term, provName }),
                userData: { label: 'RESULTS', prov, provName, term, pageNum: 1 },
            }]);
            return;
        }

        // ---- RESULTS: parse listing rows + follow "Successivo" ------------
        const html = typeof body === 'string' ? body : body.toString();
        if (debug && pageNum === 1) {
            await Actor.setValue(`results_${prov || 'IT'}_p1.html`, html, { contentType: 'text/html; charset=utf-8' });
        }

        const rows = parseListing($, { prov });
        log.info(`[${prov || 'IT'}] page ${pageNum}: parsed ${rows.length} rows (total ${collected})`);

        for (const row of rows) {
            if (collected >= maxItems) break;
            const dedupeKey = `${row.ragioneSociale}|${row.comune}|${row.descrizione}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            await Dataset.pushData(row);
            collected++;
        }

        if (collected >= maxItems) { log.info('maxItems reached, stopping.'); return; }
        if (pageNum >= maxPagesPerQuery) { log.info('maxPagesPerQuery reached.'); return; }

        // "Successivo" link carries the next pageToken.
        let nextHref = null;
        $('a').each((_, a) => {
            const txt = $(a).text().trim().toLowerCase();
            const href = $(a).attr('href');
            if (txt === 'successivo' && href && href !== '#') nextHref = href;
        });
        if (nextHref) {
            const nextUrl = nextHref.startsWith('http') ? nextHref : `${BASE}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
            await addRequests([{
                url: nextUrl,
                userData: { label: 'RESULTS', prov, provName, term, pageNum: pageNum + 1 },
            }]);
        } else {
            log.info(`[${prov || 'IT'}] no "Successivo" — end of results or cap.`);
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

/**
 * Parse one results page into listing rows.
 * NOTE: selectors are best-effort and will be finalized from the dumped HTML
 * (results_*_p1.html) after the first Apify run. We log candidate selectors so
 * we immediately see which structure matched.
 */
function parseListing($, { prov }) {
    const out = [];

    // Candidate containers for a single result row.
    const candidateSelectors = [
        '[class*="risultat"] [class*="row"]',
        '[class*="result"] [class*="item"]',
        'table tbody tr',
        'li[class*="item"]',
    ];
    let chosen = null;
    for (const sel of candidateSelectors) {
        if ($(sel).length > 0) { chosen = sel; break; }
    }
    if (!chosen) return out;

    $(chosen).each((_, el) => {
        const cells = $(el).find('td');
        if (cells.length >= 4) {
            // Table layout: Nome | Sede | Comune | Forma | Descrizione | Stato
            const txt = i => $(cells[i]).text().replace(/\s+/g, ' ').trim();
            const nome = txt(0);
            if (!nome || nome.length < 2) return;
            const link = $(el).find('a[href]').attr('href') || '';
            out.push({
                ragioneSociale: nome,
                comune: txt(2),
                provincia: prov || '',
                formaGiuridica: txt(3),
                descrizione: txt(4),
                stato: txt(5),
                detailUrl: link.startsWith('http') ? link : (link ? `${BASE}${link}` : ''),
            });
        }
    });
    return out;
}

const startRequests = provinces.map(p => ({
    url: `${BASE}${SEARCH_PATH}`,
    userData: { label: 'LANDING', prov: p.code, provName: p.name, term: searchTerm, pageNum: 0 },
    uniqueKey: `landing-${p.code || 'IT'}-${searchTerm}`,
}));

await crawler.run(startRequests);
console.log(`Done. Total saved: ${collected} companies.`);
await Actor.exit();
