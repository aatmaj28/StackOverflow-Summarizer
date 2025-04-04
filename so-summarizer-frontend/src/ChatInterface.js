import React, { useState, useRef, useEffect } from 'react';
import * as microsoftSpeech from 'microsoft-cognitiveservices-speech-sdk';
import { Volume2, VolumeX } from 'lucide-react';
import './ChatInterface.css';

function ChatInterface({ 
  pageContent, 
  originalUrl, 
  onReset, 
  storeQueryHistory 
}) {
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const messagesEndRef = useRef(null);
  const speechSynthesisRef = useRef(null);
  const speechConfigRef = useRef(null);
  const audioConfigRef = useRef(null);
  const recognizerRef = useRef(null);
  const synthesizerRef = useRef(null);

  // Initialize Speech Configuration
  useEffect(() => {
    const speechKey = process.env.REACT_APP_SPEECH_KEY;
    const region = process.env.REACT_APP_SPEECH_REGION;

    if (speechKey && region) {
      // Speech Synthesis Configuration
      const synthesisConfig = microsoftSpeech.SpeechConfig.fromSubscription(speechKey, region);
      synthesisConfig.speechSynthesisVoiceName = "en-US-AriaNeural";
      synthesisConfig.speechSynthesisOutputFormat = microsoftSpeech.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
      speechSynthesisRef.current = synthesisConfig;

      // Speech Recognition Configuration
      const recognitionConfig = microsoftSpeech.SpeechConfig.fromSubscription(speechKey, region);
      recognitionConfig.speechRecognitionLanguage = 'en-US';
      speechConfigRef.current = recognitionConfig;
    } else {
      console.error('Azure Speech configuration is missing');
    }
  }, []);

  // Add initial summary to messages
  useEffect(() => {
    if (pageContent) {
      const initialMessages = [
        { type: 'bot', content: 'Summary of the StackOverflow page:' },
        { type: 'bot', content: pageContent },
        { type: 'bot', content: 'I have summarized the StackOverflow page. What would you like to know?' }
      ];
      
      setMessages(initialMessages);
    }
  }, [pageContent]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleTextToSpeech = (textToSpeak, messageId = null) => {
    // Stop any ongoing speech
    stopTextToSpeech();

    if (!speechSynthesisRef.current) {
      console.error('Speech synthesis not initialized');
      return;
    }

    try {
      const audioConfig = microsoftSpeech.AudioConfig.fromDefaultSpeakerOutput();

      const synthesizer = new microsoftSpeech.SpeechSynthesizer(
        speechSynthesisRef.current, 
        audioConfig
      );

      synthesizerRef.current = synthesizer;
      setIsSpeaking(true);
      setSpeakingMessageId(messageId);

      synthesizer.speakTextAsync(
        textToSpeak,
        () => {
          stopTextToSpeech();
        },
        (error) => {
          console.error('Speech synthesis failed:', error);
          stopTextToSpeech();
        }
      );
    } catch (err) {
      console.error('Error in text-to-speech:', err);
      stopTextToSpeech();
    }
  };

  const stopTextToSpeech = () => {
    if (synthesizerRef.current) {
      synthesizerRef.current.close();
      synthesizerRef.current = null;
    }
    setIsSpeaking(false);
    setSpeakingMessageId(null);
  };

  const startListening = () => {
    if (!speechConfigRef.current) {
      setError('Speech configuration not initialized');
      return;
    }

    try {
      audioConfigRef.current = microsoftSpeech.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new microsoftSpeech.SpeechRecognizer(
        speechConfigRef.current,
        audioConfigRef.current
      );

      setIsListening(true);
      setError(null);

      recognizerRef.current.recognizing = (s, e) => {
        setQuery(e.result.text);
      };

      recognizerRef.current.recognized = (s, e) => {
        const recognizedText = e.result.text.toLowerCase().trim();
        setQuery(recognizedText);
        stopListening();
      };

      recognizerRef.current.startContinuousRecognitionAsync();
    } catch (err) {
      setError('Failed to start voice recognition: ' + err.message);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsListening(false);
          recognizerRef.current.close();
          recognizerRef.current = null;
        },
        (err) => {
          console.error('Error stopping recognition:', err);
          setIsListening(false);
        }
      );
    }
  };

  const handleQuerySubmit = async () => {
    const currentQuery = query.trim();
    if (!currentQuery) {
      setError('Please enter a query');
      return;
    }

    // Add user message
    setMessages(prev => [...prev, { type: 'user', content: currentQuery }]);
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:7071/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: originalUrl,
          pageContent: pageContent,
          query: currentQuery
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Request failed');
      }

      const result = await response.text();

      // Add bot response
      const newMessage = { type: 'bot', content: result };
      setMessages(prev => [...prev, newMessage]);

      // Store query in history
      if (storeQueryHistory) {
        storeQueryHistory(currentQuery);
      }

      // Clear query after submission
      setQuery('');

    } catch (err) {
      setError(err.message);
      // Add error message
      setMessages(prev => [...prev, { type: 'bot', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button 
          onClick={onReset} 
          className="reset-button"
        >
          Reset and Summarize New URL
        </button>
      </div>

      <div className="chat-content">
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div 
              key={index} 
              className={`message ${message.type}-message`}
            >
              {message.content}
              {message.type === 'bot' && (
                <button 
                  className={`speak-toggle-button ${isSpeaking && speakingMessageId === index ? 'speaking' : ''}`}
                  onClick={() => 
                    isSpeaking && speakingMessageId === index 
                      ? stopTextToSpeech() 
                      : handleTextToSpeech(message.content, index)
                  }
                >
                  {isSpeaking && speakingMessageId === index 
                    ? <VolumeX size={16} /> 
                    : <Volume2 size={16} />
                  }
                </button>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="query-input-container">
          <div className="input-wrapper">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type or say your query..!!!"
              disabled={isLoading}
            />
            <button 
              onClick={isListening ? stopListening : startListening}
              className={`voice-toggle-button ${isListening ? 'listening' : ''}`}
            >
              {isListening ? 'Stop' : 'Voice Input'}
            </button>
            <button 
              onClick={handleQuerySubmit}
              disabled={isLoading || !query.trim()}
            >
              {isLoading ? 'Sending...' : 'Submit Query'}
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

export default ChatInterface;
