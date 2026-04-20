import React, { useState } from 'react';
import { SERVERS } from '../../services/api';

const VideoPlayer = ({ url, tmdbId, mediaType = "movie", season = null, episode = null, onServerChange }) => {
    const [activeServer, setActiveServer] = useState(SERVERS[0].id);
    const [currentUrl, setCurrentUrl] = useState(url);
    const [loading, setLoading] = useState(true);

    const switchServer = (server) => {
        setActiveServer(server.id);
        setLoading(true);
        const newUrl = server.getUrl(tmdbId, mediaType, season, episode);
        setCurrentUrl(newUrl);
        if (onServerChange) onServerChange(server.id, newUrl);
    };

    if (!url && !tmdbId) return (
        <div style={{ width: '100%', height: '400px', backgroundColor: '#0d0d0d', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#aaa', borderRadius: '8px' }}>
            No Video Source
        </div>
    );

    return (
        <div style={{ width: '100%' }}>
            {/* Server Selector */}
            <div style={{
                display: 'flex', gap: '8px', marginBottom: '10px',
                flexWrap: 'wrap', alignItems: 'center'
            }}>
                <span style={{ color: '#aaa', fontSize: '0.8rem', marginRight: '4px' }}>Server:</span>
                {SERVERS.map(server => (
                    <button
                        key={server.id}
                        onClick={() => switchServer(server)}
                        style={{
                            padding: '5px 12px',
                            borderRadius: '20px',
                            border: activeServer === server.id ? '2px solid var(--primary-color, #e50914)' : '1px solid #444',
                            backgroundColor: activeServer === server.id ? 'var(--primary-color, #e50914)' : '#1a1a1a',
                            color: 'white',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            fontWeight: activeServer === server.id ? '700' : '400',
                            transition: 'all 0.2s',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {server.name} <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>{server.label}</span>
                    </button>
                ))}
                <span style={{ color: '#666', fontSize: '0.72rem', marginLeft: 'auto' }}>
                    💡 Jika ada iklan, coba server lain
                </span>
            </div>

            {/* Player */}
            <div style={{ position: 'relative', paddingTop: '56.25%', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                {loading && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: '#0d0d0d', display: 'flex', flexDirection: 'column',
                        justifyContent: 'center', alignItems: 'center', gap: '12px', zIndex: 1
                    }}>
                        <div style={{
                            width: '40px', height: '40px',
                            border: '4px solid #222', borderTop: '4px solid var(--primary-color, #e50914)',
                            borderRadius: '50%', animation: 'spin 0.8s linear infinite'
                        }} />
                        <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Memuat player...</span>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                )}
                <iframe
                    key={currentUrl}
                    src={currentUrl || url}
                    style={{
                        position: 'absolute', top: 0, left: 0,
                        width: '100%', height: '100%',
                        border: 'none', opacity: loading ? 0 : 1,
                        transition: 'opacity 0.3s'
                    }}
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    referrerPolicy="no-referrer"
                    onLoad={() => setLoading(false)}
                    title="Video Player"
                />
            </div>
        </div>
    );
};

export default VideoPlayer;
