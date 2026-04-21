import React, { useState, useEffect, useRef, useCallback } from 'react';
import { subtitleApi, parseSrt } from '../../services/api';
import { Subtitles, ChevronDown, X, Check, Loader } from 'lucide-react';

const LANGUAGES = [
  { code: 'id', label: '🇮🇩 Indonesia' },
  { code: 'en', label: '🇺🇸 English' },
  { code: 'ja', label: '🇯🇵 Japanese' },
  { code: 'ko', label: '🇰🇷 Korean' },
  { code: 'zh-CN', label: '🇨🇳 Chinese' },
  { code: 'ar', label: '🇸🇦 Arabic' },
];

const SubtitleOverlay = ({ tmdbId, mediaType = 'movie', season = null, episode = null }) => {
  const [subtitleList, setSubtitleList] = useState([]);
  const [selectedLang, setSelectedLang] = useState(null);
  const [selectedSub, setSelectedSub]   = useState(null);
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [currentCue, setCurrentCue]     = useState(null);
  const [elapsed, setElapsed]           = useState(0);
  const [showPanel, setShowPanel]       = useState(false);
  const [loading, setLoading]           = useState(false);
  const [loadingList, setLoadingList]   = useState(false);
  const [status, setStatus]             = useState('');
  const [fontSize, setFontSize]         = useState(20);
  const [subEnabled, setSubEnabled]     = useState(true);
  const [offset, setOffset]             = useState(0); // detik, untuk timing adjust

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // Jalankan timer internal untuk track waktu
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startTimeRef.current = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(secs);
    }, 250);
  }, [elapsed]);

  useEffect(() => {
    // Auto-start timer saat subtitle dimuat
    if (subtitleCues.length > 0) startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [subtitleCues]);

  // Cari cue yang aktif berdasarkan elapsed
  useEffect(() => {
    if (!subtitleCues.length || !subEnabled) { setCurrentCue(null); return; }
    const adjElapsed = elapsed + offset;
    const cue = subtitleCues.find(c => adjElapsed >= c.start && adjElapsed <= c.end);
    setCurrentCue(cue || null);
  }, [elapsed, subtitleCues, subEnabled, offset]);

  // Load subtitle list ketika tmdbId berubah
  useEffect(() => {
    if (!tmdbId) return;
    setSubtitleList([]); setSelectedSub(null); setSubtitleCues([]); setCurrentCue(null);
    setStatus('');

    setLoadingList(true);
    subtitleApi.searchSubtitles(tmdbId, mediaType, 'id,en,ja,ko')
      .then(results => {
        setSubtitleList(results);
        // Auto-pilih subtitle Indonesia jika ada
        const indo = results.find(s =>
          s.attributes?.language === 'id' ||
          s.attributes?.language === 'ind'
        );
        if (indo) {
          setStatus('Subtitle Indonesia tersedia ✓');
        } else {
          setStatus(results.length > 0 ? `${results.length} subtitle tersedia` : 'Subtitle tidak tersedia');
        }
      })
      .catch(() => setStatus('Gagal memuat daftar subtitle'))
      .finally(() => setLoadingList(false));
  }, [tmdbId, mediaType]);

  // Load & parse subtitle file
  const loadSubtitle = async (sub) => {
    setLoading(true);
    setStatus('Mengunduh subtitle...');
    setSubtitleCues([]);
    setCurrentCue(null);

    try {
      const fileId = sub.attributes?.files?.[0]?.file_id;
      if (!fileId) throw new Error('No file ID');

      const link = await subtitleApi.getDownloadLink(fileId);
      if (!link) throw new Error('No download link');

      const cues = await subtitleApi.fetchAndParseSrt(link);
      if (!cues.length) throw new Error('Empty subtitle');

      setSubtitleCues(cues);
      setSelectedSub(sub);
      setElapsed(0);
      startTimeRef.current = Date.now();
      setStatus(`✓ Subtitle dimuat (${cues.length} baris)`);
      setShowPanel(false);
    } catch (e) {
      console.error('Load subtitle error:', e);
      setStatus('Gagal memuat subtitle. Coba yang lain.');
    } finally {
      setLoading(false);
    }
  };

  const groupedByLang = subtitleList.reduce((acc, sub) => {
    const lang = sub.attributes?.language || 'unknown';
    if (!acc[lang]) acc[lang] = [];
    acc[lang].push(sub);
    return acc;
  }, {});

  const getLangLabel = (code) => {
    const found = LANGUAGES.find(l => l.code === code || l.code === code?.replace('ind', 'id'));
    if (found) return found.label;
    const names = { id: '🇮🇩 Indonesia', ind: '🇮🇩 Indonesia', en: '🇺🇸 English', eng: '🇺🇸 English', ja: '🇯🇵 Japanese', jpn: '🇯🇵 Japanese', ko: '🇰🇷 Korean', kor: '🇰🇷 Korean' };
    return names[code] || code?.toUpperCase();
  };

  return (
    <>
      {/* Subtitle Overlay - ditampilkan di bawah player */}
      <div style={{ position: 'relative', width: '100%' }}>

        {/* Subtitle Text Display */}
        {subtitleCues.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '0', left: '0', right: '0',
            display: 'flex', justifyContent: 'center', pointerEvents: 'none',
            zIndex: 10, padding: '0 8px 8px',
          }}>
            <div style={{
              backgroundColor: 'rgba(0,0,0,0.85)',
              color: '#fff',
              padding: '6px 16px',
              borderRadius: '4px',
              fontSize: `${fontSize}px`,
              lineHeight: 1.4,
              textAlign: 'center',
              maxWidth: '90%',
              whiteSpace: 'pre-line',
              textShadow: '1px 1px 2px #000',
              minHeight: '2em',
              transition: 'opacity 0.15s',
              opacity: currentCue ? 1 : 0,
            }}>
              {currentCue?.text || ''}
            </div>
          </div>
        )}

        {/* Controls Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 4px', flexWrap: 'wrap', justifyContent: 'space-between',
          borderTop: '1px solid #1a1a1a', marginTop: '4px'
        }}>
          {/* Left: status & controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Subtitle toggle */}
            <button
              onClick={() => setSubEnabled(v => !v)}
              title={subEnabled ? 'Nonaktifkan subtitle' : 'Aktifkan subtitle'}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                backgroundColor: subEnabled ? 'var(--primary-color, #e50914)' : '#2a2a2a',
                color: 'white', fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              <Subtitles size={16} />
              Subtitle {subEnabled ? 'ON' : 'OFF'}
            </button>

            {/* Subtitle picker button */}
            <button
              onClick={() => setShowPanel(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', borderRadius: '6px', border: '1px solid #333',
                backgroundColor: '#1a1a1a', color: 'white', fontSize: '0.78rem', cursor: 'pointer',
              }}
            >
              {loadingList ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ChevronDown size={14} />}
              {selectedSub
                ? getLangLabel(selectedSub.attributes?.language)
                : 'Pilih Subtitle'}
            </button>

            {/* Status text */}
            {status && (
              <span style={{ fontSize: '0.72rem', color: status.includes('✓') ? '#4ade80' : '#aaa' }}>
                {status}
              </span>
            )}
          </div>

          {/* Right: timing + font size controls (saat subtitle aktif) */}
          {subtitleCues.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Timing offset */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#aaa' }}>
                <span>Timing:</span>
                <button onClick={() => setOffset(o => o - 0.5)} style={miniBtn}>-0.5s</button>
                <span style={{ color: offset === 0 ? '#666' : '#fff', minWidth: '40px', textAlign: 'center' }}>
                  {offset > 0 ? '+' : ''}{offset.toFixed(1)}s
                </span>
                <button onClick={() => setOffset(o => o + 0.5)} style={miniBtn}>+0.5s</button>
                {offset !== 0 && (
                  <button onClick={() => setOffset(0)} style={{ ...miniBtn, color: '#e50914' }}>✕</button>
                )}
              </div>

              {/* Font size */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#aaa' }}>
                <span>Size:</span>
                <button onClick={() => setFontSize(s => Math.max(12, s - 2))} style={miniBtn}>A-</button>
                <span style={{ color: '#fff', minWidth: '28px', textAlign: 'center' }}>{fontSize}</span>
                <button onClick={() => setFontSize(s => Math.min(36, s + 2))} style={miniBtn}>A+</button>
              </div>

              {/* Reset timer */}
              <button
                onClick={() => { setElapsed(0); startTimeRef.current = Date.now(); }}
                title="Reset timer ke 00:00"
                style={{ ...miniBtn, padding: '3px 8px' }}
              >
                ↺ Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Subtitle Picker Panel */}
      {showPanel && (
        <div style={{
          backgroundColor: '#111', border: '1px solid #2a2a2a',
          borderRadius: '8px', padding: '16px', marginTop: '4px',
          maxHeight: '320px', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fff' }}>
              Pilih Subtitle ({subtitleList.length} tersedia)
            </h3>
            <button onClick={() => setShowPanel(false)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          {loadingList && (
            <div style={{ textAlign: 'center', color: '#aaa', padding: '20px' }}>
              <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>Mencari subtitle...</div>
            </div>
          )}

          {!loadingList && subtitleList.length === 0 && (
            <p style={{ color: '#666', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
              Tidak ada subtitle tersedia untuk konten ini.
            </p>
          )}

          {/* Group by language */}
          {Object.entries(groupedByLang).map(([lang, subs]) => (
            <div key={lang} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {getLangLabel(lang)}
              </div>
              {subs.slice(0, 5).map((sub, idx) => {
                const attr = sub.attributes || {};
                const isSelected = selectedSub?.id === sub.id;
                const fileName = attr.release || attr.files?.[0]?.file_name || `Subtitle ${idx + 1}`;
                const downloads = attr.download_count || 0;
                const rating = attr.ratings ? `★ ${Number(attr.ratings).toFixed(1)}` : '';

                return (
                  <button
                    key={sub.id || idx}
                    onClick={() => loadSubtitle(sub)}
                    disabled={loading}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      width: '100%', padding: '8px 10px', marginBottom: '4px',
                      backgroundColor: isSelected ? '#1a1a3e' : '#1a1a1a',
                      border: isSelected ? '1px solid #4444cc' : '1px solid #2a2a2a',
                      borderRadius: '6px', color: 'white', cursor: loading ? 'wait' : 'pointer',
                      textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    {isSelected && <Check size={16} style={{ color: '#4ade80', flexShrink: 0, marginTop: '2px' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px' }}>
                        {downloads.toLocaleString()} downloads {rating && `• ${rating}`}
                      </div>
                    </div>
                    {loading && selectedSub?.id === sub.id && (
                      <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          <p style={{ fontSize: '0.7rem', color: '#444', marginTop: '8px', textAlign: 'center' }}>
            Powered by OpenSubtitles.com
          </p>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
};

const miniBtn = {
  padding: '2px 6px', borderRadius: '4px', border: '1px solid #333',
  backgroundColor: '#1a1a1a', color: '#ccc', cursor: 'pointer', fontSize: '0.72rem',
};

export default SubtitleOverlay;
