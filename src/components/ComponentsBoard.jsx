import { Fragment, useEffect, useMemo, useState } from 'react';

const statusClass = (s) => {
  if (s === 'Live') return 'badge Resolved';
  if (s === 'Bug') return 'badge New';
  if (s === 'Deprecated') return 'badge FixProposed';
  if (s === 'Hidden') return 'badge InReview';
  return 'badge';
};

const COLUMNS = [
  { key: 'makeswiftLabel', label: 'Makeswift Display Name' },
  { key: 'componentName', label: 'Code Component' },
  { key: 'componentFile', label: 'File Path' },
  { key: 'status', label: 'Status' },
];

export default function ComponentsBoard() {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('makeswiftLabel');
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/components');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setManifest(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = manifest?.components || [];

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.makeswiftLabel,
        r.componentName,
        r.componentFile,
        r.registerFile,
        r.type,
        r.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = (a[sortKey] ?? '').toString().toLowerCase();
      const bv = (b[sortKey] ?? '').toString().toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const counts = manifest?.counts || {};
  const generatedAt = manifest?.generatedAt
    ? new Date(manifest.generatedAt).toLocaleString()
    : '';

  return (
    <div className="board-container">
      <div className="toolbar">
        <h2>Components</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter by name, path, type..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="components-filter"
          />
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {manifest && (
        <div className="components-summary">
          <span className="summary-chip"><strong>{sorted.length}</strong> shown / {rows.length} total</span>
          {['Live', 'Bug', 'Deprecated', 'Hidden'].map((s) =>
            counts[s] ? (
              <span key={s} className="summary-chip">
                <span className={statusClass(s)}>{s}</span>
                <strong style={{ marginLeft: 6 }}>{counts[s]}</strong>
              </span>
            ) : null
          )}
          {generatedAt && (
            <span className="summary-chip subtle">manifest: {generatedAt}</span>
          )}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {!loading && sorted.length === 0 && (
        <div className="empty">No components match this filter.</div>
      )}

      {sorted.length > 0 && (
        <table className="bugs">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="sortable"
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="sort-indicator">
                      {sortDir === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const key = r.registerFile + '::' + r.componentName;
              const isOpen = expanded === key;
              const hasBugs = Array.isArray(r.openBugs) && r.openBugs.length > 0;
              return (
                <Fragment key={key}>
                  <tr
                    className="row"
                    onClick={() => setExpanded(isOpen ? null : key)}
                  >
                    <td><strong>{r.makeswiftLabel || <em>(no label)</em>}</strong></td>
                    <td>{r.componentName || ''}</td>
                    <td className="mono">{r.componentFile || r.registerFile || ''}</td>
                    <td><span className={statusClass(r.status)}>{r.status}</span></td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="expand-cell">
                        <div className="detail-grid">
                          <div>
                            <h4>Type</h4>
                            <p className="mono">{r.type || '—'}</p>
                          </div>
                          <div>
                            <h4>Register File</h4>
                            <p className="mono">{r.registerFile || '—'}</p>
                          </div>
                          <div>
                            <h4>Component File</h4>
                            <p className="mono">{r.componentFile || '—'}</p>
                          </div>
                          <div>
                            <h4>Flags</h4>
                            <p>
                              {r.hidden ? 'hidden ' : ''}
                              {r.isImported ? 'imported' : 'not-imported'}
                            </p>
                          </div>
                        </div>
                        {hasBugs && (
                          <>
                            <h4>Open Bugs</h4>
                            <ul>
                              {r.openBugs.map((b) => (
                                <li key={b.bugId}>
                                  <strong>{b.bugId}</strong>{' '}
                                  <span className={statusClass('Bug')}>{b.status}</span>
                                  {b.description ? ' — ' + b.description : ''}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
