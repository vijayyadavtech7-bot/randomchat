import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';
import './App.css';
import fahSound from './assets/fahhhhh.mp3';

const getTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDuration = (s) => {
  const m   = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// 🔊 Set to false (or comment out) to disable the disconnect sound
const ENABLE_FAH_SOUND = true;

const fahAudio = new Audio(fahSound);
fahAudio.preload = 'auto';

const playFah = () => {
  if (!ENABLE_FAH_SOUND) return;
  fahAudio.currentTime = 0;
  fahAudio.play().catch(() => {});
};

/* ─────────────────────────────────────────
   Tick icon  ✓ sent/delivered  ✓✓ seen
───────────────────────────────────────── */
function TickIcon({ status }) {
  if (status === 'sent' || status === 'delivered') {
    return (
      <span className="msg-tick tick-grey">
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <path
            d="M1 5L4.5 8.5L13 1"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === 'seen') {
    return (
      <span className="msg-tick tick-seen">
        <svg width="19" height="10" viewBox="0 0 19 10" fill="none">
          <path
            d="M1 5L4.5 8.5L11 1"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 5L10.5 8.5L17 1"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return null;
}

/* ─────────────────────────────────────────
   Recording wave animation
───────────────────────────────────────── */
function MicWave({ tick }) {
  return (
    <div className="mic-wave">
      {Array.from({ length: 18 }).map((_, i) => {
        const h = 4 + Math.abs(Math.sin((tick + i * 2.2) * 0.45)) * 20;
        return <span key={i} className="mic-wave-bar" style={{ height: h }} />;
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   Typing indicator
───────────────────────────────────────── */
function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="typing-bubble">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
      <span className="typing-label">typing…</span>
    </div>
  );
}

/* ─────────────────────────────────────────
   Voice message player
───────────────────────────────────────── */
function VoicePlayer({ audioData, duration, own }) {
  const audioRef                      = useRef(null);
  const [playing, setPlaying]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnd  = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    const onTime = () => {
      if (el.duration) {
        setProgress((el.currentTime / el.duration) * 100);
        setCurrentTime(Math.floor(el.currentTime));
      }
    };
    el.addEventListener('ended', onEnd);
    el.addEventListener('timeupdate', onTime);
    return () => {
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('timeupdate', onTime);
    };
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    playing ? el.pause() : el.play();
    setPlaying(!playing);
  };

  return (
    <div className={`voice-player ${own ? 'own' : 'other'}`}>
      <audio ref={audioRef} src={audioData} />
      <button className="voice-play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div className="voice-track">
        {Array.from({ length: 30 }).map((_, i) => {
          const filled = (i / 30) * 100 < progress;
          const h      = 3 + Math.abs(Math.sin(i * 0.8)) * 13;
          return <div key={i} className={`vbar ${filled ? 'filled' : ''}`} style={{ height: h }} />;
        })}
      </div>
      <span className="voice-dur">
        {playing ? formatDuration(currentTime) : formatDuration(duration || 0)}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main App
═══════════════════════════════════════════ */
function App() {
  const socketRef      = useRef(null);
  const inputRef       = useRef(null);
  const emojiRef       = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRef       = useRef(null);
  const chunksRef      = useRef([]);
  const recTimerRef    = useRef(null);
  const waveTimerRef   = useRef(null);
  const typingTimerRef = useRef(null);

  const [status,        setStatus]        = useState('initial');
  const [messages,      setMessages]      = useState([]);
  const [inputValue,    setInputValue]    = useState('');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showEmoji,     setShowEmoji]     = useState(false);
  const [recording,     setRecording]     = useState(false);
  const [recSeconds,    setRecSeconds]    = useState(0);
  const [waveTick,      setWaveTick]      = useState(0);
  const [audioPreview,  setAudioPreview]  = useState(null);

  /* ── Socket setup ── */
  useEffect(() => {
    if (socketRef.current) return;

    const sock = io(
      process.env.NODE_ENV === 'production'
        ? window.location.origin
        : 'http://localhost:5000',
      {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      }
    );
    socketRef.current = sock;

    sock.on('connect', () => console.log('✅ Socket connected:', sock.id));

    sock.on('waiting', () => {
      setStatus('waiting');
      setMessages([]);
    });

    sock.on('chat-started', () => {
      setStatus('chatting');
      setMessages([{ type: 'system', text: "You're now connected — say hello! 👋" }]);
    });

    sock.on('receive-message', (data) => {
      setPartnerTyping(false);
      clearTimeout(typingTimerRef.current);

      const msgId = data.msgId || genId();

      setMessages(prev => [...prev,
        data.isVoice
          ? { type: 'received', isVoice: true, audioData: data.audioData, duration: data.duration, time: data.timestamp || getTime(), msgId }
          : { type: 'received', text: String(data.message || ''), time: data.timestamp || getTime(), msgId },
      ]);

      // Tell sender their message has been seen
      sock.emit('message-seen', { msgId });
    });

    sock.on('partner-typing', () => {
      setPartnerTyping(true);
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 3000);
    });

    // ✓ → ✓ grey: reached partner device
    sock.on('message-delivered', ({ msgId }) => {
      setMessages(prev =>
        prev.map(m =>
          m.msgId === msgId && m.status === 'sent'
            ? { ...m, status: 'delivered' }
            : m
        )
      );
    });

    // ✓ grey → ✓✓ white: partner opened and read it
    sock.on('message-seen', ({ msgId }) => {
      setMessages(prev =>
        prev.map(m => m.msgId === msgId ? { ...m, status: 'seen' } : m)
      );
    });

    sock.on('chat-ended', () => {
      playFah();
      setStatus('ended');
      setPartnerTyping(false);
    });
  }, []);

  /* ── visualViewport: lock topbar, track keyboard for composer ──
     When keyboard opens:
       - chat-screen height = visualViewport.height (shrinks to fit)
       - topbar stays at top (sticky, never moves)
       - messages pane shrinks naturally (flex: 1)
       - composer stays at bottom (sticky bottom: 0)
     No jump, no scroll, header always visible. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const chatEl = document.querySelector('.chat-screen');
      if (!chatEl) return;
      // Set exact height to visible area — topbar stays, composer follows
      chatEl.style.height = `${vv.height}px`;
      chatEl.style.top    = `${vv.offsetTop}px`;
      // Scroll latest message into view after keyboard settles
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  useEffect(() => {
    if (status === 'chatting') setTimeout(() => inputRef.current?.focus(), 100);
  }, [status]);

  /* ── Any printable key focuses input ── */
  useEffect(() => {
    if (status !== 'chatting') return;
    const handler = (e) => {
      if (
        e.ctrlKey || e.metaKey || e.altKey ||
        e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab' ||
        e.key.startsWith('Arrow') || e.key === 'Backspace' || e.key === 'Delete' ||
        document.activeElement === inputRef.current
      ) return;
      if (e.key.length === 1) inputRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status]);

  /* ── Close emoji picker on outside click ── */
  useEffect(() => {
    const handler = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Scroll to latest message ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partnerTyping]);

  const emit      = useCallback((ev, d) => socketRef.current?.emit(ev, d), []);
  const startChat = useCallback(() => emit('start-chat'), [emit]);

  /* ── Send text message ── */
  const sendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text || status !== 'chatting') return;
    const time  = getTime();
    const msgId = genId();
    setMessages(prev => [...prev, { type: 'sent', text, time, msgId, status: 'sent' }]);
    emit('send-message', { message: text, isVoice: false, msgId });
    setInputValue('');
  }, [inputValue, status, emit]);

  /* ── Send voice message ── */
  const sendVoice = useCallback(() => {
    if (!audioPreview || status !== 'chatting') return;
    const time  = getTime();
    const msgId = genId();
    emit('send-message', {
      audioData: audioPreview.base64,
      isVoice: true,
      duration: audioPreview.duration,
      msgId,
    });
    setMessages(prev => [...prev, {
      type: 'sent', isVoice: true,
      audioData: audioPreview.url,
      duration: audioPreview.duration,
      time, msgId, status: 'sent',
    }]);
    setAudioPreview(null);
    setRecSeconds(0);
  }, [audioPreview, status, emit]);

  const handleTyping = useCallback((e) => {
    setInputValue(e.target.value);
    if (status === 'chatting') emit('typing');
  }, [status, emit]);

  const onEmojiClick = useCallback((emojiData) => {
    setInputValue(prev => prev + emojiData.emoji);
    setShowEmoji(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  /* ── Skip to next stranger ── */
  const nextStranger = useCallback(() => {
    playFah();
    emit('end-chat');
    setPartnerTyping(false);
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
    clearInterval(recTimerRef.current);
    clearInterval(waveTimerRef.current);
    setRecording(false);
    setAudioPreview(null);
    setInputValue('');
    setShowEmoji(false);
    setTimeout(() => {
      setMessages([]);
      setStatus('waiting');
      emit('start-chat');
    }, 150);
  }, [emit]);

  /* ── End chat ── */
  const endChat = useCallback(() => {
    playFah();
    emit('end-chat');
    setStatus('ended');
    setPartnerTyping(false);
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
    clearInterval(recTimerRef.current);
    clearInterval(waveTimerRef.current);
    setRecording(false);
    setAudioPreview(null);
    setShowEmoji(false);
  }, [emit]);

  /* ── Reset to home ── */
  const startNew = useCallback(() => {
    setStatus('initial');
    setMessages([]);
    setInputValue('');
    setAudioPreview(null);
    setShowEmoji(false);
  }, []);

  /* ── Voice recording ── */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr     = new MediaRecorder(stream);
      mediaRef.current  = mr;
      chunksRef.current = [];
      let secs = 0;

      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob   = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url    = URL.createObjectURL(blob);
        const reader = new FileReader();
        reader.onload = () => setAudioPreview({ url, base64: reader.result, duration: secs });
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current  = setInterval(() => { secs++; setRecSeconds(secs); }, 1000);
      waveTimerRef.current = setInterval(() => setWaveTick(t => t + 1), 80);
    } catch {
      alert('Microphone permission was denied. Please allow access and try again.');
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    clearInterval(recTimerRef.current);
    clearInterval(waveTimerRef.current);
    setRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.ondataavailable = null;
      mediaRef.current.onstop          = null;
      mediaRef.current.stop();
    }
    clearInterval(recTimerRef.current);
    clearInterval(waveTimerRef.current);
    setRecording(false);
    setAudioPreview(null);
    setRecSeconds(0);
  };

  /* ─────────────────────────────────────────
     Render
  ───────────────────────────────────────── */
  return (
    <div className="app">

      {/* ── HOME ── */}
      {status === 'initial' && (
        <div className="screen-center">
          <div className="hero">
            <div className="hero-orb" />
            <div className="hero-content">
              <div className="logo-mark">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="16" fill="url(#lg)" />
                  <path d="M9 12h14M9 16h10M9 20h7" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  <defs>
                    <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
                      <stop stopColor="#1D4ED8" />
                      <stop offset="1" stopColor="#F97316" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h1 className="hero-title">RandomChat</h1>
              <p className="hero-sub">
                Real conversations with real people — completely anonymous.<br />
                Text &amp; voice, no account required.
              </p>
              <button className="btn-start" onClick={startChat}>
                Start Chatting
              </button>
              <p className="hero-note">100% anonymous &middot; No sign-up &middot; End anytime</p>
            </div>
          </div>
        </div>
      )}

      {/* ── MATCHING ── */}
      {status === 'waiting' && (
        <div className="screen-center">
          <div className="waiting-card">
            <div className="radar">
              <div className="radar-ring r1" />
              <div className="radar-ring r2" />
              <div className="radar-ring r3" />
              <div className="radar-core" />
            </div>
            <h2 className="waiting-title">Finding someone…</h2>
            <p className="waiting-sub">Looking for someone available to connect with</p>
            <button
              className="btn-ghost"
              onClick={() => { emit('end-chat'); setStatus('initial'); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── CHAT ── */}
      {status === 'chatting' && (
        <div className="chat-screen">

          {/* Topbar */}
          <div className="topbar">
            <div className="topbar-left">
              <div className="avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              </div>
              <div className="stranger-info">
                <div className="stranger-name">Anonymous</div>
                <div className="stranger-status">
                  <span className="live-dot" />
                  Connected
                </div>
              </div>
            </div>
            <button className="btn-end" onClick={endChat}>End Chat</button>
          </div>

          {/* Messages */}
          <div className="messages-pane">
            {messages.map((msg, i) => {
              if (msg.type === 'system') {
                return <div key={i} className="sys-msg">{msg.text}</div>;
              }
              const own = msg.type === 'sent';
              return (
                <div key={msg.msgId || i} className={`msg-row ${own ? 'own' : 'other'}`}>
                  <div className={`bubble ${own ? 'own' : 'other'}`}>
                    {msg.isVoice
                      ? <VoicePlayer audioData={msg.audioData} duration={msg.duration} own={own} />
                      : <p className="bubble-text">{typeof msg.text === 'string' ? msg.text : ''}</p>
                    }
                    <div className="bubble-footer">
                      <span className="bubble-time">{msg.time}</span>
                      {own && <TickIcon status={msg.status || 'sent'} />}
                    </div>
                  </div>
                </div>
              );
            })}
            {partnerTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice preview bar */}
          {audioPreview && !recording && (
            <div className="audio-preview-bar">
              <span className="ap-label">Voice Message</span>
              <VoicePlayer audioData={audioPreview.url} duration={audioPreview.duration} own={true} />
              <button
                className="ap-discard"
                onClick={() => setAudioPreview(null)}
                aria-label="Discard recording"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* Composer */}
          <div className="composer">
            <button className="btn-random" onClick={nextStranger} title="Connect with someone new">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16,3 21,3 21,8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21,16 21,21 16,21" />
                <line x1="15" y1="15" x2="21" y2="21" />
              </svg>
              Next
            </button>

            <div className="composer-inner">
              {recording ? (
                <div className="rec-bar">
                  <button className="rec-discard" onClick={cancelRecording} aria-label="Cancel recording">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <span className="rec-dot-live" />
                  <MicWave tick={waveTick} />
                  <span className="rec-timer">{formatDuration(recSeconds)}</span>
                </div>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    className="composer-input"
                    type="text"
                    value={inputValue}
                    onChange={handleTyping}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Write a message…"
                    autoComplete="off"
                    autoCorrect="on"
                    spellCheck
                  />
                  <div className="emoji-wrap" ref={emojiRef}>
                    <button
                      className={`emoji-toggle ${showEmoji ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); setShowEmoji(v => !v); }}
                      aria-label="Emoji picker"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </button>
                    {showEmoji && (
                      <div className="emoji-picker-wrap">
                        <EmojiPicker
                          onEmojiClick={onEmojiClick}
                          width={300}
                          height={380}
                          previewConfig={{ showPreview: false }}
                          skinTonesDisabled
                          lazyLoadEmojis
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {audioPreview && !recording ? (
              <button className="fab fab-send" onClick={sendVoice} aria-label="Send voice message">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22,2 15,22 11,13 2,9" />
                </svg>
              </button>
            ) : recording ? (
              <button className="fab fab-stop" onClick={stopRecording} aria-label="Stop recording">
                <span className="stop-sq" />
              </button>
            ) : inputValue.trim() ? (
              <button className="fab fab-send" onClick={sendMessage} aria-label="Send message">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22,2 15,22 11,13 2,9" />
                </svg>
              </button>
            ) : (
              <button className="fab fab-mic" onClick={startRecording} aria-label="Record voice message">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 1a4 4 0 014 4v7a4 4 0 01-8 0V5a4 4 0 014-4z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── ENDED ── */}
      {status === 'ended' && (
        <div className="screen-center">
          <div className="ended-card">
            <div className="ended-emoji">👋</div>
            <h2 className="ended-title">Conversation Ended</h2>
            <p className="ended-sub">
              The other person has disconnected.<br />
              Ready to meet someone new?
            </p>
            <button
              className="btn-start"
              onClick={() => { startNew(); setTimeout(startChat, 50); }}
            >
              New Conversation
            </button>
            <button className="btn-ghost" onClick={startNew}>Back to Home</button>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;