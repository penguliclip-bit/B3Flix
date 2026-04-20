// ============================================================
//  B3Flix API Service
//  Data: TMDB API (sama persis dengan Cineby)
//  Player: Multi-server, prioritas yang paling sedikit iklan
// ============================================================

const TMDB_KEY = "1f54bd990f1cdfb230adb312546d765d";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

// ============================================================
//  PLAYER SERVERS - urutan dari paling sedikit iklan
//  User bisa pilih server di halaman detail
// ============================================================
export const SERVERS = [
  {
    id: "vidsrc-xyz",
    name: "Server 1",
    label: "⚡ Cepat",
    getUrl: (id, type, s, e) =>
      type === "tv"
        ? s && e
          ? `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
          : `https://vidsrc.xyz/embed/tv?tmdb=${id}`
        : `https://vidsrc.xyz/embed/movie?tmdb=${id}`,
  },
  {
    id: "embed-su",
    name: "Server 2",
    label: "🔇 Minim Iklan",
    getUrl: (id, type, s, e) =>
      type === "tv"
        ? s && e
          ? `https://embed.su/embed/tv/${id}/${s}/${e}`
          : `https://embed.su/embed/tv/${id}/1/1`
        : `https://embed.su/embed/movie/${id}`,
  },
  {
    id: "autoembed",
    name: "Server 3",
    label: "🎬 HD",
    getUrl: (id, type, s, e) =>
      type === "tv"
        ? s && e
          ? `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`
          : `https://autoembed.co/tv/tmdb/${id}-1-1`
        : `https://autoembed.co/movie/tmdb/${id}`,
  },
  {
    id: "multiembed",
    name: "Server 4",
    label: "🌐 Backup",
    getUrl: (id, type, s, e) =>
      type === "tv"
        ? s && e
          ? `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`
          : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=1&e=1`
        : `https://multiembed.mov/?video_id=${id}&tmdb=1`,
  },
];

export const DEFAULT_SERVER = SERVERS[0];

const getEmbedUrl = (id, type = "movie", season = null, episode = null, server = DEFAULT_SERVER) =>
  server.getUrl(id, type, season, episode);

// ============================================================
//  Format item agar konsisten - mengikuti struktur Cineby
// ============================================================
const formatItem = (item, type = "movie") => {
  const mediaType = item.media_type || type;
  const isTV = mediaType === "tv";
  const tmdbId = item.id;
  const detailPath = encodeURIComponent(`${isTV ? "tv" : "movie"}/${tmdbId}`);

  return {
    id: tmdbId,
    title: item.title || item.name || "Unknown",
    poster: item.poster_path
      ? `${IMG_BASE}/w342${item.poster_path}`
      : "https://placehold.co/342x513/1a1a2e/white?text=No+Poster",
    backdrop: item.backdrop_path
      ? `${IMG_BASE}/w1280${item.backdrop_path}`
      : null,
    rating: item.vote_average ? Number(item.vote_average).toFixed(1) : "N/A",
    year: (item.release_date || item.first_air_date || "").substring(0, 4),
    type: isTV ? "TV" : "Movie",
    mediaType: isTV ? "tv" : "movie",
    description: item.overview || "",
    genre: "",
    detailPath,
    tmdbId,
    playerUrl: getEmbedUrl(tmdbId, isTV ? "tv" : "movie"),
  };
};

// TMDB fetch helper
const tmdbFetch = async (endpoint, params = {}) => {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set("api_key", TMDB_KEY);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => {
    if (k !== "_type") url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB Error: ${res.status}`);
  return res.json();
};

const paginatedFetch = async (endpoint, params = {}, page = 1) => {
  const data = await tmdbFetch(endpoint, { ...params, page });
  const items = (data.results || []).map((item) =>
    formatItem(item, params._type || "movie")
  );
  return {
    items,
    hasMore: page < (data.total_pages || 1),
  };
};

// ============================================================
//  API METHODS - Sesuai dengan konten yang ada di Cineby
// ============================================================
export const api = {

  // --- Trending (mix movie+tv, sesuai Cineby "trending" section) ---
  getTrending: async (page = 1) => {
    const data = await tmdbFetch("/trending/all/week", { page });
    const items = (data.results || []).map((item) =>
      formatItem(item, item.media_type || "movie")
    );
    return { items, hasMore: page < data.total_pages };
  },

  // --- Popular Movies (Cineby "popularMovies" section) ---
  getPopularMovies: async (page = 1) =>
    paginatedFetch("/movie/popular", { _type: "movie" }, page),

  // --- Popular TV (Cineby "popularShowTV" section) ---
  getPopularTV: async (page = 1) =>
    paginatedFetch("/tv/popular", { _type: "tv" }, page),

  // --- Top Rated (Cineby "top_rated" section) ---
  getTopRated: async (page = 1) => {
    const [movies, tv] = await Promise.all([
      tmdbFetch("/movie/top_rated", { page }),
      tmdbFetch("/tv/top_rated", { page }),
    ]);
    const items = [
      ...(movies.results || []).map((i) => formatItem(i, "movie")),
      ...(tv.results || []).map((i) => formatItem(i, "tv")),
    ].sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
    return { items, hasMore: page < movies.total_pages };
  },

  // --- K-Drama (Korea TV - ada di Cineby) ---
  getKDrama: async (page = 1) =>
    paginatedFetch(
      "/discover/tv",
      { with_origin_country: "KR", sort_by: "popularity.desc", _type: "tv" },
      page
    ),

  // --- Anime (Japan Animation - ada di Cineby "anime" section) ---
  getAnime: async (page = 1) =>
    paginatedFetch(
      "/discover/tv",
      {
        with_genres: "16",
        with_origin_country: "JP",
        sort_by: "popularity.desc",
        _type: "tv",
      },
      page
    ),

  // --- Anime Movies ---
  getAnimeMovies: async (page = 1) =>
    paginatedFetch(
      "/discover/movie",
      {
        with_genres: "16",
        with_origin_country: "JP",
        sort_by: "popularity.desc",
        _type: "movie",
      },
      page
    ),

  // --- Western TV (US/UK) ---
  getWesternTV: async (page = 1) =>
    paginatedFetch(
      "/discover/tv",
      {
        with_origin_country: "US|GB",
        sort_by: "popularity.desc",
        _type: "tv",
      },
      page
    ),

  // --- Now Playing / Bioskop (Cineby genre movie) ---
  getNowPlaying: async (page = 1) =>
    paginatedFetch("/movie/now_playing", { _type: "movie" }, page),

  // --- Upcoming Movies ---
  getUpcoming: async (page = 1) =>
    paginatedFetch("/movie/upcoming", { _type: "movie" }, page),

  // --- Indonesian Movies ---
  getIndonesianMovies: async (page = 1) =>
    paginatedFetch(
      "/discover/movie",
      { with_original_language: "id", sort_by: "popularity.desc", _type: "movie" },
      page
    ),

  // --- Indonesian Drama ---
  getIndonesianDrama: async (page = 1) =>
    paginatedFetch(
      "/discover/tv",
      { with_original_language: "id", sort_by: "popularity.desc", _type: "tv" },
      page
    ),

  // --- Short TV / Mini Series ---
  getShortTV: async (page = 1) =>
    paginatedFetch(
      "/discover/tv",
      { with_type: "2", sort_by: "popularity.desc", _type: "tv" },
      page
    ),

  // --- Indo Dub (populer global) ---
  getIndoDub: async (page = 1) =>
    paginatedFetch("/movie/popular", { _type: "movie" }, page),

  // --- Comedy ---
  getAdultComedy: async (page = 1) =>
    paginatedFetch(
      "/discover/movie",
      { with_genres: "35", sort_by: "popularity.desc", _type: "movie" },
      page
    ),

  // --- Action ---
  getAction: async (page = 1) =>
    paginatedFetch(
      "/discover/movie",
      { with_genres: "28", sort_by: "popularity.desc", _type: "movie" },
      page
    ),

  // --- Horror ---
  getHorror: async (page = 1) =>
    paginatedFetch(
      "/discover/movie",
      { with_genres: "27", sort_by: "popularity.desc", _type: "movie" },
      page
    ),

  // ============================================================
  //  Search - menggunakan TMDB /search/multi (sama seperti Cineby)
  // ============================================================
  search: async (query, page = 1) => {
    const data = await tmdbFetch("/search/multi", { query, page });
    const items = (data.results || [])
      .filter((r) => r.media_type !== "person" && (r.poster_path || r.backdrop_path))
      .map((item) => formatItem(item, item.media_type || "movie"));
    return { items, hasMore: page < data.total_pages };
  },

  // ============================================================
  //  Detail - menggunakan TMDB ID langsung (sama seperti Cineby)
  //  pathEncoded: "movie/12345" atau "tv/67890"
  // ============================================================
  getDetail: async (pathEncoded, serverId = null) => {
    const path = decodeURIComponent(pathEncoded);
    const [type, id] = path.split("/");
    const isTV = type === "tv";

    const server = serverId
      ? SERVERS.find((s) => s.id === serverId) || DEFAULT_SERVER
      : DEFAULT_SERVER;

    const [detail, credits, similar] = await Promise.all([
      tmdbFetch(`/${type}/${id}`),
      tmdbFetch(`/${type}/${id}/credits`),
      tmdbFetch(`/${type}/${id}/similar`),
    ]);

    const formatted = formatItem(detail, type);

    // Build seasons & episodes untuk TV
    let seasons = [];
    if (isTV && detail.seasons) {
      seasons = detail.seasons
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          season: s.season_number,
          name: s.name || `Season ${s.season_number}`,
          episodeCount: s.episode_count,
          episodes: Array.from({ length: s.episode_count }, (_, i) => ({
            episode: i + 1,
            title: `Episode ${i + 1}`,
            playerUrl: getEmbedUrl(id, "tv", s.season_number, i + 1, server),
          })),
        }));
    }

    // Similar items untuk rekomendasi
    const similarItems = (similar.results || [])
      .slice(0, 12)
      .map((item) => formatItem(item, type));

    return {
      ...formatted,
      genre: (detail.genres || []).map((g) => g.name).join(", "),
      runtime: detail.runtime || null,
      status: detail.status || null,
      numberOfSeasons: detail.number_of_seasons || null,
      numberOfEpisodes: detail.number_of_episodes || null,
      cast: (credits.cast || []).slice(0, 10).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character,
        photo: c.profile_path
          ? `${IMG_BASE}/w185${c.profile_path}`
          : null,
      })),
      seasons,
      similar: similarItems,
      playerUrl:
        isTV && seasons.length > 0
          ? seasons[0].episodes[0]?.playerUrl
          : getEmbedUrl(id, "movie", null, null, server),
      // Semua server URLs untuk switcher
      allServers: SERVERS.map((srv) => ({
        ...srv,
        url:
          isTV && seasons.length > 0
            ? getEmbedUrl(id, "tv", 1, 1, srv)
            : getEmbedUrl(id, "movie", null, null, srv),
      })),
    };
  },

  // Helper untuk generate URL per episode per server
  getEpisodeUrl: (tmdbId, type, season, episode, serverId) => {
    const server = SERVERS.find((s) => s.id === serverId) || DEFAULT_SERVER;
    return getEmbedUrl(tmdbId, type, season, episode, server);
  },

  getPlayer: (tmdbId, type = "movie") => getEmbedUrl(tmdbId, type),
};
