import React, { useState, useRef, useEffect } from 'react';
import * as microsoftSpeech from 'microsoft-cognitiveservices-speech-sdk';

function VoiceInput({ onVoiceCommand, onQuerySubmit }) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState('');
  const speechConfigRef = useRef(null);
  const audioConfigRef = useRef(null);
  const recognizerRef = useRef(null);

  // Initialize Speech Configuration
  useEffect(() => {
    const speechKey = process.env.REACT_APP_SPEECH_KEY;
    const region = process.env.REACT_APP_SPEECH_REGION;

    if (speechKey && region) {
      speechConfigRef.current = microsoftSpeech.SpeechConfig.fromSubscription(speechKey, region);
      speechConfigRef.current.speechRecognitionLanguage = 'en-US';
    } else {
      setError('Azure Speech configuration is missing');
    }
  }, []);

  // Start voice recognition
  const startListening = () => {
    if (!speechConfigRef.current) {
      setError('Speech configuration not initialized');
      return;
    }

    try {
      // Reset transcript
      setTranscript('');

      // Create audio configuration using default microphone
      audioConfigRef.current = microsoftSpeech.AudioConfig.fromDefaultMicrophoneInput();

      // Create speech recognizer
      recognizerRef.current = new microsoftSpeech.SpeechRecognizer(
        speechConfigRef.current,
        audioConfigRef.current
      );

      setIsListening(true);
      setError(null);

      // Track partial recognition
      recognizerRef.current.recognizing = (s, e) => {
        setTranscript(e.result.text);
      };

      // Final recognition
      recognizerRef.current.recognized = (s, e) => {
        const recognizedText = e.result.text.toLowerCase().trim();
        setTranscript(recognizedText);
        
        // Stop listening after recognition
        stopListening();

        // Call onVoiceCommand if provided
        if (onVoiceCommand) {
          onVoiceCommand(recognizedText);
        }
      };

      recognizerRef.current.startContinuousRecognitionAsync();
    } catch (err) {
      setError('Failed to start voice recognition: ' + err.message);
      setIsListening(false);
    }
  };

  // Stop voice recognition
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

  // Submit query
  const handleQuerySubmit = () => {
    if (transcript.trim()) {
      // Check if onQuerySubmit is a function before calling
      if (typeof onQuerySubmit === 'function') {
        onQuerySubmit();
      }
    }
  };

  return (
    <div className="voice-input-container">
      {error && <div className="error">{error}</div>}

      <div className="input-wrapper">
        <input
          type="text"
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            if (onVoiceCommand) {
              onVoiceCommand(e.target.value);
            }
          }}
          placeholder="Voice or text input"
        />

        <button
          onClick={isListening ? stopListening : startListening}
          className="voice-command-button"
        >
          {isListening ? 'Stop Listening' : 'Voice Input'}
        </button>

        <button 
          onClick={handleQuerySubmit}
          disabled={!transcript.trim()}
          className="voice-command-button"
        >
          Submit Query
        </button>
      </div>
    </div>
  );
}

export default VoiceInput;