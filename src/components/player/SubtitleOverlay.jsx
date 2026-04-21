import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Subtitles, ChevronDown, X, Check, Loader, AlertCircle } from 'lucide-react';

// ============================================================
//  Subtitle Service - SUBDL (gratis, no key) + OS fallback
//  CORS enabled, work dari browser
// ============================================================

const SUBDL_BASE = "https://api.subdl.com/api/v1";
const SUBDL_DL   = "https://dl.subdl.com";
const OS_BASE    = "https://api.opensubtitles.com/api/v1";
const OS_KEY     = "s2LOv0ug7sFWJGPJeO4y8VQ64oX1FCXW";
const CORS_PROXY = "https://api.allorigins.win/get?url=";

const LANG_MAP = {
  ID: '🇮🇩 Indonesia', IN: '🇮🇩 Indonesia', id: '🇮🇩 Indonesia', ind: '🇮🇩 Indonesia',
  EN: '🇺🇸 English',   en: '🇺🇸 English',   eng: '🇺🇸 English',
  JA: '🇯🇵 Japanese',  ja: '🇯🇵 Japanese',  jpn: '🇯🇵 Japanese',
  KO: '🇰🇷 Korean',    ko: '🇰🇷 Korean',    kor: '🇰🇷 Korean',
  ZH: '🇨🇳 Chinese',   zh: '🇨🇳 Chinese',   zho: '🇨🇳 Chinese',
  AR: '🇸🇦 Arabic',    ar: '🇦🇷 Arabic',    ara: '🇸🇦 Arabic',
};
const getLang = (code) => LANG_MAP[code] || code?.toUpperCase() || '?';

// Cari subtitle via SUBDL
const searchSubdl = async (tmdbId, type = 'movie') => {
  try {
    const url = `${SUBDL_BASE}/subtitles?tmdb_id=${tmdbId}&type=${type}&langs=ID,EN,JA,KO&full_season=0`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const subs = data.subtitles || [];
    // Normalise ke format umum
    return subs.map(s => ({
      source: 'subdl',
      id: s.sd_id || s.url,
      lang: s.lang || 'EN',
      name: s.release_name || s.name || 'Subtitle',
      downloads: s.downloads || 0,
      hi: s.hi || false,
      url: s.url, // relative path, prepend SUBDL_DL
    }));
  } catch (e) {
    console.warn('SUBDL search failed:', e.message);
    return [];
  }
};

// Cari subtitle via OpenSubtitles (fallback)
const searchOS = async (tmdbId, type = 'movie') => {
  try {
    const url = `${OS_BASE}/subtitles?tmdb_id=${tmdbId}&type=${type === 'tv' ? 'episode' : 'movie'}&languages=id,en&order_by=download_count`;
    const res = await fetch(url, {
      headers: { 'Api-Key': OS_KEY, 'User-Agent': 'B3Flix v1.0' }
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return (data.data || []).map(s => ({
      source: 'os',
      id: s.id,
      lang: s.attributes?.language || 'en',
      name: s.attributes?.release || s.attributes?.files?.[0]?.file_name || 'Subtitle',
      downloads: s.attributes?.download_count || 0,
      fileId: s.attributes?.files?.[0]?.file_id,
    }));
  } catch (e) {
    console.warn('OpenSubtitles search failed:', e.message);
    return [];
  }
};

// Download & parse SRT
const fetchSrt = async (sub) => {
  let rawUrl = '';

  if (sub.source === 'subdl') {
    rawUrl = `${SUBDL_DL}${sub.url}`;
  } else if (sub.source === 'os') {
    // OS butuh download token request
    const res = await fetch(`${OS_BASE}/download`, {
      method: 'POST',
      headers: { 'Api-Key': OS_KEY, 'User-Agent': 'B3Flix v1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: sub.fileId }),
    });
    const data = await res.json();
    rawUrl = data.link || '';
  }

  if (!rawUrl) throw new Error('No URL');

  // Fetch via CORS proxy
  const proxyRes = await fetch(`${CORS_PROXY}${encodeURIComponent(rawUrl)}`);
  const json = await proxyRes.json();
  const text = json.contents || '';

  // File bisa .zip (subdl kadang zip) atau .srt langsung
  if (!text || text.length < 10) throw new Error('Empty content');

  return parseSrt(text);
};

// Parse SRT → array cue
const parseSrt = (text) => {
  const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\n+/).filter(Boolean);
  return blocks.map(block => {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) return null;
    const [st, et] = lines[ti].split('-->').map(s => s.trim());
    const txt = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (!txt) return null;
    return { start: toSec(st), end: toSec(et), text: txt };
  }).filter(Boolean);
};

const toSec = (s) => {
  if (!s) return 0;
  const [h, m, sec] = s.replace(',', '.').split(':');
  return +h * 3600 + +m * 60 + parseFloat(sec);
};

// ============================================================
//  SubtitleOverlay Component
// ============================================================
const SubtitleOverlay = ({ tmdbId, mediaType = 'movie', season, episode }) => {
  const [allSubs, setAllSubs]       = useState([]);
  const [selected, setSelected]     = useState(null);
  const [cues, setCues]             = useState([]);
  const [currentCue, setCurrentCue] = useState(null);
  const [elapsed, setElapsed]       = useState(0);
  const [showPanel, setShowPanel]   = useState(false);
  const [enabled, setEnabled]       = useState(true);
  const [loading, setLoading]       = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [status, setStatus]         = useState('');
  const [fontSize, setFontSize]     = useState(20);
  const [offset, setOffset]         = useState(0);
  const [error, setError]           = useState('');

  const timerRef    = useRef(null);
  const startRef    = useRef(null);
  const pausedRef   = useRef(false);

  // Timer
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startRef.current = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => {
      if (!pausedRef.current) {
        setElapsed((Date.now() - startRef.current) / 1000);
      }
    }, 200);
  }, [elapsed]);

  useEffect(() => {
    if (cues.length > 0) startTimer();
    return () => clearInterval(timerRef.current);
  }, [cues]);

  // Active cue
  useEffect(() => {
    if (!cues.length || !enabled) { setCurrentCue(null); return; }
    const adj = elapsed + offset;
    setCurrentCue(cues.find(c => adj >= c.start && adj <= c.end) || null);
  }, [elapsed, cues, enabled, offset]);

  // Load subtitle list
  useEffect(() => {
    if (!tmdbId) return;
    setAllSubs([]); setSelected(null); setCues([]); setCurrentCue(null);
    setStatus(''); setError('');
    setListLoading(true);

    Promise.all([
      searchSubdl(tmdbId, mediaType),
      searchOS(tmdbId, mediaType),
    ]).then(([subdlSubs, osSubs]) => {
      // Merge, prioritaskan Indo di atas
      const merged = [...subdlSubs, ...osSubs];
      const deduped = merged.filter((s, i, arr) =>
        arr.findIndex(x => x.id === s.id) === i
      );
      const sorted = deduped.sort((a, b) => {
        const prio = (s) => (s.lang === 'ID' || s.lang === 'id' || s.lang === 'ind') ? 0 : 1;
        return prio(a) - prio(b) || b.downloads - a.downloads;
      });

      setAllSubs(sorted);
      const indoCount = sorted.filter(s => ['ID','id','ind','IN'].includes(s.lang)).length;

      if (indoCount > 0) {
        setStatus(`✓ ${indoCount} subtitle Indonesia tersedia`);
      } else if (sorted.length > 0) {
        setStatus(`${sorted.length} subtitle tersedia (belum ada Indo)`);
      } else {
        setStatus('');
        setError('Subtitle belum tersedia — film mungkin terlalu baru');
      }
    }).finally(() => setListLoading(false));
  }, [tmdbId, mediaType]);

  const handleLoad = async (sub) => {
    setLoading(true); setError('');
    setStatus(`Mengunduh subtitle ${getLang(sub.lang)}...`);
    setCues([]); setCurrentCue(null);
    try {
      const parsed = await fetchSrt(sub);
      if (!parsed.length) throw new Error('Subtitle kosong atau format tidak didukung');
      setCues(parsed);
      setSelected(sub);
      setElapsed(0);
      startRef.current = Date.now();
      setStatus(`✓ Subtitle dimuat — ${parsed.length} baris`);
      setShowPanel(false);
      setOffset(0);
    } catch (e) {
      setError(`Gagal memuat: ${e.message}. Coba subtitle lain.`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  // Group by lang
  const grouped = allSubs.reduce((acc, s) => {
    const k = s.lang;
    if (!acc[k]) acc[k] = [];
    acc[k].push(s);
    return acc;
  }, {});

  // Sort groups: Indo first
  const langOrder = ['ID', 'id', 'ind', 'IN', 'EN', 'en', 'eng'];
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    const ai = langOrder.indexOf(a);
    const bi = langOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <>
      {/* Controls bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 2px', flexWrap: 'wrap',
        borderTop: '1px solid #1a1a1a', marginTop: '6px',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Toggle */}
          <button onClick={() => setEnabled(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            backgroundColor: enabled ? 'var(--primary-color,#e50914)' : '#2a2a2a',
            color: '#fff', fontSize: '0.8rem', fontWeight: 600,
          }}>
            <Subtitles size={15} />
            Sub {enabled ? 'ON' : 'OFF'}
          </button>

          {/* Picker */}
          <button onClick={() => setShowPanel(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 12px', borderRadius: '6px',
            border: '1px solid #333', backgroundColor: '#1a1a1a',
            color: '#fff', fontSize: '0.78rem', cursor: 'pointer',
          }}>
            {listLoading
              ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <ChevronDown size={13} />
            }
            {selected ? `${getLang(selected.lang)}` : 'Pilih Subtitle'}
          </button>

          {/* Status / error */}
          {status && <span style={{ fontSize: '0.72rem', color: status.startsWith('✓') ? '#4ade80' : '#aaa' }}>{status}</span>}
          {error && !showPanel && (
            <span style={{ fontSize: '0.72rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={12} /> {error}
            </span>
          )}
        </div>

        {/* Timing & size controls */}
        {cues.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: '#555' }}>Timing:</span>
            <button onClick={() => setOffset(o => +(o - 0.5).toFixed(1))} style={mBtn}>-0.5s</button>
            <span style={{ fontSize: '0.72rem', color: offset !== 0 ? '#fff' : '#444', minWidth: '38px', textAlign: 'center' }}>
              {offset > 0 ? '+' : ''}{offset.toFixed(1)}s
            </span>
            <button onClick={() => setOffset(o => +(o + 0.5).toFixed(1))} style={mBtn}>+0.5s</button>
            {offset !== 0 && <button onClick={() => setOffset(0)} style={{ ...mBtn, color: '#f87171' }}>✕</button>}
            <span style={{ fontSize: '0.72rem', color: '#555', marginLeft: '4px' }}>Size:</span>
            <button onClick={() => setFontSize(s => Math.max(12, s - 2))} style={mBtn}>A-</button>
            <span style={{ fontSize: '0.72rem', color: '#aaa', minWidth: '22px', textAlign: 'center' }}>{fontSize}</span>
            <button onClick={() => setFontSize(s => Math.min(36, s + 2))} style={mBtn}>A+</button>
            <button onClick={() => { setElapsed(0); startRef.current = Date.now(); }}
              style={{ ...mBtn, padding: '3px 8px' }} title="Reset timer ke awal">↺</button>
          </div>
        )}
      </div>

      {/* Subtitle text display — di bawah player */}
      {cues.length > 0 && enabled && (
        <div style={{
          minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '4px 8px', marginBottom: '4px',
        }}>
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.88)',
            color: '#fff', padding: '6px 18px',
            borderRadius: '5px', fontSize: `${fontSize}px`,
            lineHeight: 1.45, textAlign: 'center',
            maxWidth: '90%', whiteSpace: 'pre-line',
            textShadow: '1px 1px 3px #000',
            opacity: currentCue ? 1 : 0,
            transition: 'opacity 0.15s',
            minWidth: '60px',
          }}>
            {currentCue?.text || '\u00A0'}
          </div>
        </div>
      )}

      {/* Subtitle Picker Panel */}
      {showPanel && (
        <div style={{
          backgroundColor: '#0f0f0f', border: '1px solid #222',
          borderRadius: '10px', padding: '16px', marginTop: '4px',
          maxHeight: '350px', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fff' }}>
              Pilih Subtitle ({allSubs.length} tersedia)
            </h3>
            <button onClick={() => setShowPanel(false)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
              <X size={17} />
            </button>
          </div>

          {listLoading && (
            <div style={{ textAlign: 'center', padding: '24px', color: '#666' }}>
              <Loader size={22} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: '8px', fontSize: '0.82rem' }}>Mencari subtitle...</div>
            </div>
          )}

          {!listLoading && allSubs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <AlertCircle size={32} style={{ color: '#555', marginBottom: '10px' }} />
              <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '6px' }}>
                Subtitle belum tersedia untuk film ini
              </div>
              <div style={{ color: '#555', fontSize: '0.75rem', lineHeight: 1.5 }}>
                Film baru biasanya belum memiliki subtitle.<br />
                Coba cek lagi beberapa hari/minggu kemudian.
              </div>
            </div>
          )}

          {/* Grouped subtitle list */}
          {sortedGroups.map(([lang, subs]) => (
            <div key={lang} style={{ marginBottom: '14px' }}>
              <div style={{
                fontSize: '0.72rem', color: '#666', marginBottom: '6px',
                textTransform: 'uppercase', letterSpacing: '0.8px',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                {getLang(lang)}
                <span style={{ color: '#333', fontWeight: 400 }}>({subs.length})</span>
              </div>
              {subs.slice(0, 6).map((sub, i) => {
                const isSel = selected?.id === sub.id;
                const isLoading = loading && isSel;
                return (
                  <button key={sub.id || i}
                    onClick={() => handleLoad(sub)}
                    disabled={loading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '8px 10px', marginBottom: '4px',
                      backgroundColor: isSel ? '#0d1a4a' : '#141414',
                      border: `1px solid ${isSel ? '#2244cc' : '#222'}`,
                      borderRadius: '7px', color: '#fff',
                      cursor: loading ? 'wait' : 'pointer',
                      textAlign: 'left', transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    {isSel && !isLoading && <Check size={14} style={{ color: '#4ade80', flexShrink: 0 }} />}
                    {isLoading && <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.8rem', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: isSel ? '#a5b4fc' : '#ddd',
                      }}>
                        {sub.name}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#555', marginTop: '2px' }}>
                        {sub.source === 'subdl' ? 'SUBDL' : 'OpenSubtitles'}
                        {sub.downloads > 0 && ` • ${sub.downloads.toLocaleString()} unduhan`}
                        {sub.hi && ' • HI'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}

          <p style={{ fontSize: '0.68rem', color: '#333', textAlign: 'center', marginTop: '8px' }}>
            Sumber: SUBDL & OpenSubtitles
          </p>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
};

const mBtn = {
  padding: '2px 7px', borderRadius: '4px', border: '1px solid #2a2a2a',
  backgroundColor: '#141414', color: '#bbb', cursor: 'pointer', fontSize: '0.7rem',
};

export default SubtitleOverlay;
