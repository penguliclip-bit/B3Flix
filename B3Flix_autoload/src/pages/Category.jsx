import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import MovieCard from '../components/common/MovieCard';
import { SectionSkeleton, SkeletonCard } from '../components/common/Skeleton';
import { api } from '../services/api';
import './Category.css';

const CATEGORIES = [
    { id: 'trending',           name: 'Trending',        apiFn: api.getTrending },
    { id: 'popular-movies',     name: 'Popular Movies',  apiFn: api.getPopularMovies },
    { id: 'popular-tv',         name: 'Popular TV',      apiFn: api.getPopularTV },
    { id: 'top-rated',          name: 'Top Rated',       apiFn: api.getTopRated },
    { id: 'now-playing',        name: 'Now Playing',     apiFn: api.getNowPlaying },
    { id: 'upcoming',           name: 'Coming Soon',     apiFn: api.getUpcoming },
    { id: 'kdrama',             name: 'K-Drama',         apiFn: api.getKDrama },
    { id: 'anime',              name: 'Anime',           apiFn: api.getAnime },
    { id: 'western-tv',         name: 'Western TV',      apiFn: api.getWesternTV },
    { id: 'indonesian-movies',  name: 'Film Indonesia',  apiFn: api.getIndonesianMovies },
    { id: 'indonesian-drama',   name: 'Drama Indonesia', apiFn: api.getIndonesianDrama },
    { id: 'action',             name: 'Action',          apiFn: api.getAction },
    { id: 'comedy',             name: 'Comedy',          apiFn: api.getAdultComedy },
    { id: 'horror',             name: 'Horror',          apiFn: api.getHorror },
];

const Category = () => {
    const { category: urlCategory } = useParams();
    const navigate = useNavigate();
    const [activeCategory, setActiveCategory] = useState(urlCategory || 'trending');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const observer = useRef();

    const lastRef = useCallback(node => {
        if (loadingMore || !hasMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) setPage(p => p + 1);
        });
        if (node) observer.current.observe(node);
    }, [loadingMore, hasMore]);

    useEffect(() => {
        if (urlCategory && urlCategory !== activeCategory) setActiveCategory(urlCategory);
    }, [urlCategory]);

    useEffect(() => {
        const cat = CATEGORIES.find(c => c.id === activeCategory);
        if (!cat) return;
        setLoading(true); setPage(1); setData([]);
        cat.apiFn(1).then(res => {
            setData(res.items || []);
            setHasMore(res.hasMore !== false);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [activeCategory]);

    useEffect(() => {
        if (page <= 1) return;
        const cat = CATEGORIES.find(c => c.id === activeCategory);
        if (!cat || !hasMore) return;
        setLoadingMore(true);
        cat.apiFn(page).then(res => {
            setData(prev => [...prev, ...(res.items || [])]);
            setHasMore(res.hasMore !== false);
        }).catch(() => {}).finally(() => setLoadingMore(false));
    }, [page]);

    const switchCategory = (id) => {
        setActiveCategory(id);
        navigate(`/category/${id}`);
        window.scrollTo(0, 0);
    };

    return (
        <Layout>
            <div className="container categoryPage">
                <h1 className="categoryTitle">
                    {CATEGORIES.find(c => c.id === activeCategory)?.name || activeCategory}
                </h1>

                <div className="categoryTabs" style={{ overflowX: 'auto', paddingBottom: '4px' }}>
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            className={`categoryTab ${activeCategory === cat.id ? 'active' : ''}`}
                            onClick={() => switchCategory(cat.id)}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {loading ? <SectionSkeleton /> : (
                    <div className="grid">
                        {data.map((item, index) => {
                            const isLast = data.length === index + 1;
                            return isLast ? (
                                <div ref={lastRef} key={`${item.id}-${index}`}><MovieCard movie={item} /></div>
                            ) : (
                                <MovieCard key={`${item.id}-${index}`} movie={item} />
                            );
                        })}
                    </div>
                )}

                {loadingMore && (
                    <div className="grid">{[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}</div>
                )}
                {!hasMore && !loading && data.length > 0 && (
                    <p style={{ textAlign: 'center', margin: '30px', color: '#666' }}>You've reached the end.</p>
                )}
                {!loading && data.length === 0 && (
                    <p style={{ textAlign: 'center', margin: '60px', color: '#666' }}>No content available.</p>
                )}
            </div>
        </Layout>
    );
};

export default Category;
