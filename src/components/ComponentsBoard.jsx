import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

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

// UI cooldown so users can't spam POST /api/components/refresh. The server
// enforces the same window (returns 429) — this just gives visual feedback
// and disables the button so the click never leaves the browser.
const REFRESH_COOLDOWN_SECONDS = 30;

export default function ComponentsBoard() {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('makeswiftLabel');
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  // Toast state — one at a time, auto-dismisses after 4s.
  const [toast, setToast] = useState(null); // { kind: 'success'|'error', text: string }
  const toastTimer = useRef(null);
  const showToast = (kind, text) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ kind, text });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // Cooldown countdown — 30s after each refresh click, matching the server.
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownTimer = useRef(null);
  const startCooldown = () => {
    setCooldownLeft(REFRESH_COOLDOWN_SECONDS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldownLeft((s) => {
        if (s <= 1) { clearInterval(cooldownTimer.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

  // Initial load — reads the committed manifest (or in-memory refresh cache
  // if a previous session already re-scanned). No GitHub call.
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

  // Force a live re-scan of CAST master via the GitHub API. On failure we
  // keep the last-known cached data in state and surface the failure via
  // the error toast — the table never wipes.
  const refresh = async () => {
    if (refreshing || cooldownLeft > 0) return;
    setRefreshing(true); setError('');
    // Start the cooldown up front so parallel clicks are impossible even
    // before the round-trip resolves.
    startCooldown();
    try {
      const res = await fetch('/api/components/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setManifest(data);
      const total = data.totalRegistrations ?? (data.components || []).length;
      const bugCount = data.counts?.Bug || 0;
      showToast(
        'success',
        `Refreshed ${total} components${bugCount ? ` — ${bugCount} Bug` : ''}`
      );
    } catch (e) {
      showToast('error', 'Refresh failed — showing last cached data');
    } finally {
      setRefreshing(false);
    }
  };

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

  // "Last synced" reads the manifest's generatedAt. After a successful
  // refresh the server returns a fresh generatedAt, so this reads as
  // "Just now" for the first minute.
  const lastSynced = useMemo(() => {
    if (!manifest?.generatedAt) return '';
    const dt = new Date(manifest.generatedAt);
    const ageMs = Date.now() - dt.getTime();
    if (ageMs < 60_000) return 'Just now';
    return dt.toLocaleString();
  }, [manifest?.generatedAt, cooldownLeft]); // cooldownLeft tick re-evaluates "Just now"

  const refreshLabel = refreshing
    ? 'Refreshing...'
    : cooldownLeft > 0
      ? `Wait ${cooldownLeft}s`
      : 'Refresh Components';

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
          {lastSynced && (
            <span className="last-synced">Last synced: {lastSynced}</span>
          )}
          <button
            className="btn btn-secondary refresh-btn"
            onClick={refresh}
            disabled={refreshing || cooldownLeft > 0 || loading}
            title="Force a live re-scan of CAST-Lighting/cast-website master"
          >
            {refreshing && <span className="spinner" aria-hidden="true" />}
            {refreshLabel}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`banner ${toast.kind === 'success' ? 'success' : 'error'}`}>
          {toast.text}
        </div>
      )}

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
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {loading && !manifest && (
        <div className="empty">Loading components...</div>
      )}

      {!loading && sorted.length === 0 && manifest && (
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
