import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import VideoPlayer from '../components/player/VideoPlayer';
import MovieCard from '../components/common/MovieCard';
import { Star, Calendar, Film, Tv, Clock } from 'lucide-react';
import { api, SERVERS } from '../services/api';
import './Detail.css';

const Detail = () => {
    const { detailPath } = useParams();
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeSeason, setActiveSeason] = useState(1);
    const [activeEpisode, setActiveEpisode] = useState(1);
    const [activeServerId, setActiveServerId] = useState(SERVERS[0].id);
    const [currentVideoUrl, setCurrentVideoUrl] = useState(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (!detailPath) return;
        setDetail(null);
        setLoading(true);

        api.getDetail(detailPath, SERVERS[0].id).then(data => {
            setDetail(data);
            if (data.seasons?.length > 0) {
                setActiveSeason(data.seasons[0].season);
                setActiveEpisode(1);
                setCurrentVideoUrl(data.seasons[0].episodes[0]?.playerUrl);
            } else {
                setCurrentVideoUrl(data.playerUrl);
            }
        }).catch(e => console.error('Detail fetch failed', e))
          .finally(() => setLoading(false));
    }, [detailPath]);

    // Ketika server berubah, rebuild URL episode/movie
    const handleServerChange = (serverId) => {
        setActiveServerId(serverId);
        if (!detail) return;
        const server = SERVERS.find(s => s.id === serverId);
        if (!server) return;
        const isTV = detail.mediaType === 'tv';
        const newUrl = isTV
            ? server.getUrl(detail.tmdbId, 'tv', activeSeason, activeEpisode)
            : server.getUrl(detail.tmdbId, 'movie');
        setCurrentVideoUrl(newUrl);
    };

    // Ketika episode dipilih
    const handleEpisodeSelect = (ep, seasonNum) => {
        setActiveEpisode(ep.episode);
        const server = SERVERS.find(s => s.id === activeServerId) || SERVERS[0];
        const newUrl = server.getUrl(detail.tmdbId, 'tv', seasonNum || activeSeason, ep.episode);
        setCurrentVideoUrl(newUrl);
    };

    // Ketika season berubah
    const handleSeasonChange = (seasonNum) => {
        setActiveSeason(seasonNum);
        setActiveEpisode(1);
        const server = SERVERS.find(s => s.id === activeServerId) || SERVERS[0];
        const sd = detail.seasons.find(s => s.season === seasonNum);
        if (sd?.episodes?.[0]) {
            setCurrentVideoUrl(server.getUrl(detail.tmdbId, 'tv', seasonNum, 1));
        }
    };

    if (loading) return (
        <Layout>
            <div className="container" style={{ paddingTop: '100px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '48px', height: '48px', border: '5px solid #222', borderTop: '5px solid var(--primary-color)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ color: '#aaa' }}>Loading...</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        </Layout>
    );

    if (!detail) return (
        <Layout>
            <div className="container" style={{ paddingTop: '100px', textAlign: 'center' }}>
                <p style={{ color: '#aaa' }}>Content not found.</p>
            </div>
        </Layout>
    );

    const currentSeasonData = detail.seasons?.find(s => s.season === activeSeason);
    const isTV = detail.mediaType === 'tv';

    return (
        <Layout>
            {/* Backdrop background */}
            {detail.backdrop && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, height: '100vh',
                    backgroundImage: `url(${detail.backdrop})`,
                    backgroundSize: 'cover', backgroundPosition: 'center top',
                    opacity: 0.07, zIndex: 0, pointerEvents: 'none'
                }} />
            )}

            <div className="container detailContainer" style={{ marginTop: '20px', position: 'relative', zIndex: 1 }}>

                {/* === PLAYER SECTION === */}
                <div className="watch-container">
                    <div className="video-section">
                        <VideoPlayer
                            key={`${detail.tmdbId}-${activeServerId}`}
                            url={currentVideoUrl}
                            tmdbId={detail.tmdbId}
                            mediaType={detail.mediaType}
                            season={isTV ? activeSeason : null}
                            episode={isTV ? activeEpisode : null}
                            onServerChange={handleServerChange}
                        />
                    </div>

                    {/* Episode sidebar untuk TV */}
                    {isTV && detail.seasons?.length > 0 && (
                        <div className="episode-sidebar">
                            <div className="episode-header">
                                <h2 className="sectionTitle" style={{ marginBottom: 0, fontSize: '1rem' }}>Episodes</h2>
                                {detail.seasons.length > 1 && (
                                    <select
                                        value={activeSeason}
                                        onChange={(e) => handleSeasonChange(Number(e.target.value))}
                                        style={{
                                            padding: '5px 8px', borderRadius: '6px',
                                            backgroundColor: '#222', color: 'white',
                                            border: '1px solid #444', cursor: 'pointer', fontSize: '0.8rem'
                                        }}
                                    >
                                        {detail.seasons.map(s => (
                                            <option key={s.season} value={s.season}>Season {s.season}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <div className="episodeList sidebar-list">
                                {(currentSeasonData?.episodes || []).map((ep) => (
                                    <button
                                        key={ep.episode}
                                        onClick={() => handleEpisodeSelect(ep, activeSeason)}
                                        className={`episodeBtn sidebar-btn ${activeEpisode === ep.episode ? 'active' : ''}`}
                                    >
                                        <span className="ep-num">Ep {ep.episode}</span>
                                        <span className="ep-title">{ep.title}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* === INFO SECTION === */}
                <div className="detailHeader">
                    <img src={detail.poster} alt={detail.title} className="detailPoster" />
                    <div className="detailInfo">
                        <h1 className="detailTitle">{detail.title}</h1>

                        <div className="detailMeta">
                            <span className="detailRating">
                                <Star size={16} fill="#fbbf24" stroke="none" style={{ marginRight: '4px' }} />
                                {detail.rating}
                            </span>
                            {detail.year && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Calendar size={15} /> {detail.year}
                                </span>
                            )}
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isTV ? <Tv size={15} /> : <Film size={15} />}
                                {detail.type}
                                {isTV && detail.numberOfSeasons && ` • ${detail.numberOfSeasons} Season`}
                            </span>
                            {detail.runtime && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Clock size={15} /> {detail.runtime} min
                                </span>
                            )}
                        </div>

                        {detail.genre && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' }}>
                                {detail.genre.split(', ').map(g => (
                                    <span key={g} style={{
                                        padding: '3px 10px', borderRadius: '20px',
                                        backgroundColor: '#1a1a2e', border: '1px solid #333',
                                        fontSize: '0.78rem', color: '#ccc'
                                    }}>{g}</span>
                                ))}
                            </div>
                        )}

                        <p className="detailDesc">{detail.description || 'No description available.'}</p>

                        {/* Cast */}
                        {detail.cast?.length > 0 && (
                            <div style={{ marginTop: '16px' }}>
                                <h3 style={{ marginBottom: '10px', fontSize: '0.9rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Cast</h3>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {detail.cast.map(actor => (
                                        <div key={actor.id} style={{ textAlign: 'center', width: '64px' }}>
                                            <img
                                                src={actor.photo || 'https://placehold.co/64x64/222/aaa?text=?'}
                                                alt={actor.name}
                                                style={{
                                                    width: '60px', height: '60px', borderRadius: '50%',
                                                    objectFit: 'cover', border: '2px solid #333'
                                                }}
                                                onError={e => e.target.src = 'https://placehold.co/64x64/222/aaa?text=?'}
                                            />
                                            <div style={{ fontSize: '0.62rem', marginTop: '5px', color: '#bbb', lineHeight: 1.2 }}>{actor.name}</div>
                                            {actor.character && (
                                                <div style={{ fontSize: '0.58rem', color: '#666', lineHeight: 1.2 }}>{actor.character}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* === REKOMENDASI (Similar dari TMDB) === */}
                {detail.similar?.length > 0 && (
                    <div className="recommendationsSection" style={{ marginTop: '40px' }}>
                        <h2 className="sectionTitle">You May Also Like</h2>
                        <div className="recommendationsGrid">
                            {detail.similar.map(item => (
                                <MovieCard key={item.id} movie={item} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default Detail;
