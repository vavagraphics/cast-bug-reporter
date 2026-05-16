import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Airtable's uploadAttachment endpoint accepts up to 5 MB per file when base64-encoded.
// Cap multer at 5 MB so we fail fast instead of building a payload Airtable will reject.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appK5TjjSK9rmqx2Y';
const TABLE_ID = 'tbl5bwkO1aAWVUfc0';
const SCREENSHOT_FIELD_ID = 'fld2rWRcARrx3loN5'; // "Screenshot" multipleAttachments
const AT_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_NOTIFY_CHANNEL = process.env.SLACK_NOTIFY_CHANNEL;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/health', (_req, res) => res.status(200).send('OK'));

async function airtableGet(params = '') {
  const r = await fetch(`${AT_URL}${params}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  if (!r.ok) throw new Error(`Airtable GET failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchAllRecords() {
  let records = [];
  let offset;
  do {
    const qs = new URLSearchParams();
    qs.append('sort[0][field]', 'Submitted At');
    qs.append('sort[0][direction]', 'desc');
    qs.append('pageSize', '100');
    if (offset) qs.append('offset', offset);
    const data = await airtableGet(`?${qs.toString()}`);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

app.get('/api/bugs', async (_req, res) => {
  try {
    const records = await fetchAllRecords();
    res.json({ records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function nextBugId() {
  const records = await fetchAllRecords();
  let max = 0;
  for (const r of records) {
    const id = r.fields?.['Bug ID'];
    if (typeof id === 'string') {
      const m = id.match(/CAST-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `CAST-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Upload an attachment to an existing Airtable record via the content API.
 * Airtable removed support for `data:` URLs in attachment fields, so we have to
 * use the uploadAttachment endpoint (introduced 2024). Up to 5 MB per file.
 * Returns the attachment URL on success, or null on failure (never throws — the
 * record is already created, so a screenshot failure must not break the response).
 */
async function uploadScreenshot(recordId, file) {
  try {
    const contentType = file.mimetype || 'image/png';
    const filename = file.originalname || 'screenshot.png';
    const base64 = file.buffer.toString('base64');
    const url = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${SCREENSHOT_FIELD_ID}/uploadAttachment`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contentType, file: base64, filename })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error(`[screenshot] upload failed for ${recordId}: ${r.status} ${txt}`);
      return null;
    }
    const data = await r.json().catch(() => null);
    // Response shape: { id, createdTime, fields: { Screenshot: [{ id, url, ... }] } }
    const attachments = data?.fields?.[SCREENSHOT_FIELD_ID] || data?.fields?.Screenshot;
    if (Array.isArray(attachments) && attachments[0]?.url) return attachments[0].url;
    return null;
  } catch (err) {
    console.error('[screenshot] upload exception:', err.message);
    return null;
  }
}

/**
 * Post a notification to Slack. Wrapped in try/catch so a Slack failure
 * never blocks the user-facing submission. Uses <!channel> per the
 * Railway silent-notification gotcha.
 */
async function notifySlack({ bugId, submittedBy, page, pageOther, component, componentOther, description, screenshotUrl }) {
  if (!SLACK_BOT_TOKEN || !SLACK_NOTIFY_CHANNEL) return;
  try {
    const pageText = page + (pageOther ? ` (${pageOther})` : '');
    const componentText = component + (componentOther ? ` (${componentOther})` : '');
    const screenshotLine = screenshotUrl ? `\n*Screenshot:* ${screenshotUrl}` : '';
    const text = `<!channel> :bug: New CAST bug ${bugId} from ${submittedBy}\n*Page:* ${pageText}\n*Component:* ${componentText}\n*Description:* ${description}${screenshotLine}`;
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel: SLACK_NOTIFY_CHANNEL, text })
    });
    if (!r.ok) {
      console.error('[slack] HTTP error:', r.status, await r.text().catch(() => ''));
      return;
    }
    const json = await r.json().catch(() => null);
    if (!json?.ok) console.error('[slack] API error:', json?.error || 'unknown');
  } catch (err) {
    console.error('[slack] exception:', err.message);
  }
}

app.post('/api/bugs', upload.single('screenshot'), async (req, res) => {
  try {
    const { submittedBy, page, pageOther, component, componentOther, description } = req.body;
    if (!submittedBy || !page || !component || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const bugId = await nextBugId();
    const fields = {
      'Bug ID': bugId,
      'Submitted By': submittedBy,
      'Page': page,
      'Component': component,
      'Description': description,
      'Status': 'New',
      'Submitted At': new Date().toISOString()
    };
    if (page === 'Other' && pageOther) fields['Page (Other)'] = pageOther;
    if (component === 'Other' && componentOther) fields['Component (Other)'] = componentOther;

    // Step 1: create the record (without the screenshot — that requires a record ID first)
    const createRes = await fetch(AT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });
    if (!createRes.ok) {
      const txt = await createRes.text();
      return res.status(500).json({ error: `Airtable create failed: ${txt}` });
    }
    const created = await createRes.json();
    const recordId = created.id;

    // Step 2: if a screenshot was uploaded, attach it via Airtable's content API.
    // Never block the response on this — log + continue if it fails.
    let screenshotUrl = null;
    let screenshotFailed = false;
    if (req.file) {
      screenshotUrl = await uploadScreenshot(recordId, req.file);
      if (!screenshotUrl) screenshotFailed = true;
    }

    // Step 3: Slack notification (fire-and-forget, never blocks).
    notifySlack({ bugId, submittedBy, page, pageOther, component, componentOther, description, screenshotUrl })
      .catch((err) => console.error('[slack] outer exception:', err.message));

    res.json({ success: true, bugId, screenshotFailed });
  } catch (e) {
    // Multer file-size errors land here
    if (e?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Screenshot too large — maximum 5 MB.' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`cast-bug-reporter listening on ${PORT}`));
