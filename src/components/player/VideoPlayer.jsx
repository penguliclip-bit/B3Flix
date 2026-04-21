import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SERVERS } from '../../services/api';
import {
  Subtitles, ChevronDown, X, Check, Loader, AlertCircle,
  RefreshCw, Upload, Settings, Zap, Bug
} from 'lucide-react';

// ============================================================
//  SUBTITLE ENGINE v3
//  Sources:
//    1. OpenSubtitles REST (legacy) - no key, no CORS issue via proxy
//    2. OpenSubtitles API v1 - dengan key
//    3. SUBDL - no key, ZIP format
//  Proxy: corsproxy.io (primary), allorigins.win (fallback)
// ============================================================

// ── Konfigurasi ─────────────────────────────────────────────────────────
const OS_API_KEY  = 's2LOv0ug7sFWJGPJeO4y8VQ64oX1FCXW';
const OS_API_BASE = 'https://api.opensubtitles.com/api/v1';
const OS_LEGACY   = 'https://rest.opensubtitles.org/search';
const SUBDL_BASE  = 'https://api.subdl.com/api/v1';
const SUBDL_DL    = 'https://dl.subdl.com';
const TMDB_KEY    = '1f54bd990f1cdfb230adb312546d765d';

// ── CORS proxy list ──────────────────────────────────────────────────────
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
];

// ── Language labels ──────────────────────────────────────────────────────
const LANG = {
  id:'🇮🇩 Indonesia', ind:'🇮🇩 Indonesia', ID:'🇮🇩 Indonesia',
  en:'🇺🇸 English', eng:'🇺🇸 English', EN:'🇺🇸 English',
  ja:'🇯🇵 Japanese', jpn:'🇯🇵 Japanese',
  ko:'🇰🇷 Korean', kor:'🇰🇷 Korean',
  zh:'🇨🇳 Chinese', zho:'🇨🇳 Chinese',
  ar:'🇸🇦 Arabic', ara:'🇸🇦 Arabic',
  es:'🇪🇸 Spanish', spa:'🇪🇸 Spanish',
  pt:'🇧🇷 Portuguese', por:'🇧🇷 Portuguese',
  fr:'🇫🇷 French', de:'🇩🇪 German',
};
const getLang  = c => LANG[c] || LANG[c?.toLowerCase()] || c?.toUpperCase() || '?';
const isIndo   = c => ['id','ind','ID'].includes(c);
const isEng    = c => ['en','eng','EN'].includes(c);

// ── Fetch dengan CORS proxy ──────────────────────────────────────────────
const fetchWithProxy = async (rawUrl, expectJson = false) => {
  const errors = [];

  for (const mkProxy of PROXIES) {
    try {
      const proxyUrl = mkProxy(rawUrl);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) { errors.push(`Proxy ${proxyUrl.split('?')[0]}: ${res.status}`); continue; }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json') || proxyUrl.includes('allorigins')) {
        const j = await res.json().catch(() => null);
        if (j?.contents) return j.contents;   // allorigins wrapper
        if (j && !j.error) return JSON.stringify(j);
      }
      const t = await res.text();
      if (t && t.length > 10) return t;
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`Semua proxy gagal: ${errors.slice(0,2).join(' | ')}`);
};

// ── OpenSubtitles v1 API (modern, butuh key) ────────────────────────────
const searchOS = async (tmdbId, type, season, episode) => {
  const logs = [];
  try {
    const u = new URL(`${OS_API_BASE}/subtitles`);
    u.searchParams.set('tmdb_id', tmdbId);
    u.searchParams.set('type', type === 'tv' ? 'episode' : 'movie');
    u.searchParams.set('languages', 'id,en,ja,ko,zh,es,pt,fr,de,ar');
    u.searchParams.set('order_by', 'download_count');
    if (season)  u.searchParams.set('season_number', season);
    if (episode) u.searchParams.set('episode_number', episode);

    const res = await fetch(u.toString(), {
      headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'B3Flix v1.0' },
      signal: AbortSignal.timeout(8000),
    });

    logs.push(`OS API: HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      logs.push(`OS Error: ${body.substring(0, 100)}`);
      return { subs: [], logs };
    }

    const data = await res.json();
    logs.push(`OS: ${data.data?.length || 0} subtitle ditemukan`);
    const subs = (data.data || []).map(s => ({
      source: 'os',
      id: `os-${s.id}`,
      lang: s.attributes?.language || 'en',
      name: s.attributes?.release || s.attributes?.files?.[0]?.file_name || 'Subtitle',
      downloads: s.attributes?.download_count || 0,
      fileId: s.attributes?.files?.[0]?.file_id,
      hi: s.attributes?.hearing_impaired || false,
    }));
    return { subs, logs };
  } catch (e) {
    logs.push(`OS Exception: ${e.message}`);
    return { subs: [], logs };
  }
};

// ── OpenSubtitles Legacy (no key needed) ────────────────────────────────
const searchOSLegacy = async (imdbId, lang = 'ind') => {
  const logs = [];
  try {
    if (!imdbId) { logs.push('Legacy: tidak ada IMDB ID'); return { subs: [], logs }; }
    const cleanId = imdbId.replace('tt', '');
    const url = `${OS_LEGACY}/imdbid-${cleanId}/sublanguageid-${lang}`;
    logs.push(`OS Legacy: ${url}`);

    const text = await fetchWithProxy(url);
    const data = JSON.parse(text);
    logs.push(`OS Legacy: ${data.length || 0} subtitle ditemukan`);

    const subs = (Array.isArray(data) ? data : []).map((s, i) => ({
      source: 'os-legacy',
      id: `osl-${s.IDSubtitle || i}`,
      lang: s.SubLanguageID || lang,
      name: s.SubFileName || s.MovieReleaseName || 'Subtitle',
      downloads: parseInt(s.SubDownloadsCnt) || 0,
      downloadUrl: s.SubDownloadLink || '',
      zipUrl: s.ZipDownloadLink || '',
      hi: s.SubHearingImpaired === '1',
    }));
    return { subs, logs };
  } catch (e) {
    logs.push(`OS Legacy Exception: ${e.message}`);
    return { subs: [], logs };
  }
};

// ── SUBDL ────────────────────────────────────────────────────────────────
const searchSubdl = async (tmdbId, type) => {
  const logs = [];
  try {
    const url = `${SUBDL_BASE}/subtitles?tmdb_id=${tmdbId}&type=${type}&langs=ID,EN,JA,KO&full_season=0`;
    logs.push(`SUBDL: ${url}`);

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    logs.push(`SUBDL: HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      logs.push(`SUBDL Error: ${body.substring(0, 100)}`);
      return { subs: [], logs };
    }
    const data = await res.json();
    logs.push(`SUBDL: ${data.subtitles?.length || 0} subtitle ditemukan`);

    const subs = (data.subtitles || []).map(s => ({
      source: 'subdl',
      id: `subdl-${s.sd_id || s.url}`,
      lang: s.lang || 'EN',
      name: s.release_name || s.name || 'Subtitle',
      downloads: s.downloads || 0,
      hi: s.hi || false,
      url: s.url,
    }));
    return { subs, logs };
  } catch (e) {
    logs.push(`SUBDL Exception: ${e.message}`);
    return { subs: [], logs };
  }
};

// ── Ambil IMDB ID dari TMDB ──────────────────────────────────────────────
const getImdbId = async (tmdbId, type) => {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await r.json();
    return d.imdb_id || null;
  } catch { return null; }
};

// ── ZIP extractor ────────────────────────────────────────────────────────
const extractSrtFromZip = async (zipUrl) => {
  const text = await fetchWithProxy(zipUrl);
  // Coba parse sebagai teks biasa dulu (kadang proxy auto-extract)
  if (text && text.includes('-->')) return text;

  // Manual ZIP parse dari binary via ArrayBuffer
  try {
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(zipUrl)}`, {
      signal: AbortSignal.timeout(12000)
    });
    const buf = await res.arrayBuffer();
    const b = new Uint8Array(buf);
    let i = 0;
    while (i < b.length - 30) {
      if (b[i]===0x50&&b[i+1]===0x4B&&b[i+2]===0x03&&b[i+3]===0x04) {
        const comp = b[i+8]|(b[i+9]<<8);
        const csz  = b[i+18]|(b[i+19]<<8)|(b[i+20]<<16)|(b[i+21]<<24);
        const fnl  = b[i+26]|(b[i+27]<<8);
        const exl  = b[i+28]|(b[i+29]<<8);
        const fn   = new TextDecoder().decode(b.slice(i+30,i+30+fnl)).toLowerCase();
        const ds=i+30+fnl+exl, de=ds+csz;
        if (fn.endsWith('.srt')&&comp===0&&de<=b.length) {
          const t = new TextDecoder('utf-8',{fatal:false}).decode(b.slice(ds,de));
          if (t.includes('-->')) return t;
        }
        i=(de>ds&&de<=b.length)?de:i+1;
      } else i++;
    }
  } catch (e) { throw new Error(`ZIP: ${e.message}`); }
  throw new Error('Tidak ada SRT dalam ZIP');
};

// ── Download + parse subtitle ─────────────────────────────────────────────
const loadSubtitle = async (sub) => {
  let text = '';

  if (sub.source === 'os') {
    // Step 1: Dapatkan download link
    const res = await fetch(`${OS_API_BASE}/download`, {
      method: 'POST',
      headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'B3Flix v1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: sub.fileId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Download token gagal: HTTP ${res.status}`);
    const d = await res.json();
    if (!d.link) throw new Error(`Tidak ada link: ${JSON.stringify(d).substring(0,100)}`);
    text = await fetchWithProxy(d.link);

  } else if (sub.source === 'os-legacy') {
    // Legacy: langsung ada URL
    const url = sub.zipUrl || sub.downloadUrl;
    if (!url) throw new Error('URL tidak ada di subtitle ini');
    const fetchedText = await fetchWithProxy(url);
    // Legacy download link sudah langsung GZip/SRT
    if (fetchedText.includes('-->')) {
      text = fetchedText;
    } else {
      text = await extractSrtFromZip(url);
    }

  } else if (sub.source === 'subdl') {
    const fileUrl = `${SUBDL_DL}${sub.url}`;
    if (sub.url?.includes('.zip')) {
      text = await extractSrtFromZip(fileUrl);
    } else {
      text = await fetchWithProxy(fileUrl);
      if (!text.includes('-->')) text = await extractSrtFromZip(fileUrl);
    }
  }

  if (!text || !text.includes('-->')) throw new Error('Konten bukan format subtitle valid');
  const cues = parseSrt(text);
  if (!cues.length) throw new Error('Tidak ada cue ditemukan setelah parse');
  return cues;
};

// ── SRT Parser ───────────────────────────────────────────────────────────
const parseSrt = (raw) => {
  if (!raw) return [];
  return raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split(/\n\n+/).filter(Boolean)
    .map(block => {
      const lines = block.trim().split('\n');
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti === -1) return null;
      const [st, et] = lines[ti].split('-->').map(s => s.trim());
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

const mergeSubs = (arrays) => {
  const seen = new Set();
  return arrays.flat().filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  }).sort((x,y) => {
    const p = s => isIndo(s.lang)?0:isEng(s.lang)?1:2;
    return p(x)-p(y)||y.downloads-x.downloads;
  });
};

const groupByLang = subs => {
  const map = {};
  const order = ['id','ID','ind','en','EN','eng'];
  subs.forEach(s => { if(!map[s.lang]) map[s.lang]=[]; map[s.lang].push(s); });
  return Object.entries(map).sort(([a],[b]) => {
    const ai=order.indexOf(a),bi=order.indexOf(b);
    return (ai<0?99:ai)-(bi<0?99:bi);
  });
};

// ============================================================
//  COMPONENT
// ============================================================
const VideoPlayer = ({ url, tmdbId, mediaType='movie', season=null, episode=null, onServerChange }) => {
  const [activeServer, setActiveServer]     = useState(SERVERS[0].id);
  const [currentUrl, setCurrentUrl]         = useState(url);
  const [iframeLoading, setIframeLoading]   = useState(true);

  const [allSubs, setAllSubs]               = useState([]);
  const [listLoading, setListLoading]       = useState(false);
  const [debugLogs, setDebugLogs]           = useState([]);
  const [showDebug, setShowDebug]           = useState(false);
  const [retryKey, setRetryKey]             = useState(0);

  const [selected, setSelected]             = useState(null);
  const [cues, setCues]                     = useState([]);
  const [currentCue, setCurrentCue]         = useState(null);
  const [subLoading, setSubLoading]         = useState(false);
  const [subError, setSubError]             = useState('');

  const [elapsed, setElapsed]               = useState(0);
  const [isRunning, setIsRunning]           = useState(false);
  const [offset, setOffset]                 = useState(0);

  const [showSubPanel, setShowSubPanel]     = useState(false);
  const [showSettings, setShowSettings]     = useState(false);
  const [subEnabled, setSubEnabled]         = useState(true);
  const [fontSize, setFontSize]             = useState(22);
  const [subPos, setSubPos]                 = useState(88);

  const timerRef  = useRef(null);
  const startRef  = useRef(null);
  const fileRef   = useRef(null);

  useEffect(() => { setCurrentUrl(url); setIframeLoading(true); }, [url]);

  // ── Timer ────────────────────────────────────────────────────────────────
  const startTimer = useCallback((fromElapsed = elapsed) => {
    clearInterval(timerRef.current);
    startRef.current = Date.now() - fromElapsed * 1000;
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 150);
    setIsRunning(true);
  }, [elapsed]);

  const pauseTimer = () => { clearInterval(timerRef.current); setIsRunning(false); };
  const resetTimer = () => { setElapsed(0); startTimer(0); };
  const seekTimer  = s => {
    const n = Math.max(0, elapsed + s);
    setElapsed(n);
    if (isRunning) { clearInterval(timerRef.current); startTimer(n); }
  };
  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Active cue ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cues.length||!subEnabled) { setCurrentCue(null); return; }
    const t = elapsed + offset;
    setCurrentCue(cues.find(c=>t>=c.start&&t<=c.end)||null);
  }, [elapsed, cues, subEnabled, offset]);

  // ── Load list ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tmdbId) return;
    setAllSubs([]); setSelected(null); setCues([]); setCurrentCue(null);
    setDebugLogs([]); setSubError('');
    setListLoading(true);

    const logs = [`[${new Date().toLocaleTimeString()}] Mulai cari subtitle untuk TMDB: ${tmdbId} (${mediaType})`];

    const s = mediaType==='tv' ? season  : null;
    const e = mediaType==='tv' ? episode : null;

    Promise.all([
      searchOS(tmdbId, mediaType, s, e),
      searchSubdl(tmdbId, mediaType),
      getImdbId(tmdbId, mediaType).then(imdbId => {
        logs.push(`IMDB ID: ${imdbId || 'tidak ditemukan'}`);
        if (!imdbId) return { subs: [], logs: [] };
        return Promise.all([
          searchOSLegacy(imdbId, 'ind'),
          searchOSLegacy(imdbId, 'eng'),
        ]).then(([indo, eng]) => ({
          subs: [...indo.subs, ...eng.subs],
          logs: [...indo.logs, ...eng.logs],
        }));
      }),
    ]).then(([os, sdl, legacy]) => {
      const allLogs = [...logs, ...os.logs, ...sdl.logs, ...(legacy.logs||[])];
      const merged = mergeSubs([os.subs, sdl.subs, legacy.subs||[]]);
      allLogs.push(`TOTAL: ${merged.length} subtitle (OS:${os.subs.length} SUBDL:${sdl.subs.length} Legacy:${legacy.subs?.length||0})`);
      setAllSubs(merged);
      setDebugLogs(allLogs);
    }).catch(e => {
      logs.push(`Error: ${e.message}`);
      setDebugLogs(logs);
    }).finally(() => setListLoading(false));
  }, [tmdbId, mediaType, season, episode, retryKey]);

  // ── Load subtitle file ──────────────────────────────────────────────────
  const handleLoadSub = async (sub) => {
    setSubLoading(true); setSubError(''); setCues([]); setCurrentCue(null);
    const log = [`Download: ${sub.source} - ${sub.name}`];
    try {
      const parsed = await loadSubtitle(sub);
      setCues(parsed);
      setSelected(sub);
      setElapsed(0);
      setOffset(0);
      resetTimer();
      setShowSubPanel(false);
      log.push(`✓ Berhasil: ${parsed.length} baris`);
    } catch(e) {
      console.error('[Sub]', e);
      setSubError(e.message);
      log.push(`✗ Gagal: ${e.message}`);
    } finally {
      setSubLoading(false);
      setDebugLogs(p => [...p, ...log]);
    }
  };

  // ── Upload file ─────────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    new FileReader().onload = (ev) => {
      const parsed = parseSrt(ev.target.result);
      if (!parsed.length) { setSubError('File tidak valid (bukan SRT)'); return; }
      setCues(parsed);
      setSelected({ id:'upload', lang:'custom', name: file.name, source:'upload' });
      setElapsed(0); setOffset(0);
      resetTimer();
      setShowSubPanel(false);
    }, new FileReader().readAsText(file, 'UTF-8');
    // Fix: proper file reader
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseSrt(ev.target.result);
      if (!parsed.length) { setSubError('File tidak valid (bukan SRT)'); return; }
      setCues(parsed);
      setSelected({ id:'upload', lang:'custom', name: file.name, source:'upload' });
      setElapsed(0); setOffset(0); resetTimer();
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
  const fmtTime = s => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ width:'100%' }}>

      {/* SERVER BAR */}
      <div style={{ display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ color:'#555', fontSize:'0.73rem', fontWeight:600, letterSpacing:'0.5px' }}>SERVER:</span>
        {SERVERS.map(srv => {
          const active = activeServer === srv.id;
          return (
            <button key={srv.id} onClick={() => switchServer(srv)} style={{
              padding:'5px 14px', borderRadius:'20px', fontSize:'0.76rem', cursor:'pointer',
              border: active ? '1.5px solid var(--primary-color,#e50914)' : '1.5px solid #2a2a2a',
              background: active ? 'var(--primary-color,#e50914)' : '#181818',
              color:'#fff', fontWeight: active ? 700 : 400, transition:'all 0.18s',
            }}>
              {srv.name} <span style={{opacity:0.7, fontSize:'0.7rem'}}>{srv.label}</span>
            </button>
          );
        })}
        <span style={{ color:'#333', fontSize:'0.68rem', marginLeft:'auto' }}>
          💡 Iklan banyak? Ganti server
        </span>
      </div>

      {/* PLAYER AREA */}
      <div style={{ position:'relative', paddingTop:'56.25%', background:'#000', borderRadius:'8px', overflow:'hidden' }}>

        {/* Loading */}
        {iframeLoading && (
          <div style={{ position:'absolute', inset:0, background:'#0a0a0a', zIndex:2,
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'14px' }}>
            <div style={{ width:'44px', height:'44px', borderRadius:'50%',
              border:'4px solid #1f1f1f', borderTop:'4px solid var(--primary-color,#e50914)',
              animation:'b3spin 0.75s linear infinite' }} />
            <span style={{ color:'#555', fontSize:'0.8rem' }}>Memuat player...</span>
          </div>
        )}

        {/* IFRAME */}
        <iframe key={currentUrl} src={currentUrl||url}
          style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', border:'none',
            opacity: iframeLoading ? 0 : 1, transition:'opacity 0.3s' }}
          allowFullScreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="no-referrer" onLoad={()=>setIframeLoading(false)}
          title="B3Flix Player" />

        {/* SUBTITLE OVERLAY di atas video */}
        {cues.length > 0 && subEnabled && (
          <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)',
            top:`${subPos}%`, width:'92%', display:'flex', justifyContent:'center',
            zIndex:3, pointerEvents:'none' }}>
            <div style={{
              backgroundColor: currentCue ? 'rgba(0,0,0,0.83)' : 'transparent',
              color:'#fff', padding: currentCue ? '7px 22px' : 0,
              borderRadius:'5px', fontSize:`${fontSize}px`, lineHeight:1.5,
              textAlign:'center', maxWidth:'100%', whiteSpace:'pre-line',
              textShadow:'0 1px 5px #000', opacity: currentCue ? 1 : 0,
              transition:'opacity 0.1s', fontWeight:500,
              border: currentCue ? '1px solid rgba(255,255,255,0.07)' : 'none',
            }}>
              {currentCue?.text || '\u00A0'}
            </div>
          </div>
        )}

        {/* SUBTITLE CONTROLS - pojok kanan bawah */}
        <div style={{ position:'absolute', bottom:'8px', right:'8px', zIndex:4,
          display:'flex', gap:'5px', alignItems:'center' }}>

          {/* CC Toggle */}
          <button onClick={()=>setSubEnabled(v=>!v)} style={{
            display:'flex', alignItems:'center', gap:'4px',
            padding:'4px 9px', borderRadius:'5px', border:'none', cursor:'pointer',
            background: subEnabled ? 'var(--primary-color,#e50914)' : 'rgba(0,0,0,0.75)',
            color:'#fff', fontSize:'0.73rem', fontWeight:700,
            border: subEnabled?'none':'1px solid rgba(255,255,255,0.2)',
            backdropFilter:'blur(4px)',
          }}>
            <Subtitles size={13}/> CC
          </button>

          {/* Subtitle picker */}
          <button onClick={()=>{setShowSubPanel(v=>!v);setShowSettings(false);}} style={{
            display:'flex', alignItems:'center', gap:'4px',
            padding:'4px 9px', borderRadius:'5px',
            background:'rgba(0,0,0,0.75)', color:'#fff',
            border:'1px solid rgba(255,255,255,0.2)', fontSize:'0.71rem',
            cursor:'pointer', backdropFilter:'blur(4px)',
          }}>
            {listLoading
              ? <Loader size={11} style={{animation:'b3spin 1s linear infinite'}}/>
              : <ChevronDown size={11}/>
            }
            {selected ? getLang(selected.lang) : 'Sub'}
          </button>

          {/* Settings */}
          <button onClick={()=>{setShowSettings(v=>!v);setShowSubPanel(false);}} style={{
            padding:'4px 7px', borderRadius:'5px',
            background:'rgba(0,0,0,0.75)', color:'#fff',
            border:'1px solid rgba(255,255,255,0.2)',
            cursor:'pointer', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center',
          }}>
            <Settings size={12}/>
          </button>

          {/* Debug */}
          <button onClick={()=>setShowDebug(v=>!v)} title="Debug info" style={{
            padding:'4px 7px', borderRadius:'5px',
            background: debugLogs.some(l=>l.includes('✗')||l.includes('Error')||l.includes('gagal'))
              ? 'rgba(239,68,68,0.3)' : 'rgba(0,0,0,0.75)',
            color:'#fff', border:'1px solid rgba(255,255,255,0.15)',
            cursor:'pointer', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center',
          }}>
            <Bug size={11}/>
          </button>
        </div>

        {/* SUBTITLE PANEL */}
        {showSubPanel && (
          <div style={{
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'clamp(270px,36vw,410px)',
            background:'rgba(8,8,8,0.97)', backdropFilter:'blur(20px)',
            border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px',
            padding:'16px', maxHeight:'420px', overflowY:'auto',
            boxShadow:'0 8px 32px rgba(0,0,0,0.8)',
          }}>
            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px' }}>
              <h3 style={{ margin:0, fontSize:'0.88rem', color:'#fff', fontWeight:600 }}>
                Pilih Subtitle
                {allSubs.length > 0 && (
                  <span style={{ color:'#444', fontWeight:400, fontSize:'0.73rem', marginLeft:'6px' }}>
                    ({allSubs.length})
                  </span>
                )}
              </h3>
              <div style={{ display:'flex', gap:'5px' }}>
                <button onClick={()=>setRetryKey(k=>k+1)} title="Refresh"
                  style={{ background:'none', border:'none', color:'#555', cursor:'pointer', padding:'2px' }}>
                  <RefreshCw size={13}/>
                </button>
                <button onClick={()=>setShowSubPanel(false)}
                  style={{ background:'none', border:'none', color:'#555', cursor:'pointer', padding:'2px' }}>
                  <X size={15}/>
                </button>
              </div>
            </div>

            {/* Error */}
            {subError && (
              <div style={{
                background:'#1a0808', border:'1px solid #3a1a1a', borderRadius:'7px',
                padding:'8px 12px', marginBottom:'12px',
                fontSize:'0.74rem', color:'#f87171',
                display:'flex', gap:'7px', alignItems:'flex-start',
              }}>
                <AlertCircle size={13} style={{flexShrink:0,marginTop:'1px'}}/> {subError}
              </div>
            )}

            {/* Upload */}
            <input ref={fileRef} type="file" accept=".srt,.sub,.vtt" style={{display:'none'}} onChange={handleFileUpload}/>
            <button onClick={()=>fileRef.current?.click()} style={{
              width:'100%', padding:'9px 12px', marginBottom:'8px',
              background:'#111', border:'1px dashed #2a2a2a',
              borderRadius:'8px', color:'#777', cursor:'pointer',
              fontSize:'0.77rem', display:'flex', alignItems:'center', gap:'8px',
            }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='#444'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='#2a2a2a'}
            >
              <Upload size={13}/> Upload .srt dari komputer
            </button>

            {/* Off */}
            <button onClick={()=>{setCues([]);setSelected(null);setCurrentCue(null);setShowSubPanel(false);}} style={{
              width:'100%', padding:'9px 12px', marginBottom:'12px',
              background:!selected?'#0c1a3a':'#111',
              border:`1px solid ${!selected?'#1e40af':'#1f1f1f'}`,
              borderRadius:'8px', color:!selected?'#93c5fd':'#666',
              cursor:'pointer', fontSize:'0.77rem',
              display:'flex', alignItems:'center', gap:'8px',
            }}>
              <X size={12}/> Off — No Subtitles
            </button>

            {/* Loading */}
            {listLoading && (
              <div style={{ textAlign:'center', padding:'28px', color:'#555' }}>
                <Loader size={22} style={{animation:'b3spin 1s linear infinite',color:'#555'}}/>
                <div style={{marginTop:'8px', fontSize:'0.78rem'}}>Mencari dari 3 sumber...</div>
              </div>
            )}

            {/* Empty */}
            {!listLoading && allSubs.length===0 && (
              <div style={{ textAlign:'center', padding:'20px' }}>
                <AlertCircle size={32} style={{color:'#333',marginBottom:'10px'}}/>
                <div style={{color:'#666',fontSize:'0.82rem',marginBottom:'6px'}}>
                  Subtitle tidak ditemukan
                </div>
                <div style={{color:'#444',fontSize:'0.72rem',lineHeight:1.6}}>
                  Coba klik 🐛 untuk lihat detail error,<br/>
                  atau upload file .srt manual.
                </div>
              </div>
            )}

            {/* Indo badge */}
            {!listLoading && indoCount > 0 && (
              <div style={{
                background:'#061406', border:'1px solid #1a3a1a',
                borderRadius:'6px', padding:'6px 10px', marginBottom:'12px',
                fontSize:'0.71rem', color:'#4ade80',
                display:'flex', alignItems:'center', gap:'6px',
              }}>
                <Check size={12}/> {indoCount} subtitle Indonesia tersedia
              </div>
            )}

            {/* Subtitle list */}
            {!listLoading && grouped.map(([lang, subs]) => (
              <div key={lang} style={{marginBottom:'14px'}}>
                <div style={{
                  fontSize:'0.67rem', color:'#444', marginBottom:'6px',
                  textTransform:'uppercase', letterSpacing:'1px',
                  display:'flex', alignItems:'center', gap:'6px',
                }}>
                  {getLang(lang)}
                  <span style={{color:'#333'}}>({subs.length})</span>
                  {isIndo(lang) && (
                    <span style={{
                      background:'#061406', color:'#4ade80', fontSize:'0.59rem',
                      padding:'0 5px', borderRadius:'3px', border:'1px solid #1a3a1a',
                    }}>✓ Rekomendasi</span>
                  )}
                </div>
                {subs.slice(0,8).map((sub,i) => {
                  const isSel = selected?.id===sub.id;
                  const isLd  = subLoading && isSel;
                  return (
                    <button key={sub.id||i} onClick={()=>handleLoadSub(sub)}
                      disabled={subLoading} style={{
                        display:'flex', alignItems:'center', gap:'9px',
                        width:'100%', padding:'8px 10px', marginBottom:'3px',
                        background:isSel?'#0c1a3a':'#111',
                        border:`1px solid ${isSel?'#1e40af':'#1a1a1a'}`,
                        borderRadius:'7px', color:'#fff',
                        cursor:subLoading?'wait':'pointer', textAlign:'left',
                        transition:'all 0.15s',
                      }}
                      onMouseEnter={e=>{if(!isSel)e.currentTarget.style.borderColor='#2a2a2a'}}
                      onMouseLeave={e=>{if(!isSel)e.currentTarget.style.borderColor='#1a1a1a'}}
                    >
                      <div style={{width:'14px',flexShrink:0}}>
                        {isSel&&!isLd&&<Check size={12} style={{color:'#4ade80'}}/>}
                        {isLd&&<Loader size={12} style={{animation:'b3spin 1s linear infinite'}}/>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{
                          fontSize:'0.77rem', overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap',
                          color:isSel?'#93c5fd':'#ccc',
                        }}>{sub.name}</div>
                        <div style={{fontSize:'0.63rem',color:'#444',marginTop:'1px',display:'flex',gap:'6px'}}>
                          <span style={{color:sub.source==='os'?'#6366f1':sub.source==='os-legacy'?'#818cf8':'#555'}}>
                            {sub.source==='os'?'OpenSubtitles':sub.source==='os-legacy'?'OS Legacy':'SUBDL'}
                          </span>
                          {sub.downloads>0&&<span>↓ {sub.downloads.toLocaleString()}</span>}
                          {sub.hi&&<span>♿</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* SETTINGS PANEL */}
        {showSettings && (
          <div style={{
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'255px', background:'rgba(8,8,8,0.97)', backdropFilter:'blur(20px)',
            border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px',
            padding:'16px', boxShadow:'0 8px 32px rgba(0,0,0,0.8)',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
              <h3 style={{margin:0,fontSize:'0.86rem',color:'#fff',fontWeight:600}}>Pengaturan</h3>
              <button onClick={()=>setShowSettings(false)}
                style={{background:'none',border:'none',color:'#555',cursor:'pointer'}}>
                <X size={15}/>
              </button>
            </div>

            {/* Font size */}
            <div style={{marginBottom:'12px'}}>
              <label style={{fontSize:'0.7rem',color:'#555',display:'block',marginBottom:'5px'}}>
                Ukuran teks: <span style={{color:'#aaa'}}>{fontSize}px</span>
              </label>
              <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                <button onClick={()=>setFontSize(s=>Math.max(12,s-2))} style={sBtn}>A-</button>
                <input type="range" min="12" max="36" value={fontSize}
                  onChange={e=>setFontSize(+e.target.value)}
                  style={{flex:1,accentColor:'var(--primary-color,#e50914)'}}/>
                <button onClick={()=>setFontSize(s=>Math.min(36,s+2))} style={sBtn}>A+</button>
              </div>
            </div>

            {/* Posisi */}
            <div style={{marginBottom:'12px'}}>
              <label style={{fontSize:'0.7rem',color:'#555',display:'block',marginBottom:'5px'}}>
                Posisi: <span style={{color:'#aaa'}}>{subPos<40?'Atas':subPos>75?'Bawah':'Tengah'}</span>
              </label>
              <input type="range" min="5" max="92" value={subPos}
                onChange={e=>setSubPos(+e.target.value)}
                style={{width:'100%',accentColor:'var(--primary-color,#e50914)'}}/>
            </div>

            {/* Timing */}
            <div style={{marginBottom:'12px'}}>
              <label style={{fontSize:'0.7rem',color:'#555',display:'block',marginBottom:'5px'}}>
                Sinkronisasi: <span style={{color:offset!==0?'#facc15':'#aaa'}}>
                  {offset>0?'+':''}{offset.toFixed(1)}s
                </span>
              </label>
              <div style={{display:'flex',gap:'5px'}}>
                <button onClick={()=>setOffset(o=>+(o-0.5).toFixed(1))} style={sBtn}>-0.5s</button>
                <button onClick={()=>setOffset(o=>+(o+0.5).toFixed(1))} style={sBtn}>+0.5s</button>
                {offset!==0&&<button onClick={()=>setOffset(0)} style={{...sBtn,color:'#f87171'}}>↺</button>}
              </div>
            </div>

            {/* Timer */}
            {cues.length > 0 && (
              <div>
                <label style={{fontSize:'0.7rem',color:'#555',display:'block',marginBottom:'5px'}}>
                  Timer: <span style={{color:'#aaa'}}>{fmtTime(elapsed)}</span>
                  {isRunning
                    ? <span style={{color:'#4ade80',fontSize:'0.62rem',marginLeft:'6px'}}>● Live</span>
                    : <span style={{color:'#555',fontSize:'0.62rem',marginLeft:'6px'}}>⏸</span>
                  }
                </label>
                <div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>
                  {isRunning
                    ? <button onClick={pauseTimer} style={sBtn}>⏸ Pause</button>
                    : <button onClick={()=>startTimer()} style={sBtn}>▶ Play</button>
                  }
                  <button onClick={resetTimer} style={sBtn}>↺ Reset</button>
                  <button onClick={()=>seekTimer(-5)} style={sBtn}>-5s</button>
                  <button onClick={()=>seekTimer(5)} style={sBtn}>+5s</button>
                </div>
                <p style={{fontSize:'0.63rem',color:'#333',marginTop:'8px',lineHeight:1.5}}>
                  Tekan Reset bersamaan saat video mulai
                </p>
              </div>
            )}
          </div>
        )}

        {/* DEBUG PANEL */}
        {showDebug && (
          <div style={{
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'clamp(280px,40vw,480px)',
            background:'rgba(4,8,4,0.98)', backdropFilter:'blur(20px)',
            border:'1px solid #1a3a1a', borderRadius:'12px',
            padding:'14px', maxHeight:'360px', overflowY:'auto',
            boxShadow:'0 8px 32px rgba(0,0,0,0.9)',
            fontFamily:'monospace',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
              <h3 style={{margin:0,fontSize:'0.82rem',color:'#4ade80',fontWeight:600}}>
                🐛 Debug Subtitle
              </h3>
              <button onClick={()=>setShowDebug(false)}
                style={{background:'none',border:'none',color:'#555',cursor:'pointer'}}>
                <X size={14}/>
              </button>
            </div>
            {debugLogs.length === 0 && (
              <div style={{color:'#555',fontSize:'0.72rem'}}>Belum ada log. Refresh halaman atau klik ↻.</div>
            )}
            {debugLogs.map((log, i) => (
              <div key={i} style={{
                fontSize:'0.68rem',
                color: log.includes('✓')||log.includes('TOTAL')?'#4ade80'
                     : log.includes('✗')||log.includes('Error')||log.includes('gagal')||log.includes('FAIL')?'#f87171'
                     : log.includes('IMDB')||log.includes('SUBDL')||log.includes('OS')?'#93c5fd'
                     : '#666',
                padding:'2px 0', borderBottom:'1px solid #111', lineHeight:1.5,
              }}>{log}</div>
            ))}
          </div>
        )}
      </div>

      {/* STATUS BAR */}
      {cues.length > 0 && (
        <div style={{
          display:'flex', alignItems:'center', gap:'8px',
          padding:'5px 2px', marginTop:'5px',
          borderTop:'1px solid #1a1a1a', flexWrap:'wrap',
        }}>
          <Subtitles size={12} style={{color:'#4ade80'}}/>
          <span style={{fontSize:'0.71rem',color:'#4ade80'}}>
            ✓ {getLang(selected?.lang)} — {cues.length} baris
          </span>
          <span style={{fontSize:'0.71rem',color:'#444'}}>
            {fmtTime(elapsed)} {offset!==0&&`| ${offset>0?'+':''}${offset.toFixed(1)}s`}
          </span>
          {!isRunning && (
            <span style={{fontSize:'0.67rem',color:'#f87171',display:'flex',alignItems:'center',gap:'4px'}}>
              <Zap size={10}/> Timer paused
            </span>
          )}
        </div>
      )}

      <style>{`
        @keyframes b3spin { to { transform: rotate(360deg); } }
        button:disabled { opacity:0.5; cursor:not-allowed!important; }
      `}</style>
    </div>
  );
};

const sBtn = {
  padding:'3px 9px', borderRadius:'4px',
  border:'1px solid #222', background:'#111',
  color:'#888', cursor:'pointer', fontSize:'0.7rem',
  whiteSpace:'nowrap',
};

export default VideoPlayer;
