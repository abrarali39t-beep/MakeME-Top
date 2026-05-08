// ═══════════════════════════════════════════════════════════════════════════
//  MBP – MakeMe Top Business Profile
//  Google Apps Script v5 — Razorpay Payment Gateway + Auto-Approval
//
//  ╔════════════════════════════════════════════════════════════════════╗
//  ║  SETUP STEPS:                                                     ║
//  ║  1. Paste entire file into script.google.com                     ║
//  ║  2. Fill ★ YOUR CONFIG ★ section below                          ║
//  ║  3. Deploy → New Deployment → Web App                            ║
//  ║     • Execute as: Me  |  Who has access: Anyone                  ║
//  ║  4. Copy the Web App URL and paste it as APPS_SCRIPT_URL in:    ║
//  ║       index.html  •  admin.html  •  help-ai.html                ║
//  ║  5. In Razorpay Dashboard → Settings → Webhooks:                ║
//  ║     • URL: <your Web App URL>?action=razorpay_webhook            ║
//  ║     • Events: payment.captured + subscription.charged           ║
//  ║     • Copy Webhook Secret → paste as RZP_WEBHOOK_SECRET below   ║
//  ║  6. Set up a time-based trigger for checkExpiredSubscriptions()  ║
//  ║     Apps Script → Triggers → Add → Every day                    ║
//  ║  7. Run testAll() to verify before going live                    ║
//  ╚════════════════════════════════════════════════════════════════════╝
//
//  PAYMENT PLANS:
//    monthly_799  — ₹799/month   (real price ₹1,799 — 10-day limited offer)
//    annual_1499  — ₹1,499/year  (20% off vs 12 × ₹799 = ₹9,588 → save ₹8,089)
//
//  ACTIONS via doPost():
//    razorpay_webhook     — auto payment verification + user activation
//    createRazorpayOrder  — create Razorpay order (frontend calls this)
//    uploadImage          — Google Drive image upload
//    askGroqAI            — Groq AI secure proxy
//    sendWelcomeEmail     — new user welcome
//    sendBusinessApproved — listing live notification
//    sendBusinessRejected — listing rejection notification
//    sendPaymentConfirm   — premium activation receipt
//    sendNewReviewAlert   — review notification to owner
//    sendBulkUpdateEmail  — admin newsletter
//    sendOwnershipClaim   — claim request to current owner
//    sendClaimAccepted    — transfer confirmed email
//
//  ACTIONS via doGet():
//    ping                 — health check
//    razorpay_webhook     — webhook delivery (some providers use GET)
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
//  ★  YOUR CONFIG  ★
// ─────────────────────────────────────────────────────────────────────────

const ADMIN_EMAIL  = 'abrarrtallks@gmail.com';
const BRAND_EMAIL  = 'mbp.makemetop@gmail.com';
const BRAND_NAME   = 'MakeMe Top – MBP';
const SITE_URL     = 'https://makemetop.in';
const LOGO_URL     = 'https://makemetop.in/icon-192.png';
const ROOT_FOLDER  = 'MBP_Uploads';

// ── RAZORPAY KEYS (NEVER exposed to frontend) ──
// Get from: https://dashboard.razorpay.com → Settings → API Keys
const RZP_KEY_ID     = 'PASTE_YOUR_RAZORPAY_KEY_ID';       // rzp_live_xxxxxx
const RZP_KEY_SECRET = 'PASTE_YOUR_RAZORPAY_KEY_SECRET';   // your secret key
const RZP_WEBHOOK_SECRET = 'PASTE_YOUR_RAZORPAY_WEBHOOK_SECRET'; // from webhook settings

// ── PRICING (in paise — Razorpay uses smallest currency unit) ──
// ₹799/month  → 79900 paise   (limited offer — real price ₹1,799)
// ₹1,499/year → 149900 paise  (20% off vs monthly × 12)
const PLANS = {
  monthly_799: {
    name:         'MBP Premium – 1 Month',
    amount:       79900,          // paise
    currency:     'INR',
    display:      '₹799',
    real_price:   '₹1,499',       // crossed-out "real" price for offer display
    duration_days: 30,
    period:       'monthly'
  },
  annual_1499: {
    name:         'MBP Premium – 1 Year',
    amount:       799900,         // paise = ₹7,999
    currency:     'INR',
    display:      '₹7,999',
    real_price:   '₹9,588',       // 12 × ₹799 = ₹9,588 — user saves ₹1,589
    duration_days: 365,
    period:       'yearly',
    discount_pct:  17              // 17% off real annual cost
  }
};

// ── GROQ AI KEY ──
const GROQ_API_KEY = 'PASTE_YOUR_GROQ_API_KEY_HERE';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_MAX_TOK = 1024;

// ── FIREBASE (for Firestore REST updates — fill in your project details) ──
const FIREBASE_PROJECT = 'live-voting-b236f';
const FIREBASE_API_KEY = 'AIzaSyDwx-GoLV3-T5_zEURlqUb1LXa48gbqhM8';

// ── AI SYSTEM PROMPT ──
const AI_SYSTEM_PROMPT =
  'You are MBP AI Assistant — the official guide for MakeMe Top Business Profile (MBP) ' +
  'at makemetop.in. Help tourists plan Kashmir trips and advise business owners on listing ' +
  'their agency or resort. Plans: ₹799/month or ₹1,499/year (20% off). Paid via Razorpay. ' +
  'Approval within 48 hours. Be friendly, concise, professional. Use emojis sparingly. ' +
  'If asked in Hindi/Urdu, respond in that language. Visit makemetop.in for listings.';

// ─────────────────────────────────────────────────────────────────────────
//  SECURITY — Replay Attack Prevention
// ─────────────────────────────────────────────────────────────────────────
// Store processed payment IDs to prevent replay attacks
// Uses CacheService (6-hour window) as first line, PropertiesService as persistent store
const CACHE        = CacheService.getScriptCache();
const PROPS        = PropertiesService.getScriptProperties();
const PROCESSED_KEY = 'processed_payments_';

function isAlreadyProcessed(paymentId) {
  if (!paymentId) return false;
  if (CACHE.get(PROCESSED_KEY + paymentId)) return true;
  const stored = PROPS.getProperty(PROCESSED_KEY + paymentId);
  return !!stored;
}

function markAsProcessed(paymentId) {
  if (!paymentId) return;
  CACHE.put(PROCESSED_KEY + paymentId, '1', 21600); // 6 hour cache
  PROPS.setProperty(PROCESSED_KEY + paymentId, new Date().toISOString());
}

// ─────────────────────────────────────────────────────────────────────────
//  HMAC-SHA256 SIGNATURE VERIFICATION (for Razorpay webhook)
// ─────────────────────────────────────────────────────────────────────────
function verifyRazorpaySignature(payload, signature, secret) {
  try {
    const mac = Utilities.computeHmacSha256Signature(payload, secret);
    const hex = mac.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
    return hex === signature;
  } catch (e) {
    Logger.log('Signature verify error: ' + e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  doGet — Health check + optional GET webhook
// ═══════════════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    return jsonResp({ status: 'ok', service: 'MBP Apps Script v5', ts: new Date().toISOString() });
  }
  return jsonResp({ status: 'ok' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  doPost — Main router
// ═══════════════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResp({ error: 'Empty request body' });
    }

    // ── Razorpay webhook comes with a special header — check query param too ──
    const queryAction = e && e.parameter && e.parameter.action;

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResp({ error: 'Invalid JSON: ' + parseErr.message });
    }

    if (!data || typeof data !== 'object') {
      return jsonResp({ error: 'Request body must be a JSON object' });
    }

    // Razorpay webhooks set event at root level; our internal actions use data.action
    const action = queryAction || (data.action || '').trim() || (data.event ? 'razorpay_webhook' : '');

    switch (action) {

      // ── RAZORPAY WEBHOOK (auto-verify payment, activate user) ──
      case 'razorpay_webhook':
        return handleRazorpayWebhook(e.postData.contents, e, data);

      // ── CREATE RAZORPAY ORDER (frontend calls this to get order_id) ──
      case 'createRazorpayOrder':
        return createRazorpayOrder(data.plan_id, data.user_id, data.user_email, data.user_name, data.biz_id);

      // ── GET RAZORPAY KEY ID (frontend needs key_id to init Razorpay checkout) ──
      case 'getRazorpayKeyId':
        return jsonResp({ key_id: RZP_KEY_ID });

      // ── MANUAL PAYMENT VERIFICATION (admin panel) ──
      case 'verifyPaymentManual':
        return manualVerifyPayment(data.payment_id, data.plan_id, data.user_id, data.user_email, data.user_name, data.biz_id, data.admin_token);

      // ── AI ──
      case 'askGroqAI':
        return askGroqAI(data.messages, data.systemPrompt);

      // ── IMAGE UPLOAD ──
      case 'uploadImage':
        return uploadImageToDrive(data.file, data.name, data.folder, data.mimeType);

      // ── EMAILS ──
      case 'sendWelcomeEmail':       return sendWelcomeEmail(data.to, data.name);
      case 'sendBusinessApproved':   return sendBusinessApprovedEmail(data.to, data.name, data.businessName);
      case 'sendBusinessRejected':   return sendBusinessRejectedEmail(data.to, data.name, data.businessName);
      case 'sendPaymentConfirm':     return sendPaymentConfirmEmail(data.to, data.name, data.planName, data.amount, data.paymentId, data.expiry, data.planId);
      case 'sendNewReviewAlert':     return sendNewReviewAlert(data.ownerEmail, data.businessName, data.reviewerName, data.rating);
      case 'sendBulkUpdateEmail':    return sendBulkUpdateEmail(data.to, data.subject, data.message);
      case 'sendOwnershipClaim':     return sendOwnershipClaimEmail(data.ownerEmail, data.ownerName, data.businessName, data.requesterName, data.requesterEmail, data.requesterPhone, data.requesterMsg, data.token, data.businessId);
      case 'sendClaimAccepted':      return sendClaimAcceptedEmail(data.to, data.name, data.businessName);

      // ── Legacy bare upload ──
      default:
        if (data.file) return uploadImageToDrive(data.file, data.name, data.folder, data.mimeType);
        return jsonResp({ error: 'Unknown action: ' + (action || '(none)') });
    }
  } catch (err) {
    Logger.log('doPost fatal: ' + err.message + '\n' + err.stack);
    return jsonResp({ error: err.message || 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RAZORPAY — Create Order
//  Frontend sends: { action:'createRazorpayOrder', plan_id, user_id, user_email, biz_id }
//  Returns: { order_id, amount, currency, plan_name, key_id }
// ═══════════════════════════════════════════════════════════════════════════
function createRazorpayOrder(planId, userId, userEmail, userName, bizId) {
  if (!planId || !PLANS[planId]) return jsonResp({ error: 'Invalid plan_id: ' + planId });
  if (!userId)    return jsonResp({ error: 'user_id is required' });
  if (!userEmail) return jsonResp({ error: 'user_email is required' });
  if (RZP_KEY_ID.includes('PASTE')) return jsonResp({ error: 'Razorpay keys not configured in Code.gs' });

  const plan = PLANS[planId];
  const receipt = 'mbp_' + planId + '_' + Date.now();

  const orderPayload = {
    amount:   plan.amount,
    currency: plan.currency,
    receipt:  receipt,
    notes: {
      plan_id:    planId,
      user_id:    userId,
      user_email: userEmail,
      user_name:  userName || '',
      biz_id:     bizId    || '',
      platform:   'MBP'
    }
  };

  try {
    const credentials = Utilities.base64Encode(RZP_KEY_ID + ':' + RZP_KEY_SECRET);
    const resp = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
      method:      'post',
      contentType: 'application/json',
      headers:     { 'Authorization': 'Basic ' + credentials },
      payload:     JSON.stringify(orderPayload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    const result = JSON.parse(body);

    if (code !== 200) {
      Logger.log('Razorpay create order error ' + code + ': ' + body);
      return jsonResp({ error: result.error?.description || 'Failed to create order (code ' + code + ')' });
    }

    Logger.log('Order created: ' + result.id + ' | plan: ' + planId + ' | user: ' + userId);
    return jsonResp({
      order_id:   result.id,
      amount:     plan.amount,
      currency:   plan.currency,
      plan_name:  plan.name,
      plan_id:    planId,
      key_id:     RZP_KEY_ID         // safe to return — this is the public key
    });

  } catch (err) {
    Logger.log('createRazorpayOrder error: ' + err.message);
    return jsonResp({ error: 'Network error creating order: ' + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RAZORPAY WEBHOOK — Auto-verify, activate user, save to Firestore
//
//  Flow:
//    Razorpay → POST to Apps Script webhook URL
//    → verify HMAC signature (prevent forgery)
//    → check idempotency (prevent replay)
//    → extract user_id, plan_id from payment notes
//    → updateFirestoreUser() to set is_premium=true, expiry
//    → updateFirestoreDocument() to set business status=approved if biz_id present
//    → addFirestoreDocument() to payments collection
//    → send payment confirmation email
// ═══════════════════════════════════════════════════════════════════════════
function handleRazorpayWebhook(rawBody, e, data) {

  // ── 1. Verify Razorpay signature ──
  const sig = (e && e.parameter && e.parameter['x-razorpay-signature']) ||
              (e && e.postData && e.postData.headers && e.postData.headers['x-razorpay-signature']) ||
              '';

  if (sig && !RZP_WEBHOOK_SECRET.includes('PASTE')) {
    if (!verifyRazorpaySignature(rawBody, sig, RZP_WEBHOOK_SECRET)) {
      Logger.log('WEBHOOK: Invalid signature — possible attack!');
      return jsonResp({ error: 'Invalid signature' });
    }
  } else {
    Logger.log('WEBHOOK: Signature verification skipped (secret not configured or sig missing)');
  }

  // ── 2. Parse event ──
  const event   = data.event || '';
  const payload = data.payload || {};

  if (event !== 'payment.captured' && event !== 'order.paid' && event !== 'subscription.charged') {
    Logger.log('WEBHOOK: Ignored event: ' + event);
    return jsonResp({ status: 'ignored', event });
  }

  const payment = payload.payment?.entity || payload.order?.entity || {};
  const notes   = payment.notes || {};

  const paymentId = payment.id || '';
  const userId    = notes.user_id    || '';
  const planId    = notes.plan_id    || 'monthly_799';
  const bizId     = notes.biz_id     || '';
  const email     = notes.user_email || payment.email || '';
  const userName  = notes.user_name  || '';
  const amountINR = (payment.amount || 0) / 100;

  if (!userId) {
    Logger.log('WEBHOOK: No user_id in payment notes — cannot activate');
    return jsonResp({ error: 'No user_id in notes' });
  }

  // ── 3. Idempotency — prevent replay attacks ──
  if (paymentId && isAlreadyProcessed(paymentId)) {
    Logger.log('WEBHOOK: Payment already processed (replay prevented): ' + paymentId);
    return jsonResp({ status: 'already_processed', payment_id: paymentId });
  }

  // ── 4. Compute expiry ──
  const plan = PLANS[planId] || PLANS['monthly_799'];
  const expiryMs = Date.now() + (plan.duration_days * 24 * 60 * 60 * 1000);
  const expiry   = new Date(expiryMs).toISOString();
  const expiryDisplay = new Date(expiryMs).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // ── 5. Update Firestore user → set premium ──
  updateFirestoreUser(userId, {
    is_premium:     true,
    premium_plan:   planId,
    premium_expiry: expiry,
    payment_id:     paymentId,
    updated_at:     new Date().toISOString()
  });

  // ── 6. Auto-approve business listing if biz_id provided ──
  if (bizId) {
    updateFirestoreDocument('businesses', bizId, {
      status:          'approved',
      is_premium:      true,
      premium_expiry:  expiry,
      premium_plan:    planId,
      approved_at:     new Date().toISOString()
    });
    Logger.log('WEBHOOK: Auto-approved listing: ' + bizId);
  }

  // ── 7. Save payment record to Firestore ──
  addFirestoreDocument('payments', {
    payment_id:   paymentId,
    user_id:      userId,
    user_email:   email,
    plan_id:      planId,
    plan_name:    plan.name,
    amount_inr:   amountINR,
    biz_id:       bizId,
    status:       'paid',
    expires_at:   expiry,
    created_at:   new Date().toISOString(),
    platform:     'MBP'
  });

  // ── 8. Mark as processed ──
  if (paymentId) markAsProcessed(paymentId);

  // ── 9. Send confirmation email ──
  if (email) {
    sendPaymentConfirmEmail(email, userName || email.split('@')[0], plan.name, amountINR, paymentId, expiryDisplay, planId);
  }

  Logger.log('WEBHOOK: Premium activated | user: ' + userId + ' | plan: ' + planId + ' | expires: ' + expiryDisplay);
  return jsonResp({ status: 'success', user_id: userId, expires: expiry });
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANUAL PAYMENT VERIFICATION (admin fallback)
//  Admin can trigger this from admin panel if webhook fails
// ═══════════════════════════════════════════════════════════════════════════
function manualVerifyPayment(paymentId, planId, userId, userEmail, userName, bizId, adminToken) {

  // Simple admin token check (set your own token below)
  const ADMIN_TOKEN = 'PASTE_YOUR_ADMIN_SECRET_TOKEN'; // change this to a strong random string
  if (adminToken !== ADMIN_TOKEN) {
    return jsonResp({ error: 'Unauthorized' });
  }

  if (!paymentId || !userId || !planId) {
    return jsonResp({ error: 'payment_id, user_id and plan_id are required' });
  }

  if (isAlreadyProcessed(paymentId)) {
    return jsonResp({ status: 'already_processed' });
  }

  // Verify payment with Razorpay API
  try {
    const credentials = Utilities.base64Encode(RZP_KEY_ID + ':' + RZP_KEY_SECRET);
    const resp = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' + paymentId, {
      headers: { 'Authorization': 'Basic ' + credentials },
      muteHttpExceptions: true
    });
    const code   = resp.getResponseCode();
    const rzpPay = JSON.parse(resp.getContentText());

    if (code !== 200) return jsonResp({ error: 'Razorpay fetch failed: ' + code });
    if (rzpPay.status !== 'captured') return jsonResp({ error: 'Payment not captured. Status: ' + rzpPay.status });

    const plan     = PLANS[planId] || PLANS['monthly_799'];
    const expiryMs = Date.now() + (plan.duration_days * 24 * 60 * 60 * 1000);
    const expiry   = new Date(expiryMs).toISOString();
    const expiryDisplay = new Date(expiryMs).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

    updateFirestoreUser(userId, { is_premium:true, premium_plan:planId, premium_expiry:expiry, payment_id:paymentId });
    if (bizId) updateFirestoreDocument('businesses', bizId, { status:'approved', is_premium:true, premium_expiry:expiry });
    addFirestoreDocument('payments', { payment_id:paymentId, user_id:userId, user_email:userEmail||'', plan_id:planId, amount_inr:rzpPay.amount/100, status:'paid', expires_at:expiry });
    markAsProcessed(paymentId);
    if (userEmail) sendPaymentConfirmEmail(userEmail, userName||'', plan.name, rzpPay.amount/100, paymentId, expiryDisplay, planId);

    return jsonResp({ status: 'verified', expires: expiry });
  } catch (err) {
    Logger.log('manualVerifyPayment error: ' + err.message);
    return jsonResp({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTO-EXPIRY — Triggered daily by Apps Script time trigger
//  Scans Firestore for expired premium users and removes their premium status
// ═══════════════════════════════════════════════════════════════════════════
function checkExpiredSubscriptions() {
  if (!FIREBASE_PROJECT || FIREBASE_PROJECT.includes('PASTE')) {
    Logger.log('checkExpiredSubscriptions: Firebase not configured, skipping');
    return;
  }

  const now = new Date().toISOString();
  Logger.log('Checking expired subscriptions at: ' + now);

  // Query payments collection for expired entries
  const paymentsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;

  const query = {
    structuredQuery: {
      from: [{ collectionId: 'payments' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'paid' } } },
            { fieldFilter: { field: { fieldPath: 'expires_at' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: now } } }
          ]
        }
      },
      limit: 50
    }
  };

  try {
    const resp = UrlFetchApp.fetch(paymentsUrl, {
      method: 'POST', contentType: 'application/json',
      payload: JSON.stringify(query), muteHttpExceptions: true
    });
    const results = JSON.parse(resp.getContentText());
    let expiredCount = 0;

    (Array.isArray(results) ? results : []).forEach(row => {
      if (!row.document) return;
      const fields  = row.document.fields || {};
      const userId  = fields.user_id?.stringValue;
      const bizId   = fields.biz_id?.stringValue;
      const payId   = fields.payment_id?.stringValue;
      const planId  = fields.plan_id?.stringValue || '';
      const docPath = row.document.name;

      if (!userId) return;

      // Remove premium from user
      updateFirestoreUser(userId, { is_premium: false, premium_plan: '', premium_expiry: '' });

      // If yearly plan expired, also remove listing premium status
      if (bizId) {
        updateFirestoreDocument('businesses', bizId, { is_premium: false, premium_expiry: '' });
      }

      // Mark payment as expired
      const docName = docPath.split('/').pop();
      updateFirestoreDocumentByPath(docPath, { status: 'expired', expired_at: now });

      expiredCount++;
      Logger.log('Expired: userId=' + userId + ' plan=' + planId);

      // Send expiry notification email
      const emailVal = fields.user_email?.stringValue;
      const planName = (PLANS[planId] || {}).name || 'MBP Premium';
      if (emailVal) sendPremiumExpiredEmail(emailVal, planName, planId);
    });

    Logger.log('checkExpiredSubscriptions: processed ' + expiredCount + ' expired records');
  } catch (err) {
    Logger.log('checkExpiredSubscriptions error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GROQ AI — Secure Proxy
// ═══════════════════════════════════════════════════════════════════════════
function askGroqAI(messages, customSystemPrompt) {
  if (!GROQ_API_KEY || GROQ_API_KEY.includes('PASTE_YOUR')) {
    return jsonResp({ error: 'Groq API key not configured.' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return jsonResp({ error: 'messages array is required' });
  }

  const cleanMessages = messages
    .slice(-20)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 3000) }));

  if (cleanMessages.length === 0) return jsonResp({ error: 'No valid messages' });

  const sysPrompt = (customSystemPrompt && typeof customSystemPrompt === 'string')
    ? customSystemPrompt.slice(0, 2000)
    : AI_SYSTEM_PROMPT;

  try {
    const resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY },
      payload: JSON.stringify({ model: GROQ_MODEL, messages: [{ role:'system', content:sysPrompt }, ...cleanMessages], max_tokens: GROQ_MAX_TOK, temperature: 0.7, stream: false }),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    const gData = JSON.parse(body);
    if (code !== 200) {
      const em = gData.error?.message || 'Groq error ' + code;
      if (code === 401) return jsonResp({ error: 'Invalid Groq API key.' });
      if (code === 429) return jsonResp({ error: 'Groq rate limit. Try again.' });
      return jsonResp({ error: em });
    }
    const reply = gData.choices?.[0]?.message?.content?.trim();
    if (!reply) return jsonResp({ error: 'Empty AI response' });
    return jsonResp({ reply, model: GROQ_MODEL, tokens: gData.usage?.total_tokens || 0 });
  } catch (err) {
    return jsonResp({ error: 'Groq fetch error: ' + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGE UPLOAD — Google Drive
// ═══════════════════════════════════════════════════════════════════════════
function uploadImageToDrive(base64Data, fileName, folderPath, mimeType) {
  if (!base64Data || typeof base64Data !== 'string' || base64Data.length < 10) {
    return jsonResp({ error: 'No valid file data' });
  }
  try {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const rootFolder  = getOrCreateFolder(ROOT_FOLDER, null);
    let target = rootFolder;
    if (folderPath) {
      const parts = folderPath.replace(/^MBP_Uploads\/?/, '').split('/').map(p => p.trim()).filter(Boolean);
      for (const part of parts) target = getOrCreateFolder(part, target);
    }
    const name = (fileName && fileName.trim()) ? fileName.trim() : ('mbp_' + Date.now() + '.webp');
    const type = (mimeType && mimeType.trim()) ? mimeType.trim() : 'image/webp';
    let decoded;
    try { decoded = Utilities.base64Decode(cleanBase64); }
    catch (de) { return jsonResp({ error: 'base64 decode failed: ' + de.message }); }
    const file = target.createFile(Utilities.newBlob(decoded, type, name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const id = file.getId();
    return jsonResp({ url: 'https://lh3.googleusercontent.com/d/' + id, fallbackUrl: 'https://drive.google.com/uc?export=view&id=' + id, id, folder: target.getName() });
  } catch (err) {
    return jsonResp({ error: 'Upload failed: ' + err.message });
  }
}

function getOrCreateFolder(name, parent) {
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

// ═══════════════════════════════════════════════════════════════════════════
//  FIRESTORE REST API HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function firestoreBaseUrl(collection, docId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}${docId ? '/' + docId : ''}?key=${FIREBASE_API_KEY}`;
}

function toFirestoreFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'boolean') return [k, { booleanValue: v }];
    if (typeof v === 'number')  return [k, { doubleValue: v }];
    return [k, { stringValue: String(v) }];
  }));
}

function updateFirestoreUser(userId, fields) {
  if (!FIREBASE_PROJECT || FIREBASE_PROJECT.includes('PASTE')) return null;
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const url  = firestoreBaseUrl('users', userId) + '&' + mask;
  try {
    const r = UrlFetchApp.fetch(url, { method:'PATCH', contentType:'application/json', payload: JSON.stringify({ fields: toFirestoreFields(fields) }), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) Logger.log('Firestore user PATCH error: ' + r.getContentText().slice(0,200));
    return JSON.parse(r.getContentText());
  } catch (e) { Logger.log('updateFirestoreUser: ' + e.message); return null; }
}

function updateFirestoreDocument(collection, docId, fields) {
  if (!FIREBASE_PROJECT || FIREBASE_PROJECT.includes('PASTE')) return null;
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const url  = firestoreBaseUrl(collection, docId) + '&' + mask;
  try {
    const r = UrlFetchApp.fetch(url, { method:'PATCH', contentType:'application/json', payload: JSON.stringify({ fields: toFirestoreFields(fields) }), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) Logger.log('Firestore ' + collection + ' PATCH error: ' + r.getContentText().slice(0,200));
    return JSON.parse(r.getContentText());
  } catch (e) { Logger.log('updateFirestoreDocument: ' + e.message); return null; }
}

function updateFirestoreDocumentByPath(docPath, fields) {
  if (!FIREBASE_PROJECT || FIREBASE_PROJECT.includes('PASTE')) return null;
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const url  = `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}&${mask}`;
  try {
    UrlFetchApp.fetch(url, { method:'PATCH', contentType:'application/json', payload: JSON.stringify({ fields: toFirestoreFields(fields) }), muteHttpExceptions: true });
  } catch (e) { Logger.log('updateFirestoreDocumentByPath: ' + e.message); }
}

function addFirestoreDocument(collection, data) {
  if (!FIREBASE_PROJECT || FIREBASE_PROJECT.includes('PASTE')) return null;
  const url = firestoreBaseUrl(collection, null);
  try {
    const r = UrlFetchApp.fetch(url, { method:'POST', contentType:'application/json', payload: JSON.stringify({ fields: toFirestoreFields(data) }), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) Logger.log('Firestore addDoc error: ' + r.getContentText().slice(0,200));
  } catch (e) { Logger.log('addFirestoreDocument: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

// 1. Welcome
function sendWelcomeEmail(to, name) {
  if (!to || !isValidEmail(to)) return jsonResp({ status: 'skipped' });
  const safeName = sanitize(name) || 'there';
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">🔥</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">Welcome, ${safeName}!</h1>
  <p style="color:#6B7280;font-size:15px;line-height:1.7;margin:0 0 28px;">You're now part of <strong style="color:#1F1F1F;">Kashmir's #1 travel directory</strong> — MakeMe Top Business Profile.</p>
</td></tr>
<tr><td style="padding:0 32px 28px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    ${featureRow('📋','List Your Business','Get verified on MBP — ₹799/month or ₹1,499/year — ranked on Google Search')}
    ${featureRow('⭐','Write Reviews','Help tourists find great travel agencies and resorts')}
    ${featureRow('🔍','Discover Kashmir','Top-rated resorts, houseboats, tour operators across J&amp;K')}
    ${featureRow('📲','Install the App','Settings → Install App — works offline too!')}
  </table>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#1F1F1F;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">🏔️ List My Business Now</a>
  <p style="margin:14px 0 0;font-size:13px;color:#9CA3AF;">Starting at ₹799/month · Paid via Razorpay · Live within 48 hours</p>
</td></tr>`;
  return sendEmail(to, '🔥 Welcome to MBP – MakeMe Top Business Profile!', body);
}

// 2. Payment Confirmation (Premium Activated)
function sendPaymentConfirmEmail(to, name, planName, amount, paymentId, expiry, planId) {
  if (!to || !isValidEmail(to)) return jsonResp({ status: 'skipped' });
  const plan = PLANS[planId] || {};
  const safeName = sanitize(name) || 'there';
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">🎉</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">Payment Successful!</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Hi ${safeName}, your MBP Premium is now active. Your listing will be live within 48 hours.</p>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#D1FAE5;border:1.5px solid #6EE7B7;border-radius:12px;padding:20px 24px;">
    <p style="margin:0 0 12px;font-weight:700;color:#065F46;font-size:14px;">Payment Receipt</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${receiptRow('Plan', sanitize(planName||plan.name||'MBP Premium'))}
      ${receiptRow('Amount Paid', '₹' + amount)}
      ${receiptRow('Payment ID', sanitize(paymentId||'N/A'))}
      ${receiptRow('Valid Until', sanitize(expiry||'N/A'))}
    </table>
  </div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <p style="font-weight:700;font-size:14px;color:#1F1F1F;margin:0 0 12px;">🔥 Your MBP Premium includes:</p>
  <ul style="color:#374151;font-size:14px;padding-left:20px;line-height:2;margin:0;">
    <li>Verified badge on your listing</li>
    <li>Featured on MakeMe Top homepage</li>
    <li>Google-indexed with full Schema.org markup</li>
    <li>Call, WhatsApp &amp; booking buttons</li>
    <li>Photo gallery + customer reviews</li>
    <li>QR code for sharing</li>
  </ul>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">View My Dashboard</a>
  <p style="margin:14px 0 0;font-size:12px;color:#9CA3AF;">Keep this as your receipt. Support: ${ADMIN_EMAIL}</p>
</td></tr>`;
  return sendEmail(to, '✅ MBP Premium Activated – ' + (planName||''), body);
}

// 3. Business Approved
function sendBusinessApprovedEmail(to, name, businessName) {
  if (!to || !isValidEmail(to)) return jsonResp({ status: 'skipped' });
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">🏔️</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">Your Listing is Live!</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Hi ${sanitize(name)||'there'}, <strong style="color:#1F1F1F;">${sanitize(businessName)||'Your Listing'}</strong> is now visible to tourists worldwide!</p>
</td></tr>
<tr><td style="padding:0 32px 28px;">
  <div style="background:#D1FAE5;border:1.5px solid #6EE7B7;border-radius:12px;padding:20px 24px;">
    <ul style="color:#065F46;font-size:14px;padding-left:20px;line-height:2;margin:0;">
      <li>Visible on MakeMe Top to tourists</li>
      <li>Google-indexed with Schema markup</li>
      <li>Ready to receive calls &amp; WhatsApp messages</li>
      <li>QR code available for social sharing</li>
    </ul>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">View My Listing 🏔️</a>
</td></tr>`;
  return sendEmail(to, '✅ Your Listing is Live – ' + sanitize(businessName), body);
}

// 4. Business Rejected
function sendBusinessRejectedEmail(to, name, businessName) {
  if (!to || !isValidEmail(to)) return jsonResp({ status: 'skipped' });
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">📝</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">Listing Needs Updates</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Hi ${sanitize(name)||'there'}, <strong>${sanitize(businessName)||'Your listing'}</strong> needs a few changes before going live.</p>
</td></tr>
<tr><td style="padding:0 32px 28px;">
  <div style="background:#FEF3C7;border:1.5px solid #FCD34D;border-radius:12px;padding:20px 24px;">
    <ul style="color:#92400E;font-size:14px;padding-left:20px;line-height:2;margin:0;">
      <li>Missing or unclear logo / cover photo</li>
      <li>Incomplete description</li>
      <li>Invalid or unverifiable phone number</li>
      <li>Incomplete or incorrect address</li>
    </ul>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#1F1F1F;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">Update My Listing</a>
</td></tr>`;
  return sendEmail(to, '📝 Listing Needs Updates – ' + sanitize(businessName), body);
}

// 5. Premium Expired
function sendPremiumExpiredEmail(to, planName, planId) {
  if (!to || !isValidEmail(to)) return;
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">⏰</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">Your MBP Premium Has Expired</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Your <strong>${sanitize(planName)}</strong> subscription has expired. Renew now to keep your listing visible to tourists.</p>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#FEF3C7;border:1.5px solid #FCD34D;border-radius:12px;padding:16px 20px;text-align:center;">
    <p style="color:#92400E;font-size:14px;margin:0;">⚠️ Your listing is now hidden from tourists until you renew.</p>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#F5A623;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">🔥 Renew Now – ₹799/month</a>
  <p style="margin:14px 0 0;font-size:13px;color:#9CA3AF;">Or get the full year for ₹1,499 — save more!</p>
</td></tr>`;
  sendEmail(to, '⏰ Your MBP Premium has expired — Renew now', body);
}

// 6. New Review Alert
function sendNewReviewAlert(ownerEmail, businessName, reviewerName, rating) {
  if (!ownerEmail || !isValidEmail(ownerEmail)) return jsonResp({ status: 'skipped' });
  const stars = '⭐'.repeat(Math.min(parseInt(rating)||5,5));
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:44px;margin-bottom:12px;">${stars}</div>
  <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1F1F1F;">New Review!</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;"><strong>${sanitize(reviewerName)||'A customer'}</strong> left a ${parseInt(rating)||5}-star review on <strong>${sanitize(businessName)||'your listing'}</strong>.</p>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#1F1F1F;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">View Reviews</a>
</td></tr>`;
  return sendEmail(ownerEmail, stars + ' New review on ' + sanitize(businessName) + ' – MBP', body);
}

// 7. Bulk / Newsletter
function sendBulkUpdateEmail(to, subject, message) {
  if (!to || !isValidEmail(to) || !subject) return jsonResp({ status: 'skipped' });
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:44px;margin-bottom:12px;">📢</div>
  <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:#1F1F1F;">${sanitize(subject)}</h1>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="color:#374151;font-size:15px;line-height:1.8;">${message||''}</div>
  <div style="text-align:center;margin-top:28px;">
    <a href="${SITE_URL}" style="display:inline-block;background:#1F1F1F;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">Open MBP App</a>
  </div>
</td></tr>`;
  return sendEmail(to, '[MBP] ' + sanitize(subject), body);
}

// 8. Ownership Claim
function sendOwnershipClaimEmail(ownerEmail, ownerName, businessName, requesterName, requesterEmail, requesterPhone, requesterMsg, token, businessId) {
  if (!ownerEmail || !isValidEmail(ownerEmail)) return jsonResp({ status: 'skipped' });
  const acceptUrl = SITE_URL + '/?claim=' + encodeURIComponent(token) + '&claimaction=accept';
  const rejectUrl = SITE_URL + '/?claim=' + encodeURIComponent(token) + '&claimaction=reject';
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">🏢</div>
  <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:#1F1F1F;">Ownership Request</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Hi ${sanitize(ownerName)||'there'}, someone has requested ownership of your listing.</p>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#F3F4F6;border-radius:12px;padding:20px 24px;margin-bottom:16px;">
    <p style="font-weight:700;font-size:14px;color:#1F1F1F;margin:0 0 14px;">Listing: <span style="color:#F5A623;">${sanitize(businessName)||'N/A'}</span></p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${receiptRow('Name', sanitize(requesterName)||'N/A')}
      ${receiptRow('Email', sanitize(requesterEmail)||'N/A')}
      ${receiptRow('Phone', sanitize(requesterPhone)||'N/A')}
    </table>
    ${requesterMsg?`<div style="margin-top:12px;padding:10px 14px;background:#fff;border-radius:8px;border-left:3px solid #F5A623;font-size:13px;color:#374151;font-style:italic;">"${sanitize(requesterMsg)}"</div>`:''}
  </div>
  <div style="background:#FEF3C7;border:1.5px solid #FCD34D;border-radius:10px;padding:14px;font-size:13px;color:#92400E;line-height:1.6;">⚠️ <strong>Only accept if you know this person.</strong> Accepting transfers full control of your listing.</div>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:8px;"><a href="${acceptUrl}" style="display:block;background:#16A34A;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700;font-size:14px;text-align:center;">✅ Accept</a></td>
    <td style="padding-left:8px;"><a href="${rejectUrl}" style="display:block;background:#DC2626;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700;font-size:14px;text-align:center;">❌ Reject</a></td>
  </tr></table>
  <p style="margin:14px 0 0;font-size:12px;color:#9CA3AF;text-align:center;">Links expire once used. If unexpected, simply ignore.</p>
</td></tr>`;
  return sendEmail(ownerEmail, '🏢 Ownership request for ' + sanitize(businessName) + ' – MBP', body);
}

// 9. Claim Accepted
function sendClaimAcceptedEmail(to, name, businessName) {
  if (!to || !isValidEmail(to)) return jsonResp({ status: 'skipped' });
  const body = `
<tr><td style="padding:36px 32px 16px;text-align:center;">
  <div style="font-size:52px;margin-bottom:16px;">🎉</div>
  <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:#1F1F1F;">You Now Own This Listing!</h1>
  <p style="color:#6B7280;font-size:15px;margin:0 0 24px;">Hi ${sanitize(name)||'there'}, ownership of <strong>${sanitize(businessName)||'the listing'}</strong> has been transferred to you!</p>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center;">
  <a href="${SITE_URL}" style="display:inline-block;background:#1F1F1F;color:#fff;text-decoration:none;padding:15px 40px;border-radius:12px;font-weight:700;font-size:15px;">Manage My Listing 🔥</a>
</td></tr>`;
  return sendEmail(to, '🎉 You now own ' + sanitize(businessName) + ' on MBP!', body);
}

// ── Email engine ──
function emailHeader() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F4F4;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F4;padding:24px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;max-width:560px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#1F1F1F;padding:28px 32px 24px;text-align:center;">
  <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
    <td style="padding-right:10px;vertical-align:middle;"><img src="${LOGO_URL}" width="40" height="40" style="border-radius:10px;display:block;" alt="MBP"/></td>
    <td style="vertical-align:middle;">
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;line-height:1;">Make<span style="color:#F5A623;">Me</span>Top</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;letter-spacing:0.5px;">MBP – MAKEMETOP BUSINESS PROFILE</div>
    </td>
  </tr></table>
</td></tr>`;
}

function emailFooter() {
  return `<tr><td style="background:#F9FAFB;padding:20px 32px;text-align:center;border-top:1px solid #E5E7EB;">
  <p style="margin:0 0 6px;font-size:12px;color:#9CA3AF;">MakeMe Top Business Profile (MBP) · Srinagar, J&amp;K, India</p>
  <p style="margin:0;font-size:12px;"><a href="${SITE_URL}" style="color:#F5A623;text-decoration:none;">${SITE_URL}</a></p>
  <p style="margin:8px 0 0;font-size:11px;color:#D1D5DB;">You received this because you have an MBP account. To unsubscribe, contact ${ADMIN_EMAIL}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function sendEmail(to, subject, bodyHtml) {
  try {
    GmailApp.sendEmail(to, subject, '', { htmlBody: emailHeader()+bodyHtml+emailFooter(), name: BRAND_NAME, replyTo: ADMIN_EMAIL });
    Logger.log('Email sent: ' + subject + ' → ' + to);
    return jsonResp({ status: 'sent', to });
  } catch (err) {
    Logger.log('sendEmail error: ' + err.message);
    return jsonResp({ error: 'Email failed: ' + err.message });
  }
}

// ── Helpers ──
function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function featureRow(icon, title, desc) {
  return `<tr><td width="40" style="font-size:22px;vertical-align:top;padding-bottom:16px;">${icon}</td><td style="padding-bottom:16px;padding-left:4px;"><strong style="color:#1F1F1F;font-size:14px;display:block;">${title}</strong><span style="color:#6B7280;font-size:13px;">${desc}</span></td></tr>`;
}
function receiptRow(label, value) {
  return `<tr><td style="color:#065F46;font-size:13px;padding:5px 0;font-weight:600;">${label}:</td><td style="color:#065F46;font-size:13px;text-align:right;padding:5px 0;">${value}</td></tr>`;
}
function isValidEmail(e) { return typeof e==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
function sanitize(s) { if(!s)return''; return String(s).replace(/<[^>]*>/g,'').trim().slice(0,500); }

// ═══════════════════════════════════════════════════════════════════════════
//  TEST FUNCTIONS — run manually in Apps Script editor
// ═══════════════════════════════════════════════════════════════════════════
function testAll()              { testPing(); testCreateOrder(); testAI(); testWelcomeEmail(); Logger.log('✅ All tests done'); }
function testPing()             { Logger.log(JSON.parse(doGet({parameter:{action:'ping'}}).getContent())); }
function testCreateOrder()      {
  Logger.log('=== Monthly Order ===');
  const r1 = JSON.parse(createRazorpayOrder('monthly_799','uid_test','abrarrtallks@gmail.com','Abrar','biz_001').getContent());
  Logger.log(JSON.stringify(r1));
  Logger.log('=== Annual Order ===');
  const r2 = JSON.parse(createRazorpayOrder('annual_1499','uid_test','abrarrtallks@gmail.com','Abrar','biz_001').getContent());
  Logger.log(JSON.stringify(r2));
}
function testWebhookSim()       { /* Simulate a webhook call for monthly plan */ Logger.log(JSON.parse(handleRazorpayWebhook('{}', {parameter:{}}, { event:'payment.captured', payload:{ payment:{ entity:{ id:'pay_test123', amount:79900, email:'abrarrtallks@gmail.com', notes:{ user_id:'uid_test', plan_id:'monthly_799', user_email:'abrarrtallks@gmail.com', user_name:'Abrar', biz_id:'biz_001' }}}}}).getContent())); }
function testAI()               { const r=JSON.parse(askGroqAI([{role:'user',content:'What is Gulmarg known for?'}]).getContent()); Logger.log(r.error||r.reply?.slice(0,80)); }
function testWelcomeEmail()     { sendWelcomeEmail(ADMIN_EMAIL,'Abrar'); }
function testPaymentEmail()     { sendPaymentConfirmEmail(ADMIN_EMAIL,'Abrar','MBP Premium – 1 Month',799,'pay_test123','13 Jun 2025','monthly_799'); }
function testAnnualPaymentEmail(){ sendPaymentConfirmEmail(ADMIN_EMAIL,'Abrar','MBP Premium – 1 Year',7999,'pay_test456','13 Jun 2026','annual_1499'); }
function testExpiredEmail()     { sendPremiumExpiredEmail(ADMIN_EMAIL,'MBP Premium – 1 Month','monthly_799'); }
function testApprovedEmail()    { sendBusinessApprovedEmail(ADMIN_EMAIL,'Abrar','Kashmir Grand Resorts'); }
function testRejectedEmail()    { sendBusinessRejectedEmail(ADMIN_EMAIL,'Abrar','Kashmir Grand Resorts'); }
function testReviewEmail()      { sendNewReviewAlert(ADMIN_EMAIL,'Kashmir Grand Resorts','Ahmed Khan',5); }
function testCheckExpiry()      { checkExpiredSubscriptions(); }
function testUpload() {
  const tiny='UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoBAAEAAkA4JZQCdAEO/gHOAAD++P/////bSA==';
  Logger.log(JSON.parse(uploadImageToDrive(tiny,'test.webp','test_folder','image/webp').getContent()));
}