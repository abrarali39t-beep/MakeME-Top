# 🔥 MBP – MakeMeTop Business Profile
## Complete Setup, Deployment & Google Ranking Guide

> **Platform:** GitHub Pages (`/docs` folder) + Firebase Auth/Firestore + Google Apps Script + Razorpay

---

## 📁 Your `/docs` folder must look like this

```
/docs/
  index.html           ← Main app
  sw.js                ← Service Worker (PWA)
  manifest.json        ← PWA manifest
  icon-192.png         ← App icon 192×192
  icon-512.png         ← App icon 512×512
  screenshot-mobile.png ← PWA screenshot (390×844)
  about.html
  privacy-policy.html
  terms.html
  refund.html
```

> **Note:** `Code.gs` goes to Google Apps Script — NOT in `/docs`.

---

## ⚙️ STEP 1 — Firebase Setup

1. Go to **console.firebase.google.com** → Create project (or use existing)
2. Go to **Project Settings → Your apps → Add app → Web**
3. Copy your Firebase config object
4. Open `index.html` → find the `firebaseConfig` block → paste your values:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",         // ← from Firebase console
  authDomain:        "yourproject.firebaseapp.com",
  projectId:         "yourproject",
  storageBucket:     "yourproject.firebasestorage.app",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};
```

5. In Firebase console → **Authentication → Sign-in method** → Enable:
   - ✅ Email/Password
   - ✅ Google

6. In Firebase console → **Firestore Database** → Create database → Start in **production mode**

7. Upload your `firestore.rules` file (included in the package)

---

## 📧 STEP 2 — Google Apps Script (Emails + Drive Upload)

1. Go to **script.google.com** → click **New project**
2. Delete all default code → paste the full `Code.gs` content
3. At the top of `Code.gs`, fill in **your** values:

```js
const ADMIN_EMAIL       = 'your@gmail.com';     // ← your Gmail
const FIREBASE_PROJECT  = 'your-project-id';    // ← from Firebase console
const FIREBASE_API_KEY  = 'AIzaSy...';          // ← from Firebase console
```

4. Click **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** → copy the URL (looks like `https://script.google.com/macros/s/ABC.../exec`)

6. Open `index.html` → paste the URL in **two places**:

```js
const DRIVE_UPLOAD_URL = "https://script.google.com/macros/s/YOUR_URL/exec";
const EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_URL/exec";
```

> ✅ Same URL for both — `Code.gs` handles routing based on the `action` field.

7. **Test emails** — in Apps Script editor, run these functions one by one:
   - `testWelcomeEmail()` → check your inbox
   - `testApprovedEmail()`
   - `testPaymentEmail()`

---

## 💳 STEP 3 — Razorpay Payment Setup

### 3a. Get your API keys
1. Go to **dashboard.razorpay.com** → Settings → API Keys
2. Copy your **Key ID** (starts with `rzp_live_` or `rzp_test_`)
3. Open `index.html` → paste:

```js
const RAZORPAY_KEY_ID = "rzp_live_XXXXXXXXXXXXXXXX";
```

> ⚠️ **Never put your Razorpay Secret in `index.html`** — secret stays in `Code.gs` only

### 3b. Auto-approve webhook (premium activates automatically)
1. In Razorpay dashboard → **Settings → Webhooks → Add New Webhook**
2. URL: `https://script.google.com/macros/s/YOUR_APPS_SCRIPT_URL/exec`
3. Select events: ✅ `payment.captured` ✅ `order.paid`
4. Copy the **Webhook Secret**
5. In `Code.gs` → paste:

```js
const RZP_WEBHOOK_SECRET = 'your_webhook_secret';
```

6. Redeploy Apps Script (Deploy → Manage deployments → Edit → new version)

### 3c. What happens on payment:
```
User pays ₹499 → Razorpay → webhook → Apps Script
  → Updates Firestore: users/{uid}.is_premium = true
  → Saves to payments collection
  → Sends confirmation email to user ✅
```

---

## 🌐 STEP 4 — GitHub Pages Deployment

### First time:
```bash
git init
git add docs/
git commit -m "🔥 MBP v4 launch"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### In GitHub:
1. Go to repo → **Settings → Pages**
2. Source: **Deploy from branch**
3. Branch: `main` | Folder: `/docs`
4. Save → your site goes live at `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### Custom domain (makemetop.in):
1. In GitHub Pages settings → **Custom domain** → type `makemetop.in`
2. In Hostinger DNS → add these records:

| Type | Name | Value |
|------|------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | YOUR_USERNAME.github.io |

3. Wait 24 hours for DNS propagation
4. In GitHub Pages → enable **Enforce HTTPS** ✅

### Push updates:
```bash
git add docs/
git commit -m "Update: description of change"
git push
```

---

## 🔒 STEP 5 — Admin Panel Access

1. Open `index.html` → find:
```js
const ADMIN_EMAILS = ["YOUR_ADMIN_EMAIL@gmail.com"];
```
2. Replace with your actual Gmail address
3. Log in with that email → admin icon appears in top-right of home page

**Admin panel lets you:**
- ✅ Approve / reject MBP listings
- 💬 View and reply to user messages
- 🗑 Delete any listing

---

## 📲 STEP 6 — PWA App Install

### What makes the install prompt appear:

| Browser | When it shows |
|---------|--------------|
| **Chrome Android** | After 4 seconds on site (automatic banner) |
| **iOS Safari** | Banner shows after 3 seconds with "Share → Add to Home Screen" |
| **Desktop Chrome** | Install icon in address bar |

### Requirements for PWA to work:
- ✅ Site served over **HTTPS** (GitHub Pages does this automatically)
- ✅ `manifest.json` linked in `<head>`
- ✅ `sw.js` in root of your site (i.e., inside `/docs/`)
- ✅ Icons present: `icon-192.png` and `icon-512.png`

### Test PWA:
1. Open Chrome → F12 → **Application tab → Manifest** (should show all green ticks)
2. **Application → Service Workers** (should show "Activated and running")

---

## 🔍 STEP 7 — Google SEO & Ranking

### Submit to Google Search Console:
1. Go to **search.google.com/search-console**
2. Add property → URL prefix → `https://makemetop.in`
3. Verify with HTML tag (copy tag → paste in `index.html` `<head>`)
4. Submit sitemap: `https://makemetop.in/sitemap.xml`

### What's already built in for ranking:

| SEO Feature | Where |
|-------------|-------|
| Title: "MBP – MakeMeTop Business Profile" | `<title>` in head |
| Schema.org WebSite + FAQ + LocalBusiness | `<script type="ld+json">` |
| Per-profile schema injected dynamically | `injectBizSchema()` in JS |
| Breadcrumbs for every MBP profile | BreadcrumbList schema |
| Geo meta tags for Srinagar J&K | `geo.region`, `geo.position` |
| Open Graph for social sharing | `og:` meta tags |
| Twitter Card | `twitter:` meta tags |
| robots.txt | `/docs/robots.txt` |
| sitemap.xml | `/docs/sitemap.xml` |

### Target keywords already in the page:
- `MBP`, `MakeMeTop Business Profile`, `MMT`, `MMTBP`
- `local business Srinagar`, `business directory J&K`
- `Kashmir business listing`, `free MBP`

### Every MBP profile gets its own Google entry:
When a user creates an MBP and opens their profile, the app automatically:
1. Changes `<title>` → `{Business Name} – MBP | Srinagar J&K | MakeMeTop`
2. Updates `meta description`
3. Injects `LocalBusiness` schema with address, phone, reviews
4. Sets `canonical` URL to `/?biz={id}`
5. Updates all Open Graph tags

---

## 📬 STEP 8 — Sending Emails to All Users (Bulk Updates)

From the admin panel or by calling the Apps Script directly:

```js
// From your browser console (when logged in as admin):
fetch(window.EMAIL_SCRIPT_URL, {
  method: 'POST',
  body: JSON.stringify({
    action: 'sendBulkUpdate',
    to: 'user@email.com',
    subject: 'New Feature: MBP Premium 🔥',
    message: '<p>We just launched something amazing...</p>'
  }),
  headers: { 'Content-Type': 'text/plain' }
});
```

For mass emails (all users), add a Firestore query loop in `Code.gs`:

```js
function sendNewsletterToAll(subject, message) {
  // Query all users from Firestore REST API
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/users?key=${FIREBASE_API_KEY}&pageSize=100`;
  const resp = UrlFetchApp.fetch(url);
  const data = JSON.parse(resp.getContentText());
  const docs = data.documents || [];
  docs.forEach(doc => {
    const email = doc.fields?.email?.stringValue;
    if (email) sendBulkUpdateEmail(email, subject, message);
    Utilities.sleep(200); // prevent Gmail rate limiting
  });
}
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| White screen | Check Firebase config values are correctly pasted |
| Login not working | Enable Email/Password in Firebase Auth |
| Images not uploading | Deploy Apps Script as **Web App → Anyone** |
| Emails not sending | Run `testWelcomeEmail()` in Apps Script editor; check Gmail permissions |
| Install popup not showing | Must be on HTTPS + SW registered (check DevTools → Application) |
| Razorpay payment failing | Check `RAZORPAY_KEY_ID` is set; test with `rzp_test_` key first |
| MBP not appearing on Google | Submit sitemap in Search Console; wait 2–7 days for indexing |

---

## 🔑 Config Checklist

Open `index.html` and fill in ALL of these before going live:

```
[ ] firebaseConfig.apiKey
[ ] firebaseConfig.authDomain
[ ] firebaseConfig.projectId
[ ] firebaseConfig.storageBucket
[ ] firebaseConfig.messagingSenderId
[ ] firebaseConfig.appId
[ ] DRIVE_UPLOAD_URL   (from Apps Script deployment)
[ ] EMAIL_SCRIPT_URL   (same as DRIVE_UPLOAD_URL)
[ ] RAZORPAY_KEY_ID    (from Razorpay dashboard)
[ ] ADMIN_EMAILS       (your Gmail)
```

In `Code.gs` fill in:
```
[ ] ADMIN_EMAIL         (your Gmail)
[ ] FIREBASE_PROJECT    (project ID from Firebase)
[ ] FIREBASE_API_KEY    (API key from Firebase)
[ ] RZP_WEBHOOK_SECRET  (from Razorpay webhooks)
```

---

*MBP – MakeMeTop Business Profile · Srinagar, Jammu & Kashmir · makemetop.in*
