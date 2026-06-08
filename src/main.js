/**
 * Italy Companies Scraper v7
 * Source: registroimprese.it — "Ricerca libera e acquisto" (official CCIAA registry)
 * Mode:   LISTING ONLY (no detail / no PEC) — base to iterate on.
 *
 * Real search mechanics (reverse-engineered from the landing form):
 *   - Search portlet:  RiRicercaImpreseGratuitaPortlet  (the form)
 *   - Results portlet: RiRisultatiRicercaImpreseGratuitaPortlet (renders rows)
 *   - The form is a POST to a Liferay ACTION url (p_p_lifecycle=1,
 *     javax.portlet.action=cerca) that carries a per-session p_auth token.
 *   - Fields: inputSearchField + filtroInputSearchField = search term;
 *     filtroProvincia = 2-letter province code (e.g. "NA"); soloNonCancellate=S;
 *     filtroScore=S; captchaResp = reCAPTCHA v3 token (EMPTY here — see note).
 *
 * Flow: GET landing -> read desktop searchForm (action+p_auth, namespace, all
 * hidden inputs) -> POST form-urlencoded -> follow 302 to the rendered results
 * -> parse rows -> follow "Successivo".
 *
 * NOTE (reCAPTCHA v3): the page loads grecaptcha with render=<sitekey> and mints
 * captchaResp via JS on submit. We POST with an EMPTY captchaResp. This run is
 * the test of whether the server enforces the v3 score on free search. If it
 * blocks, the next step is minting a token (browser) or a solver — but try
 * HTTP-only first because per-solve cost would wreck the unit economics.
 *
 * HTTP-only (CheerioCrawler / got-scraping); results are server-side rendered.
 * RECON: with debug=true we dump landing + first results HTML to the KV Store
 * to finalize the row selectors against real markup.
 */

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load } from 'cheerio';

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

const crawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    maxConcurrency: 1,
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

    async requestHandler({ $, request, log, sendRequest }) {
        const { prov, provName, term } = request.userData;

        // (1) Landing already fetched as $ (GET, same session below).
        if (debug) {
            await Actor.setValue(`landing_${prov || 'IT'}.html`, $.html(), { contentType: 'text/html; charset=utf-8' });
        }

        // (2) Read the desktop searchForm: action(+p_auth), namespace, fields.
        let $form = $('form[name$="_searchForm"]').first();
        if ($form.length === 0) $form = $('form[name$="_searchFormMob"]').first();
        if ($form.length === 0) { log.error(`[${prov || 'IT'}] searchForm not found.`); return; }

        const action = ($form.attr('action') || '').replace(/&amp;/g, '&');
        const ns = $form.attr('data-fm-namespace') || NS;
        const payload = new URLSearchParams();
        $form.find('input, select, textarea').each((_, el) => {
            const name = $(el).attr('name');
            if (name) payload.set(name, $(el).attr('value') || '');
        });
        payload.set(`${ns}inputSearchField`, term);
        payload.set(`${ns}filtroInputSearchField`, term);
        payload.set(`${ns}filtroProvincia`, prov || ''); // '' = Tutta Italia
        payload.set(`${ns}soloNonCancellate`, 'S');
        payload.set(`${ns}filtroScore`, 'S');
        payload.set(`${ns}captchaResp`, '');

        const navHeaders = {
            'content-type': 'application/x-www-form-urlencoded',
            'referer': `${BASE}${SEARCH_PATH}`,
            'origin': BASE,
            'cache-control': 'max-age=0',
            'upgrade-insecure-requests': '1',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-user': '?1',
        };
        log.info(`[${prov || 'IT'}] POST search term="${term}" fields=${[...payload.keys()].length}`);

        // (3) POST in the SAME session as the landing GET (shared cookie jar),
        //     so the per-session p_auth stays valid. Don't throw on 4xx so we
        //     can capture the block page.
        let resp;
        try {
            resp = await sendRequest({
                url: action, method: 'POST', headers: navHeaders,
                body: payload.toString(), throwHttpErrors: false, followRedirect: true,
            });
        } catch (e) { log.error(`[${prov || 'IT'}] POST error: ${e.message}`); return; }

        let html = typeof resp.body === 'string' ? resp.body : String(resp.body);
        log.info(`[${prov || 'IT'}] POST status=${resp.statusCode} finalUrl=${resp.url || action} bodyLen=${html.length}`);
        if (debug) await Actor.setValue(`post_response_${prov || 'IT'}.html`, html, { contentType: 'text/html; charset=utf-8' });

        if (resp.statusCode >= 400) {
            log.warning(`[${prov || 'IT'}] BLOCKED status=${resp.statusCode}. Inspect post_response_${prov || 'IT'}.html (WAF? Liferay auth? captcha?).`);
            return;
        }

        // (4) Parse + paginate via sendRequest in the SAME session.
        let pageNum = 1;
        while (true) {
            const $$ = load(html);
            if (debug && pageNum === 1) {
                await Actor.setValue(`results_${prov || 'IT'}_p1.html`, html, { contentType: 'text/html; charset=utf-8' });
            }
            const executed = /hai cercato/i.test(html);
            const looksLikeForm = $$('form[name$="_searchForm"]').length > 0 && !executed;
            if (pageNum === 1) log.info(`[${prov || 'IT'}] results: executed=${executed} looksLikeForm=${looksLikeForm}`);

            const rows = parseListing($$, { prov });
            log.info(`[${prov || 'IT'}] page ${pageNum}: parsed ${rows.length} rows (total ${collected})`);
            for (const row of rows) {
                if (collected >= maxItems) break;
                const k = `${row.ragioneSociale}|${row.comune}|${row.descrizione}`;
                if (seen.has(k)) continue;
                seen.add(k);
                await Dataset.pushData(row);
                collected++;
            }
            if (collected >= maxItems) { log.info('maxItems reached.'); break; }
            if (pageNum >= maxPagesPerQuery) { log.info('maxPagesPerQuery reached.'); break; }

            let nextHref = null;
            $$('a').each((_, a) => {
                const t = $$(a).text().trim().toLowerCase();
                const h = $$(a).attr('href');
                if (t === 'successivo' && h && h !== '#') nextHref = h;
            });
            if (!nextHref) { log.info(`[${prov || 'IT'}] no "Successivo" — end of results or cap.`); break; }

            const nextUrl = nextHref.startsWith('http') ? nextHref : `${BASE}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
            let r2;
            try {
                r2 = await sendRequest({
                    url: nextUrl,
                    headers: { 'referer': resp.url || `${BASE}${SEARCH_PATH}`, 'upgrade-insecure-requests': '1', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' },
                    throwHttpErrors: false,
                });
            } catch (e) { log.warning(`[${prov || 'IT'}] pagination error: ${e.message}`); break; }
            if (r2.statusCode >= 400) { log.warning(`[${prov || 'IT'}] pagination BLOCKED status=${r2.statusCode}.`); break; }
            html = typeof r2.body === 'string' ? r2.body : String(r2.body);
            pageNum++;
            await new Promise(r => setTimeout(r, 800));
        }
    },

        failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

/**
 * Parse one results page into listing rows.
 * NOTE: selectors are still best-effort. The rows render inside the
 * RiRisultatiRicercaImpreseGratuitaPortlet container; we scope there and log
 * candidate-selector counts so the real row structure is obvious from the logs.
 * Finalized against results_*_p1.html after this run.
 */
function parseListing($, { prov }) {
    const out = [];

    // Scope to the results portlet if present, else whole doc.
    let $scope = $('[id*="RiRisultatiRicercaImpreseGratuita"]');
    if ($scope.length === 0) $scope = $.root();

    // Probe candidate row containers and log their counts (recon aid).
    const candidates = [
        'table tbody tr',
        '[class*="risultat"] [class*="row"]',
        '[class*="result"] [class*="item"]',
        '[class*="elenco"] [class*="row"]',
        'li[class*="item"]',
        'div[class*="card"]',
    ];
    const probe = candidates.map(sel => `${sel}=${$scope.find(sel).length}`);
    console.log(`parseListing probe [${prov || 'IT'}]: ${probe.join(' | ')}`);

    let chosen = null;
    for (const sel of candidates) {
        if ($scope.find(sel).length > 0) { chosen = sel; break; }
    }
    if (!chosen) return out;

    $scope.find(chosen).each((_, el) => {
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
