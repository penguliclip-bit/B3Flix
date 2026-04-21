import React from 'react';
import { Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import './MovieCard.css';

const MovieCard = ({ movie }) => {
  const path = `/detail/${movie.detailPath || encodeURIComponent(`${movie.mediaType || 'movie'}/${movie.id}`)}`;

  return (
    <Link to={path} className="movieCard">
      <div className="posterWrapper">
        <img src={movie.poster} alt={movie.title} className="posterImage" loading="lazy" />
        <div className="ratingBadge">
          <Star size={12} fill="#fbbf24" stroke="none" />
          {movie.rating}
        </div>
        {movie.type && (
          <div style={{
            position: 'absolute', top: '8px', left: '8px',
            background: movie.type === 'TV' ? '#1a6ef5' : '#e50914',
            color: '#fff', fontSize: '0.65rem', fontWeight: 700,
            padding: '2px 6px', borderRadius: '3px', textTransform: 'uppercase'
          }}>
            {movie.type}
          </div>
        )}
        <div className="overlay">
          <h3 className="movieTitle">{movie.title}</h3>
          <div className="movieInfo">
            <span>{movie.year}</span>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MovieCard;
