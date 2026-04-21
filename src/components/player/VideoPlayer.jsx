import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SERVERS } from '../../services/api';
import {
  Subtitles, ChevronDown, X, Check, Loader, AlertCircle,
  RefreshCw, Upload, Settings, Bug
} from 'lucide-react';

// ============================================================
//  SUBTITLE ENGINE v6
//  Sources (priority order):
//    1. OpenSubtitles Legacy REST  — imdbid, no key, proxy
//    2. OpenSubtitles API v1       — tmdb, dengan key
//  Download:
//    - SubDownloadLink  → .gz  (gzip-encoded SRT)
//    - ZipDownloadLink  → .zip (DEFLATE compressed)
//  Proxy: corsproxy.io → allorigins → codetabs
// ============================================================

const OS_API_KEY  = 's2LOv0ug7sFWJGPJeO4y8VQ64oX1FCXW';
const OS_API_BASE = 'https://api.opensubtitles.com/api/v1';
const OS_LEGACY   = 'https://rest.opensubtitles.org/search';
const TMDB_KEY    = '1f54bd990f1cdfb230adb312546d765d';

const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

// ── Language maps ────────────────────────────────────────────────────────
const FLAG = { id:'🇮🇩',ind:'🇮🇩',ID:'🇮🇩', en:'🇺🇸',eng:'🇺🇸',EN:'🇺🇸', ja:'🇯🇵',jpn:'🇯🇵', ko:'🇰🇷',kor:'🇰🇷', zh:'🇨🇳',zho:'🇨🇳', ar:'🇸🇦',ara:'🇸🇦', es:'🇪🇸',spa:'🇪🇸', pt:'🇧🇷',por:'🇧🇷', fr:'🇫🇷', de:'🇩🇪' };
const NAME = { id:'Indonesian',ind:'Indonesian',ID:'Indonesian', en:'English',eng:'English',EN:'English', ja:'Japanese',jpn:'Japanese', ko:'Korean',kor:'Korean', zh:'Chinese',zho:'Chinese', ar:'Arabic',ara:'Arabic', es:'Spanish',spa:'Spanish', pt:'Portuguese',por:'Portuguese', fr:'French', de:'German' };
const getLangFlag = c => FLAG[c] || FLAG[c?.toLowerCase()] || '🌐';
const getLangName = c => NAME[c] || NAME[c?.toLowerCase()] || (c?.toUpperCase() || '?');
const isIndo = c => ['id','ind','ID','in','IN'].includes(c);
const isEng  = c => ['en','eng','EN'].includes(c);

// ── CORS fetch — text only ───────────────────────────────────────────────
const proxyFetchText = async (rawUrl) => {
  for (const mkP of PROXIES) {
    try {
      const res = await fetch(mkP(rawUrl), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json') || mkP(rawUrl).includes('allorigins')) {
        const j = await res.json().catch(() => null);
        if (j?.contents && j.contents.length > 20) return j.contents;
      }
      const t = await res.text();
      if (t && t.length > 20) return t;
    } catch (_) {}
  }
  throw new Error('Semua proxy gagal');
};

// ── CORS fetch — ArrayBuffer (untuk binary) ──────────────────────────────
const proxyFetchBinary = async (rawUrl) => {
  // corsproxy.io bisa handle binary
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`;
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Binary fetch HTTP ${res.status}`);
  return res.arrayBuffer();
};

// ── Decompress GZIP dari ArrayBuffer → string ────────────────────────────
const decompressGzip = async (buf) => {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(out);
};

// ── Ekstrak SRT dari ZIP (stored=0 atau DEFLATE=8) ───────────────────────
const extractFromZip = async (buf) => {
  const b = new Uint8Array(buf);
  const decodeName = bytes => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { return new TextDecoder('latin1').decode(bytes); }
  };

  let i = 0;
  while (i < b.length - 30) {
    if (b[i]===0x50 && b[i+1]===0x4B && b[i+2]===0x03 && b[i+3]===0x04) {
      const comp = b[i+8]  | (b[i+9]  << 8);
      const csz  = b[i+18] | (b[i+19] << 8) | (b[i+20] << 16) | (b[i+21] << 24);
      const fnl  = b[i+26] | (b[i+27] << 8);
      const exl  = b[i+28] | (b[i+29] << 8);
      const fn   = decodeName(b.slice(i+30, i+30+fnl)).toLowerCase();
      const ds   = i + 30 + fnl + exl;
      const de   = ds + Math.abs(csz);

      if (fn.endsWith('.srt') && de <= b.length + 4) {
        let text = '';
        try {
          if (comp === 0) {
            // Stored
            text = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(ds, de));
          } else if (comp === 8) {
            // DEFLATE
            const compressed = b.slice(ds, de);
            const ds2 = new DecompressionStream('deflate-raw');
            const w = ds2.writable.getWriter();
            w.write(compressed); w.close();
            const r = ds2.readable.getReader();
            const chunks = [];
            while (true) { const {done,value} = await r.read(); if(done) break; chunks.push(value); }
            const tot = chunks.reduce((s,c) => s+c.length, 0);
            const out = new Uint8Array(tot); let off=0;
            for (const c of chunks) { out.set(c,off); off+=c.length; }
            text = new TextDecoder('utf-8', { fatal: false }).decode(out);
          }
        } catch (_) {}
        if (text && text.includes('-->')) return text;
      }
      i = (de > ds && de <= b.length) ? de : i + 1;
    } else { i++; }
  }
  throw new Error('Tidak ada SRT valid dalam ZIP');
};

// ── Download SRT — auto-detect format (gzip / zip / plain text) ──────────
const downloadSrt = async (url) => {
  // Fetch sebagai binary dulu — paling reliable
  const buf = await proxyFetchBinary(url);
  const magic = new Uint8Array(buf, 0, 4);

  // Magic bytes: gzip = 1F 8B, zip = 50 4B 03 04
  if (magic[0] === 0x1F && magic[1] === 0x8B) {
    // GZIP — SubDownloadLink dari OS Legacy
    return decompressGzip(buf);
  }
  if (magic[0] === 0x50 && magic[1] === 0x4B) {
    // ZIP — ZipDownloadLink
    return extractFromZip(buf);
  }
  // Plain text
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (text.includes('-->')) return text;
  throw new Error('Format tidak dikenali (bukan gzip/zip/srt)');
};

// ── OpenSubtitles Legacy search ──────────────────────────────────────────
const searchOSLegacy = async (imdbId, lang, season, episode) => {
  const logs = [];
  try {
    const cleanId = imdbId.replace('tt', '');
    let url = `${OS_LEGACY}/imdbid-${cleanId}/sublanguageid-${lang}`;
    if (season)  url += `/season-${season}`;
    if (episode) url += `/episode-${episode}`;
    logs.push(`OS Legacy: ${url}`);

    const text = await proxyFetchText(url);
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('JSON parse gagal'); }
    if (!Array.isArray(data)) throw new Error('Response bukan array');
    logs.push(`OS Legacy: ${data.length} subtitle ditemukan`);

    const subs = data.map((s, idx) => ({
      source:      'os-legacy',
      id:          `osl-${s.IDSubtitle || idx}`,
      lang:        s.SubLanguageID || lang,
      name:        s.SubFileName || s.MovieReleaseName || 'Subtitle',
      downloads:   parseInt(s.SubDownloadsCnt) || 0,
      downloadUrl: s.SubDownloadLink || '',   // .gz
      zipUrl:      s.ZipDownloadLink  || '',  // .zip
      hi:          s.SubHearingImpaired === '1',
      matchEp:     !!(season && s.SeriesSeason == season && s.SeriesEpisode == episode),
    }));

    // Sort: episode match dulu, lalu downloads
    subs.sort((a,b) => (b.matchEp - a.matchEp) || (b.downloads - a.downloads));
    return { subs, logs };
  } catch (e) {
    logs.push(`OS Legacy Error: ${e.message}`);
    return { subs: [], logs };
  }
};

// ── OpenSubtitles v1 API search ──────────────────────────────────────────
const searchOSv1 = async (tmdbId, type, season, episode) => {
  const logs = [];
  try {
    const url = new URL(`${OS_API_BASE}/subtitles`);
    url.searchParams.set('tmdb_id', tmdbId);
    url.searchParams.set('type', type === 'tv' ? 'episode' : 'movie');
    url.searchParams.set('languages', 'id,en,ja,ko');
    url.searchParams.set('order_by', 'download_count');
    if (season)  url.searchParams.set('season_number',  season);
    if (episode) url.searchParams.set('episode_number', episode);

    const res = await fetch(url.toString(), {
      headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'B3Flix v1.0' },
      signal: AbortSignal.timeout(8000),
    });
    logs.push(`OS API: HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(()=>'');
      logs.push(`OS Error: ${body.substring(0,120)}`);
      return { subs: [], logs };
    }
    const data = await res.json();
    const subs = (data.data || []).map(s => ({
      source:    'os',
      id:        `os-${s.id}`,
      lang:      s.attributes?.language || 'en',
      name:      s.attributes?.release || s.attributes?.files?.[0]?.file_name || 'Subtitle',
      downloads: s.attributes?.download_count || 0,
      fileId:    s.attributes?.files?.[0]?.file_id,
      hi:        s.attributes?.hearing_impaired || false,
    }));
    logs.push(`OS API: ${subs.length} subtitle`);
    return { subs, logs };
  } catch (e) {
    logs.push(`OS API Exception: ${e.message}`);
    return { subs: [], logs };
  }
};

// ── Get IMDB ID dari TMDB ────────────────────────────────────────────────
const getImdbId = async (tmdbId, type) => {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await r.json();
    return d.imdb_id || null;
  } catch (_) { return null; }
};

// ── Load & parse subtitle file ───────────────────────────────────────────
const loadSubtitle = async (sub) => {
  let srtText = '';

  if (sub.source === 'os-legacy') {
    // Coba SubDownloadLink (.gz) dulu, fallback ke ZipDownloadLink (.zip)
    const urls = [sub.downloadUrl, sub.zipUrl].filter(Boolean);
    let lastErr = null;
    for (const url of urls) {
      try { srtText = await downloadSrt(url); break; }
      catch (e) { lastErr = e; }
    }
    if (!srtText) throw lastErr || new Error('Tidak ada URL tersedia');

  } else if (sub.source === 'os') {
    const res = await fetch(`${OS_API_BASE}/download`, {
      method: 'POST',
      headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'B3Flix v1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: sub.fileId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Token gagal HTTP ${res.status}`);
    const d = await res.json();
    if (!d.link) throw new Error('Link kosong dari OS');
    srtText = await downloadSrt(d.link);
  }

  if (!srtText || !srtText.includes('-->')) throw new Error('Bukan format SRT valid');
  const cues = parseSrt(srtText);
  if (!cues.length) throw new Error('0 cue ditemukan setelah parse');
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

// ── Merge & group ────────────────────────────────────────────────────────
const mergeSubs = (arrays) => {
  const seen = new Set();
  return arrays.flat().filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id); return true;
  }).sort((x,y) => {
    const p = s => isIndo(s.lang)?0:isEng(s.lang)?1:2;
    return p(x)-p(y) || y.downloads-x.downloads;
  });
};

const groupByLang = subs => {
  const map = {};
  const order = ['id','ID','ind','en','EN','eng'];
  subs.forEach(s => { if (!map[s.lang]) map[s.lang]=[]; map[s.lang].push(s); });
  return Object.entries(map).sort(([a],[b]) => {
    const ai=order.indexOf(a), bi=order.indexOf(b);
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
  const [autoLoaded, setAutoLoaded]         = useState(false);
  const [selectedLang, setSelectedLang]     = useState(null);
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
    setAutoLoaded(false);
    setSelectedLang(null);

    const logs = [`[${new Date().toLocaleTimeString()}] Cari subtitle TMDB:${tmdbId} (${mediaType})`];
    const s = mediaType==='tv' ? season  : null;
    const e = mediaType==='tv' ? episode : null;

    // Step 1: Cari IMDB ID dulu
    getImdbId(tmdbId, mediaType).then(imdbId => {
      logs.push(`IMDB ID: ${imdbId || 'tidak ditemukan'}`);

      const promises = [
        searchOSv1(tmdbId, mediaType, s, e),
      ];
      if (imdbId) {
        promises.push(searchOSLegacy(imdbId, 'ind', s, e));
        promises.push(searchOSLegacy(imdbId, 'eng', s, e));
      }

      return Promise.all(promises).then(results => {
        const allSubs2 = results.flatMap(r => {
          if (r.logs) logs.push(...r.logs);
          return r.subs || [];
        });
        const merged = mergeSubs([allSubs2]);
        logs.push(`TOTAL: ${merged.length} subtitle`);
        setAllSubs(merged);
        setDebugLogs([...logs]);
      });
    }).catch(err => {
      logs.push(`Error: ${err.message}`);
      setDebugLogs([...logs]);
    }).finally(() => setListLoading(false));
  }, [tmdbId, mediaType, season, episode, retryKey]);

  // ── Auto-load subtitle terbaik (Indo → English), dengan fallback ────────
  useEffect(() => {
    if (listLoading || autoLoaded || allSubs.length === 0 || selected) return;

    setAutoLoaded(true); // Set DULU sebelum async — cegah infinite loop

    // Buat urutan kandidat: semua Indo (by downloads), lalu semua English
    const indoSubs = allSubs.filter(s => isIndo(s.lang));
    const engSubs  = allSubs.filter(s => isEng(s.lang));
    const candidates = [...indoSubs, ...engSubs];
    if (!candidates.length) return;

    // Coba satu per satu sampai berhasil
    const tryNext = async (list) => {
      for (const pick of list) {
        try {
          setSubLoading(true); setSubError('');
          setDebugLogs(p => [...p, `[Auto] Mencoba: ${pick.source} - ${pick.name}`]);
          const parsed = await loadSubtitle(pick);
          setCues(parsed);
          setSelected(pick);
          setElapsed(0); setOffset(0);
          resetTimer();
          setDebugLogs(p => [...p, `✓ Auto-loaded ${parsed.length} baris (${pick.lang})`]);
          return; // sukses, stop
        } catch (e) {
          setDebugLogs(p => [...p, `✗ Auto gagal (${pick.name.slice(0,30)}): ${e.message}`]);
          // lanjut ke kandidat berikutnya
        } finally {
          setSubLoading(false);
        }
      }
      setDebugLogs(p => [...p, 'Auto: semua kandidat gagal, silakan pilih manual']);
    };

    tryNext(candidates);
  }, [listLoading, allSubs, autoLoaded, selected]);

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
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseSrt(ev.target.result);
      if (!parsed.length) { setSubError('File tidak valid (bukan SRT)'); return; }
      setCues(parsed);
      setSelected({ id:'upload', lang:'custom', name: file.name, source:'upload' });
      setElapsed(0); setOffset(0); resetTimer();
      setShowSubPanel(false);
      setAutoLoaded(true);
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
            padding:'4px 9px', borderRadius:'5px', cursor:'pointer',
            background: subEnabled ? 'var(--primary-color,#e50914)' : 'rgba(0,0,0,0.75)',
            border: subEnabled ? 'none' : '1px solid rgba(255,255,255,0.2)',
            color:'#fff', fontSize:'0.73rem', fontWeight:700,
            backdropFilter:'blur(4px)',
          }}>
            <Subtitles size={13}/> CC
          </button>

          {/* Subtitle picker */}
          <button onClick={()=>{setShowSubPanel(v=>{if(v){setSelectedLang(null);}return !v;});setShowSettings(false);}} style={{
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
            {selected && autoLoaded && (
              <span style={{
                fontSize:'0.58rem', backgroundColor:'#16a34a',
                color:'#fff', padding:'0 4px', borderRadius:'3px', marginLeft:'2px',
              }}>Auto</span>
            )}
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

        {/* SUBTITLE PANEL - Cineby style */}
        {showSubPanel && (() => {
          const panelStyle = {
            position:'absolute', bottom:'46px', right:'8px', zIndex:10,
            width:'clamp(260px,34vw,380px)',
            background:'rgba(10,10,10,0.98)', backdropFilter:'blur(24px)',
            border:'1px solid rgba(255,255,255,0.09)', borderRadius:'14px',
            overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,0.9)',
          };
          const rowBase = {
            display:'flex', alignItems:'center', justifyContent:'space-between',
            width:'100%', padding:'11px 16px', border:'none', textAlign:'left',
            cursor:'pointer', fontSize:'0.83rem',
            borderBottom:'1px solid rgba(255,255,255,0.04)', transition:'background 0.15s',
          };
          const rowStyle = (active) => ({...rowBase,
            background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
            color: active ? '#fff' : '#aaa',
          });
          const hdrStyle = {
            display:'flex', alignItems:'center', gap:'8px',
            padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)',
          };

          if (!selectedLang) return (
            <div style={panelStyle}>
              <div style={hdrStyle}>
                <button onClick={()=>{setShowSubPanel(false);setSelectedLang(null);}}
                  style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:0,display:'flex'}}>
                  <X size={16}/>
                </button>
                <span style={{color:'#fff',fontWeight:600,fontSize:'0.85rem',flex:1}}>Subtitles</span>
                <button onClick={()=>setRetryKey(k=>k+1)} title="Refresh"
                  style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:0,display:'flex'}}>
                  <RefreshCw size={13}/>
                </button>
              </div>
              <div style={{maxHeight:'380px', overflowY:'auto'}}>
                {listLoading && (
                  <div style={{textAlign:'center',padding:'32px',color:'#555'}}>
                    <Loader size={20} style={{animation:'b3spin 1s linear infinite'}}/>
                    <div style={{marginTop:'8px',fontSize:'0.75rem'}}>Mencari subtitle...</div>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".srt,.sub,.vtt" style={{display:'none'}} onChange={handleFileUpload}/>
                <button onClick={()=>fileRef.current?.click()} style={rowStyle(false)}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.05)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <Upload size={13} style={{color:'#555'}}/> Upload file .srt
                  </span>
                </button>
                <button onClick={()=>{setCues([]);setSelected(null);setCurrentCue(null);setAutoLoaded(false);setShowSubPanel(false);}}
                  style={rowStyle(!selected)}
                  onMouseEnter={e=>{ if(selected) e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                  onMouseLeave={e=>{ if(selected) e.currentTarget.style.background=!selected?'rgba(255,255,255,0.07)':'transparent'; }}>
                  <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <X size={13} style={{color:'#555'}}/> Off — No Subtitles
                  </span>
                  {!selected && <Check size={14} style={{color:'#4ade80'}}/>}
                </button>
                {!listLoading && allSubs.length===0 && (
                  <div style={{textAlign:'center',padding:'24px',color:'#555',fontSize:'0.78rem'}}>
                    Subtitle tidak ditemukan
                  </div>
                )}
                {!listLoading && grouped.map(([lang, subs]) => {
                  const isActiveLang = selected && (selected.lang===lang||
                    (isIndo(lang)&&isIndo(selected.lang))||(isEng(lang)&&isEng(selected.lang)));
                  return (
                    <button key={lang} onClick={()=>setSelectedLang(lang)}
                      style={rowStyle(isActiveLang)}
                      onMouseEnter={e=>{ if(!isActiveLang) e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e=>{ if(!isActiveLang) e.currentTarget.style.background='transparent'; }}>
                      <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <span style={{fontSize:'1.05rem'}}>{getLangFlag(lang)}</span>
                        <span>
                          {getLangName(lang)}
                          {isIndo(lang) && (
                            <span style={{marginLeft:'6px',fontSize:'0.6rem',color:'#4ade80',
                              background:'rgba(74,222,128,0.1)',padding:'1px 5px',borderRadius:'3px'}}>Auto</span>
                          )}
                        </span>
                      </span>
                      <span style={{display:'flex',alignItems:'center',gap:'6px',color:'#444',fontSize:'0.72rem'}}>
                        <span>{subs.length}</span>
                        {isActiveLang
                          ? <Check size={13} style={{color:'#4ade80'}}/>
                          : <ChevronDown size={13} style={{transform:'rotate(-90deg)'}}/>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );

          const langSubs = grouped.find(([l])=>l===selectedLang)?.[1]||[];
          return (
            <div style={panelStyle}>
              <div style={hdrStyle}>
                <button onClick={()=>setSelectedLang(null)}
                  style={{background:'none',border:'none',color:'#aaa',cursor:'pointer',padding:0,
                    display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem'}}>
                  <ChevronDown size={15} style={{transform:'rotate(90deg)'}}/> Kembali
                </button>
                <span style={{color:'#fff',fontWeight:600,fontSize:'0.85rem',flex:1,textAlign:'center'}}>
                  {getLangName(selectedLang)}
                </span>
                <button onClick={()=>{setShowSubPanel(false);setSelectedLang(null);}}
                  style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:0,display:'flex'}}>
                  <X size={16}/>
                </button>
              </div>
              {subError && (
                <div style={{margin:'8px',background:'#1a0808',border:'1px solid #3a1a1a',
                  borderRadius:'7px',padding:'8px 12px',fontSize:'0.73rem',color:'#f87171',
                  display:'flex',gap:'6px',alignItems:'flex-start'}}>
                  <AlertCircle size={12} style={{flexShrink:0,marginTop:'1px'}}/> {subError}
                </div>
              )}
              <div style={{maxHeight:'380px', overflowY:'auto'}}>
                {langSubs.map((sub,i)=>{
                  const isSel=selected?.id===sub.id;
                  const isLd=subLoading&&isSel;
                  return (
                    <button key={sub.id||i} onClick={()=>handleLoadSub(sub)}
                      disabled={subLoading} style={rowStyle(isSel)}
                      onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background='transparent'; }}>
                      <span style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:'0.78rem',overflow:'hidden',textOverflow:'ellipsis',
                          whiteSpace:'nowrap',color:isSel?'#fff':'#ccc'}}>{sub.name}</div>
                        <div style={{fontSize:'0.62rem',color:'#555',marginTop:'2px',display:'flex',gap:'8px'}}>
                          <span style={{color:sub.source==='os-legacy'?'#818cf8':'#555'}}>
                            {sub.source==='os'?'OpenSubtitles':sub.source==='os-legacy'?'OS Legacy':'SUBDL'}
                          </span>
                          {sub.downloads>0&&<span>↓ {sub.downloads.toLocaleString()}</span>}
                          {sub.hi&&<span>♿ HI</span>}
                        </div>
                      </span>
                      <span style={{width:'18px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                        {isLd&&<Loader size={13} style={{animation:'b3spin 1s linear infinite',color:'#888'}}/>}
                        {isSel&&!isLd&&<Check size={14} style={{color:'#4ade80'}}/>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

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
