import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, Star } from 'lucide-react';
import './HeroBanner.css';

const HeroBanner = ({ items = [] }) => {
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (items.length === 0) return;
        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % items.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [items.length]);

    if (items.length === 0) return null;

    const item = items[currentIndex];
    const bgImage = item.backdrop || item.poster;

    return (
        <div className="heroContainer">
            {items.map((it, index) => (
                <div
                    key={it.id}
                    className={`heroSlide ${index === currentIndex ? 'active' : ''}`}
                    style={{ backgroundImage: `url(${it.backdrop || it.poster})` }}
                >
                    <div className="heroOverlay">
                        <div className="heroContent">
                            <h1 className="heroTitle">{it.title}</h1>
                            <div className="heroInfo">
                                <span className="heroRating">
                                    <Star size={16} fill="#fbbf24" stroke="none" />
                                    {it.rating}
                                </span>
                                <span>{it.year}</span>
                                <span>{it.type}</span>
                            </div>
                            {it.description && (
                                <p className="heroDesc" style={{
                                    maxWidth: '500px',
                                    color: 'rgba(255,255,255,0.8)',
                                    fontSize: '0.95rem',
                                    lineHeight: '1.5',
                                    marginBottom: '16px',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                }}>
                                    {it.description}
                                </p>
                            )}
                            <div className="heroActions">
                                <Link
                                    to={`/detail/${it.detailPath}`}
                                    className="btn btn-primary"
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    <Play size={20} fill="currentColor" />
                                    Watch Now
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            <button className="navButton navPrev" onClick={() =>
                setCurrentIndex((prev) => (prev - 1 + items.length) % items.length)
            }>
                <ChevronLeft size={24} />
            </button>
            <button className="navButton navNext" onClick={() =>
                setCurrentIndex((prev) => (prev + 1) % items.length)
            }>
                <ChevronRight size={24} />
            </button>

            <div style={{ position: 'absolute', bottom: '16px', right: '50%', transform: 'translateX(50%)', display: 'flex', gap: '8px', zIndex: 10 }}>
                {items.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setCurrentIndex(i)}
                        style={{
                            width: i === currentIndex ? '24px' : '8px',
                            height: '8px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: i === currentIndex ? 'var(--primary-color, #e50914)' : 'rgba(255,255,255,0.5)',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            padding: 0
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default HeroBanner;
