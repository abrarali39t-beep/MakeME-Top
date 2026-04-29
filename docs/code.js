// ═══════════════════════════════════════════════════════════════
//  SITEMAP GENERATOR — run weekly via trigger
//  Adds every approved business profile to sitemap.xml on GitHub
//  NOTE: You need to set up a GitHub Personal Access Token
// ═══════════════════════════════════════════════════════════════

const GITHUB_TOKEN  = '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';
const GITHUB_OWNER  = 'abrarali39t-beep';
const GITHUB_REPO   = 'MakwME-Top';
const GITHUB_FILE   = 'docs/sitemap.xml'; // path inside your repo

function generateAndPushSitemap() {
  // 1. Fetch all approved businesses from Firestore
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
  let businesses = [];
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'businesses' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'approved' }
            }
          },
          limit: 500
        }
      })
    });
    const rows = JSON.parse(resp.getContentText());
    businesses = (rows || [])
      .filter(r => r.document?.fields)
      .map(r => {
        const f = r.document.fields;
        const id = r.document.name.split('/').pop();
        const name = f.name?.stringValue || '';
        const type = f.type?.stringValue || '';
        const updated = f.updated_at?.timestampValue || f.created_at?.timestampValue || new Date().toISOString();
        return { id, name, type, updated };
      });
    Logger.log(`Found ${businesses.length} approved businesses`);
  } catch(e) {
    Logger.log('Firestore query error: ' + e.message);
    return;
  }

  // 2. Build sitemap XML
  const today = new Date().toISOString().split('T')[0];
  const bizUrls = businesses.map(b => `
  <url>
    <loc>${SITE_URL}/biz.html?id=${b.id}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`).join('');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <!-- Static pages -->
  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE_URL}/about.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>${SITE_URL}/privacy-policy.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>
  <url><loc>${SITE_URL}/terms.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>
  <url><loc>${SITE_URL}/refund.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.4</priority></url>

  <!-- MBP Business Profiles — ${businesses.length} approved businesses -->
  ${bizUrls}

</urlset>`;

  // 3. Push to GitHub via API
  pushToGitHub(sitemap);
}

function pushToGitHub(content) {
  if (!GITHUB_TOKEN || GITHUB_TOKEN.includes('YOUR_')) {
    Logger.log('GitHub token not set — logging sitemap only:');
    Logger.log(content.slice(0, 500));
    return;
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  // Get current file SHA (needed for update)
  let sha = '';
  try {
    const getResp = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' },
      muteHttpExceptions: true
    });
    const data = JSON.parse(getResp.getContentText());
    sha = data.sha || '';
  } catch(e) { Logger.log('Could not get file SHA: ' + e.message); }

  // Push updated sitemap
  const body = {
    message: `🔥 Auto-update sitemap — ${new Date().toISOString().split('T')[0]}`,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    ...(sha ? { sha } : {})
  };

  try {
    const putResp = UrlFetchApp.fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const result = JSON.parse(putResp.getContentText());
    if (result.content?.sha) {
      Logger.log('✅ Sitemap pushed to GitHub successfully');
    } else {
      Logger.log('⚠️ GitHub push response: ' + putResp.getContentText().slice(0,300));
    }
  } catch(e) {
    Logger.log('GitHub push error: ' + e.message);
  }
}

// Set up weekly auto-trigger — run once manually to set up
function setupWeeklyTrigger() {
  // Remove existing triggers first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'generateAndPushSitemap') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Create new weekly trigger (every Monday at 2am)
  ScriptApp.newTrigger('generateAndPushSitemap')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(2)
    .create();
  Logger.log('✅ Weekly sitemap trigger set up');
}

// Test manually — run this to test sitemap generation
function testSitemapGeneration() { generateAndPushSitemap(); }
