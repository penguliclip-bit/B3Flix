import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SERVERS } from '../../services/api';
import {
  Subtitles, ChevronDown, X, Check, Loader, AlertCircle,
  RefreshCw, Upload, Settings, Zap, Play
} from 'lucide-react';

// ============================================================
//  SUBTITLE ENGINE
//  Pendekatan: overlay langsung di atas iframe (sama seperti Cineby)
//  Timer: manual tapi bisa di-sync dengan tombol "Mulai dari sini"
// ============================================================

const OS_BASE  = 'https://api.opensubtitles.com/api/v1';
const OS_KEY   = 's2LOv0ug7sFWJGPJeO4y8VQ64oX1FCXW';
const OS_AGENT = 'B3Flix v1.0';
const SUBDL_BASE = 'https://api.subdl.com/api/v1';
const SUBDL_DL   = 'https://dl.subdl.com';

const LANG_LABELS = {
  'id':'🇮🇩 Indonesia','ind':'🇮🇩 Indonesia','ID':'🇮🇩 Indonesia','in':'🇮🇩 Indonesia',
  'en':'🇺🇸 English','eng':'🇺🇸 English','EN':'🇺🇸 English',
  'ja':'🇯🇵 Japanese','jpn':'🇯🇵 Japanese','JA':'🇯🇵 Japanese',
  'ko':'🇰🇷 Korean','kor':'🇰🇷 Korean','KO':'🇰🇷 Korean',
  'zh':'🇨🇳 Chinese','zho':'🇨🇳 Chinese',
  'ar':'🇸🇦 Arabic','ara':'🇸🇦 Arabic',
  'es':'🇪🇸 Spanish','spa':'🇪🇸 Spanish',
  'pt':'🇧🇷 Portuguese','por':'🇧🇷 Portuguese',
  'fr':'🇫🇷 French','fre':'🇫🇷 French',
  'de':'🇩🇪 German','ger':'🇩🇪 German',
};
const getLang  = c => LANG_LABELS[c] || LANG_LABELS[c?.toLowerCase()] || c?.toUpperCase() || '?';
const isIndo   = c => ['id','ind','ID','in','IN'].includes(c);
const isEng    = c => ['en','eng','EN'].includes(c);

// CORS proxy dengan fallback
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

const fetchWithProxy = async (rawUrl) => {
  // Coba langsung
  try {
    const r = await fetch(rawUrl, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const t = await r.text(); if (t?.length > 20) return t; }
  } catch (_) {}
  // Proxy fallback
  for (const mkProxy of PROXIES) {
    try {
      const r = await fetch(mkProxy(rawUrl), { signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const j = await r.json();
        if (j?.contents?.length > 20) return j.contents;
      } else {
        const t = await r.text();
        if (t?.length > 20) return t;
      }
    } catch (_) {}
  }
  throw new Error('Tidak bisa mengunduh subtitle — coba subtitle lain');
};

// ZIP extractor (untuk SUBDL yang sering kirim .zip)
const extractSrtFromZip = async (zipUrl) => {
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(zipUrl)}`;
  const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('ZIP tidak bisa diunduh');
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf);
  let i = 0;
  while (i < b.length - 30) {
    if (b[i]===0x50&&b[i+1]===0x4B&&b[i+2]===0x03&&b[i+3]===0x04) {
      const comp = b[i+8]|(b[i+9]<<8);
      const csz  = b[i+18]|(b[i+19]<<8)|(b[i+20]<<16)|(b[i+21]<<24);
      const fnl  = b[i+26]|(b[i+27]<<8);
      const exl  = b[i+28]|(b[i+29]<<8);
      const fn   = new TextDecoder().decode(b.slice(i+30,i+30+fnl)).toLowerCase();
      const ds   = i+30+fnl+exl;
      const de   = ds+csz;
      if (fn.endsWith('.srt') && comp===0 && de<=b.length) {
        const text = new TextDecoder('utf-8',{fatal:false}).decode(b.slice(ds,de));
        if (text.includes('-->')) return text;
      }
      i = (de>ds&&de<=b.length) ? de : i+1;
    } else i++;
  }
  throw new Error('Tidak ada .srt di dalam ZIP');
};

// OpenSubtitles search
const searchOS = async (tmdbId, type, season, episode) => {
  try {
    const u = new URL(`${OS_BASE}/subtitles`);
    u.searchParams.set('tmdb_id', tmdbId);
    u.searchParams.set('type', type==='tv'?'episode':'movie');
    u.searchParams.set('languages', 'id,en,ja,ko,zh,es,pt,fr,de,ar');
    u.searchParams.set('order_by', 'download_count');
    if (season)  u.searchParams.set('season_number', season);
    if (episode) u.searchParams.set('episode_number', episode);
    const r = await fetch(u.toString(), {
      headers:{'Api-Key':OS_KEY,'User-Agent':OS_AGENT},
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`OS ${r.status}`);
    const d = await r.json();
    return (d.data||[]).map(s=>({
      source:'os', id:`os-${s.id}`,
      lang: s.attributes?.language||'en',
      name: s.attributes?.release||s.attributes?.files?.[0]?.file_name||'Subtitle',
      downloads: s.attributes?.download_count||0,
      fileId: s.attributes?.files?.[0]?.file_id,
      hi: s.attributes?.hearing_impaired||false,
    }));
  } catch(e) { console.warn('[OS]',e.message); return []; }
};

// SUBDL search
const searchSubdl = async (tmdbId, type) => {
  try {
    const r = await fetch(
      `${SUBDL_BASE}/subtitles?tmdb_id=${tmdbId}&type=${type}&langs=ID,EN,JA,KO,ZH&full_season=0`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error(`SUBDL ${r.status}`);
    const d = await r.json();
    return (d.subtitles||[]).map(s=>({
      source:'subdl', id:`subdl-${s.sd_id||s.url}`,
      lang: s.lang||'EN', name: s.release_name||s.name||'Subtitle',
      downloads: s.downloads||0, hi: s.hi||false, url: s.url,
    }));
  } catch(e) { console.warn('[SUBDL]',e.message); return []; }
};

// Fetch + parse subtitle file
const loadSubtitle = async (sub) => {
  let text = '';
  if (sub.source==='os') {
    const r = await fetch(`${OS_BASE}/download`,{
      method:'POST',
      headers:{'Api-Key':OS_KEY,'User-Agent':OS_AGENT,'Content-Type':'application/json'},
      body: JSON.stringify({file_id: sub.fileId}),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Token gagal (${r.status})`);
    const d = await r.json();
    if (!d.link) throw new Error('Link kosong dari OpenSubtitles');
    text = await fetchWithProxy(d.link);
  } else {
    const url = `${SUBDL_DL}${sub.url}`;
    if (sub.url?.includes('.zip')) {
      text = await extractSrtFromZip(url);
    } else {
      text = await fetchWithProxy(url);
      if (text?.startsWith('PK') || text?.charCodeAt(0)===0x50)
        text = await extractSrtFromZip(url);
    }
  }
  if (!text||text.length<10) throw new Error('File subtitle kosong');
  const cues = parseSrt(text);
  if (!cues.length) throw new Error('Format tidak dikenali');
  return cues;
};

// SRT parser
const parseSrt = (raw) => {
  if (!raw) return [];
  return raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split(/\n\n+/).filter(Boolean)
    .map(block => {
      const lines = block.trim().split('\n');
      const ti = lines.findIndex(l=>l.includes('-->'));
      if (ti===-1) return null;
      const [st,et] = lines[ti].split('-->').map(s=>s.trim());
      const txt = lines.slice(ti+1).join('\n')
        .replace(/<[^>]+>/g,'').replace(/\{[^}]+\}/g,'')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
      if (!txt) return null;
      return { start: toSec(st), end: toSec(et), text: txt };
    }).filter(Boolean);
};
const toSec = s => {
  if (!s) return 0;
  const [h,m,sec] = s.replace(',','.').split(':');
  return +h*3600 + +m*60 + parseFloat(sec||0);
};

// Merge + deduplicate + sort subs
const mergeSubs = (a, b) => {
  const seen = new Set();
  return [...a,...b].filter(s=>{
    if(seen.has(s.id)) return false; seen.add(s.id); return true;
  }).sort((x,y)=>{
    const p = s => isIndo(s.lang)?0 : isEng(s.lang)?1 : 2;
    return p(x)-p(y) || y.downloads-x.downloads;
  });
};

const groupByLang = subs => {
  const map = {};
  const order = ['id','in','ind','ID','en','EN','eng'];
  subs.forEach(s=>{ if(!map[s.lang]) map[s.lang]=[]; map[s.lang].push(s); });
  return Object.entries(map).sort(([a],[b])=>{
    const ai=order.indexOf(a), bi=order.indexOf(b);
    return (ai===-1?99:ai)-(bi===-1?99:bi);
  });
};

// ============================================================
//  MAIN VideoPlayer Component
// ============================================================
const VideoPlayer = ({ url, tmdbId, mediaType='movie', season=null, episode=null, onServerChange }) => {
  // Player state
  const [activeServer, setActiveServer] = useState(SERVERS[0].id);
  const [currentUrl, setCurrentUrl]     = useState(url);
  const [iframeLoading, setIframeLoading] = useState(true);

  // Subtitle list state
  const [allSubs, setAllSubs]           = useState([]);
  const [listLoading, setListLoading]   = useState(false);
  const [listError, setListError]       = useState('');
  const [retryKey, setRetryKey]         = useState(0);

  // Active subtitle state
  const [selected, setSelected]         = useState(null);
  const [cues, setCues]                 = useState([]);
  const [currentCue, setCurrentCue]     = useState(null);
  const [subLoading, setSubLoading]     = useState(false);
  const [subError, setSubError]         = useState('');

  // Timer state
  const [elapsed, setElapsed]           = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [offset, setOffset]             = useState(0);

  // UI state
  const [showSubPanel, setShowSubPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [subEnabled, setSubEnabled]     = useState(true);
  const [fontSize, setFontSize]         = useState(22);
  const [subPosition, setSubPosition]   = useState(88); // % dari atas
  const [uploadedSubs, setUploadedSubs] = useState(null);

  const timerRef   = useRef(null);
  const startRef   = useRef(null);
  const fileInputRef = useRef(null);

  // ── URL update ketika prop berubah ───────────────────────────────────────
  useEffect(() => { setCurrentUrl(url); setIframeLoading(true); }, [url]);

  // ── Timer ────────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startRef.current = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 150);
    setIsTimerRunning(true);
  }, [elapsed]);

  const pauseTimer = () => {
    clearInterval(timerRef.current);
    setIsTimerRunning(false);
  };

  const resetTimer = () => {
    clearInterval(timerRef.current);
    setElapsed(0);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 150);
    setIsTimerRunning(true);
  };

  const seekTimer = (sec) => {
    const newElapsed = Math.max(0, elapsed + sec);
    setElapsed(newElapsed);
    startRef.current = Date.now() - newElapsed * 1000;
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Active cue ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cues.length || !subEnabled) { setCurrentCue(null); return; }
    const t = elapsed + offset;
    setCurrentCue(cues.find(c => t >= c.start && t <= c.end) || null);
  }, [elapsed, cues, subEnabled, offset]);

  // ── Load subtitle list ───────────────────────────────────────────────────
  useEffect(() => {
    if (!tmdbId) return;
    setAllSubs([]); setSelected(null); setCues([]); setCurrentCue(null);
    setListError(''); setSubError('');
    setListLoading(true);

    const s = mediaType==='tv' ? season  : null;
    const e = mediaType==='tv' ? episode : null;

    Promise.all([searchOS(tmdbId, mediaType, s, e), searchSubdl(tmdbId, mediaType)])
      .then(([os, sdl]) => {
        const merged = mergeSubs(os, sdl);
        setAllSubs(merged);
        if (!merged.length) setListError('Subtitle belum tersedia untuk konten ini');
      })
      .catch(() => setListError('Gagal memuat daftar subtitle'))
      .finally(() => setListLoading(false));
  }, [tmdbId, mediaType, season, episode, retryKey]);

  // ── Load subtitle file ───────────────────────────────────────────────────
  const handleLoadSub = async (sub) => {
    setSubLoading(true); setSubError(''); setCues([]); setCurrentCue(null);
    try {
      const parsed = await loadSubtitle(sub);
      setCues(parsed);
      setSelected(sub);
      setElapsed(0);
      setOffset(0);
      startTimer();
      setShowSubPanel(false);
    } catch(e) {
      console.error('[Sub]', e);
      setSubError(`Gagal: ${e.message}`);
    } finally { setSubLoading(false); }
  };

  // ── Upload file lokal ────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsed = parseSrt(text);
      if (!parsed.length) { setSubError('File tidak valid atau bukan format SRT'); return; }
      setCues(parsed);
      setSelected({ id:'upload', lang:'custom', name: file.name, source:'upload' });
      setElapsed(0); setOffset(0);
      startTimer();
      setShowSubPanel(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // ── Server switch ────────────────────────────────────────────────────────
  const switchServer = (server) => {
    setActiveServer(server.id);
    setIframeLoading(true);
    const newUrl = server.getUrl(tmdbId, mediaType, season, episode);
    setCurrentUrl(newUrl);
    if (onServerChange) onServerChange(server.id, newUrl);
  };

  const grouped = groupByLang(allSubs);
  const indoCount = allSubs.filter(s => isIndo(s.lang)).length;

  // ── Format time ──────────────────────────────────────────────────────────
  const fmtTime = s => {
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  };

  // ============================================================
  //  RENDER
  // ============================================================
  if (!url && !tmdbId) return (
    <div style={{ width:'100%', height:'400px', background:'#0a0a0a', display:'flex',
      justifyContent:'center', alignItems:'center', color:'#555', borderRadius:'8px',
      fontSize:'0.9rem', gap:'8px' }}>
      <Play size={18} /> Tidak ada sumber video
    </div>
  );

  return (
    <div style={{ width:'100%', userSelect:'none' }}>

      {/* ═══ SERVER SELECTOR ═══ */}
      <div style={{
        display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap', alignItems:'center',
      }}>
        <span style={{ color:'#555', fontSize:'0.75rem', fontWeight:600, letterSpacing:'0.5px' }}>
          SERVER:
        </span>
        {SERVERS.map(server => {
          const isActive = activeServer === server.id;
          return (
            <button key={server.id} onClick={() => switchServer(server)} style={{
              padding:'5px 14px', borderRadius:'20px', fontSize:'0.76rem', cursor:'pointer',
              border: isActive ? '1.5px solid var(--primary-color,#e50914)' : '1.5px solid #2a2a2a',
              background: isActive ? 'var(--primary-color,#e50914)' : '#181818',
              color:'#fff', fontWeight: isActive ? 700 : 400,
              transition:'all 0.18s', whiteSpace:'nowrap',
            }}>
              {server.name} <span style={{opacity:0.75, fontSize:'0.7rem'}}>{server.label}</span>
            </button>
          );
        })}
        <span style={{ color:'#383838', fontSize:'0.68rem', marginLeft:'auto' }}>
          💡 Iklan banyak? Ganti server
        </span>
      </div>

      {/* ═══ PLAYER WRAPPER (iframe + subtitle overlay) ═══ */}
      <div style={{
        position:'relative', paddingTop:'56.25%', background:'#000',
        borderRadius:'8px', overflow:'hidden',
      }}>
        {/* Loading spinner */}
        {iframeLoading && (
          <div style={{
            position:'absolute', inset:0, background:'#0a0a0a', zIndex:2,
            display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', gap:'14px',
          }}>
            <div style={{
              width:'44px', height:'44px', borderRadius:'50%',
              border:'4px solid #1f1f1f',
              borderTop:'4px solid var(--primary-color,#e50914)',
              animation:'b3spin 0.75s linear infinite',
            }} />
            <span style={{ color:'#555', fontSize:'0.8rem' }}>Memuat player...</span>
          </div>
        )}

        {/* IFRAME */}
        <iframe
          key={currentUrl}
          src={currentUrl || url}
          style={{
            position:'absolute', top:0, left:0,
            width:'100%', height:'100%', border:'none',
            opacity: iframeLoading ? 0 : 1, transition:'opacity 0.3s',
          }}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="no-referrer"
          onLoad={() => setIframeLoading(false)}
          title="B3Flix Player"
        />

        {/* ══ SUBTITLE OVERLAY (langsung di atas video) ══ */}
        {cues.length > 0 && subEnabled && (
          <div style={{
            position:'absolute', left:'50%', transform:'translateX(-50%)',
            top:`${subPosition}%`, width:'92%',
            display:'flex', justifyContent:'center',
            zIndex:3, pointerEvents:'none',
          }}>
            <div style={{
              backgroundColor: currentCue ? 'rgba(0,0,0,0.82)' : 'transparent',
              color:'#fff', padding: currentCue ? '6px 20px' : '0',
              borderRadius:'5px', fontSize:`${fontSize}px`,
              lineHeight:1.5, textAlign:'center',
              maxWidth:'100%', whiteSpace:'pre-line',
              textShadow:'0 1px 4px #000, 0 0 8px rgba(0,0,0,0.8)',
              transition:'opacity 0.1s',
              opacity: currentCue ? 1 : 0,
              border: currentCue ? '1px solid rgba(255,255,255,0.06)' : 'none',
              fontWeight: 500,
              letterSpacing: '0.01em',
            }}>
              {currentCue?.text || '\u00A0'}
            </div>
          </div>
        )}

        {/* ══ SUBTITLE CONTROLS (pojok kanan bawah) ══ */}
        <div style={{
          position:'absolute', bottom:'8px', right:'8px', zIndex:4,
          display:'flex', gap:'6px', alignItems:'center',
        }}>
          {/* CC toggle */}
          <button
            onClick={() => setSubEnabled(v=>!v)}
            title={subEnabled ? 'Matikan subtitle' : 'Nyalakan subtitle'}
            style={{
              display:'flex', alignItems:'center', gap:'5px',
              padding:'5px 10px', borderRadius:'6px', border:'none',
              background: subEnabled
                ? 'var(--primary-color,#e50914)'
                : 'rgba(0,0,0,0.7)',
              color:'#fff', fontSize:'0.75rem', fontWeight:700,
              cursor:'pointer', backdropFilter:'blur(4px)',
              border: subEnabled ? 'none' : '1px solid rgba(255,255,255,0.2)',
              transition:'all 0.2s',
            }}>
            <Subtitles size={14} />
            CC
          </button>

          {/* Sub picker */}
          <button
            onClick={() => { setShowSubPanel(v=>!v); setShowSettings(false); }}
            style={{
              display:'flex', alignItems:'center', gap:'5px',
              padding:'5px 10px', borderRadius:'6px',
              background:'rgba(0,0,0,0.7)', color:'#fff',
              border:'1px solid rgba(255,255,255,0.2)',
              fontSize:'0.73rem', cursor:'pointer',
              backdropFilter:'blur(4px)',
            }}>
            {listLoading
              ? <Loader size={12} style={{animation:'b3spin 1s linear infinite'}} />
              : <ChevronDown size={12} />
            }
            {selected ? getLang(selected.lang) : 'Subtitle'}
          </button>

          {/* Settings */}
          <button
            onClick={() => { setShowSettings(v=>!v); setShowSubPanel(false); }}
            title="Pengaturan subtitle"
            style={{
              padding:'5px 8px', borderRadius:'6px',
              background:'rgba(0,0,0,0.7)', color:'#fff',
              border:'1px solid rgba(255,255,255,0.2)',
              cursor:'pointer', backdropFilter:'blur(4px)',
              display:'flex', alignItems:'center',
            }}>
            <Settings size={13} />
          </button>
        </div>

        {/* ══ SUBTITLE PANEL (panel pilih subtitle) ══ */}
        {showSubPanel && (
          <div style={{
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'clamp(280px, 38vw, 420px)',
            background:'rgba(10,10,10,0.97)', backdropFilter:'blur(16px)',
            border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px',
            padding:'16px', maxHeight:'380px', overflowY:'auto',
            boxShadow:'0 8px 32px rgba(0,0,0,0.7)',
          }}>
            <div style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              marginBottom:'14px',
            }}>
              <h3 style={{ margin:0, fontSize:'0.88rem', color:'#fff', fontWeight:600 }}>
                Pilih Subtitle
                {allSubs.length > 0 && (
                  <span style={{ color:'#444', fontWeight:400, fontSize:'0.74rem', marginLeft:'6px' }}>
                    ({allSubs.length} tersedia)
                  </span>
                )}
              </h3>
              <div style={{ display:'flex', gap:'6px' }}>
                <button onClick={() => setRetryKey(k=>k+1)} title="Refresh"
                  style={{ background:'none', border:'none', color:'#555', cursor:'pointer',
                    display:'flex', alignItems:'center', padding:'2px' }}>
                  <RefreshCw size={14} />
                </button>
                <button onClick={() => setShowSubPanel(false)}
                  style={{ background:'none', border:'none', color:'#555', cursor:'pointer', padding:'2px' }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Error */}
            {subError && (
              <div style={{
                background:'#1a0808', border:'1px solid #3a1a1a', borderRadius:'8px',
                padding:'8px 12px', marginBottom:'12px',
                fontSize:'0.75rem', color:'#f87171',
                display:'flex', gap:'8px', alignItems:'center',
              }}>
                <AlertCircle size={13} style={{flexShrink:0}} /> {subError}
              </div>
            )}

            {/* Upload */}
            <input ref={fileInputRef} type="file" accept=".srt,.sub,.vtt"
              style={{display:'none'}} onChange={handleFileUpload} />
            <button onClick={() => fileInputRef.current?.click()} style={{
              width:'100%', padding:'9px 12px', marginBottom:'12px',
              background:'#141414', border:'1px dashed #333',
              borderRadius:'8px', color:'#888', cursor:'pointer',
              fontSize:'0.78rem', display:'flex', alignItems:'center',
              gap:'8px', transition:'all 0.15s',
            }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='#555'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='#333'}
            >
              <Upload size={14} /> Upload subtitle (.srt, .sub, .vtt)
            </button>

            {/* Off option */}
            <button onClick={()=>{ setCues([]); setSelected(null); setCurrentCue(null); setShowSubPanel(false); }}
              style={{
                width:'100%', padding:'9px 12px', marginBottom:'12px',
                background: !selected ? '#0c1a3a' : '#141414',
                border:`1px solid ${!selected ? '#1e40af' : '#222'}`,
                borderRadius:'8px', color: !selected ? '#93c5fd' : '#888',
                cursor:'pointer', fontSize:'0.78rem',
                display:'flex', alignItems:'center', gap:'8px',
              }}>
              <X size={13} /> Off — No Subtitles
            </button>

            {/* Loading */}
            {listLoading && (
              <div style={{ textAlign:'center', padding:'24px', color:'#555' }}>
                <Loader size={22} style={{ animation:'b3spin 1s linear infinite', color:'#666' }} />
                <div style={{ marginTop:'8px', fontSize:'0.8rem' }}>Mencari subtitle...</div>
              </div>
            )}

            {/* Empty */}
            {!listLoading && allSubs.length===0 && (
              <div style={{ textAlign:'center', padding:'20px' }}>
                <AlertCircle size={32} style={{ color:'#333', marginBottom:'10px' }} />
                <div style={{ color:'#666', fontSize:'0.82rem', marginBottom:'6px' }}>
                  {listError || 'Subtitle belum tersedia'}
                </div>
                <div style={{ color:'#444', fontSize:'0.72rem', lineHeight:1.6 }}>
                  Film baru biasanya belum memiliki subtitle.<br/>
                  Coba beberapa hari lagi atau upload manual.
                </div>
              </div>
            )}

            {/* Status badge */}
            {!listLoading && allSubs.length>0 && indoCount>0 && (
              <div style={{
                background:'#0a1a0a', border:'1px solid #1a3a1a',
                borderRadius:'6px', padding:'6px 10px', marginBottom:'12px',
                fontSize:'0.72rem', color:'#4ade80',
                display:'flex', alignItems:'center', gap:'6px',
              }}>
                <Check size={12} /> {indoCount} subtitle Indonesia tersedia
              </div>
            )}

            {/* Subtitle list grouped by language */}
            {!listLoading && grouped.map(([lang, subs]) => (
              <div key={lang} style={{ marginBottom:'16px' }}>
                <div style={{
                  fontSize:'0.68rem', color:'#444', marginBottom:'6px',
                  textTransform:'uppercase', letterSpacing:'1px',
                  display:'flex', alignItems:'center', gap:'6px',
                }}>
                  {getLang(lang)}
                  <span style={{ color:'#333' }}>({subs.length})</span>
                  {isIndo(lang) && (
                    <span style={{
                      background:'#0a2a0a', color:'#4ade80',
                      fontSize:'0.6rem', padding:'0 5px', borderRadius:'3px',
                      border:'1px solid #1a4a1a',
                    }}>Rekomendasi</span>
                  )}
                </div>
                {subs.slice(0, 8).map((sub, i) => {
                  const isSel = selected?.id === sub.id;
                  const isLd  = subLoading && isSel;
                  return (
                    <button key={sub.id||i} onClick={()=>handleLoadSub(sub)}
                      disabled={subLoading}
                      style={{
                        display:'flex', alignItems:'center', gap:'10px',
                        width:'100%', padding:'8px 10px', marginBottom:'3px',
                        background: isSel ? '#0c1a3a' : '#111',
                        border:`1px solid ${isSel ? '#1e40af' : '#1f1f1f'}`,
                        borderRadius:'7px', color:'#fff', cursor: subLoading?'wait':'pointer',
                        textAlign:'left', transition:'all 0.15s',
                      }}
                      onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.borderColor='#2a2a2a'; }}
                      onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.borderColor='#1f1f1f'; }}
                    >
                      <div style={{ width:'15px', flexShrink:0 }}>
                        {isSel&&!isLd && <Check size={13} style={{color:'#4ade80'}} />}
                        {isLd && <Loader size={13} style={{animation:'b3spin 1s linear infinite'}} />}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{
                          fontSize:'0.78rem', overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap',
                          color: isSel ? '#93c5fd' : '#ccc',
                        }}>
                          {sub.name}
                        </div>
                        <div style={{ fontSize:'0.64rem', color:'#444', marginTop:'1px', display:'flex', gap:'6px' }}>
                          <span style={{ color: sub.source==='os' ? '#6366f1' : '#555' }}>
                            {sub.source==='os' ? 'OpenSubtitles' : 'SUBDL'}
                          </span>
                          {sub.downloads>0 && <span>↓ {sub.downloads.toLocaleString()}</span>}
                          {sub.hi && <span>♿</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* ══ SETTINGS PANEL ══ */}
        {showSettings && (
          <div style={{
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'260px',
            background:'rgba(10,10,10,0.97)', backdropFilter:'blur(16px)',
            border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px',
            padding:'16px', boxShadow:'0 8px 32px rgba(0,0,0,0.7)',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px' }}>
              <h3 style={{ margin:0, fontSize:'0.88rem', color:'#fff', fontWeight:600 }}>Pengaturan Subtitle</h3>
              <button onClick={()=>setShowSettings(false)}
                style={{ background:'none', border:'none', color:'#555', cursor:'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {/* Font size */}
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'0.72rem', color:'#666', display:'block', marginBottom:'6px' }}>
                Ukuran Teks: <span style={{ color:'#aaa' }}>{fontSize}px</span>
              </label>
              <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                <button onClick={()=>setFontSize(s=>Math.max(12,s-2))} style={sBtn}>A-</button>
                <input type="range" min="12" max="36" value={fontSize}
                  onChange={e=>setFontSize(+e.target.value)}
                  style={{ flex:1, accentColor:'var(--primary-color,#e50914)' }} />
                <button onClick={()=>setFontSize(s=>Math.min(36,s+2))} style={sBtn}>A+</button>
              </div>
            </div>

            {/* Posisi vertikal */}
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'0.72rem', color:'#666', display:'block', marginBottom:'6px' }}>
                Posisi: <span style={{ color:'#aaa' }}>{subPosition === 88 ? 'Bawah' : subPosition < 50 ? 'Atas' : 'Tengah'}</span>
              </label>
              <input type="range" min="5" max="92" value={subPosition}
                onChange={e=>setSubPosition(+e.target.value)}
                style={{ width:'100%', accentColor:'var(--primary-color,#e50914)' }} />
            </div>

            {/* Timing offset */}
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'0.72rem', color:'#666', display:'block', marginBottom:'6px' }}>
                Sinkronisasi: <span style={{ color: offset!==0 ? '#facc15' : '#aaa' }}>
                  {offset > 0 ? '+' : ''}{offset.toFixed(1)}s
                </span>
              </label>
              <div style={{ display:'flex', gap:'6px' }}>
                <button onClick={()=>setOffset(o=>+(o-0.5).toFixed(1))} style={sBtn}>-0.5s</button>
                <button onClick={()=>setOffset(o=>+(o+0.5).toFixed(1))} style={sBtn}>+0.5s</button>
                {offset!==0 && (
                  <button onClick={()=>setOffset(0)} style={{ ...sBtn, color:'#f87171' }}>Reset</button>
                )}
              </div>
            </div>

            {/* Timer controls */}
            {cues.length > 0 && (
              <div>
                <label style={{ fontSize:'0.72rem', color:'#666', display:'block', marginBottom:'6px' }}>
                  Timer: <span style={{ color:'#aaa' }}>{fmtTime(elapsed)}</span>
                  {isTimerRunning
                    ? <span style={{ color:'#4ade80', fontSize:'0.65rem', marginLeft:'6px' }}>● Live</span>
                    : <span style={{ color:'#666', fontSize:'0.65rem', marginLeft:'6px' }}>⏸ Paused</span>
                  }
                </label>
                <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                  {isTimerRunning
                    ? <button onClick={pauseTimer} style={sBtn}>⏸ Pause</button>
                    : <button onClick={startTimer} style={sBtn}>▶ Lanjut</button>
                  }
                  <button onClick={resetTimer} style={sBtn}>↺ Reset ke 0:00</button>
                  <button onClick={()=>seekTimer(-5)} style={sBtn}>-5s</button>
                  <button onClick={()=>seekTimer(5)} style={sBtn}>+5s</button>
                </div>
                <p style={{ fontSize:'0.65rem', color:'#444', marginTop:'8px', lineHeight:1.5 }}>
                  💡 Klik "Reset ke 0:00" ketika video mulai diputar agar subtitle sync.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ SUBTITLE STATUS BAR (bawah player) ═══ */}
      {cues.length > 0 && (
        <div style={{
          display:'flex', alignItems:'center', gap:'8px',
          padding:'6px 4px', marginTop:'6px',
          borderTop:'1px solid #1a1a1a', flexWrap:'wrap',
        }}>
          <Subtitles size={13} style={{ color:'#555' }} />
          <span style={{ fontSize:'0.72rem', color:'#4ade80' }}>
            ✓ {getLang(selected?.lang)} — {cues.length} baris dimuat
          </span>
          <span style={{ fontSize:'0.72rem', color:'#555' }}>
            | {fmtTime(elapsed)}
            {offset !== 0 && ` | offset ${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}
          </span>
          {!isTimerRunning && (
            <span style={{
              fontSize:'0.68rem', color:'#f87171',
              display:'flex', alignItems:'center', gap:'4px',
            }}>
              <Zap size={11} /> Timer paused — klik ▶ di Pengaturan
            </span>
          )}
        </div>
      )}

      <style>{`
        @keyframes b3spin { to { transform: rotate(360deg); } }
        button:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

const sBtn = {
  padding:'4px 10px', borderRadius:'5px',
  border:'1px solid #2a2a2a', background:'#141414',
  color:'#aaa', cursor:'pointer', fontSize:'0.71rem',
  whiteSpace:'nowrap',
};

export default VideoPlayer;
