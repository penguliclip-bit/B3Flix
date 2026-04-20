import React, { useState, useEffect } from 'react';
import Layout from '../components/layout/Layout';
import HeroBanner from '../components/home/HeroBanner';
import Section from '../components/layout/Section';
import MovieCard from '../components/common/MovieCard';
import { SectionSkeleton } from '../components/common/Skeleton';
import { api } from '../services/api';

const Home = () => {
    const [heroItems, setHeroItems] = useState([]);
    const [sections, setSections] = useState({
        popularMovies: { title: 'Popular Movies',   data: [], loading: true, link: '/category/popular-movies' },
        popularTV:     { title: 'Popular TV Shows', data: [], loading: true, link: '/category/popular-tv' },
        topRated:      { title: 'Top Rated',        data: [], loading: true, link: '/category/top-rated' },
        kDrama:        { title: 'K-Drama',          data: [], loading: true, link: '/category/kdrama' },
        anime:         { title: 'Anime',            data: [], loading: true, link: '/category/anime' },
        westernTV:     { title: 'Western TV',       data: [], loading: true, link: '/category/western-tv' },
        indoMovie:     { title: 'Film Indonesia',   data: [], loading: true, link: '/category/indonesian-movies' },
    });

    useEffect(() => {
        // Hero = Trending (mix movie+tv, sama seperti Cineby)
        api.getTrending(1).then(res => {
            setHeroItems(res.items.filter(i => i.backdrop).slice(0, 7));
        }).catch(() => {});

        const fetchSection = (key, apiFn) => {
            apiFn(1).then(res => {
                setSections(prev => ({
                    ...prev,
                    [key]: { ...prev[key], data: res.items || [], loading: false }
                }));
            }).catch(() => {
                setSections(prev => ({ ...prev, [key]: { ...prev[key], loading: false } }));
            });
        };

        fetchSection('popularMovies', api.getPopularMovies);
        fetchSection('popularTV',     api.getPopularTV);
        fetchSection('topRated',      api.getTopRated);
        fetchSection('kDrama',        api.getKDrama);
        fetchSection('anime',         api.getAnime);
        fetchSection('westernTV',     api.getWesternTV);
        fetchSection('indoMovie',     api.getIndonesianMovies);
    }, []);

    return (
        <Layout>
            {heroItems.length > 0 && <HeroBanner items={heroItems} />}
            {Object.entries(sections).map(([key, section]) =>
                section.loading ? <SectionSkeleton key={key} /> : (
                    section.data.length > 0 && (
                        <Section key={key} title={section.title} linkTo={section.link}>
                            {section.data.slice(0, 12).map(item => (
                                <MovieCard key={item.id} movie={item} />
                            ))}
                        </Section>
                    )
                )
            )}
        </Layout>
    );
};

export default Home;
