// PROJECT SOL · conectores R01–R16: cada analizador con respuestas reales grabadas (sin red), la guarda legal, la deduplicación,
// la procedencia escrita en sol_fuentes, el avance de lectura contiguo, las retractaciones y la búsqueda unificada con un conector caído.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import * as C from '../src/core/conectores.ts';
import type { Get, Respuesta } from '../src/core/conectores.ts';

const POR = 'prueba-conectores';
let db: Db; const pruebasIds: number[] = []; let auditoriaDesde = 0;
const ACCIONES_AUDITADAS = ['sol.investigar', 'sol.fuente_registrada', 'sol.retractacion_comprobada', 'sol.conectores_probados'];
const ok = (x: unknown, headers?: Record<string, string>): Respuesta => ({ status: 200, text: typeof x === 'string' ? x : JSON.stringify(x), headers });
const no = (status: number, text = ''): Respuesta => ({ status, text });

// ---------- respuestas grabadas (forma real de cada API, recortadas) ----------
const obraOA = (doi: string, extra: Record<string, unknown> = {}) => ({
  id: 'https://openalex.org/W2886993029', doi: `https://doi.org/${doi}`, title: 'Pre-sleep treatment with galantamine stimulates lucid dreaming', display_name: 'Pre-sleep treatment with galantamine stimulates lucid dreaming',
  publication_year: 2018, publication_date: '2018-08-08', type: 'article', is_retracted: false, cited_by_count: 60,
  open_access: { is_oa: true, oa_status: 'gold', oa_url: `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`, any_repository_has_fulltext: true },
  best_oa_location: { is_oa: true, landing_page_url: `https://doi.org/${doi}`, pdf_url: `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`, source: { display_name: 'PLoS ONE', type: 'journal' }, license: 'cc-by', version: 'publishedVersion' },
  locations: [
    { is_oa: true, landing_page_url: `https://doi.org/${doi}`, pdf_url: `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`, source: { display_name: 'PLoS ONE', type: 'journal' }, license: 'cc-by', version: 'publishedVersion' },
    { is_oa: true, landing_page_url: 'https://europepmc.org/articles/pmc6082533', pdf_url: null, source: { display_name: 'Europe PMC', type: 'repository' }, license: 'cc-by', version: 'publishedVersion' },
    { is_oa: true, landing_page_url: 'https://sci-hub.se/10.1371/x', pdf_url: null, source: { display_name: 'espejo pirata', type: 'repository' }, license: null, version: null },
    { is_oa: false, landing_page_url: 'https://example.com/cerrado', pdf_url: null },
  ],
  authorships: [{ author: { display_name: 'Stephen P. LaBerge' } }, { author: { display_name: 'Kristen LaMarca' } }],
  ids: { openalex: 'https://openalex.org/W2886993029', doi: `https://doi.org/${doi}`, pmid: 'https://pubmed.ncbi.nlm.nih.gov/30089135', pmcid: 'https://www.ncbi.nlm.nih.gov/pmc/articles/6082533' },
  abstract_inverted_index: { Lucid: [0], dreaming: [1], is: [2], a: [3], remarkable: [4], state: [5] }, ...extra,
});
const OA_BUSQUEDA = { meta: { count: 3 }, results: [
  { ...obraOA('10.5555/kratos-c-comun'), title: 'Quantum decoherence', ids: {} },
  { id: 'https://openalex.org/W1', doi: null, title: 'A preprint on decoherence', publication_year: 2024, type: 'preprint', is_retracted: false, cited_by_count: 2, open_access: { is_oa: true, oa_status: 'green', oa_url: 'https://arxiv.org/pdf/2401.00001' },
    best_oa_location: { is_oa: true, landing_page_url: 'http://arxiv.org/abs/2401.00001', pdf_url: 'https://arxiv.org/pdf/2401.00001', source: { display_name: 'arXiv', type: 'repository' }, license: null, version: 'submittedVersion' }, primary_location: { landing_page_url: 'http://arxiv.org/abs/2401.00001' }, authorships: [] },
  { id: 'https://openalex.org/W2', doi: 'https://doi.org/10.5555/kratos-c-retr', title: 'A retracted memory study', publication_year: 2011, type: 'article', is_retracted: true, cited_by_count: 9, open_access: { is_oa: false, oa_status: 'closed', oa_url: null }, best_oa_location: null, authorships: [{ author: { display_name: 'A. Autor' } }] },
] };
const ARXIV = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>11764</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/1205.6750v1</id>
    <title>Decoherence without
      Dissipation</title>
    <summary>That decoherence can take place in the presence of energy conservation seems to be a poorly known fact.</summary>
    <published>2012-05-30T16:40:53Z</published>
    <author><name>W. G. Unruh</name></author>
    <arxiv:doi>10.1098/rsta.2012.0163</arxiv:doi>
    <arxiv:journal_ref>Phil. Trans. R. Soc. A 370 (2012) 4454</arxiv:journal_ref>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-ph/0609145v2</id>
    <title>Baryogenesis &amp; leptogenesis</title>
    <summary>Lectures.</summary>
    <published>2006-09-14T00:00:00Z</published>
    <author><name>James M. Cline</name></author>
  </entry>
</feed>`;
const S2 = { total: 2, offset: 0, data: [
  { paperId: 'abc123', externalIds: { DOI: '10.5555/kratos-c-s2', CorpusId: 1 }, title: 'Decoherence review', year: 2019, authors: [{ authorId: '1', name: 'M. Schlosshauer' }], isOpenAccess: true, openAccessPdf: { url: 'https://arxiv.org/pdf/1911.06282', status: 'GREEN', license: 'CCBY' }, citationCount: 521, publicationTypes: ['JournalArticle', 'Review'] },
  { paperId: 'def456', externalIds: { ArXiv: '2401.00002' }, title: 'Only on arXiv', year: 2024, authors: [], isOpenAccess: true, openAccessPdf: { url: '', status: null }, citationCount: 0, publicationTypes: null },
] };
const crItem = (doi: string, extra: Record<string, unknown> = {}) => ({ DOI: doi, title: ['Quantum decoherence'], type: 'journal-article', issued: { 'date-parts': [[2019, 10, 1]] }, author: [{ given: 'Maximilian', family: 'Schlosshauer' }], 'is-referenced-by-count': 400, URL: `https://doi.org/${doi}`, ...extra });
const CR_BUSQUEDA = { status: 'ok', message: { 'total-results': 2, items: [crItem('10.5555/kratos-c-comun'), crItem('10.5555/kratos-c-libro', { type: 'book-chapter', title: ['A chapter'], license: [{ URL: 'http://creativecommons.org/licenses/by/4.0/' }] })] } };
const RETR = { DOI: '10.5555/kratos-c-aviso', type: 'retraction', label: 'Retraction', source: 'retraction-watch', updated: { 'date-parts': [[2013, 7, 23]] } };
const CR_RETRACTADO = { status: 'ok', message: crItem('10.5555/kratos-c-retr', { title: ['RETRACTED: A retracted memory study'], 'updated-by': [RETR], relation: {} }) };
const CR_CORREGIDO = { status: 'ok', message: crItem('10.5555/kratos-c-corr', { 'updated-by': [{ DOI: '10.5555/kratos-c-errata', type: 'correction', label: 'Correction', source: 'publisher', updated: { 'date-parts': [[2020, 1, 2]] } }] }) };
const CR_AVISOS = { status: 'ok', message: { 'total-results': 1, items: [crItem('10.5555/kratos-c-aviso', { title: ['Statement of Retraction'], 'update-to': [{ ...RETR, DOI: '10.5555/kratos-c-retr' }] })] } };
const PM_BUSCA = { header: { type: 'esearch' }, esearchresult: { count: '1', idlist: ['30089135'] } };
const PM_RESUMEN = { result: { uids: ['30089135'], '30089135': { uid: '30089135', title: 'Pre-sleep treatment with galantamine stimulates lucid dreaming.', pubdate: '2018', sortpubdate: '2018/08/08 00:00', authors: [{ name: 'LaBerge S' }, { name: 'LaMarca K' }],
  articleids: [{ idtype: 'pubmed', value: '30089135' }, { idtype: 'pmc', value: 'PMC6082533' }, { idtype: 'doi', value: '10.5555/kratos-c-pm' }], pubtype: ['Journal Article', 'Randomized Controlled Trial'] } } };
const EPMC = { hitCount: 2, resultList: { result: [
  { id: '30089135', source: 'MED', pmid: '30089135', pmcid: 'PMC6082533', doi: '10.5555/kratos-c-pm', title: 'Pre-sleep treatment with galantamine stimulates lucid dreaming.', authorString: 'LaBerge S, LaMarca K, Baird B.', pubYear: '2018', pubType: 'research-article; journal article', isOpenAccess: 'Y', citedByCount: 60 },
  { id: 'PPR12345', source: 'PPR', title: 'A dream preprint', authorString: 'X Y.', pubYear: '2024', pubType: 'preprint', isOpenAccess: 'N', citedByCount: 0 },
] } };
const INSPIRE = { hits: { total: 2, hits: [
  { id: '767972', metadata: { citation_count: 7, publication_info: [{ journal_volume: '663', year: 2008, journal_title: 'Phys.Lett.B' }], authors: [{ full_name: 'Gu, Pei-Hong' }], dois: [{ value: '10.1016/j.physletb.2008.04.001' }], preprint_date: '2007-11', arxiv_eprints: [{ value: '0711.2727' }], titles: [{ title: 'SO(10) GUT Baryogenesis' }] } },
  { id: '726153', metadata: { citation_count: 472, authors: [{ full_name: 'Cline, James M.' }], publication_info: [{ cnum: 'C06-07-31.1' }], preprint_date: '2006-09', titles: [{ title: 'Baryogenesis' }], arxiv_eprints: [{ value: 'hep-ph/0609145' }] } },
] } };
const OSTI = [{ osti_id: '17258222', title: 'A multi-pulse laser blow-off system on DIII-D', authors: ['Biwole, A. Tema [MIT Plasma Science and Fusion Center] (ORCID:0000000247052743)', 'Howard, N. T. [MIT]'], publication_date: '2026-10-01T00:00:00Z', doi: '10.1063/5.0353742', product_type: 'Journal Article', description: 'A <sup>Laser</sup> Blow-Off system.',
  links: [{ rel: 'citation', href: 'https://www.osti.gov/biblio/17258222' }, { rel: 'fulltext', href: 'https://www.osti.gov/servlets/purl/17258222' }] }];
const NTRS = { stats: { total: 1 }, results: [{ id: 20150023082, title: 'Ion propulsion test', authorAffiliations: [{ sequence: 1, meta: { author: { name: 'Second, B.' } } }, { sequence: 0, meta: { author: { name: 'First, A.' } } }], publications: [{ publicationDate: '2015-07-01T00:00:00.0000000+00:00' }],
  distribution: 'PUBLIC', downloadsAvailable: true, downloads: [{ links: { original: '/api/citations/20150023082/downloads/20150023082.pdf', pdf: '/api/citations/20150023082/downloads/20150023082.pdf' } }], stiType: 'CONFERENCE_PAPER', copyright: { determinationType: 'PUBLIC_USE_PERMITTED' }, abstract: 'Thruster tests.' }] };
const ADS = { responseHeader: { status: 0 }, response: { numFound: 1, docs: [{ bibcode: '2019PhR...831....1S', title: ['Quantum decoherence'], author: ['Schlosshauer, M.'], year: '2019', doi: ['10.5555/kratos-c-comun'], property: ['REFEREED', 'OPENACCESS'], citation_count: 500 }] } };
const IA = { response: { numFound: 3, docs: [
  { identifier: 'turbaphilosophor00gratiala', title: 'The Turba philosophorum', creator: 'Waite, Arthur Edward', year: 1896, mediatype: 'texts', 'possible-copyright-status': 'NOT_IN_COPYRIGHT' },
  { identifier: 'lettersofalchemy0000king', title: 'Letters of alchemy', year: 2017, mediatype: 'texts', 'access-restricted-item': 'true' },
  { identifier: 'rosary-of-the-philosophers', title: ['The Rosary Of The Philosophers'], licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/', mediatype: 'texts' },
] } };
const GUT = { count: 1, results: [{ id: 61112, title: 'A New Light of Alchymie', authors: [{ name: 'Sedziwój, Michal' }, { name: 'Paracelsus' }], copyright: false, summaries: ['A treatise of alchemy.'], formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/61112.txt.utf-8' } }] };
const WC = { type: 'ResultList', totalResults: 2, results: [
  { id: 'w82mzw4u', title: 'Alchemy papers', workType: { id: 'h', label: 'Archives and manuscripts' }, availabilities: [{ id: 'closed-stores', label: 'Closed stores' }], description: '<p>Papers about alchemy.</p>', production: [{ dates: [{ label: '1930-1950' }] }], contributors: [] },
  { id: 'yq7qh9zv', title: 'Alchemy and the Alchemists.', workType: { id: 'a', label: 'Books' }, availabilities: [{ id: 'online', label: 'Online' }], production: [{ dates: [{ label: '[1850]' }] }],
    contributors: [{ agent: { label: 'Glasgow University Library' }, roles: [{ label: 'data contributor' }] }, { agent: { label: 'Hitchcock, E. A.' }, roles: [] }],
    items: [{ locations: [{ url: 'https://iiif.wellcomecollection.org/presentation/v2/b24926681', license: { id: 'pdm', label: 'Public Domain Mark', url: 'https://creativecommons.org/share-your-work/public-domain/pdm/' } }] }] },
] };
const DESAFIO = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com cf-chl</body></html>';
const EA_INDICE = `<HTML><head><TITLE>Twilit Grotto -- Esoteric Archives</TITLE><script>var x = "<a href='no.htm'>agrippa falso</a>";</script></head><body>
  <A HREF="agrippa/index.html">Henrich Cornelius Agrippa</A> <A HREF="agrippa/op1.htm">Of Occult Philosophy I: <i>Natural</i> Magic</A>
  <a href='tritheim/stegano.htm'>Steganographia</a> <A HREF="gifs/agrippa.gif">agrippa</A> <a href="https://www.amazon.com/agrippa">Agrippa en Amazon</a> <a href="#arriba">agrippa ancla</a></body></HTML>`;
const IAP_INDICE = `<html><head><title>IAPSOP</title></head><body><a href="https://iapsop.com/archive/materials/banner_of_light/index.html">Banner of Light</a>
  <a class="mission-link" href="https://iapsop.com/archive/materials/spiritual_telegraph/index.html">Spiritual Telegraph</a> <a href="/lessons/">Occult lessons archive</a></body></html>`;
const parrafos = (n: number, txt = 'palabra') => `${txt} `.repeat(n);
const XML_PMC = `<?xml version="1.0"?><article><front><article-meta><article-title>Lectura de prueba de conectores</article-title></article-meta></front><body><sec><p>${parrafos(9000)}</p></sec></body><back><ref-list><ref>cita</ref></ref-list></back></article>`;   // ~72.000 caracteres

function pdfMinimo(lineas: string[]): string {
  const flujo = `BT /F1 10 Tf 72 760 Td ${lineas.map((l) => `(${l}) Tj 0 -13 Td`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  return out + `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const PDF_ABIERTO = pdfMinimo(Array.from({ length: 40 }, (_, i) => `Linea ${i + 1} del articulo abierto de prueba sobre suenos lucidos.`));
const PDF_OSTI = pdfMinimo(['A multi-pulse laser blow-off system on DIII-D', ...Array.from({ length: 40 }, (_, i) => `Linea ${i + 1} del informe tecnico de fusion por confinamiento magnetico.`)]);
const PDF_ARXIV = pdfMinimo(['Un preprint sin HTML', ...Array.from({ length: 40 }, (_, i) => `Linea ${i + 1} del texto completo del preprint en PDF.`)]);

// Red simulada: tabla de [patrón, respuesta]; registra cada URL pedida
type Tabla = [RegExp, Respuesta | ((u: string, h?: Record<string, string>) => Respuesta)][];
function red(extra: Tabla = [], llamadas: { url: string; headers?: Record<string, string> }[] = []): Get {
  const tabla: Tabla = [...extra,
    [/api\.openalex\.org\/works\/doi:10\.5555\/kratos-c-retr/, ok(obraOA('10.5555/kratos-c-retr', { is_retracted: true, open_access: { is_oa: false }, best_oa_location: null, locations: [], ids: {} }))],
    [/api\.openalex\.org\/works\/doi:10\.5555\/kratos-c-html/, ok(obraOA('10.5555/kratos-c-html', { ids: {}, best_oa_location: null, open_access: { is_oa: true, oa_status: 'bronze' }, locations: [{ is_oa: true, landing_page_url: 'https://publisher.example/abierto', pdf_url: null, license: null }] }))],
    [/api\.openalex\.org\/works\/doi:10\.5555\/kratos-c-pdf/, ok(obraOA('10.5555/kratos-c-pdf', { ids: {}, locations: [] }))],
    [/api\.openalex\.org\/works\/doi:/, (u) => ok(obraOA(decodeURIComponent(/doi:([^?]+)/.exec(u)![1])))],
    [/api\.openalex\.org\/works\?search=/, ok(OA_BUSQUEDA)],
    [/export\.arxiv\.org\/api\/query/, ok(ARXIV)],
    [/api\.semanticscholar\.org/, ok(S2)],
    [/api\.crossref\.org\/works\?filter=update-type:retraction/, ok(CR_AVISOS)],
    [/api\.crossref\.org\/works\?query=/, ok(CR_BUSQUEDA)],
    [/api\.crossref\.org\/works\/10\.5555\/kratos-c-retr/, ok(CR_RETRACTADO)],
    [/api\.crossref\.org\/works\/10\.5555\/kratos-c-corr/, ok(CR_CORREGIDO)],
    [/api\.crossref\.org\/works\/10\.5555\/kratos-c-titulo/, ok({ status: 'ok', message: crItem('10.5555/kratos-c-titulo', { title: ['Galantamine and lucid dreaming: a crossover study'] }) })],
    [/api\.crossref\.org\/works\/10\./, no(404, 'Resource not found.')],   // DOI desconocido para Crossref (p. ej. de DataCite): el título queda «no contrastado»
    [/eutils\.ncbi\.nlm\.nih\.gov\/.*esearch/, ok(PM_BUSCA)],
    [/eutils\.ncbi\.nlm\.nih\.gov\/.*esummary/, ok(PM_RESUMEN)],
    [/europepmc\/webservices\/rest\/search/, ok(EPMC)],
    [/europepmc\/webservices\/rest\/PMC999000333\/fullTextXML/, ok(`<?xml version="1.0"?><article><front><article-meta><article-title>Solo el resumen</article-title><abstract><p>${parrafos(400, 'resumen')}</p></abstract></article-meta></front></article>`)],
    [/europepmc\/webservices\/rest\/PMC\d+\/fullTextXML/, ok(XML_PMC)],
    [/inspirehep\.net\/api\/literature/, ok(INSPIRE)],
    [/osti\.gov\/api\/v1\/records/, ok(OSTI, { 'x-total-count': '67251' })],
    [/osti\.gov\/biblio\/17258222/, ok('<html><head><title>A multi-pulse laser blow-off system on DIII-D (Journal Article) | OSTI.GOV</title></head><body>ficha</body></html>', { 'content-type': 'text/html' })],
    [/osti\.gov\/servlets\/purl\/17258222/, (_u) => ok(PDF_OSTI, { 'content-type': 'application/pdf' })],
    [/ntrs\.nasa\.gov\/api\/citations\/search/, ok(NTRS)],
    [/api\.adsabs\.harvard\.edu/, ok(ADS)],
    [/archive\.org\/advancedsearch\.php/, ok(IA)],
    [/archive\.org\/metadata\/lettersofalchemy0000king/, ok({ metadata: { 'access-restricted-item': 'true' }, files: [{ name: 'x_djvu.txt' }] })],
    [/archive\.org\/metadata\//, ok({ metadata: { title: 'The Turba philosophorum, or, Assembly of the sages', 'possible-copyright-status': 'NOT_IN_COPYRIGHT' }, files: [{ name: 'turba.pdf' }, { name: 'turba_djvu.txt' }] })],
    [/archive\.org\/download\/.+\.txt/, ok(`THE TURBA PHILOSOPHORUM\n${parrafos(400, 'sabio')}`)],
    [/gutendex\.com\/books/, ok(GUT)],
    [/gutenberg\.org\/ebooks\/\d+\.txt\.utf-8/, ok(`The Project Gutenberg eBook of A New Light of Alchymie\r\nTitle: A New Light of Alchymie\r\nAuthor: Sedziwój\r\n\r\n*** START OF THE PROJECT GUTENBERG EBOOK A NEW LIGHT OF ALCHYMIE ***\r\n${parrafos(300, 'alquimia')}\r\n*** END OF THE PROJECT GUTENBERG EBOOK A NEW LIGHT OF ALCHYMIE ***\r\nSection 1. General Terms of Use ${parrafos(200, 'licencia')}`)],
    [/hermetic\.com/, no(403, DESAFIO)],
    [/sacred-texts\.com/, no(403, DESAFIO)],
    [/esotericarchives\.com\/agrippa\/op1\.htm/, ok(`<html><head><title>Agrippa: Occult Philosophy I</title><style>p{}</style></head><body><h1>Of Occult Philosophy</h1><p>${parrafos(200, 'magia&nbsp;natural')}</p></body></html>`)],
    [/esotericarchives\.com/, ok(EA_INDICE)],
    [/iapsop\.com/, ok(IAP_INDICE)],
    [/api\.wellcomecollection\.org/, ok(WC)],
    [/api\.unpaywall\.org\/v2\//, ok({ doi: 'x', is_oa: true, best_oa_location: { url_for_pdf: 'https://zenodo.org/records/1/files/a.pdf', url_for_landing_page: 'https://zenodo.org/records/1', license: 'cc-by', version: 'acceptedVersion', host_type: 'repository' }, oa_locations: [] })],
    [/doi\.org\/api\/handles\/10\.5555\/kratos-c-existe/, ok({ responseCode: 1, handle: '10.5555/kratos-c-existe' })],
    [/doi\.org\/api\/handles\//, no(404, '{"responseCode":100}')],
    [/doi\.org\/10\.5555\/kratos-c-(existe|caida)/, no(403, 'Forbidden')],
    [/doi\.org\//, ok('<html><head><title>Página del editor</title></head><body>ok</body></html>', { 'content-type': 'text/html' })],
    [/journals\.plos\.org\/.*kratos-c-pdf/, ok(PDF_ABIERTO, { 'content-type': 'application/pdf' })],
    [/journals\.plos\.org\/.*kratos-c-html-falso/, ok('<html><body>Inicia sesión para comprar</body></html>')],
    [/\/\/arxiv\.org\/html\/1205\.6750/, no(404, 'No HTML')],
    [/ar5iv\.labs\.arxiv\.org\/html\/1205\.6750/, ok(`<html><head><title>[1205.6750] Decoherence without Dissipation</title></head><body><nav>menu</nav><article class="ltx_document"><p>${parrafos(500, 'decoherencia')}</p><math alttext="E=mc^2"><mi>E</mi></math></article></body></html>`)],
    // ar5iv sin el artículo: 307 a la página del resumen (comprobado en vivo con 2510.99999); el cliente real sigue la redirección
    [/ar5iv\.labs\.arxiv\.org\/html\/2401\.00009/, ok(`<html><head><title>[2401.00009] Un preprint sin HTML</title></head><body><h1>Un preprint sin HTML</h1><blockquote class="abstract">${parrafos(200, 'resumen')}</blockquote></body></html>`, { 'x-url-final': 'https://arxiv.org/abs/2401.00009' })],
    [/\/\/arxiv\.org\/pdf\/2401\.00009/, (_u) => ok(PDF_ARXIV, { 'content-type': 'application/pdf' })],
    [/(hermetica\.uva\.nl|amsterdamhermetica|esswe\.org|embassyofthefreemind|warburg|wellcomecollection\.org)/, ok('<html><title>directorio</title></html>')],
  ];
  return async (url, init) => {
    llamadas.push({ url, headers: init?.headers });
    for (const [rx, v] of tabla) if (rx.test(url)) return typeof v === 'function' ? v(url, init?.headers) : v;
    return no(404, 'sin fixture');
  };
}

before(async () => {
  db = createPool(); await migrate(db, () => {});
  auditoriaDesde = (await db.query(`SELECT coalesce(max(id), 0)::int AS m FROM audit_log`)).rows[0].m;
  C.AJUSTES.espera429Ms = 0; C.AJUSTES.esperaOpenAlexMs = 0;
  C.SECRETOS.leer = () => null;   // sin llavero en las pruebas
});
after(async () => {
  await db.query(`DELETE FROM sol_fuentes WHERE created_by = $1`, [POR]);
  if (pruebasIds.length) await db.query(`DELETE FROM sol_conectores_pruebas WHERE id = ANY($1)`, [pruebasIds]);
  await db.query(`DELETE FROM system_state WHERE key = 'unpaywall_email' AND updated_by = $1`, [POR]);
  await db.end();   // audit_log es de solo inserción (lo impone un disparador): sus filas no se borran
});

// ---------- analizadores ----------
test('R01 OpenAlex: estado (retractado, preprint), acceso abierto, resumen invertido, PMC y DOI', () => {
  const r = OA_BUSQUEDA.results.map((w) => C.parseOpenAlexWork(w));
  assert.equal(r[0].doi, '10.5555/kratos-c-comun'); assert.equal(r[0].url, 'https://doi.org/10.5555/kratos-c-comun'); assert.equal(r[0].estado_publicacion, 'publicado');
  assert.equal(r[0].texto_disponible, true); assert.match(String(r[0].permisos), /cc-by/); assert.equal(r[0].resumen, 'Lucid dreaming is a remarkable state'); assert.equal(r[0].citas, 60);
  assert.equal(r[1].estado_publicacion, 'preprint'); assert.equal(r[1].doi, null); assert.equal(r[1].url, 'http://arxiv.org/abs/2401.00001'); assert.equal(r[1].arxiv, '2401.00001');
  assert.equal(r[2].estado_publicacion, 'retractado'); assert.equal(r[2].texto_disponible, false); assert.match(String(r[2].permisos), /solo metadatos/);
  const w = C.parseOpenAlexWork(obraOA('10.5555/kratos-c-x'));
  assert.equal(w.pmcid, 'PMC6082533'); assert.equal(w.identificador, 'W2886993029'); assert.equal(w.autores, 'Stephen P. LaBerge; Kristen LaMarca');
  assert.equal(w.ubicaciones_oa.length, 3);                                        // la cerrada no cuenta (la pirata se filtra después, en legalPorDoi)
});

test('R01: un 429 de OpenAlex se reintenta una vez (Retry-After del cuerpo) y si persiste se informa sin inventar', async () => {
  const lim = no(429, '{"error":"Rate limit exceeded","retryAfter":40}');
  let n = 0; assert.equal((await C.BUSCADORES.R01('decoherence', 3, async () => (n++ ? ok(OA_BUSQUEDA) : lim))).registros.length, 3); assert.equal(n, 2);
  await assert.rejects(C.BUSCADORES.R01('decoherence', 3, async () => lim), /OpenAlex limitó la búsqueda anónima \(429\).*kratos-openalex.*no se inventan/);
});

test('R02 arXiv: Atom con expresiones regulares, id sin versión, DOI publicado, texto en arxiv.org/html; error del API se informa', () => {
  const r = C.parseArxiv(ARXIV);
  assert.equal(r.length, 2);
  assert.equal(r[0].identificador, 'arXiv:1205.6750'); assert.equal(r[0].titulo, 'Decoherence without Dissipation'); assert.equal(r[0].doi, '10.1098/rsta.2012.0163');
  assert.equal(r[0].estado_publicacion, 'preprint'); assert.equal(r[0].texto_url, 'https://arxiv.org/html/1205.6750'); assert.match(String(r[0].permisos), /Phil\. Trans/);
  assert.equal(r[1].identificador, 'arXiv:hep-ph/0609145'); assert.equal(r[1].titulo, 'Baryogenesis & leptogenesis'); assert.equal(r[1].anio, 2006);
  assert.throws(() => C.parseArxiv('<feed><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title><summary>incorrect id format</summary></entry></feed>'), /arXiv devolvió un error/);
});

test('R03 Semantic Scholar: campos, PDF abierto y preprint; un 429 se reintenta una vez y si persiste se informa sin inventar', async () => {
  const r = C.parseS2(S2);
  assert.equal(r[0].doi, '10.5555/kratos-c-s2'); assert.equal(r[0].estado_publicacion, 'publicado'); assert.equal(r[0].texto_url, 'https://arxiv.org/pdf/1911.06282'); assert.equal(r[0].citas, 521);
  assert.equal(r[1].estado_publicacion, 'preprint'); assert.equal(r[1].identificador, 'arXiv:2401.00002'); assert.equal(r[1].texto_url, null);
  let n = 0; const una429: Get = async () => (n++ === 0 ? no(429, '{"message":"Too Many Requests"}') : ok(S2));
  assert.equal((await C.BUSCADORES.R03('decoherence', 2, una429)).registros.length, 2); assert.equal(n, 2);
  let m = 0; const siempre429: Get = async () => { m++; return no(429, '{"message":"Too Many Requests"}'); };
  await assert.rejects(C.BUSCADORES.R03('decoherence', 2, siempre429), /429.*no se inventan/); assert.equal(m, 2);
});

test('R04 Crossref: retractación (updated-by y título RETRACTED), corrección, aviso de otra obra, licencia abierta', () => {
  const a = C.parseCrossrefItem(CR_RETRACTADO.message);
  assert.equal(a.retractado, true); assert.equal(a.registro.estado_publicacion, 'retractado'); assert.match(String(a.registro.correcciones), /retraction \(aviso 10\.5555\/kratos-c-aviso\) 2013-07-23 \[retraction-watch\]/);
  const c = C.parseCrossrefItem(CR_CORREGIDO.message); assert.equal(c.corregido, true); assert.equal(c.registro.estado_publicacion, 'corregido');
  const n = C.parseCrossrefItem(CR_AVISOS.message.items[0]); assert.equal(n.retractado, false); assert.equal(n.aviso_de, '10.5555/kratos-c-retr'); assert.equal(n.registro.estado_publicacion, 'publicado');
  const l = C.parseCrossrefItem(CR_BUSQUEDA.message.items[1]); assert.equal(l.registro.estado_publicacion, 'libro'); assert.equal(l.registro.texto_disponible, true); assert.match(String(l.registro.permisos), /creativecommons/);
  assert.equal(C.parseCrossrefItem(CR_BUSQUEDA.message.items[0]).registro.fecha, '2019-10-01');
});

test('R05 PubMed y Europe PMC: PMCID, DOI, preprints, acceso abierto; si PubMed falla, Europe PMC sigue', async () => {
  const p = C.parsePubmedResumen(PM_RESUMEN)[0];
  assert.equal(p.identificador, 'PMC6082533'); assert.equal(p.doi, '10.5555/kratos-c-pm'); assert.equal(p.fecha, '2018-08-08'); assert.equal(p.titulo.endsWith('.'), false); assert.equal(p.texto_disponible, true);
  const e = C.parseEuropePmc(EPMC);
  assert.equal(e[0].texto_url, 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6082533/fullTextXML'); assert.equal(e[1].estado_publicacion, 'preprint'); assert.equal(e[1].texto_disponible, false);
  const r = await C.BUSCADORES.R05('lucid dreaming', 3, red());
  assert.equal(r.registros.filter((x) => x.doi === '10.5555/kratos-c-pm').length, 1);                // PubMed y Europe PMC fusionados por DOI
  const caido = await C.BUSCADORES.R05('lucid dreaming', 3, red([[/esearch/, ok({ esearchresult: { ERROR: 'Search Backend failed: Cannot connect to SOLR' } })]]));
  assert.match(String(caido.aviso), /Parcial: PubMed: Search Backend failed/); assert.equal(caido.registros.length, 2);
});

test('R06 INSPIRE, R07 OSTI, R08 NTRS: campos normalizados', async () => {
  const i = C.parseInspire(INSPIRE);
  assert.equal(i[0].estado_publicacion, 'publicado'); assert.equal(i[0].doi, '10.1016/j.physletb.2008.04.001'); assert.equal(i[0].anio, 2008); assert.equal(i[0].identificador, 'arXiv:0711.2727');
  assert.equal(i[1].estado_publicacion, 'preprint'); assert.equal(i[1].url, 'https://inspirehep.net/literature/726153'); assert.equal(i[1].citas, 472);
  const o = C.parseOsti(OSTI)[0];
  assert.equal(o.autores, 'Biwole, A. Tema; Howard, N. T.'); assert.equal(o.texto_url, 'https://www.osti.gov/servlets/purl/17258222'); assert.equal(o.resumen, 'A Laser Blow-Off system.'); assert.equal(o.fecha, '2026-10-01');
  const n = C.parseNtrs(NTRS)[0];
  assert.equal(n.autores, 'First, A.; Second, B.'); assert.equal(n.texto_url, 'https://ntrs.nasa.gov/api/citations/20150023082/downloads/20150023082.pdf'); assert.match(String(n.permisos), /PUBLIC_USE_PERMITTED/);
  assert.equal((await C.BUSCADORES.R07('fusion', 3, red())).total, 67251);
});

test('R08: sin token de ADS queda BLOQUEADO y NTRS funciona; con token se llama a ADS con autorización', async () => {
  const sin = await C.BUSCADORES.R08('ion propulsion', 3, red());
  assert.equal(sin.partes?.NTRS, 1); assert.match(String(sin.partes?.ADS), /BLOQUEADO.*kratos-ads/);
  const llamadas: { url: string; headers?: Record<string, string> }[] = [];
  C.SECRETOS.leer = (s) => (s === 'kratos-ads' ? 'token-de-prueba' : null);
  try {
    const con = await C.BUSCADORES.R08('ion propulsion', 3, red([], llamadas));
    assert.equal(con.partes?.ADS, 1); assert.equal(llamadas.find((l) => l.url.includes('adsabs'))?.headers?.Authorization, 'Bearer token-de-prueba');
    const ads = C.parseAds(ADS)[0]; assert.equal(ads.estado_publicacion, 'publicado'); assert.equal(ads.texto_disponible, true); assert.equal(ads.url, 'https://ui.adsabs.harvard.edu/abs/2019PhR...831....1S/abstract');
  } finally { C.SECRETOS.leer = () => null; }
});

test('R10 Internet Archive y Gutenberg; R13/R14 Wellcome: licencias, préstamo controlado y manuscritos', async () => {
  const a = C.parseArchive(IA);
  assert.equal(a[0].texto_disponible, true); assert.match(String(a[0].permisos), /dominio público/);
  assert.equal(a[1].texto_disponible, false); assert.match(String(a[1].permisos), /préstamo controlado/); assert.equal(a[1].texto_url, null);
  assert.equal(a[2].titulo, 'The Rosary Of The Philosophers'); assert.match(String(a[2].permisos), /publicdomain/);
  const g = C.parseGutendex(GUT)[0]; assert.equal(g.texto_url, 'https://www.gutenberg.org/ebooks/61112.txt.utf-8'); assert.equal(g.estado_publicacion, 'libro'); assert.equal(g.anio, null);
  const w = C.parseWellcome(WC, 'R14');
  assert.equal(w[0].estado_publicacion, 'manuscrito'); assert.equal(w[0].texto_disponible, false); assert.match(String(w[0].permisos), /Closed stores/);
  assert.equal(w[1].estado_publicacion, 'libro'); assert.equal(w[1].autores, 'Hitchcock, E. A.'); assert.equal(w[1].anio, 1850); assert.match(String(w[1].permisos), /Public Domain Mark/);
  const llamadas: { url: string }[] = [];
  const r14 = await C.BUSCADORES.R14('alchemy', 3, red([], llamadas));
  assert.ok(llamadas.some((l) => l.url.includes('availabilities=online'))); assert.ok(llamadas.some((l) => decodeURIComponent(l.url).includes('licenseurl:* OR possible-copyright-status:NOT_IN_COPYRIGHT')));
  assert.ok(r14.registros.every((x) => x.conector === 'R14'));
  assert.match(String((await C.BUSCADORES.R13('alchemy', 3, red())).aviso), /hermetica\.uva\.nl/);
});

test('R11/R12: palabras clave sobre los enlaces del índice; un desafío anti-bots se informa y no se insiste', async () => {
  const l = C.enlaces(EA_INDICE, 'https://www.esotericarchives.com/esoteric.htm');
  assert.ok(l.some((x) => x.url === 'https://www.esotericarchives.com/agrippa/op1.htm' && x.texto === 'Of Occult Philosophy I: Natural Magic'));
  const m = C.coincidencias(l, 'Agrippa', 'esotericarchives.com', 10);
  assert.ok(m.every((x) => x.url.startsWith('https://www.esotericarchives.com/') && !x.url.endsWith('.gif')));          // solo del propio sitio, sin imágenes ni anclas
  assert.ok(!m.some((x) => x.url.includes('no.htm')));                                                                 // los enlaces dentro de <script> se ignoran al buscar texto
  assert.equal(C.coincidencias(l, 'occult philosophy', 'esotericarchives.com', 10)[0].url, 'https://www.esotericarchives.com/agrippa/op1.htm');
  const r11 = await C.BUSCADORES.R11('agrippa', 5, red());
  assert.ok(r11.registros.length >= 1); assert.equal(r11.registros[0].permisos, 'consulta en línea; derechos según cada texto');
  assert.match(String(r11.aviso), /PARCIAL: hermetic\.com: BLOQUEADO.*Cloudflare.*no se elude/);
  const llamadas: { url: string }[] = [];
  const r12 = await C.BUSCADORES.R12('spiritual', 5, red([], llamadas));
  assert.equal(llamadas.filter((x) => x.url.includes('sacred-texts.com')).length, 1);                              // tras el bloqueo no se piden las otras 8 páginas
  assert.ok(r12.registros.some((x) => x.url === 'https://iapsop.com/archive/materials/spiritual_telegraph/index.html'));
  // …/banner_of_light/ y …/banner_of_light/index.html son la misma página: un solo resultado
  assert.equal(C.claveUrl('https://iapsop.com/archive/materials/banner_of_light/'), C.claveUrl('https://www.iapsop.com/archive/materials/banner_of_light/index.html'));
  const dup = C.enlaces(`${IAP_INDICE}<a href="/archive/materials/banner_of_light/">Banner of Light</a>`, 'https://iapsop.com/');
  assert.equal(C.coincidencias(dup, 'banner of light', 'iapsop.com', 5).length, 1);
  await assert.rejects(C.BUSCADORES.R11('agrippa', 5, red([[/esotericarchives\.com/, no(500)]])), /hermetic\.com: BLOQUEADO/);
});

test('utilidades: HTML a texto (sin scripts ni menús, entidades y fórmulas), DOI, desafío anti-bots', () => {
  const t = C.htmlATexto('<html><head><title>x</title><script>alert(1)</script></head><body><nav>Menú</nav><p>Hermes &amp; Thot&#8212;&eacute;l</p><math alttext="x^2"><mi>x</mi></math></body></html>');
  assert.equal(t, 'Hermes & Thot—él\nx^2');
  // páginas con <article> (arXiv HTML): solo el contenido principal, sin «Skip to main content» ni la cabecera del sitio
  const pag = `<html><body><a class="skip-main" href="#main">Skip to main content</a><header class="desktop_header">Why HTML? Report Issue</header><article class="ltx_document"><h1>Decoherence</h1><p>${parrafos(80, 'cuerpo')}</p></article></body></html>`;
  assert.match(C.textoPrincipalHtml(pag), /^Decoherence\n+cuerpo/); assert.doesNotMatch(C.textoPrincipalHtml(pag), /Skip to main|Why HTML/);
  assert.match(C.textoPrincipalHtml(`<html><body><p>Skip</p><article>corto</article><p>${parrafos(80, 'texto')}</p></body></html>`), /^Skip\s+corto\s+texto/);   // un <article> sin texto suficiente no recorta la página
  assert.equal(C.sinLicenciaGutenberg('sin marcas'), 'sin marcas');
  assert.equal(C.limpiarDoi('https://doi.org/10.1371/journal.pone.0201246'), '10.1371/journal.pone.0201246'); assert.equal(C.limpiarDoi('doi: 10.1/x'), null); assert.equal(C.limpiarDoi('basura'), null);
  assert.equal(C.desafioAntibots(no(403, DESAFIO)), true); assert.equal(C.desafioAntibots(no(404, 'no hay')), false);
  // la cabecera User-Agent va en ASCII (la misma identidad): un byte suelto «ó» hace que Cloudflare rechace la petición por mal formada
  assert.equal(C.UA, 'KRATOS-SOL/1.0 (investigación; acceso legal)'); assert.equal(C.UA_HTTP, 'KRATOS-SOL/1.0 (investigacion; acceso legal)'); assert.match(C.UA_HTTP, /^[\x20-\x7e]+$/);
});

// ---------- R15 guarda legal ----------
test('R15: las bibliotecas en la sombra se rechazan siempre, también incrustadas; nunca se pide la URL', async () => {
  for (const u of ['https://sci-hub.se/10.1371/x', 'http://www.sci-hub.ru/', 'https://libgen.is/book', 'https://library.lol/main/x', 'https://z-lib.org/', 'https://annas-archive.org/md5/1', 'https://1lib.sk/', 'https://singlelogin.re/', 'https://gen.lib.rus.ec/x',
    'https://example.org/proxy?u=https%3A%2F%2Fsci-hub.st%2F10.1%2Fx'])
    assert.match(String(C.dominioBloqueado(u)), /biblioteca en la sombra.*legal_por_doi/, u);
  for (const u of ['https://zlib.net/', 'https://arxiv.org/abs/1205.6750', 'https://www.ebi.ac.uk/europepmc/', 'https://scholar.archive.org/', 'https://doi.org/10.1371/x']) assert.equal(C.dominioBloqueado(u), null, u);
  assert.ok(C.DOMINIOS_BLOQUEADOS.includes('sci-hub.*') && C.DOMINIOS_BLOQUEADOS.includes('annas-archive.*'));
  const llamadas: { url: string }[] = []; const g = red([], llamadas);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R01', titulo: 'Pirata', url: 'https://sci-hub.se/10.5555/kratos-c-x', estado_publicacion: 'publicado', texto_disponible: true }, POR, [], g), /biblioteca en la sombra/);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R01', titulo: 'Con PDF pirata', url: 'https://doi.org/10.5555/kratos-c-x', texto_url: 'https://libgen.li/x.pdf', estado_publicacion: 'publicado', texto_disponible: true }, POR, [], g), /biblioteca en la sombra/);
  await assert.rejects(C.leerFuente(db, { url: 'https://annas-archive.org/md5/abc' }, POR, g), /biblioteca en la sombra/);
  assert.equal(llamadas.length, 0);
  // una URL legal que redirige a una biblioteca en la sombra tampoco se registra ni se lee
  const redirige = red([[/gutenberg\.org\/ebooks\/777/, ok(`Title: x\n${parrafos(300)}`, { 'x-url-final': 'https://libgen.rs/book/777' })]]);
  await assert.rejects(C.leerFuente(db, { url: 'https://www.gutenberg.org/ebooks/777' }, POR, redirige), /libgen\.rs es una biblioteca en la sombra/);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R10', titulo: 'Redirigido', url: 'https://www.gutenberg.org/ebooks/777.txt.utf-8', estado_publicacion: 'libro', texto_disponible: true }, POR, [], redirige), /biblioteca en la sombra/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_fuentes WHERE url LIKE '%/ebooks/777%'`)).rows[0].n, 0);
  assert.equal(C.fusionar([{ conector: 'R03', titulo: 'x', url: 'https://sci-hub.se/x', estado_publicacion: 'publicado', texto_disponible: true }]).length, 0);
  assert.match(C.NOTA_SCIHUB.texto, /2011.*Alexandra Elbakyan/); assert.equal(C.NOTA_SCIHUB.referencias.map((r) => r.doi).join(' '), '10.1126/science.352.6285.508 10.7554/eLife.32822 10.1038/nature.2017.22196');
  const ctx = await C.BUSCADORES.R15('historia de sci-hub', 3, red()); assert.equal(ctx.registros.length, 3); assert.match(String(ctx.aviso), /no la usa para obtener textos/);
});

test('legalPorDoi: copias abiertas (PMC primero, PDF del editor), sin espejos piratas; Unpaywall directo solo si está configurado', async () => {
  const l = await C.legalPorDoi('10.5555/kratos-c-x', red(), db);
  assert.equal(l.acceso_abierto, true); assert.equal(l.pmcid, 'PMC6082533');
  assert.equal(l.ubicaciones[0].tipo, 'xml'); assert.equal(l.ubicaciones[0].url, 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6082533/fullTextXML');
  assert.ok(l.ubicaciones.some((u) => u.pdf_url?.includes('journals.plos.org'))); assert.ok(!l.ubicaciones.some((u) => u.url.includes('sci-hub')));
  assert.match(l.unpaywall, /no configurado.*unpaywall_email/);
  const sin = await C.legalPorDoi('10.5555/kratos-c-retr', red());
  assert.equal(sin.acceso_abierto, false); assert.equal(sin.retractado, true); assert.match(sin.nota, /No consta ninguna copia legal.*préstamo interbibliotecario/);
  await assert.rejects(C.legalPorDoi('no-es-un-doi'), /DOI no válido/);
  const previo = (await db.query(`SELECT 1 FROM system_state WHERE key = 'unpaywall_email'`)).rows.length;
  if (!previo) {
    await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('unpaywall_email', '"investigacion@example.org"', $1)`, [POR]);
    const llamadas: { url: string }[] = [];
    const u = await C.legalPorDoi('10.5555/kratos-c-x', red([], llamadas), db);
    assert.equal(u.unpaywall, 'consultado directamente'); assert.ok(llamadas.some((x) => x.url.startsWith('https://api.unpaywall.org/v2/10.5555/kratos-c-x?email=investigacion%40example.org')));
    assert.ok(u.ubicaciones.some((x) => x.origen === 'Unpaywall (API directa)'));
    await db.query(`DELETE FROM system_state WHERE key = 'unpaywall_email' AND updated_by = $1`, [POR]);
  }
});

// ---------- registro con procedencia ----------
test('registrar: procedencia en sol_fuentes, deduplicación por DOI y por URL, sin rebajar un «retractado»', async () => {
  const g = red();
  const r = await C.registrarRegistro(db, { conector: 'r04', titulo: 'Registro de prueba A', autores: 'Uno, A.', anio: 2019, fecha: '2019-10-01', doi: '10.5555/kratos-c-reg', identificador: 'W123', url: 'https://doi.org/10.5555/kratos-c-reg',
    estado_publicacion: 'publicado', texto_disponible: true, texto_url: 'https://journals.plos.org/x.pdf', permisos: 'acceso abierto, licencia cc-by', resumen: 'Un resumen que no es lectura completa.' }, POR, ['S04', 'Decoherencia'], g);
  assert.equal(r.nuevo, true); assert.equal(r.verificada, true); assert.equal(r.acceso, 'resumen');
  const f = (await db.query(`SELECT * FROM sol_fuentes WHERE id = $1`, [r.fuente_id])).rows[0];
  assert.equal(f.doi, '10.5555/kratos-c-reg'); assert.equal(f.identificador, 'W123'); assert.equal(f.conector, 'R04'); assert.equal(f.estado_publicacion, 'publicado'); assert.equal(f.fecha_publicacion, '2019-10-01');
  assert.equal(f.texto_disponible, true); assert.equal(f.permisos, 'acceso abierto, licencia cc-by'); assert.deepEqual(f.temas, ['s04', 'decoherencia']); assert.match(f.notas, /NO es lectura completa/); assert.equal(f.leido_hasta, 0);
  assert.equal(f.texto_url, 'https://journals.plos.org/x.pdf'); assert.equal(r.texto_url, 'https://journals.plos.org/x.pdf');
  // mismo DOI con otra URL (otro conector): la misma fuente; un «retractado» posterior sí cuenta
  const b = await C.registrarRegistro(db, { conector: 'R16', titulo: 'Registro de prueba A (OpenAlex)', doi: '10.5555/KRATOS-C-REG', url: 'https://openalex.org/W123', estado_publicacion: 'retractado', texto_disponible: false, correcciones: 'OpenAlex: is_retracted=true' }, POR, ['S12'], g);
  assert.equal(b.fuente_id, r.fuente_id); assert.equal(b.nuevo, false); assert.equal(b.estado_publicacion, 'retractado');
  const c = await C.registrarRegistro(db, { conector: 'R01', titulo: 'Registro de prueba A', url: 'https://doi.org/10.5555/kratos-c-reg', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  assert.equal(c.fuente_id, r.fuente_id); assert.equal(c.estado_publicacion, 'retractado');                       // nunca se rebaja
  const f2 = (await db.query(`SELECT * FROM sol_fuentes WHERE id = $1`, [r.fuente_id])).rows[0];
  assert.equal(f2.texto_disponible, true); assert.equal(f2.conector, 'R04'); assert.match(f2.correcciones, /is_retracted=true/); assert.deepEqual([...f2.temas].sort(), ['decoherencia', 's04', 's12']);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_fuentes WHERE lower(doi) = '10.5555/kratos-c-reg'`)).rows[0].n, 1);
  // el editor rechaza la apertura automática pero doi.org confirma el DOI: verificada, solo metadatos
  const d = await C.registrarRegistro(db, { conector: 'R04', titulo: 'Registro de prueba B', doi: '10.5555/kratos-c-existe', url: 'https://doi.org/10.5555/kratos-c-existe', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  assert.equal(d.verificada, true); assert.equal(d.acceso, 'metadatos'); assert.match(d.nota, /DOI confirmado en doi\.org/);
  const e = await C.registrarRegistro(db, { conector: 'R04', titulo: 'Registro de prueba C', doi: '10.5555/kratos-c-caida', url: 'https://doi.org/10.5555/kratos-c-caida', estado_publicacion: 'publicado', texto_disponible: null, resumen: 'abstract' }, POR, [], g);
  assert.equal(e.verificada, false); assert.equal(e.acceso, 'metadatos'); assert.match(e.nota, /NO verificada/);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R04', titulo: '', url: 'https://doi.org/10.5555/x', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g), /título/);
});

test('R16: preprints, retractados, avisos de Crossref y posibles resultados negativos (marcados como no confirmados, nunca como resumen)', async () => {
  const llamadas: { url: string }[] = [];
  const r = await C.BUSCADORES.R16('memory', 3, red([], llamadas));
  assert.equal(r.partes?.['OpenAlex preprints'], 3); assert.equal(r.partes?.['Crossref retractaciones'], 1); assert.equal(r.partes?.['Europe PMC replicaciones fallidas y resultados nulos'], 2);
  assert.ok(llamadas.some((l) => l.url.includes('filter=type:preprint')) && llamadas.some((l) => l.url.includes('filter=is_retracted:true')));
  assert.match(decodeURIComponent(llamadas.find((l) => l.url.includes('europepmc'))!.url), /query=\(memory\) AND \(TITLE:"failed replication" OR TITLE:"failure to replicate" OR/);
  const neg = r.registros.find((x) => x.doi === '10.5555/kratos-c-pm')!;
  assert.equal(neg.conector, 'R16'); assert.match(String(neg.nota), /Posible replicación fallida.*no confirmado/); assert.equal(neg.resumen, null);
  const reg = await C.registrarRegistro(db, neg, POR, ['R16'], red([[/europepmc\.org\/article\//, ok('<html><head><title>Europe PMC</title></head></html>', { 'content-type': 'text/html' })]]));
  assert.equal(reg.verificada, true); assert.equal(reg.acceso, 'metadatos');                                              // la nota del conector no cuenta como resumen leído
  assert.match((await db.query(`SELECT notas FROM sol_fuentes WHERE id = $1`, [reg.fuente_id])).rows[0].notas, /Aviso del registro: Posible replicación fallida/);
  const sinEpmc = await C.BUSCADORES.R16('memory', 3, red([[/europepmc/, no(503, '{"errCode":503,"errMsg":"Search service is temporarily unavailable."}')]]));
  assert.match(String(sinEpmc.partes?.['Europe PMC replicaciones fallidas y resultados nulos']), /error: Europe PMC respondió 503/); assert.ok(sinEpmc.registros.length > 0); assert.match(String(sinEpmc.aviso), /Parcial/);
  await assert.rejects(C.BUSCADORES.R16('memory', 3, async () => no(500)), /OpenAlex respondió 500.*Crossref respondió 500.*Europe PMC respondió 500/);
});

// ---------- lectura ----------
test('leer: solo cuenta lo leído de seguido; texto_completo al pasar del 90 %; procedencia del origen', async () => {
  const g = red();
  const a: any = await C.leerFuente(db, { pmcid: 'pmc999000222' }, POR, g);
  assert.equal(a.acceso, 'parcial'); assert.equal(a.desde, 0); assert.equal(a.hasta, 30000); assert.ok(a.leido_pct < 50); assert.equal(a.conector, 'R05'); assert.equal(a.formato, 'xml'); assert.equal(a.titulo, 'Lectura de prueba de conectores');
  assert.ok(!a.texto_no_confiable.includes('cita'));                                                                      // la bibliografía no cuenta como texto
  const salto: any = await C.leerFuente(db, { pmcid: 'PMC999000222', desde: 60000 }, POR, g);
  assert.equal(salto.leido_pct, a.leido_pct);                                                                             // saltarse el medio no cuenta
  const b: any = await C.leerFuente(db, { fuente_id: a.fuente_id, desde: a.hasta }, POR, g);
  assert.equal(b.fuente_id, a.fuente_id);
  const c: any = await C.leerFuente(db, { pmcid: 'PMC999000222', desde: b.hasta }, POR, g);
  assert.equal(c.acceso, 'texto_completo'); assert.equal(c.leido_pct, 100); assert.equal(c.siguiente, 'fin del texto');
  const f = (await db.query(`SELECT * FROM sol_fuentes WHERE id = $1`, [a.fuente_id])).rows[0];
  assert.equal(f.acceso, 'texto_completo'); assert.equal(f.leido_hasta, f.longitud); assert.equal(f.identificador, 'PMC999000222'); assert.equal(f.conector, 'R05'); assert.equal(f.texto_disponible, true); assert.equal(f.url, 'https://europepmc.org/article/PMC/PMC999000222');
  assert.equal((f.notas.match(/Texto leído de https:\/\/www\.ebi\.ac\.uk\/europepmc\/webservices\/rest\/PMC999000222\/fullTextXML/g) ?? []).length, 1);   // procedencia del texto, sin repetirla
  // releer el principio no rebaja nada
  assert.equal(((await C.leerFuente(db, { pmcid: 'PMC999000222' }, POR, g)) as any).acceso, 'texto_completo');
});

test('leer: arXiv (HTML con respaldo ar5iv), Gutenberg, Internet Archive, archivo esotérico; rechazos honestos', async () => {
  const llamadas: { url: string }[] = []; const g = red([], llamadas);
  const ax: any = await C.leerFuente(db, { arxiv: 'arXiv:1205.6750v1' }, POR, g);
  assert.equal(ax.origen, 'https://ar5iv.labs.arxiv.org/html/1205.6750'); assert.equal(ax.formato, 'html'); assert.ok(!ax.texto_no_confiable.includes('menu')); assert.ok(ax.texto_no_confiable.includes('E=mc^2'));
  assert.equal((await db.query(`SELECT identificador, url FROM sol_fuentes WHERE id = $1`, [ax.fuente_id])).rows[0].url, 'https://arxiv.org/abs/1205.6750');
  const gu: any = await C.leerFuente(db, { url: 'https://www.gutenberg.org/ebooks/61112' }, POR, g);
  assert.equal(gu.origen, 'https://www.gutenberg.org/ebooks/61112.txt.utf-8'); assert.equal(gu.titulo, 'A New Light of Alchymie'); assert.ok(!gu.texto_no_confiable.includes('\r'));
  assert.ok(gu.texto_no_confiable.startsWith('alquimia') && !/licencia|START OF|Section 1/.test(gu.texto_no_confiable)); assert.equal(gu.longitud, parrafos(300, 'alquimia').trim().length);   // la licencia de PG no cuenta como obra
  const ia: any = await C.leerFuente(db, { url: 'https://archive.org/details/turbaphilosophor00gratiala' }, POR, g);
  assert.equal(ia.origen, 'https://archive.org/download/turbaphilosophor00gratiala/turba_djvu.txt'); assert.equal(ia.conector, 'R10'); assert.equal(ia.titulo, 'The Turba philosophorum, or, Assembly of the sages');   // título de los metadatos de IA
  await assert.rejects(C.leerFuente(db, { url: 'https://archive.org/details/lettersofalchemy0000king' }, POR, g), /préstamo controlado/);
  const eso: any = await C.leerFuente(db, { url: 'https://www.esotericarchives.com/agrippa/op1.htm' }, POR, g);
  assert.equal(eso.conector, 'R11'); assert.equal(eso.titulo, 'Agrippa: Occult Philosophy I'); assert.ok(eso.texto_no_confiable.includes('magia natural'));
  await assert.rejects(C.leerFuente(db, { url: 'https://hermetic.com/texts/x' }, POR, g), /anti-bots.*no se elude/);
  const antes = llamadas.length;
  await assert.rejects(C.leerFuente(db, { url: 'https://www.sciencedirect.com/science/article/pii/S0000000000000000' }, POR, g), /No consta como acceso abierto legal/);
  assert.equal(llamadas.length, antes);                                                                                   // ni siquiera se pide la página de pago
  await assert.rejects(C.leerFuente(db, { doi: '10.5555/kratos-c-html' }, POR, g), /solo como página web/);
  await assert.rejects(C.leerFuente(db, { doi: '10.5555/kratos-c-retr' }, POR, g), /No consta ninguna copia legal/);
  await assert.rejects(C.leerFuente(db, { url: 'https://journals.plos.org/plosone/article/file?id=10.5555/kratos-c-html-falso&type=printable' }, POR, g), /no es un PDF/);
  await assert.rejects(C.leerFuente(db, { fuente_id: 999999999 }, POR, g), /No existe la fuente/);
  // con fuente_id, otro texto no se anota en esa fuente; el suyo (mismo identificador) sí
  const antesFila = (await db.query(`SELECT leido_hasta, longitud, acceso FROM sol_fuentes WHERE id = $1`, [ax.fuente_id])).rows[0];
  await assert.rejects(C.leerFuente(db, { fuente_id: ax.fuente_id, url: 'https://www.gutenberg.org/ebooks/61112' }, POR, g), /no corresponde a la fuente/);
  await assert.rejects(C.leerFuente(db, { fuente_id: ax.fuente_id, pmcid: 'PMC999000222' }, POR, g), /no corresponde a la fuente/);
  assert.deepEqual((await db.query(`SELECT leido_hasta, longitud, acceso FROM sol_fuentes WHERE id = $1`, [ax.fuente_id])).rows[0], antesFila);
  assert.equal(((await C.leerFuente(db, { fuente_id: ax.fuente_id, arxiv: '1205.6750' }, POR, g)) as any).fuente_id, ax.fuente_id);
  // una fuente con DOI: ni un archivo esotérico, ni otro libro con «su» DOI al lado, ni un PDF con otro DOI en la URL cuentan como lectura suya
  const conDoi = await C.registrarRegistro(db, { conector: 'R04', titulo: 'Fuente con DOI para la guarda', doi: '10.5555/kratos-c-guarda', url: 'https://doi.org/10.5555/kratos-c-guarda', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  for (const x of [{ url: 'https://www.esotericarchives.com/agrippa/op1.htm' }, { url: 'https://www.gutenberg.org/ebooks/61112', doi: '10.5555/kratos-c-guarda' }, { url: 'https://journals.plos.org/plosone/article/file?id=10.5555/kratos-c-otro&type=printable' }])
    await assert.rejects(C.leerFuente(db, { fuente_id: conDoi.fuente_id, ...x }, POR, g), /no corresponde a la fuente/, JSON.stringify(x));
  assert.equal((await db.query(`SELECT leido_hasta FROM sol_fuentes WHERE id = $1`, [conDoi.fuente_id])).rows[0].leido_hasta, 0);
});

test('leer: PDF de acceso abierto por DOI con pypdf (scripts/sol/pdf_texto.py), ligado a la fuente registrada', { skip: !fs.existsSync(C.PDF.python) && 'falta .jarvis/acd/venv' }, async () => {
  const g = red();
  const r = await C.registrarRegistro(db, { conector: 'R01', titulo: 'Artículo abierto en PDF', doi: '10.5555/kratos-c-pdf', url: 'https://doi.org/10.5555/kratos-c-pdf', estado_publicacion: 'publicado', texto_disponible: true }, POR, [], g);
  const l: any = await C.leerFuente(db, { fuente_id: r.fuente_id }, POR, g);
  assert.equal(l.fuente_id, r.fuente_id); assert.equal(l.formato, 'pdf'); assert.equal(l.conector, 'R09'); assert.match(l.texto_no_confiable, /Linea 1 del articulo abierto/); assert.match(l.texto_no_confiable, /Linea 40/);
  assert.equal(l.acceso, 'texto_completo');                                                                               // cabe en un trozo: leído entero de verdad
  assert.equal((await db.query(`SELECT acceso FROM sol_fuentes WHERE id = $1`, [r.fuente_id])).rows[0].acceso, 'texto_completo');
  // OSTI: el registro guarda el texto_url del conector y accion=leer con solo fuente_id lo usa (la ficha HTML no es el texto)
  const ro = await C.registrarRegistro(db, C.parseOsti(OSTI)[0], POR, ['S05'], g);
  assert.equal(ro.verificada, true); assert.equal(ro.texto_url, 'https://www.osti.gov/servlets/purl/17258222');
  const lo: any = await C.leerFuente(db, { fuente_id: ro.fuente_id }, POR, g);
  assert.equal(lo.fuente_id, ro.fuente_id); assert.equal(lo.origen, 'https://www.osti.gov/servlets/purl/17258222'); assert.equal(lo.formato, 'pdf'); assert.equal(lo.acceso, 'texto_completo');
  assert.equal(((await C.leerFuente(db, { fuente_id: ro.fuente_id, url: 'https://www.osti.gov/servlets/purl/17258222' }, POR, g)) as any).fuente_id, ro.fuente_id);   // su propio texto_url sí vale
  // un PDF abierto cualquiera con el DOI de la fuente escrito en su URL no es «su» texto: se comprueba el contenido; y sin fuente_id no se le atribuye ese DOI
  const guarda = await C.registrarRegistro(db, { conector: 'R04', titulo: 'Fuente con DOI para la guarda del PDF', doi: '10.5555/kratos-c-guarda-pdf', url: 'https://doi.org/10.5555/kratos-c-guarda-pdf', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  const ajeno = 'https://journals.plos.org/plosone/article/file?id=10.5555/kratos-c-guarda-pdf&otro=kratos-c-pdf&type=printable';
  await assert.rejects(C.leerFuente(db, { fuente_id: guarda.fuente_id, url: ajeno }, POR, g), /no parece ser el de la fuente/);
  assert.equal((await db.query(`SELECT leido_hasta FROM sol_fuentes WHERE id = $1`, [guarda.fuente_id])).rows[0].leido_hasta, 0);
  const suelto: any = await C.leerFuente(db, { url: ajeno }, POR, g);
  assert.notEqual(suelto.fuente_id, guarda.fuente_id); assert.equal((await db.query(`SELECT doi FROM sol_fuentes WHERE id = $1`, [suelto.fuente_id])).rows[0].doi, null);
});

// ---------- retractaciones ----------
test('retractación: OpenAlex y Crossref actualizan estado, correcciones y fecha de revisión; sin respuesta no se toca nada', async () => {
  const g = red();
  const r = await C.registrarRegistro(db, { conector: 'R01', titulo: 'A retracted memory study', doi: '10.5555/kratos-c-retr', url: 'https://doi.org/10.5555/kratos-c-retr', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  assert.equal(r.estado_publicacion, 'publicado');
  const c: any = await C.comprobarRetractacion(db, { fuente_id: r.fuente_id }, POR, g);
  assert.equal(c.comprobado, true); assert.equal(c.retractado, true); assert.equal(c.estado_publicacion, 'retractado'); assert.equal(c.actualizado, true); assert.match(c.nota, /RETRACTADA/);
  let f = (await db.query(`SELECT estado_publicacion, correcciones, revisada_en FROM sol_fuentes WHERE id = $1`, [r.fuente_id])).rows[0];
  assert.equal(f.estado_publicacion, 'retractado'); assert.match(f.correcciones, /OpenAlex: is_retracted=true/); assert.match(f.correcciones, /retraction-watch/); assert.ok(f.revisada_en);
  await C.comprobarRetractacion(db, { doi: '10.5555/kratos-c-retr' }, POR, g);                                             // segunda vez: no duplica
  assert.equal((await db.query(`SELECT correcciones FROM sol_fuentes WHERE id = $1`, [r.fuente_id])).rows[0].correcciones, f.correcciones);
  const caida: Get = async () => no(500, 'error');
  const s = await C.registrarRegistro(db, { conector: 'R04', titulo: 'Quantum decoherence', doi: '10.5555/kratos-c-corr', url: 'https://doi.org/10.5555/kratos-c-corr', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  const x: any = await C.comprobarRetractacion(db, { fuente_id: s.fuente_id }, POR, caida);
  assert.equal(x.comprobado, false); assert.equal((await db.query(`SELECT revisada_en FROM sol_fuentes WHERE id = $1`, [s.fuente_id])).rows[0].revisada_en, null);
  const y: any = await C.comprobarRetractacion(db, { fuente_id: s.fuente_id }, POR, g);
  assert.equal(y.corregido, true); assert.equal(y.estado_publicacion, 'corregido');
  const z: any = await C.comprobarRetractacion(db, { doi: '10.5555/kratos-c-sin-fuente' }, POR, g);
  assert.equal(z.actualizado, false); assert.match(z.nota, /no se ha modificado nada/);
  const sinDoi = (await db.query(`INSERT INTO sol_fuentes (titulo, created_by) VALUES ('Sin DOI', $1) RETURNING id`, [POR])).rows[0].id;
  assert.equal(((await C.comprobarRetractacion(db, { fuente_id: sinDoi }, POR, g)) as any).comprobado, false);
  f = (await db.query(`SELECT revisada_en FROM sol_fuentes WHERE id = $1`, [sinDoi])).rows[0]; assert.equal(f.revisada_en, null);
});

// ---------- búsqueda unificada ----------
test('investigar: abanico por área con un conector caído (se informa, no se lanza) y deduplicación entre conectores', async () => {
  const r = await C.investigar(db, { fuente: 'ciencia', consulta: 'quantum decoherence', max: 3 }, POR, red([[/inspirehep\.net/, no(500, 'Internal Server Error')]]));
  assert.deepEqual(r.fuentes, ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R16']);
  const ins = r.por_conector.find((p) => p.codigo === 'R06')!; assert.equal(ins.ok, false); assert.match(String(ins.error), /INSPIRE-HEP respondió 500/);
  assert.ok(r.por_conector.filter((p) => p.codigo !== 'R06').every((p) => p.ok));
  const comun = r.registros.filter((x) => x.doi?.toLowerCase() === '10.5555/kratos-c-comun');
  assert.equal(comun.length, 1); assert.ok(['R01', 'R04', 'R16'].every((c) => comun[0].conectores.includes(c)), String(comun[0].conectores));
  assert.ok(r.registros.some((x) => x.doi === '10.5555/kratos-c-retr' && x.estado_publicacion === 'retractado'));          // R16: la obra retractada, no solo el aviso
  assert.match(r.nota, /un resumen NO es una lectura completa/);
  const una = await C.investigar(db, { fuente: 'r10', consulta: 'alchemy' }, POR, red());
  assert.deepEqual(una.fuentes, ['R10']); assert.ok(una.registros.some((x) => x.identificador === 'gutenberg:61112'));
  const eso = await C.investigar(db, { fuente: 'esoterismo', consulta: 'agrippa' }, POR, red());
  assert.deepEqual(eso.fuentes, ['R10', 'R11', 'R12', 'R13', 'R14']);
  await assert.rejects(C.investigar(db, { fuente: 'R99', consulta: 'x y' }, POR, red()), /Fuente no válida/);
});

test('probarConectores: una fila por código R01–R16 con ok, resultados y detalle; R15 = guarda + copia legal', async () => {
  const r = await C.probarConectores(db, red());
  pruebasIds.push(...r.pruebas.map((p) => p.id));
  assert.equal(r.probados, 16); assert.deepEqual(r.pruebas.map((p) => p.codigo), Object.keys(C.CONECTORES));
  const p = (c: string) => r.pruebas.find((x) => x.codigo === c)!;
  assert.equal(p('R15').ok, true); assert.match(p('R15').detalle, /rechaza sci-hub\.se/);
  assert.equal(p('R09').ok, true); assert.match(p('R09').detalle, /Unpaywall directo: no configurado/);
  assert.equal(p('R08').ok, true); assert.match(p('R08').detalle, /ADS: BLOQUEADO/);
  assert.match(p('R13').detalle, /directorio: 9\/9 responden/);
  assert.match(p('R11').detalle, /hermetic\.com: BLOQUEADO/);
  assert.equal(p('R16').ok, true); assert.match(p('R16').detalle, /Europe PMC replicaciones fallidas y resultados nulos: 2/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_conectores_pruebas WHERE id = ANY($1)`, [pruebasIds])).rows[0].n, 16);
  const caida = await C.probarConectores(db, async () => no(0, 'sin red'));
  pruebasIds.push(...caida.pruebas.map((x) => x.id));
  assert.equal(caida.pruebas.filter((x) => x.codigo !== 'R15' && x.ok).length, 0);                                       // sin red nada pasa por bueno
  assert.equal(caida.pruebas.find((x) => x.codigo === 'R15')!.ok, false);                                                // la guarda sola no basta: hace falta la copia legal
});

test('herramienta: acciones, errores devueltos (no lanzados) y descripción en español con las reglas de acceso', async () => {
  const g = red();
  assert.match(C.INVESTIGAR_TOOL.description, /Un resumen recuperado NO es una lectura completa/); assert.match(C.INVESTIGAR_TOOL.description, /Sci-Hub/);
  assert.deepEqual((C.INVESTIGAR_TOOL.input_schema.properties.accion as any).enum, ['buscar_externo', 'registrar', 'leer', 'retractacion', 'legal_por_doi', 'conectores']);
  // compatible con herramientas estrictas: todo objeto del esquema cierra additionalProperties
  const objetos = (s: any): any[] => (s && typeof s === 'object' ? [...(s.type === 'object' ? [s] : []), ...Object.values(s).flatMap(objetos)] : []);
  assert.ok(objetos(C.INVESTIGAR_TOOL.input_schema).every((o) => o.additionalProperties === false && o.properties));
  const lista: any = await C.herramientaInvestigar(db, { accion: 'conectores' }, 'agente:sol', g);
  assert.equal(lista.conectores.length, 16); assert.ok(lista.conectores.every((c: any) => c.ultima_prueba)); assert.equal(lista.credenciales['NASA ADS (kratos-ads)'], 'ausente');
  assert.match(String(((await C.herramientaInvestigar(db, { accion: 'volar' }, 'agente:sol', g)) as any).error), /Acción no válida/);
  assert.match(String(((await C.herramientaInvestigar(db, { accion: 'buscar_externo', fuente: 'R77', consulta: 'abc' }, 'agente:sol', g)) as any).error), /Fuente no válida/);
  assert.match(String(((await C.herramientaInvestigar(db, { accion: 'leer', url: 'https://sci-hub.se/x' }, 'agente:sol', g)) as any).error), /biblioteca en la sombra/);
  const reg: any = await C.herramientaInvestigar(db, { accion: 'registrar', conector: 'R02', titulo: 'Decoherence without Dissipation', identificador: 'arXiv:1205.6750', url: 'https://arxiv.org/abs/1205.6750', estado_publicacion: 'preprint', texto_disponible: true, temas: ['S04'] }, POR, g);
  assert.ok(reg.fuente_id); assert.equal(reg.estado_publicacion, 'preprint');
  assert.equal(((await C.herramientaInvestigar(db, { accion: 'legal_por_doi', doi: '10.5555/kratos-c-x' }, 'agente:saturno', g)) as any).acceso_abierto, true);
  const bus: any = await C.herramientaInvestigar(db, { accion: 'buscar_externo', fuente: 'R02', consulta: 'decoherence', max: 2 }, 'kratos (IA)', g);
  assert.equal(bus.resultados, 2);
});

// ---------- revisión adversarial: cada defecto corregido tiene su prueba ----------
test('R15: variantes que antes se colaban (punto final del FQDN, doble codificación, sin esquema, usuario@, entidades)', () => {
  for (const u of ['https://library.lol./main/x', 'https://gen.lib.rus.ec./book', 'https://example.org/p?u=https%253A%252F%252Fsci-hub.se%252F10.1%252Fx', 'https://example.org/go?to=sci-hub.ru/10.1/x',
    'https://example.org/p?u=https%3A%2F%2Fuser%40libgen.rs%2Fx', 'https://example.org/p?u=https:&#x2F;&#x2F;annas-archive.org&#x2F;md5', 'https://oceanofpdf.com/x', 'https://welib.org/md5/1', 'https://dokumen.pub/x.html'])
    assert.match(String(C.dominioBloqueado(u)), /biblioteca en la sombra/, u);
  for (const u of ['https://zlib.net/', 'https://en.wikipedia.org/wiki/Sci-Hub', 'https://elifesciences.org/articles/32822', 'https://doi.org/10.1126/science.352.6285.508', 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0201246'])
    assert.equal(C.dominioBloqueado(u), null, u);
  // un registro con el enlace al texto pirata se conserva, pero sin ese enlace
  const f = C.fusionar([{ conector: 'R03', titulo: 'x', url: 'https://doi.org/10.5555/x', estado_publicacion: 'publicado', texto_disponible: true, texto_url: 'https://sci-hub.se/10.5555/x' }]);
  assert.equal(f.length, 1); assert.equal(f[0].texto_url, null); assert.equal(f[0].texto_disponible, null);
});

test('destinos de red: nada local ni privado; registrar y leer lo rechazan sin hacer ninguna petición', async () => {
  for (const u of ['http://127.0.0.1:5432/', 'http://localhost:3000/admin', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', 'http://intranet/', 'http://kratos.local/', 'ftp://ftp.example.org/x', 'https://usuario:clave@example.org/'])
    assert.ok(C.motivoNoPublica(u), u);
  for (const u of ['https://arxiv.org/abs/1205.6750', 'https://doi.org/10.1371/x', 'http://8.8.8.8/']) assert.equal(C.motivoNoPublica(u), null, u);
  const llamadas: { url: string }[] = []; const g = red([], llamadas);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R01', titulo: 'Servicio interno', url: 'http://127.0.0.1:5432/', estado_publicacion: 'documento', texto_disponible: null }, POR, [], g), /dirección local o privada/);
  await assert.rejects(C.registrarRegistro(db, { conector: 'R01', titulo: 'Metadatos de la nube', url: 'http://169.254.169.254/latest/meta-data/', estado_publicacion: 'documento', texto_disponible: null }, POR, [], g), /dirección local o privada/);
  await assert.rejects(C.leerFuente(db, { url: 'http://localhost:8080/x.pdf' }, POR, g), /dirección local o privada/);
  assert.equal(llamadas.length, 0);
});

test('clienteHttp: cada redirección se comprueba antes de pedirla; credenciales solo al mismo host; tamaño y codificación', async () => {
  const pedidas: { url: string; headers: Record<string, string> }[] = [];
  const respuestas: Record<string, () => Response> = {
    'https://legal.example/a': () => new Response(null, { status: 302, headers: { location: 'https://sci-hub.se/10.1/x' } }),
    'https://legal.example/b': () => new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    'https://api.example/q': () => new Response(null, { status: 307, headers: { location: 'https://otro.example/r' } }),
    'https://otro.example/r': () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    'https://api.example/mismo': () => new Response(null, { status: 302, headers: { location: '/fin' } }),
    'https://api.example/fin': () => new Response('fin', { status: 200 }),
    'https://grande.example/x.pdf': () => new Response('x', { status: 200, headers: { 'content-length': String(90e6), 'content-type': 'application/pdf' } }),
    'https://viejo.example/latin.htm': () => new Response(Buffer.from('<html><body>Tratado de alquimia: caf\xe9 y \x93oro\x94</body></html>', 'latin1'), { status: 200, headers: { 'content-type': 'text/html' } }),
    'https://viejo.example/iso.htm': () => new Response(Buffer.from('<html><body>Tratado: se\xf1or</body></html>', 'latin1'), { status: 200, headers: { 'content-type': 'text/html; charset=iso-8859-1' } }),
    'https://repo.example/a.pdf': () => new Response(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xe2, 0xe3, 0xcf, 0xd3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  };
  const falsoFetch = (async (u: string, init: any) => { pedidas.push({ url: u, headers: init.headers }); return (respuestas[u] ?? (() => new Response('no', { status: 404 })))(); }) as any;
  const resolver = async (h: string) => (h === 'interno.example' ? ['10.1.2.3'] : ['93.184.215.14']);
  const get = C.clienteHttp(falsoFetch, resolver);
  const a = await get('https://legal.example/a');
  assert.equal(a.status, 451); assert.match(a.text, /sci-hub\.se es una biblioteca en la sombra/); assert.ok(!pedidas.some((p) => p.url.includes('sci-hub')));   // nunca se pide
  const b = await get('https://legal.example/b');
  assert.equal(b.status, 0); assert.match(b.text, /dirección local o privada/); assert.ok(!pedidas.some((p) => p.url.includes('169.254')));
  const q = await get('https://api.openalex.org/works?search=sci-hub.se%20downloads');   // una búsqueda que NOMBRA a Sci-Hub no contacta con Sci-Hub: se hace
  assert.equal(q.status, 404); assert.ok(pedidas.some((p) => p.url.startsWith('https://api.openalex.org/works?search=sci-hub.se')));
  const i = await get('https://interno.example/x'); assert.match(i.text, /resuelve a una dirección privada/); assert.ok(!pedidas.some((p) => p.url.includes('interno')));
  const c = await get('https://api.example/q', { headers: { Authorization: 'Bearer secreto', Accept: 'application/json' } });
  assert.equal(c.status, 200); assert.equal(c.headers?.['x-url-final'], 'https://otro.example/r');
  assert.equal(pedidas.find((p) => p.url === 'https://api.example/q')!.headers.Authorization, 'Bearer secreto');
  assert.equal(pedidas.find((p) => p.url === 'https://otro.example/r')!.headers.Authorization, undefined);                   // el token no sale hacia otro host
  assert.equal(pedidas.find((p) => p.url === 'https://otro.example/r')!.headers.Accept, 'application/json');
  await get('https://api.example/mismo', { headers: { Authorization: 'Bearer secreto' } });
  assert.equal(pedidas.find((p) => p.url === 'https://api.example/fin')!.headers.Authorization, 'Bearer secreto');
  assert.match((await get('https://grande.example/x.pdf')).text, /demasiado grande/);
  assert.match((await get('https://viejo.example/latin.htm')).text, /café y “oro”/);                                           // windows-1252 sin declarar
  assert.match((await get('https://viejo.example/iso.htm')).text, /señor/);
  assert.deepEqual([...Buffer.from((await get('https://repo.example/a.pdf')).text, 'latin1')], [0x25, 0x50, 0x44, 0x46, 0x2d, 0xe2, 0xe3, 0xcf, 0xd3]);   // binario intacto
});

test('registrar: un título que no casa con su DOI se rechaza; un preprint no pasa por publicado; estados inventados → desconocido; un enlace de índice no es un resumen', async () => {
  const g = red();
  await assert.rejects(C.registrarRegistro(db, { conector: 'R04', titulo: 'A miracle cure that never existed', doi: '10.5555/kratos-c-titulo', url: 'https://doi.org/10.5555/kratos-c-titulo', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g),
    /no coincide con el del DOI 10\.5555\/kratos-c-titulo según Crossref \(«Galantamine and lucid dreaming/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_fuentes WHERE lower(doi) = '10.5555/kratos-c-titulo'`)).rows[0].n, 0);
  const ax = await C.registrarRegistro(db, { conector: 'R03', titulo: 'Only on arXiv', identificador: 'arXiv:2401.00002', url: 'https://arxiv.org/abs/2401.00002', estado_publicacion: 'publicado', texto_disponible: true }, POR, [], g);
  assert.equal(ax.estado_publicacion, 'preprint');
  const bio = await C.registrarRegistro(db, { conector: 'R01', titulo: 'Un preprint de bioRxiv', doi: '10.1101/2024.01.01.123456', url: 'https://doi.org/10.1101/2024.01.01.123456', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g);
  assert.equal(bio.estado_publicacion, 'preprint'); assert.match((await db.query(`SELECT notas FROM sol_fuentes WHERE id = $1`, [bio.fuente_id])).rows[0].notas, /Título NO contrastado/);
  const raro = await C.registrarRegistro(db, { conector: 'R01', titulo: 'Estado inventado', url: 'https://doi.org/10.5555/kratos-c-estado', estado_publicacion: 'constructor' as any, texto_disponible: null }, POR, [], g);
  assert.equal(raro.estado_publicacion, 'desconocido');
  const r11 = await C.BUSCADORES.R11('steganographia', 5, g);
  assert.ok(r11.registros.every((x) => x.resumen === null && /enlace del índice/.test(String(x.nota))));
  const e = await C.registrarRegistro(db, r11.registros[0], POR, [], g);
  assert.equal(e.acceso, 'metadatos'); assert.doesNotMatch((await db.query(`SELECT notas FROM sol_fuentes WHERE id = $1`, [e.fuente_id])).rows[0].notas, /Resumen recuperado/);
  // con una fila por URL (sin DOI) y otra por DOI, manda la del DOI (antes el NULL ordenaba primero y el UPDATE chocaba con el índice único del DOI)
  await db.query(`INSERT INTO sol_fuentes (titulo, url, created_by) VALUES ('Fila sin DOI', 'https://example.org/kratos-orden', $1)`, [POR]);
  const conDoi = (await db.query(`INSERT INTO sol_fuentes (titulo, url, doi, created_by) VALUES ('Fila con DOI', 'https://example.org/kratos-orden-2', '10.5555/kratos-c-orden', $1) RETURNING id`, [POR])).rows[0].id;
  assert.equal((await C.registrarRegistro(db, { conector: 'R04', titulo: 'Fila con DOI', doi: '10.5555/kratos-c-orden', url: 'https://example.org/kratos-orden', estado_publicacion: 'publicado', texto_disponible: null }, POR, [], g)).fuente_id, conDoi);
});

test('leer: la página del resumen de arXiv (ar5iv redirige a /abs/) y un XML de PMC sin <body> nunca cuentan como texto completo', async () => {
  const sinPdf = red([[/\/\/arxiv\.org\/pdf\/2401\.00009/, no(404, 'no')]]);
  const r: any = await C.leerFuente(db, { arxiv: '2401.00009' }, POR, sinPdf);
  assert.match(String(r.error), /página del resumen/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_fuentes WHERE identificador = 'arXiv:2401.00009'`)).rows[0].n, 0);
  const x: any = await C.leerFuente(db, { pmcid: 'PMC999000333' }, POR, red());
  assert.match(String(x.error), /no trae el cuerpo del artículo.*un resumen no es una lectura completa/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_fuentes WHERE identificador = 'PMC999000333'`)).rows[0].n, 0);
  if (fs.existsSync(C.PDF.python)) {                                                                                                  // con PDF de respaldo: se lee el PDF, no el resumen
    const p: any = await C.leerFuente(db, { arxiv: '2401.00009' }, POR, red());
    assert.equal(p.formato, 'pdf'); assert.equal(p.origen, 'https://arxiv.org/pdf/2401.00009'); assert.match(p.texto_no_confiable, /texto completo del preprint/); assert.doesNotMatch(p.texto_no_confiable, /resumen resumen/);
  }
});

test('leer: un identificador o un texto_url registrados que son de otra obra no anotan la lectura en la fuente', async () => {
  const g = red();
  const f = await C.registrarRegistro(db, { conector: 'R01', titulo: 'Galantamine and lucid dreaming: a crossover study', doi: '10.5555/kratos-c-titulo', identificador: 'PMC999000222', url: 'https://doi.org/10.5555/kratos-c-titulo', estado_publicacion: 'publicado', texto_disponible: true }, POR, [], g);
  assert.match((await db.query(`SELECT notas FROM sol_fuentes WHERE id = $1`, [f.fuente_id])).rows[0].notas, /Título contrastado con Crossref/);
  await assert.rejects(C.leerFuente(db, { fuente_id: f.fuente_id }, POR, g), /no parece ser el de la fuente/);                     // PMC999000222 es otro artículo
  await assert.rejects(C.leerFuente(db, { fuente_id: f.fuente_id, pmcid: 'PMC999000222' }, POR, g), /no parece ser el de la fuente/);
  const t = await C.registrarRegistro(db, { conector: 'R13', titulo: 'Tratado de botica sin relacion', url: 'https://wellcomecollection.org/works/kratoszz', texto_url: 'https://www.gutenberg.org/ebooks/61112', estado_publicacion: 'manuscrito', texto_disponible: true }, POR, [], g);
  await assert.rejects(C.leerFuente(db, { fuente_id: t.fuente_id }, POR, g), /no parece ser el de la fuente/);
  for (const id of [f.fuente_id, t.fuente_id]) assert.deepEqual((await db.query(`SELECT leido_hasta, acceso FROM sol_fuentes WHERE id = $1`, [id])).rows[0], { leido_hasta: 0, acceso: 'metadatos' });
  // con fuente_id y otro DOI, la comprobación de retractación no se anota en ella
  await assert.rejects(C.comprobarRetractacion(db, { fuente_id: f.fuente_id, doi: '10.5555/kratos-c-retr' }, POR, g), /tiene el DOI 10\.5555\/kratos-c-titulo/);
  assert.equal((await db.query(`SELECT revisada_en FROM sol_fuentes WHERE id = $1`, [f.fuente_id])).rows[0].revisada_en, null);
  const parcial: any = await C.comprobarRetractacion(db, { fuente_id: f.fuente_id }, POR, red([[/api\.openalex\.org/, no(500)]]));
  assert.equal(parcial.comprobado, true); assert.match(parcial.nota, /PARCIAL: OpenAlex no respondió/);
});

test('leer: desde fraccionario admitido y leido_hasta nunca mayor que la longitud (otra edición algo más corta)', async () => {
  const xml = (n: number) => `<?xml version="1.0"?><article><front><article-meta><article-title>Lectura de prueba de conectores</article-title></article-meta></front><body><sec><p>${parrafos(n)}</p></sec></body></article>`;
  const larga = red([[/PMC999000444\/fullTextXML/, ok(xml(9000))]]), corta = red([[/PMC999000444\/fullTextXML/, ok(xml(8950))]]);
  const a: any = await C.leerFuente(db, { pmcid: 'PMC999000444', desde: 0.7 }, POR, larga); assert.equal(a.desde, 0);
  const b: any = await C.leerFuente(db, { fuente_id: a.fuente_id, desde: a.hasta + 0.4 }, POR, larga);
  const c: any = await C.leerFuente(db, { fuente_id: a.fuente_id, desde: b.hasta }, POR, larga); assert.equal(c.leido_pct, 100);
  const d: any = await C.leerFuente(db, { fuente_id: a.fuente_id }, POR, corta); assert.ok(d.longitud < c.longitud); assert.equal(d.aviso, undefined);
  const fila = (await db.query(`SELECT leido_hasta, longitud, acceso FROM sol_fuentes WHERE id = $1`, [a.fuente_id])).rows[0];
  assert.ok(fila.leido_hasta <= fila.longitud, JSON.stringify(fila)); assert.equal(fila.acceso, 'texto_completo');
});

test('Crossref: sentido de las relaciones (…-by la recibe, …-of es el aviso); R16 recupera el título de «Retraction: …»', async () => {
  assert.equal(C.parseCrossrefItem(crItem('10.5555/kratos-c-rel', { relation: { 'is-retracted-by': [{ id: '10.5555/kratos-c-aviso2', 'id-type': 'doi' }] } })).retractado, true);
  const aviso = C.parseCrossrefItem(crItem('10.5555/kratos-c-aviso3', { title: ['Retraction notice'], relation: { 'is-retraction-of': [{ id: '10.5555/kratos-c-otra', 'id-type': 'doi' }] } }));
  assert.equal(aviso.retractado, false); assert.equal(aviso.aviso_de, '10.5555/kratos-c-otra');
  const avisos = { status: 'ok', message: { items: [crItem('10.5555/kratos-c-aviso4', { title: ['Retraction: Ileal lymphoid nodular hyperplasia in children'], 'update-to': [{ ...RETR, DOI: '10.5555/kratos-c-wake' }] })] } };
  const r = await C.BUSCADORES.R16('memory', 3, red([[/update-type:retraction/, ok(avisos)]]));
  const w = r.registros.find((x) => x.doi === '10.5555/kratos-c-wake')!;
  assert.equal(w.titulo, 'Ileal lymphoid nodular hyperplasia in children'); assert.equal(w.estado_publicacion, 'retractado');
});

test('extraerPdf es asíncrono (no bloquea el proceso de KRATOS) y rechaza lo que no es PDF', { skip: !fs.existsSync(C.PDF.python) && 'falta .jarvis/acd/venv' }, async () => {
  const p = C.extraerPdf(Buffer.from('esto no es un PDF'));
  assert.ok(p instanceof Promise); await assert.rejects(p, /no es un PDF/);
  const t = await C.extraerPdf(Buffer.from(PDF_ABIERTO, 'latin1')); assert.match(t.texto, /Linea 40/); assert.equal(t.paginas, 1);
});

test('auditoría: buscar, registrar, comprobar retractaciones y probar conectores dejan constancia en audit_log', async () => {
  const acciones = (await db.query(`SELECT DISTINCT action FROM audit_log WHERE id > $1 AND action = ANY($2)`, [auditoriaDesde, ACCIONES_AUDITADAS])).rows.map((r) => r.action).sort();
  assert.deepEqual(acciones, [...ACCIONES_AUDITADAS].sort());
});
