import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appK5TjjSK9rmqx2Y';
const TABLE_ID = 'tbl5bwkO1aAWVUfc0';
const AT_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

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
    if (req.file) {
      const mime = req.file.mimetype || 'image/png';
      const b64 = req.file.buffer.toString('base64');
      fields['Screenshot'] = [{
        url: `data:${mime};base64,${b64}`,
        filename: req.file.originalname || 'screenshot.png'
      }];
    }
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
    res.json({ success: true, bugId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`cast-bug-reporter listening on ${PORT}`));
