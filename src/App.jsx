import { useState } from 'react';
import BugForm from './components/BugForm.jsx';
import StatusBoard from './components/StatusBoard.jsx';

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
        >Submit a Bug</button>
        <button
          className={`tab ${tab === 'board' ? 'active' : ''}`}
          onClick={() => setTab('board')}
        >Bug Status Board</button>
      </nav>
      {tab === 'submit' ? <BugForm /> : <StatusBoard />}
    </div>
  );
}
