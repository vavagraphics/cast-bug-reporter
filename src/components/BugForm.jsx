import { useState } from 'react';

const PAGES = [
  'Home','Shop / All Products','Fixtures','Lamps','Power Supplies & Wire',
  'Accessories & Tools','Repair Parts','Bluetooth Color Control',
  'Landscape Lighting Kits','About','Contact','Trade Pro','Distributor Locator',
  'FAQ','Warranty','Gallery','Resources','Events','Search Results',
  'Account / Login','Other'
];

const COMPONENTS = [
  'Site Navbar','Site Footer','Navigation Topper','Hero Banner','Category Grid',
  'Shop Grid','Product Gallery','Bundle Products','Parts Grid','Product Hero',
  'Product Description','Product Documents','Product FAQ','About Content',
  'Blog Grid','Blog Post Content','Content Media','Media Gallery','Brand Logos',
  'Comparison Section','Reviews Carousel','Trade Pro Section','Ready CTA',
  'Newsletter CTA (Full)','Newsletter Form (Small)','Contact Section',
  'General Contact Form','Trade Pro Signup','Retail Signup','Contractor Finder',
  'Distributor Finder','Search Results','Not Found Hero','Login Section',
  'Favorites Grid','Quotes List','Quote Detail','Orders Grid','Order Detail',
  'Certifications & Patents','Rich Text Section','GDPR Popup','Events Grid',
  'Documents & Downloads','Other'
];

const initial = {
  submittedBy: '', page: '', pageOther: '',
  component: '', componentOther: '', description: ''
};

export default function BugForm() {
  const [form, setForm] = useState(initial);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onFile = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    if (f && f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setPreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.submittedBy || !form.page || !form.component || !form.description) {
      setError('Please fill all required fields.'); return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('screenshot', file);
      const res = await fetch('/api/bugs', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Submission failed');
      setSuccess(`Bug report ${data.bugId} submitted successfully.`);
      setForm(initial); setFile(null); setPreview(null);
      const fileInput = document.getElementById('screenshot-input');
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      {success && <div className="banner success">{success}</div>}
      {error && <div className="banner error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label>Your Name <span className="required">*</span></label>
          <input type="text" placeholder="Your name" value={form.submittedBy}
            onChange={e => update('submittedBy', e.target.value)} required />
        </div>

        <div className="field">
          <label>Page <span className="required">*</span></label>
          <select value={form.page} onChange={e => update('page', e.target.value)} required>
            <option value="">Select a page…</option>
            {PAGES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {form.page === 'Other' && (
          <div className="field">
            <label>Please specify the page</label>
            <input type="text" value={form.pageOther}
              onChange={e => update('pageOther', e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>Component <span className="required">*</span></label>
          <select value={form.component} onChange={e => update('component', e.target.value)} required>
            <option value="">Select a component…</option>
            {COMPONENTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {form.component === 'Other' && (
          <div className="field">
            <label>Please specify the component</label>
            <input type="text" value={form.componentOther}
              onChange={e => update('componentOther', e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>Description <span className="required">*</span></label>
          <textarea rows={5}
            placeholder="Please describe the bug or issue in detail. Include what you expected to happen vs. what actually happened."
            value={form.description}
            onChange={e => update('description', e.target.value)} required />
        </div>

        <div className="field">
          <label>Attach a screenshot (optional)</label>
          <input id="screenshot-input" type="file" accept="image/*" onChange={onFile} />
          {preview && <img src={preview} alt="preview" className="preview-img" />}
        </div>

        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit Bug Report'}
        </button>
      </form>
    </div>
  );
}
