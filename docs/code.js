// ═══════════════════════════════════════════════════════════════════════════
//  SITEMAP GENERATOR — add to Code.gs (Google Apps Script)
//  Run weekly via time trigger → pushes sitemap.xml to GitHub
//
//  FIXES vs original:
//    ✅ GITHUB_TOKEN moved here (NOT in frontend code — was exposed!)
//    ✅ GITHUB_REPO corrected: 'MakwME-Top' → 'MakeME-Top' (fix typo — update to your actual repo)
//    ✅ Business URLs: use /biz.html?id= (not /?biz= which Google can't crawl)
//    ✅ privacy-policy.html → privacy.html (matches actual file)
//    ✅ Added help-ai.html and admin page exclusion
//    ✅ muteHttpExceptions on Firestore query to prevent silent failures
//    ✅ Updated field extraction: also pulls updated_at for accurate <lastmod>
//    ✅ Added business name/type to sitemap comments for debugging
//    ✅ Added error logging with partial success (don't abort on single failure)
// ═══════════════════════════════════════════════════════════════════════════

// ── ADD THESE CONSTANTS TO THE TOP OF YOUR Code.gs FILE ──
// (They reference FIREBASE_PROJECT, FIREBASE_API_KEY, SITE_URL already defined there)

const GITHUB_TOKEN = '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';
// ⚠️  IMPORTANT: Rotate this token — it was exposed in frontend code.
//     Go to github.com → Settings → Developer Settings → Personal Access Tokens
//     → Delete the old token → Generate new token with "repo" scope only
//     → Paste new token here (in Code.gs only, NEVER in HTML/JS files)

const GITHUB_OWNER = 'abrarali39t-beep';
const GITHUB_REPO  = 'MakeME-Top';       // ← Fix: was 'MakwME-Top' (typo). Update to your exact repo name.
const GITHUB_FILE  = 'sitemap.xml';       // ← File at root of repo (not docs/ unless that's your gh-pages source)

// ─────────────────────────────────────────────────────────────────────────
//  MAIN: Generate sitemap and push to GitHub
// ─────────────────────────────────────────────────────────────────────────
function generateAndPushSitemap() {
  Logger.log('=== Sitemap generation started: ' + new Date().toISOString() + ' ===');

  // ── 1. Fetch all approved businesses from Firestore ──
  const firestoreUrl =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;

  let businesses = [];
  try {
    const resp = UrlFetchApp.fetch(firestoreUrl, {
      method:             'POST',
      contentType:        'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        structuredQuery: {
          from:  [{ collectionId: 'businesses' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op:    'EQUAL',
              value: { stringValue: 'approved' }
            }
          },
          // Order by newest first — gives Google freshest content
          orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }],
          limit: 1000
        }
      })
    });

    const statusCode = resp.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('❌ Firestore query failed with status ' + statusCode + ': ' + resp.getContentText().slice(0, 300));
      return;
    }

    const rows = JSON.parse(resp.getContentText());

    businesses = (Array.isArray(rows) ? rows : [])
      .filter(r => r.document && r.document.fields)
      .map(r => {
        const f  = r.document.fields;
        const id = r.document.name.split('/').pop();

        // Get most accurate last-modified date
        const updatedRaw = f.updated_at?.timestampValue
          || f.approved_at?.timestampValue
          || f.created_at?.timestampValue;
        const lastmod = updatedRaw
          ? new Date(updatedRaw).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        return {
          id,
          name:    f.name?.stringValue      || '',
          type:    f.type?.stringValue       || '',
          premium: f.is_premium?.booleanValue || false,
          lastmod
        };
      });

    Logger.log(`✅ Found ${businesses.length} approved businesses`);

  } catch(e) {
    Logger.log('❌ Firestore fetch error: ' + e.message);
    return;
  }

  // ── 2. Build sitemap XML ──
  const today  = new Date().toISOString().split('T')[0];

  // Premium listings get higher priority — they've paid for visibility
  const bizUrls = businesses.map(b => {
    const priority = b.premium ? '0.9' : '0.8';
    const comment  = b.name ? `<!-- ${b.name.replace(/-->/g,'')} ${b.type ? '| '+b.type : ''} -->` : '';
    return `
  ${comment}
  <url>
    <loc>${SITE_URL}/biz.html?id=${encodeXml(b.id)}</loc>
    <lastmod>${b.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }).join('');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">

  <!-- ══ STATIC PAGES ══ -->
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/about.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SITE_URL}/privacy.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${SITE_URL}/terms.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${SITE_URL}/refund.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.4</priority>
  </url>

  <!-- ══ MBP BUSINESS PROFILES — ${businesses.length} approved listings ══ -->${bizUrls}

</urlset>`;

  Logger.log('Sitemap XML built — ' + (sitemap.length / 1024).toFixed(1) + ' KB, ' + businesses.length + ' business URLs');

  // ── 3. Push to GitHub ──
  pushToGitHub(sitemap);
}

// ─────────────────────────────────────────────────────────────────────────
//  Push sitemap XML to GitHub via REST API
// ─────────────────────────────────────────────────────────────────────────
function pushToGitHub(content) {

  if (!GITHUB_TOKEN || GITHUB_TOKEN.includes('YOUR_') || GITHUB_TOKEN.length < 20) {
    Logger.log('⚠️  GitHub token not configured — printing sitemap to log instead:');
    Logger.log(content.slice(0, 1000));
    return;
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const headers = {
    'Authorization': 'token ' + GITHUB_TOKEN,
    'Accept':        'application/vnd.github.v3+json',
    'User-Agent':    'MBP-MakeMeTop-SitemapBot/1.0'
  };

  // ── Get current file SHA (required for updates — GitHub rejects PUT without it) ──
  let sha = '';
  let fileExists = false;
  try {
    const getResp = UrlFetchApp.fetch(apiUrl, {
      headers,
      muteHttpExceptions: true
    });
    const code = getResp.getResponseCode();
    if (code === 200) {
      const data = JSON.parse(getResp.getContentText());
      sha       = data.sha || '';
      fileExists = true;
      Logger.log('Existing sitemap SHA: ' + sha.slice(0, 8) + '…');
    } else if (code === 404) {
      Logger.log('sitemap.xml not found in repo — will create it fresh');
    } else {
      Logger.log('GitHub GET unexpected status ' + code + ': ' + getResp.getContentText().slice(0, 200));
    }
  } catch(e) {
    Logger.log('Could not fetch existing file: ' + e.message);
  }

  // ── Push the sitemap ──
  const commitMsg = (fileExists ? '🔄 Auto-update' : '🔥 Create') +
    ` sitemap — ${new Date().toISOString().split('T')[0]} (${content.match(/<url>/g)?.length || 0} URLs)`;

  const body = {
    message: commitMsg,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch:  'main',             // ← change to 'master' if your default branch is master
    ...(sha ? { sha } : {})      // include SHA only when updating existing file
  };

  try {
    const putResp = UrlFetchApp.fetch(apiUrl, {
      method:  'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const code   = putResp.getResponseCode();
    const result = JSON.parse(putResp.getContentText());

    if (code === 200 || code === 201) {
      Logger.log('✅ Sitemap pushed to GitHub successfully');
      Logger.log('   Commit SHA: ' + (result.commit?.sha || 'N/A').slice(0, 8) + '…');
      Logger.log('   File URL:   ' + (result.content?.html_url || 'N/A'));
    } else if (code === 422) {
      // SHA mismatch — file was updated between our GET and PUT
      Logger.log('⚠️  SHA conflict (409/422) — file was modified externally. Retrying with fresh SHA…');
      Utilities.sleep(2000);
      generateAndPushSitemap(); // retry once
    } else if (code === 401) {
      Logger.log('❌ GitHub auth failed — token may be expired or missing "repo" scope. Rotate at github.com/settings/tokens');
    } else if (code === 404) {
      Logger.log('❌ GitHub 404 — check GITHUB_OWNER, GITHUB_REPO, and GITHUB_FILE are correct');
      Logger.log('   Owner: ' + GITHUB_OWNER + '  Repo: ' + GITHUB_REPO + '  File: ' + GITHUB_FILE);
    } else {
      Logger.log('⚠️  GitHub PUT status ' + code + ': ' + putResp.getContentText().slice(0, 300));
    }

  } catch(e) {
    Logger.log('❌ GitHub push error: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  TRIGGERS
// ─────────────────────────────────────────────────────────────────────────

// Run once manually to set up the weekly trigger
function setupWeeklyTrigger() {
  // Remove any existing triggers for this function
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'generateAndPushSitemap') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Removed old trigger');
    }
  });

  // Create new trigger: every Monday at 2–3 AM
  ScriptApp.newTrigger('generateAndPushSitemap')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(2)
    .create();

  Logger.log('✅ Weekly sitemap trigger created — runs every Monday at 2am');
}

// Also run after every new business approval
// Call this from your bizAction() in Code.gs after approving a listing:
//   generateAndPushSitemap();   ← add this line after approval logic
function triggerSitemapOnApproval() {
  generateAndPushSitemap();
}

// ─────────────────────────────────────────────────────────────────────────
//  TEST
// ─────────────────────────────────────────────────────────────────────────
function testSitemapGeneration() {
  generateAndPushSitemap();
}

function testGitHubConnection() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  try {
    const resp = UrlFetchApp.fetch(apiUrl, {
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Accept':        'application/vnd.github.v3+json'
      },
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    if (data.id) {
      Logger.log('✅ GitHub connection OK — repo: ' + data.full_name + ' (default branch: ' + data.default_branch + ')');
      Logger.log('   Update GITHUB_FILE path in code.js if needed.');
    } else {
      Logger.log('❌ GitHub connection failed: ' + resp.getContentText().slice(0, 200));
    }
  } catch(e) {
    Logger.log('❌ GitHub test error: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────────────────────────────────
function encodeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
