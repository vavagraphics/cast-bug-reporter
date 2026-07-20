import { useState } from 'react';
import BugForm from './components/BugForm.jsx';
import StatusBoard from './components/StatusBoard.jsx';
import ComponentsBoard from './components/ComponentsBoard.jsx';

export default function App() {
  const [tab, setTab] = useState('submit');
  return (
    <div>
      <header className="header">
        <div>
          <h1>CAST Lighting</h1>
          <div className="subtitle">Bug Report Portal</div>
        </div>
      </header>
      <nav className="tabs">
        <button
          className={`tab ${tab === 'submit' ? 'active' : ''}`}
          onClick={() => setTab('submit')}
        >Submit a Report</button>
        <button
          className={`tab ${tab === 'board' ? 'active' : ''}`}
          onClick={() => setTab('board')}
        >Bug Status Board</button>
        <button
          className={`tab ${tab === 'features' ? 'active' : ''}`}
          onClick={() => setTab('features')}
        >Feature Status Board</button>
        <button
          className={`tab ${tab === 'components' ? 'active' : ''}`}
          onClick={() => setTab('components')}
        >Components</button>
      </nav>
      {tab === 'submit' && <BugForm />}
      {tab === 'board' && <StatusBoard typeFilter="bug" />}
      {tab === 'features' && <StatusBoard typeFilter="feature" />}
      {tab === 'components' && <ComponentsBoard />}
    </div>
  );
}
