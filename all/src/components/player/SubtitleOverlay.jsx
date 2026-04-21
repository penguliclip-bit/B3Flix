import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Subtitles, ChevronDown, X, Check, Loader, AlertCircle, RefreshCw } from 'lucide-react';

// ============================================================
//  SUBTITLE SERVICE - Fixed & Improved
//  Strategi: OpenSubtitles (utama) + SUBDL (fallback)
//  CORS: Multiple proxy dengan auto-fallback
// ============================================================

const OS_BASE  = 'https://api.opensubtitles.com/api/v1';
const OS_KEY   = 's2LOv0ug7sFWJGPJeO4y8VQ64oX1FCXW';
const OS_AGENT = 'B3Flix v1.0';

const SUBDL_BASE = 'https://api.subdl.com/api/v1';
const SUBDL_DL   = 'https://dl.subdl.com';

// Multiple CORS proxies dengan auto-fallback
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

const LANG_MAP = {
  'id': '🇮🇩 Indonesia', 'ind': '🇮🇩 Indonesia', 'in': '🇮🇩 Indonesia', 'ID': '🇮🇩 Indonesia',
  'en': '🇺🇸 English',   'eng': '🇺🇸 English',   'EN': '🇺🇸 English',
  'ja': '🇯🇵 Japanese',  'jpn': '🇯🇵 Japanese',  'JA': '🇯🇵 Japanese',
  'ko': '🇰🇷 Korean',    'kor': '🇰🇷 Korean',    'KO': '🇰🇷 Korean',
  'zh': '🇨🇳 Chinese',   'zho': '🇨🇳 Chinese',
  'ar': '🇸🇦 Arabic',    'ara': '🇸🇦 Arabic',
};
const getLang = (code) =>
  LANG_MAP[code] || LANG_MAP[code?.toLowerCase()] || code?.toUpperCase() || '?';
const isIndo = (lang) => ['id', 'ind', 'in', 'ID', 'IN'].includes(lang);

// ─── CORS fetch dengan multiple proxy ─────────────────────────────────────
const fetchWithProxy = async (rawUrl) => {
  // Coba langsung dulu
  try {
    const res = await fetch(rawUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const t = await res.text();
      if (t && t.length > 20) return t;
    }
  } catch (_) {}

  // Fallback ke proxy
  for (const makeProxy of CORS_PROXIES) {
    try {
      const res = await fetch(makeProxy(rawUrl), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      // allorigins returns JSON { contents, status }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json();
        if (json.contents && json.contents.length > 20) return json.contents;
      } else {
        const t = await res.text();
        if (t && t.length > 20) return t;
      }
    } catch (_) {}
  }
  throw new Error('Semua proxy gagal — coba subtitle lain');
};

// ─── ZIP extractor minimal (tanpa library) ────────────────────────────────
const extractSrtFromZipUrl = async (zipUrl) => {
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(zipUrl)}`;
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error('ZIP fetch failed');

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Scan for local file headers (signature 50 4B 03 04)
  let i = 0;
  while (i < bytes.length - 30) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B &&
        bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      const compression  = bytes[i+8]  | (bytes[i+9] << 8);
      const compressedSz = bytes[i+18] | (bytes[i+19] << 8) |
                          (bytes[i+20] << 16) | (bytes[i+21] << 24);
      const fnLen = bytes[i+26] | (bytes[i+27] << 8);
      const exLen = bytes[i+28] | (bytes[i+29] << 8);

      const fname = new TextDecoder().decode(bytes.slice(i+30, i+30+fnLen)).toLowerCase();
      const dataStart = i + 30 + fnLen + exLen;
      const dataEnd   = dataStart + compressedSz;

      if (fname.endsWith('.srt') && compression === 0 && dataEnd <= bytes.length) {
        const text = new TextDecoder('utf-8', { fatal: false })
          .decode(bytes.slice(dataStart, dataEnd));
        if (text.includes('-->')) return text;
      }

      i = (dataEnd > dataStart && dataEnd <= bytes.length) ? dataEnd : i + 1;
    } else {
      i++;
    }
  }
  throw new Error('Tidak ada .srt di dalam ZIP');
};

// ─── OpenSubtitles search ──────────────────────────────────────────────────
const searchOS = async (tmdbId, type, season, episode) => {
  try {
    const url = new URL(`${OS_BASE}/subtitles`);
    url.searchParams.set('tmdb_id', tmdbId);
    url.searchParams.set('type', type === 'tv' ? 'episode' : 'movie');
    url.searchParams.set('languages', 'id,en,ja,ko');
    url.searchParams.set('order_by', 'download_count');
    if (season)  url.searchParams.set('season_number', season);
    if (episode) url.searchParams.set('episode_number', episode);

    const res = await fetch(url.toString(), {
      headers: { 'Api-Key': OS_KEY, 'User-Agent': OS_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`OS ${res.status}`);
    const data = await res.json();

    return (data.data || []).map(s => ({
      source: 'os',
      id: `os-${s.id}`,
      lang: s.attributes?.language || 'en',
      name: s.attributes?.release || s.attributes?.files?.[0]?.file_name || 'Subtitle',
      downloads: s.attributes?.download_count || 0,
      fileId: s.attributes?.files?.[0]?.file_id,
      hi: s.attributes?.hearing_impaired || false,
    }));
  } catch (e) {
    console.warn('[OS] search failed:', e.message);
    return [];
  }
};

// ─── SUBDL search (fallback) ───────────────────────────────────────────────
const searchSubdl = async (tmdbId, type) => {
  try {
    const res = await fetch(
      `${SUBDL_BASE}/subtitles?tmdb_id=${tmdbId}&type=${type}&langs=ID,EN,JA,KO&full_season=0`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`SUBDL ${res.status}`);
    const data = await res.json();

    return (data.subtitles || []).map(s => ({
      source: 'subdl',
      id: `subdl-${s.sd_id || s.url}`,
      lang: s.lang || 'EN',
      name: s.release_name || s.name || 'Subtitle',
      downloads: s.downloads || 0,
      hi: s.hi || false,
      url: s.url,
    }));
  } catch (e) {
    console.warn('[SUBDL] search failed:', e.message);
    return [];
  }
};

// ─── Fetch + Parse subtitle ────────────────────────────────────────────────
const fetchAndParseSrt = async (sub) => {
  let text = '';

  if (sub.source === 'os') {
    const res = await fetch(`${OS_BASE}/download`, {
      method: 'POST',
      headers: { 'Api-Key': OS_KEY, 'User-Agent': OS_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: sub.fileId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Token request gagal (${res.status})`);
    const data = await res.json();
    if (!data.link) throw new Error('Link subtitle kosong dari OS');
    text = await fetchWithProxy(data.link);

  } else if (sub.source === 'subdl') {
    const fileUrl = `${SUBDL_DL}${sub.url}`;
    const isZipFile = sub.url?.includes('.zip');

    if (isZipFile) {
      text = await extractSrtFromZipUrl(fileUrl);
    } else {
      text = await fetchWithProxy(fileUrl);
      // Cek magic bytes ZIP (PK)
      if (text && (text.startsWith('PK') || text.charCodeAt(0) === 0x50)) {
        text = await extractSrtFromZipUrl(fileUrl);
      }
    }
  }

  if (!text || text.length < 10) throw new Error('Konten subtitle kosong');
  const cues = parseSrt(text);
  if (!cues.length) throw new Error('Format tidak dikenali — coba subtitle lain');
  return cues;
};

// ─── SRT Parser ───────────────────────────────────────────────────────────
const parseSrt = (raw) => {
  if (!raw) return [];
  const blocks = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\n+/).filter(Boolean);
  return blocks.map(block => {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) return null;
    const [st, et] = lines[ti].split('-->').map(s => s.trim());
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .trim();
    if (!txt) return null;
    return { start: toSec(st), end: toSec(et), text: txt };
  }).filter(Boolean);
};

const toSec = (s) => {
  if (!s) return 0;
  const [h, m, sec] = s.replace(',', '.').split(':');
  return +h * 3600 + +m * 60 + parseFloat(sec || 0);
};

// ─── Merge & sort ─────────────────────────────────────────────────────────
const mergeSubs = (a, b) => {
  const seen = new Set();
  return [...a, ...b].filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  }).sort((x, y) => {
    const p = s => isIndo(s.lang) ? 0 : ['en','EN','eng'].includes(s.lang) ? 1 : 2;
    return p(x) - p(y) || y.downloads - x.downloads;
  });
};

const groupByLang = (subs) => {
  const map = {};
  const order = ['id','in','ind','ID','en','EN','eng'];
  subs.forEach(s => {
    if (!map[s.lang]) map[s.lang] = [];
    map[s.lang].push(s);
  });
  return Object.entries(map).sort(([a], [b]) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
};

// ============================================================
//  SubtitleOverlay Component
// ============================================================
const SubtitleOverlay = ({ tmdbId, mediaType = 'movie', season, episode }) => {
  const [allSubs, setAllSubs]         = useState([]);
  const [selected, setSelected]       = useState(null);
  const [cues, setCues]               = useState([]);
  const [currentCue, setCurrentCue]   = useState(null);
  const [elapsed, setElapsed]         = useState(0);
  const [showPanel, setShowPanel]     = useState(false);
  const [enabled, setEnabled]         = useState(true);
  const [loading, setLoading]         = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [status, setStatus]           = useState('');
  const [error, setError]             = useState('');
  const [fontSize, setFontSize]       = useState(20);
  const [offset, setOffset]           = useState(0);
  const [retryKey, setRetryKey]       = useState(0);

  const timerRef = useRef(null);
  const startRef = useRef(null);

  // Timer
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startRef.current = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 200);
  }, [elapsed]);

  useEffect(() => {
    if (cues.length > 0) startTimer();
    return () => clearInterval(timerRef.current);
  }, [cues]);

  useEffect(() => {
    if (!cues.length || !enabled) { setCurrentCue(null); return; }
    const t = elapsed + offset;
    setCurrentCue(cues.find(c => t >= c.start && t <= c.end) || null);
  }, [elapsed, cues, enabled, offset]);

  // Load subtitle list
  useEffect(() => {
    if (!tmdbId) return;
    setAllSubs([]); setSelected(null); setCues([]);
    setCurrentCue(null); setStatus(''); setError('');
    setListLoading(true);

    const s = mediaType === 'tv' ? season : null;
    const e = mediaType === 'tv' ? episode : null;

    Promise.all([searchOS(tmdbId, mediaType, s, e), searchSubdl(tmdbId, mediaType)])
      .then(([os, subdl]) => {
        const merged = mergeSubs(os, subdl);
        setAllSubs(merged);
        const indoCount = merged.filter(x => isIndo(x.lang)).length;
        if (indoCount > 0) setStatus(`✓ ${indoCount} subtitle Indonesia tersedia`);
        else if (merged.length > 0) setStatus(`${merged.length} subtitle tersedia`);
        else setError('Belum ada subtitle — film mungkin terlalu baru');
      })
      .catch(() => setError('Gagal memuat daftar subtitle'))
      .finally(() => setListLoading(false));
  }, [tmdbId, mediaType, season, episode, retryKey]);

  const handleLoad = async (sub) => {
    setLoading(true); setError('');
    setStatus(`Mengunduh ${getLang(sub.lang)}...`);
    setCues([]); setCurrentCue(null);

    try {
      const parsed = await fetchAndParseSrt(sub);
      setCues(parsed);
      setSelected(sub);
      setElapsed(0);
      startRef.current = Date.now();
      setOffset(0);
      setStatus(`✓ ${parsed.length} baris dimuat`);
      setShowPanel(false);
    } catch (e) {
      console.error('[Subtitle]', e);
      setError(`Gagal: ${e.message}`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const resetTimer = () => {
    setElapsed(0);
    startRef.current = Date.now();
  };

  const grouped = groupByLang(allSubs);

  return (
    <>
      {/* Subtitle display */}
      {cues.length > 0 && enabled && (
        <div style={{
          minHeight: '52px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '6px 8px',
        }}>
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.87)',
            color: '#fff', padding: '7px 22px',
            borderRadius: '6px', fontSize: `${fontSize}px`,
            lineHeight: 1.5, textAlign: 'center',
            maxWidth: '94%', whiteSpace: 'pre-line',
            textShadow: '1px 1px 4px #000',
            opacity: currentCue ? 1 : 0,
            transition: 'opacity 0.12s',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            {currentCue?.text || '\u00A0'}
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 0', flexWrap: 'wrap',
        borderTop: '1px solid #1f1f1f', marginTop: '4px',
      }}>
        <button onClick={() => setEnabled(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          backgroundColor: enabled ? 'var(--primary-color,#e50914)' : '#2a2a2a',
          color: '#fff', fontSize: '0.8rem', fontWeight: 600,
          transition: 'background 0.2s',
        }}>
          <Subtitles size={15} /> CC {enabled ? 'ON' : 'OFF'}
        </button>

        <button onClick={() => setShowPanel(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '5px 12px', borderRadius: '6px',
          border: '1px solid #333', backgroundColor: '#1a1a1a',
          color: '#fff', fontSize: '0.78rem', cursor: 'pointer',
        }}>
          {listLoading
            ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
            : <ChevronDown size={13} style={{ transform: showPanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          }
          {selected ? getLang(selected.lang) : 'Subtitle'}
        </button>

        <button onClick={() => setRetryKey(k => k + 1)} title="Refresh daftar subtitle"
          style={{ ...mBtn, display: 'flex', alignItems: 'center', padding: '5px 8px' }}>
          <RefreshCw size={12} />
        </button>

        {status && (
          <span style={{ fontSize: '0.72rem', color: status.startsWith('✓') ? '#4ade80' : '#aaa' }}>
            {status}
          </span>
        )}
        {error && !showPanel && (
          <span style={{ fontSize: '0.72rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={12} /> {error}
          </span>
        )}

        {cues.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.7rem', color: '#555' }}>Timing:</span>
            <button onClick={() => setOffset(o => +(o - 0.5).toFixed(1))} style={mBtn}>-0.5s</button>
            <span style={{ fontSize: '0.72rem', minWidth: '42px', textAlign: 'center', color: offset !== 0 ? '#facc15' : '#444' }}>
              {offset > 0 ? '+' : ''}{offset.toFixed(1)}s
            </span>
            <button onClick={() => setOffset(o => +(o + 0.5).toFixed(1))} style={mBtn}>+0.5s</button>
            {offset !== 0 && <button onClick={() => setOffset(0)} style={{ ...mBtn, color: '#f87171' }}>✕</button>}
            <span style={{ fontSize: '0.7rem', color: '#555', marginLeft: '4px' }}>Ukuran:</span>
            <button onClick={() => setFontSize(s => Math.max(12, s - 2))} style={mBtn}>A-</button>
            <span style={{ fontSize: '0.72rem', color: '#888', minWidth: '22px', textAlign: 'center' }}>{fontSize}</span>
            <button onClick={() => setFontSize(s => Math.min(36, s + 2))} style={mBtn}>A+</button>
            <button onClick={resetTimer} style={{ ...mBtn, padding: '3px 8px' }} title="Reset timer">↺</button>
          </div>
        )}
      </div>

      {/* Picker panel */}
      {showPanel && (
        <div style={{
          backgroundColor: '#0e0e0e', border: '1px solid #222',
          borderRadius: '12px', padding: '16px', marginTop: '6px',
          maxHeight: '380px', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
              Pilih Subtitle
              {allSubs.length > 0 && (
                <span style={{ color: '#555', fontWeight: 400, fontSize: '0.77rem', marginLeft: '6px' }}>
                  ({allSubs.length})
                </span>
              )}
            </h3>
            <button onClick={() => setShowPanel(false)}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>
              <X size={17} />
            </button>
          </div>

          {listLoading && (
            <div style={{ textAlign: 'center', padding: '32px', color: '#555' }}>
              <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: '10px', fontSize: '0.82rem' }}>Mencari subtitle...</div>
            </div>
          )}

          {!listLoading && allSubs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px' }}>
              <AlertCircle size={36} style={{ color: '#444', marginBottom: '12px' }} />
              <div style={{ color: '#777', fontSize: '0.85rem', marginBottom: '8px' }}>Subtitle belum tersedia</div>
              <div style={{ color: '#444', fontSize: '0.75rem', lineHeight: 1.6 }}>
                Film baru biasanya belum memiliki subtitle.<br />
                Coba beberapa hari lagi atau klik ↻ untuk refresh.
              </div>
            </div>
          )}

          {error && (
            <div style={{
              backgroundColor: '#1a0a0a', border: '1px solid #3a1a1a',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '12px',
              fontSize: '0.78rem', color: '#f87171',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          {!listLoading && grouped.map(([lang, subs]) => (
            <div key={lang} style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '0.7rem', color: '#555', marginBottom: '6px',
                textTransform: 'uppercase', letterSpacing: '0.8px',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                {getLang(lang)}
                <span style={{ color: '#333' }}>({subs.length})</span>
                {isIndo(lang) && (
                  <span style={{
                    backgroundColor: '#0f2a0f', color: '#4ade80',
                    fontSize: '0.62rem', padding: '0 6px', borderRadius: '3px',
                    border: '1px solid #1a4a1a',
                  }}>Rekomendasi</span>
                )}
              </div>
              {subs.slice(0, 8).map((sub, i) => {
                const isSel = selected?.id === sub.id;
                const isLd  = loading && isSel;
                return (
                  <button key={sub.id || i} onClick={() => handleLoad(sub)} disabled={loading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '9px 12px', marginBottom: '4px',
                      backgroundColor: isSel ? '#0c1a3a' : '#141414',
                      border: `1px solid ${isSel ? '#1e40af' : '#222'}`,
                      borderRadius: '8px', color: '#fff',
                      cursor: loading ? 'wait' : 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}>
                    <div style={{ width: '16px', flexShrink: 0 }}>
                      {isSel && !isLd && <Check size={14} style={{ color: '#4ade80' }} />}
                      {isLd  && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSel ? '#93c5fd' : '#ddd' }}>
                        {sub.name}
                      </div>
                      <div style={{ fontSize: '0.67rem', color: '#555', marginTop: '2px', display: 'flex', gap: '8px' }}>
                        <span style={{ color: sub.source === 'os' ? '#818cf8' : '#666' }}>
                          {sub.source === 'os' ? 'OpenSubtitles' : 'SUBDL'}
                        </span>
                        {sub.downloads > 0 && <span>↓ {sub.downloads.toLocaleString()}</span>}
                        {sub.hi && <span>♿ HI</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}

          <p style={{ fontSize: '0.67rem', color: '#2a2a2a', textAlign: 'center', marginTop: '6px' }}>
            Sumber: OpenSubtitles & SUBDL
          </p>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } button:disabled { opacity:0.6; }`}</style>
    </>
  );
};

const mBtn = {
  padding: '3px 8px', borderRadius: '4px',
  border: '1px solid #2a2a2a', backgroundColor: '#141414',
  color: '#aaa', cursor: 'pointer', fontSize: '0.72rem',
};

export default SubtitleOverlay;
