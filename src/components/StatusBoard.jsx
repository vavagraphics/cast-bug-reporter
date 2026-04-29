import { useEffect, useState } from 'react';

const badgeClass = (status) => {
  if (status === 'New') return 'badge New';
  if (status === 'In Review') return 'badge InReview';
  if (status === 'Fix Proposed') return 'badge FixProposed';
  if (status === 'Resolved') return 'badge Resolved';
  return 'badge';
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString();
};

export default function StatusBoard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bugs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setRecords(data.records || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="board-container">
      <div className="toolbar">
        <h2>Bug Status Board</h2>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {!loading && records.length === 0 && (
        <div className="empty">No bug reports submitted yet.</div>
      )}
      {records.length > 0 && (
        <table className="bugs">
          <thead>
            <tr>
              <th>Bug ID</th>
              <th>Submitted By</th>
              <th>Page</th>
              <th>Component</th>
              <th>Status</th>
              <th>Submitted At</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const f = r.fields || {};
              const isOpen = expanded === r.id;
              const pageDisplay = f['Page'] === 'Other' && f['Page (Other)']
                ? `Other: ${f['Page (Other)']}` : (f['Page'] || '');
              const compDisplay = f['Component'] === 'Other' && f['Component (Other)']
                ? `Other: ${f['Component (Other)']}` : (f['Component'] || '');
              return (
                <>
                  <tr key={r.id} className="row" onClick={() => setExpanded(isOpen ? null : r.id)}>
                    <td><strong>{f['Bug ID'] || ''}</strong></td>
                    <td>{f['Submitted By'] || ''}</td>
                    <td>{pageDisplay}</td>
                    <td>{compDisplay}</td>
                    <td><span className={badgeClass(f['Status'])}>{f['Status'] || ''}</span></td>
                    <td>{fmtDate(f['Submitted At'])}</td>
                  </tr>
                  {isOpen && (
                    <tr key={r.id + '-x'}>
                      <td colSpan={6} className="expand-cell">
                        <h4>Description</h4>
                        <p>{f['Description'] || '—'}</p>
                        <h4>Proposed Fix</h4>
                        <p>{f['Proposed Fix'] || '—'}</p>
                        {Array.isArray(f['Screenshot']) && f['Screenshot'].length > 0 && (
                          <>
                            <h4>Screenshot</h4>
                            <a href={f['Screenshot'][0].url} target="_blank" rel="noreferrer">
                              <img src={f['Screenshot'][0].thumbnails?.large?.url || f['Screenshot'][0].url}
                                alt="screenshot" style={{ maxWidth: 400, borderRadius: 4 }} />
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
