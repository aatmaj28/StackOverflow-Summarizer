import React, { useState, useEffect, useRef } from 'react';
import VoiceInput from './VoiceInput';
import ChatInterface from './ChatInterface';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [pageContent, setPageContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [isChatMode, setIsChatMode] = useState(false);
  const [userId, setUserId] = useState('');
  const [queryHistory, setQueryHistory] = useState([]);
  const [showQueryHistory, setShowQueryHistory] = useState(false);
  const cooldownRef = useRef(null);

  // Generate or retrieve userId
  useEffect(() => {
    const storedUserId = localStorage.getItem('stackoverflow-assistant-userId');
    if (storedUserId) {
      setUserId(storedUserId);
    } else {
      const newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setUserId(newUserId);
      localStorage.setItem('stackoverflow-assistant-userId', newUserId);
    }
  }, []);

  // Clear interval on unmount
  useEffect(() => {
    return () => clearInterval(cooldownRef.current);
  }, []);

  // Countdown timer
  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
    } else {
      clearInterval(cooldownRef.current);
    }
  }, [cooldown]);

  const storeQueryHistory = async (queries) => {
    try {
      await fetch('http://localhost:7071/api/store-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          url,
          pageContent,
          summary,
          queries: Array.isArray(queries) ? queries : [queries]
        })
      });
    } catch (err) {
      console.error('Failed to store query history:', err);
    }
  };

  const toggleQueryHistory = async () => {
    if (!showQueryHistory) {
      await fetchQueryHistory();
    }
    setShowQueryHistory(prev => !prev);
  };

  const fetchQueryHistory = async () => {
    try {
      const response = await fetch(`http://localhost:7071/api/retrieve-query-history?userId=${userId}`);
      if (response.ok) {
        const history = await response.json();
        setQueryHistory(history);
      }
    } catch (err) {
      console.error('Failed to retrieve query history:', err);
    }
  };

  const fetchPageContent = async (urlToSummarize) => {
    try {
      const response = await fetch(
        `http://localhost:7071/api/summarize?url=${encodeURIComponent(urlToSummarize)}`
      );
  
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Request failed');
      }
  
      const result = await response.json();
      setSummary(result.summary);
      setPageContent(result.pageContent);
      setIsChatMode(true);
      setUrl(urlToSummarize);
      setCooldown(20);
    } catch (err) {
      setError(err.message.includes('20 seconds')
        ? 'Please wait 20 seconds between requests'
        : err.message);
    }
  };

  const handleSubmit = async (urlToSummarize) => {
    const effectiveUrl = urlToSummarize || url;

    if (!effectiveUrl) {
      setError('Please enter a URL');
      return;
    }

    if (cooldown > 0) return;

    setIsLoading(true);
    setError('');

    try {
      await fetchPageContent(effectiveUrl);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceCommand = (extractedUrl) => {
    if (extractedUrl) {
      setUrl(extractedUrl);
      handleSubmit(extractedUrl);
    } else {
      if (url) {
        handleSubmit();
      } else {
        setError('No URL detected. Please provide a Stack Overflow URL.');
      }
    }
  };

  const resetState = () => {
    setIsChatMode(false);
    setSummary('');
    setPageContent('');
    setUrl('');
  };

  return (
    <div className="App">
      <div className="app-container">
        <div className="main-header">
          <div className="app-title-container">
            <h1 className="app-title">
              <span className="title-stack">Stack</span>
              <span className="title-overflow">Overflow</span>
              <span className="title-assistant">Conversational Assistant</span>
            </h1>
          </div>
          <button 
            onClick={toggleQueryHistory} 
            className="toggle-history-button global-history-toggle"
          >
            {showQueryHistory ? 'Hide History' : 'Show Query History'}
          </button>
        </div>

        <div className="main-content">
          {!isChatMode ? (
            <div className="initial-input-container">
              <form onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste Stack Overflow URL"
                  disabled={isLoading || cooldown > 0}
                />
                <button
                  type="submit"
                  disabled={isLoading || cooldown > 0}
                >
                  {isLoading ? 'Summarizing...' :
                    cooldown > 0 ? `Wait ${cooldown}s` : 'Summarize'}
                </button>
              </form>

              <VoiceInput onVoiceCommand={handleVoiceCommand} />

              {error && <div className="error">{error}</div>}

              {summary && (
                <div className="summary">
                  <h3>Summary:</h3>
                  <p>{summary}</p>
                </div>
              )}

              <div className="example">
                <p>Try these examples:</p>
                <div className="example-buttons">
                  <button
                    onClick={() => setUrl("https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do")}
                    disabled={cooldown > 0}
                  >
                    Python "yield" keyword
                  </button>
                  <button
                    onClick={() => setUrl("https://stackoverflow.com/questions/1995952/how-to-handle-null-null-checks-in-java")}
                    disabled={cooldown > 0}
                  >
                    Java Null Handling
                  </button>
                  <button
                    onClick={() => setUrl("https://stackoverflow.com/questions/9618217/javascript-object-oriented-programming")}
                    disabled={cooldown > 0}
                  >
                    JavaScript OOP Concepts
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <ChatInterface 
              pageContent={pageContent} 
              originalUrl={url} 
              onReset={resetState} 
              storeQueryHistory={storeQueryHistory}
            />
          )}
        </div>

        {showQueryHistory && (
          <div className="query-history-container">
            <div className="query-history-scrollable">
              <h3>Query History</h3>
              {queryHistory.length === 0 ? (
                <p className="no-history">No query history found</p>
              ) : (
                queryHistory.map((entry, index) => (
                  <div key={index} className="history-entry">
                    <h4>{entry.url}</h4>
                    <p>{entry.summary}</p>
                    <div className="history-queries">
                      {entry.queries.map((query, qIndex) => (
                        <span key={qIndex} className="query-chip">{query}</span>
                      ))}
                    </div>
                    <small>{new Date(entry.timestamp).toLocaleString()}</small>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;