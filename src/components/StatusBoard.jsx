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

// typeFilter: 'bug' | 'feature'
// bug board = Type=Bug OR Type blank (backward compat with pre-Type records)
// feature board = Type=Feature only
export default function StatusBoard({ typeFilter = 'bug' }) {
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

  const filtered = records.filter(r => {
    const t = r.fields?.['Type'];
    if (typeFilter === 'feature') return t === 'Feature';
    // bug: show records with Type=Bug OR no Type set (backward compat)
    return !t || t === 'Bug';
  });

  const title = typeFilter === 'feature' ? 'Feature Status Board' : 'Bug Status Board';
  const emptyMsg = typeFilter === 'feature'
    ? 'No feature requests submitted yet.'
    : 'No bug reports submitted yet.';

  const isFeatureBoard = typeFilter === 'feature';

  return (
    <div className="board-container">
      <div className="toolbar">
        <h2>{title}</h2>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {!loading && filtered.length === 0 && (
        <div className="empty">{emptyMsg}</div>
      )}
      {filtered.length > 0 && (
        <table className="bugs">
          <thead>
            <tr>
              <th>ID</th>
              <th>Submitted By</th>
              {!isFeatureBoard && <th>Page</th>}
              {!isFeatureBoard && <th>Component</th>}
              <th>Status</th>
              <th>Submitted At</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const f = r.fields || {};
              const isOpen = expanded === r.id;
              const pageDisplay = f['Page'] === 'Other' && f['Page (Other)']
                ? `Other: ${f['Page (Other)']}` : (f['Page'] || '');
              const compDisplay = f['Component'] === 'Other' && f['Component (Other)']
                ? `Other: ${f['Component (Other)']}` : (f['Component'] || '');
              const colSpan = isFeatureBoard ? 4 : 6;
              return (
                <>
                  <tr key={r.id} className="row" onClick={() => setExpanded(isOpen ? null : r.id)}>
                    <td><strong>{f['Bug ID'] || ''}</strong></td>
                    <td>{f['Submitted By'] || ''}</td>
                    {!isFeatureBoard && <td>{pageDisplay}</td>}
                    {!isFeatureBoard && <td>{compDisplay}</td>}
                    <td><span className={badgeClass(f['Status'])}>{f['Status'] || ''}</span></td>
                    <td>{fmtDate(f['Submitted At'])}</td>
                  </tr>
                  {isOpen && (
                    <tr key={r.id + '-x'}>
                      <td colSpan={colSpan} className="expand-cell">
                        <h4>Description</h4>
                        <p>{f['Description'] || '—'}</p>
                        {!isFeatureBoard && (
                          <>
                            <h4>Proposed Fix</h4>
                            <p>{f['Proposed Fix'] || '—'}</p>
                          </>
                        )}
                        {isFeatureBoard && f['Proposed Fix'] && (
                          <>
                            <h4>Notes</h4>
                            <p>{f['Proposed Fix']}</p>
                          </>
                        )}
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
