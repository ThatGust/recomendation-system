import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import readline from 'readline';

// --- Types ---
interface Movie {
  movieId: string;
  title: string;
  genres: string[];
}

interface MusicTrack {
  trackId: string;
  artists: string;
  trackName: string;
  trackGenre: string;
  valence: number;
  energy: number;
  danceability: number;
}

// --- Data Storage (Nested Dictionaries for Anti-Sparsity) ---
let movieUserRatings: Record<string, Record<string, number>> = {};
let movies: Record<string, Movie> = {};
let musicTracks: Record<string, MusicTrack> = {};
let movieAvgRatings: Record<string, number> = {};
let userMovies: Record<string, string[]> = {}; 
let movieGenomes: Record<string, Record<string, number>> = {}; // movieId -> { tagId -> relevance }

// Genre Profiles mapping audio features to movie categories
const genreProfiles: Record<string, { valence: number, energy: number, danceability: number }> = {
  "Action": { valence: 0.4, energy: 0.9, danceability: 0.5 },
  "Adventure": { valence: 0.7, energy: 0.8, danceability: 0.4 },
  "Animation": { valence: 0.8, energy: 0.7, danceability: 0.6 },
  "Children": { valence: 0.9, energy: 0.6, danceability: 0.4 },
  "Comedy": { valence: 0.8, energy: 0.6, danceability: 0.7 },
  "Crime": { valence: 0.3, energy: 0.6, danceability: 0.4 },
  "Documentary": { valence: 0.5, energy: 0.2, danceability: 0.2 },
  "Drama": { valence: 0.3, energy: 0.3, danceability: 0.3 },
  "Fantasy": { valence: 0.6, energy: 0.5, danceability: 0.4 },
  "Film-Noir": { valence: 0.1, energy: 0.2, danceability: 0.2 },
  "Horror": { valence: 0.1, energy: 0.8, danceability: 0.3 },
  "Musical": { valence: 0.7, energy: 0.6, danceability: 0.9 },
  "Mystery": { valence: 0.3, energy: 0.4, danceability: 0.3 },
  "Romance": { valence: 0.6, energy: 0.3, danceability: 0.4 },
  "Sci-Fi": { valence: 0.5, energy: 0.7, danceability: 0.4 },
  "Thriller": { valence: 0.2, energy: 0.8, danceability: 0.4 },
  "War": { valence: 0.2, energy: 0.7, danceability: 0.3 },
  "Western": { valence: 0.4, energy: 0.6, danceability: 0.4 },
};

// Loading state
let isDatasetLoading = false;
let loadProgress = {
  status: 'idle',
  movies: 0,
  ratings: 0,
  genomes: 0,
  music: 0,
  error: null as string | null
};

const upload = multer({ dest: 'uploads/' });

// --- Helper: Line Processor ---
async function processMusicCSVFile(filePath: string) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isHeader = true;
  let count = 0;
  let cols = { id: -1, name: -1, artists: -1, genre: -1, valence: -1, energy: -1, dance: -1 };

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    if (isHeader) {
      isHeader = false;
      const header = line.toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      cols.id = header.findIndex(h => h.includes('track_id'));
      cols.name = header.findIndex(h => h.includes('track_name'));
      cols.artists = header.findIndex(h => h.includes('artists'));
      cols.genre = header.findIndex(h => h.includes('track_genre'));
      cols.valence = header.findIndex(h => h.includes('valence'));
      cols.energy = header.findIndex(h => h.includes('energy'));
      cols.dance = header.findIndex(h => h.includes('danceability'));
      continue;
    }

    if (cols.id === -1 || cols.name === -1) continue;

    const row: string[] = [];
    let currentField = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = '';
      } else currentField += char;
    }
    row.push(currentField.trim());

    if (row[cols.id]) {
      musicTracks[row[cols.id]] = {
        trackId: row[cols.id],
        trackName: row[cols.name]?.replace(/^"|"$/g, '') || 'Unknown Track',
        artists: row[cols.artists]?.replace(/^"|"$/g, '') || 'Unknown Artist',
        trackGenre: row[cols.genre] || 'Unknown',
        valence: parseFloat(row[cols.valence]) || 0.5,
        energy: parseFloat(row[cols.energy]) || 0.5,
        danceability: parseFloat(row[cols.dance]) || 0.5
      };
      count++;
      if (count % 20000 === 0) loadProgress.music = count;
    }
  }
  loadProgress.music = count;
}
async function processJSONLFile(filePath: string, type: 'movies' | 'ratings') {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const ratingsSum: Record<string, number> = {};
  const ratingsCount: Record<string, number> = {};
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (type === 'movies') {
        const id = (data.item_id || data.id || data.movieId || data.item_id)?.toString();
        if (!id) continue;
        movies[id] = {
          movieId: id,
          title: data.title || 'Unknown Title',
          genres: data.genres ? (Array.isArray(data.genres) ? data.genres : data.genres.split('|')) : []
        };
        if (data.avgRating) movieAvgRatings[id] = parseFloat(data.avgRating);
        count++;
        if (count % 10000 === 0) loadProgress.movies = count;
      } else if (type === 'ratings') {
        const mId = (data.item_id || data.movieId)?.toString();
        const uId = (data.user_id || data.userId)?.toString();
        const rating = parseFloat(data.rating);
        if (!mId || !uId || isNaN(rating)) continue;

        if (!movieUserRatings[mId]) movieUserRatings[mId] = {};
        movieUserRatings[mId][uId] = rating;

        if (!userMovies[uId]) userMovies[uId] = [];
        userMovies[uId].push(mId);

        ratingsSum[mId] = (ratingsSum[mId] || 0) + rating;
        ratingsCount[mId] = (ratingsCount[mId] || 0) + 1;
        count++;
        if (count % 200000 === 0) {
          loadProgress.ratings = count;
          console.log(`[Loading] ${count} ratings loaded...`);
        }
      }
    } catch (e) {
      continue;
    }
  }

  if (type === 'ratings') {
    Object.keys(ratingsSum).forEach(id => {
      if (!movieAvgRatings[id]) {
        movieAvgRatings[id] = ratingsSum[id] / ratingsCount[id];
      }
    });
    loadProgress.ratings = count;
  } else {
    loadProgress.movies = count;
  }
}

async function processCSVFile(filePath: string, type: 'movies' | 'ratings' | 'genome') {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isHeader = true;
  const ratingsSum: Record<string, number> = {};
  const ratingsCount: Record<string, number> = {};
  let count = 0;
  
  let columns = { 
    movie: { id: 0, title: 1, genres: 2 },
    rating: { user: 0, movie: 1, score: 2 },
    genome: { movieId: 0, tagId: 1, score: 2 } 
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    if (isHeader) {
      isHeader = false;
      const header = line.toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      if (type === 'movies') {
        const idIdx = header.findIndex(h => h.includes('movieid') || h.includes('item_id') || h === 'id');
        const titleIdx = header.findIndex(h => h.includes('title') || h === 'name');
        const genresIdx = header.findIndex(h => h.includes('genres') || h === 'genre');
        if (idIdx !== -1) columns.movie.id = idIdx;
        if (titleIdx !== -1) columns.movie.title = titleIdx;
        if (genresIdx !== -1) columns.movie.genres = genresIdx;
      } else if (type === 'ratings') {
        const userIdx = header.findIndex(h => h.includes('userid') || h.includes('user_id'));
        const movieIdx = header.findIndex(h => h.includes('movieid') || h.includes('item_id'));
        const scoreIdx = header.findIndex(h => h.includes('rating') || h === 'score');
        if (userIdx !== -1) columns.rating.user = userIdx;
        if (movieIdx !== -1) columns.rating.movie = movieIdx;
        if (scoreIdx !== -1) columns.rating.score = scoreIdx;
      } else if (type === 'genome') {
        const mIdx = header.findIndex(h => h === 'movieid' || h === 'item_id');
        const tIdx = header.findIndex(h => h === 'tagid' || h === 'tag');
        const sIdx = header.findIndex(h => h === 'relevance' || h === 'score');
        if (mIdx !== -1) columns.genome.movieId = mIdx;
        if (tIdx !== -1) columns.genome.tagId = tIdx;
        if (sIdx !== -1) columns.genome.score = sIdx;
      }
      continue;
    }

    const row: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    row.push(currentField.trim());

    if (type === 'movies') {
      const movieId = row[columns.movie.id];
      const title = row[columns.movie.title];
      const genres = row[columns.movie.genres];
      
      if (!movieId || isNaN(parseInt(movieId))) continue;
      
      const cleanTitle = title ? title.replace(/^"|"$/g, '').trim() : 'Unknown Title';
      
      movies[movieId] = {
        movieId,
        title: cleanTitle,
        genres: genres ? genres.replace(/^"|"$/g, '').split('|') : []
      };
      count++;
      if (count % 10000 === 0) loadProgress.movies = count;
    } else if (type === 'ratings') {
      const userId = row[columns.rating.user];
      const movieId = row[columns.rating.movie];
      const ratingStr = row[columns.rating.score];
      const rating = parseFloat(ratingStr);
      
      if (!movieId || isNaN(rating) || !userId) continue;

      if (!movieUserRatings[movieId]) movieUserRatings[movieId] = {};
      movieUserRatings[movieId][userId] = rating;

      if (!userMovies[userId]) userMovies[userId] = [];
      userMovies[userId].push(movieId);

      ratingsSum[movieId] = (ratingsSum[movieId] || 0) + rating;
      ratingsCount[movieId] = (ratingsCount[movieId] || 0) + 1;
      count++;
      if (count % 200000 === 0) {
        loadProgress.ratings = count;
        console.log(`[Loading] ${count} ratings loaded...`);
      }
    } else if (type === 'genome') {
      const movieId = row[columns.genome.movieId];
      const tagId = row[columns.genome.tagId];
      const relevance = parseFloat(row[columns.genome.score]);
      if (!movieId || !tagId || isNaN(relevance)) continue;
      
      if (!movieGenomes[movieId]) movieGenomes[movieId] = {};
      movieGenomes[movieId][tagId] = relevance;
      count++;
      if (count % 500000 === 0) loadProgress.genomes = count;
    }
  }

  if (type === 'ratings') {
    Object.keys(ratingsSum).forEach(id => {
      if (!movieAvgRatings[id]) {
        movieAvgRatings[id] = ratingsSum[id] / ratingsCount[id];
      }
    });
    loadProgress.ratings = count;
  } else if (type === 'movies') {
    loadProgress.movies = count;
  } else {
    loadProgress.genomes = count;
  }
}

async function reloadData() {
  if (isDatasetLoading) return;
  
  const dataDir = path.join(process.cwd(), 'public/data');
  if (!fs.existsSync(dataDir)) return;
  
  const files = fs.readdirSync(dataDir);
  const moviesCSV = files.find(f => f.toLowerCase() === 'movies.csv');
  const moviesJSON = files.find(f => f.toLowerCase() === 'metadata.json' || f.toLowerCase() === 'movies.json');
  const ratingsCSV = files.find(f => f.toLowerCase() === 'ratings.csv');
  const ratingsJSON = files.find(f => f.toLowerCase() === 'ratings.json');
  const genomeFile = files.find(f => ['genome-scores.csv', 'tagdl.csv', 'glmer.csv', 'genome_scores.csv'].includes(f.toLowerCase()));
  const musicFile = files.find(f => f.toLowerCase().includes('track') || f.toLowerCase().includes('spotify') || f.toLowerCase() === 'dataset.csv');

  if (!(moviesCSV || moviesJSON) || !(ratingsCSV || ratingsJSON)) {
    console.log('Dataset incomplete.');
    return;
  }

  console.log('--- STARTING DATA LOAD ---');
  isDatasetLoading = true;
  loadProgress = { status: 'loading', movies: 0, ratings: 0, genomes: 0, music: 0, error: null };

  try {
    // Reset state
    movieUserRatings = {};
    movies = {};
    musicTracks = {};
    movieAvgRatings = {};
    userMovies = {};
    movieGenomes = {};

    // Process Movies
    if (moviesJSON) await processJSONLFile(path.join(dataDir, moviesJSON), 'movies');
    else if (moviesCSV) await processCSVFile(path.join(dataDir, moviesCSV), 'movies');

    // Process Ratings
    if (ratingsJSON) await processJSONLFile(path.join(dataDir, ratingsJSON), 'ratings');
    else if (ratingsCSV) await processCSVFile(path.join(dataDir, ratingsCSV), 'ratings');

    // Process Genome
    if (genomeFile) {
      console.log(`Loading Genome from ${genomeFile}...`);
      await processCSVFile(path.join(dataDir, genomeFile), 'genome');
    }

    // Process Music
    if (musicFile) {
      console.log(`Loading Music from ${musicFile}...`);
      await processMusicCSVFile(path.join(dataDir, musicFile));
    }

    console.log(`--- LOAD COMPLETE ---`);
    console.log(`Summary: ${Object.keys(movies).length} movies, ${loadProgress.ratings} ratings, ${Object.keys(musicTracks).length} music tracks.`);
    loadProgress.status = 'ready';
  } catch (err: any) {
    console.error('--- LOAD FAILED ---', err);
    loadProgress.status = 'error';
    loadProgress.error = err.message;
  } finally {
    isDatasetLoading = false;
  }
}

// --- Pure Math Metrics ---
// ... (mismas funciones matematicas) ...

function getCommonUsers(id1: string, id2: string): string[] {
  const ratings1 = movieUserRatings[id1] || {};
  const ratings2 = movieUserRatings[id2] || {};
  
  const keys1 = Object.keys(ratings1);
  const keys2 = Object.keys(ratings2);
  
  // Optimization: Iterate over the smaller array and check against a Set
  const [smaller, larger] = keys1.length < keys2.length ? [keys1, ratings2] : [keys2, ratings1];
  
  // Since ratings1/ratings2 are already maps, we can just check existence
  return smaller.filter(u => u in larger);
}

function euclideanDistance(id1: string, id2: string): number {
  const common = getCommonUsers(id1, id2);
  if (common.length < 5) return Infinity;
  
  let sumSq = 0;
  const r1 = movieUserRatings[id1];
  const r2 = movieUserRatings[id2];
  
  common.forEach(u => {
    sumSq += Math.pow(r1[u] - r2[u], 2);
  });
  return Math.sqrt(sumSq);
}

function manhattanDistance(id1: string, id2: string): number {
  const common = getCommonUsers(id1, id2);
  if (common.length < 5) return Infinity;
  
  let sumAbs = 0;
  const r1 = movieUserRatings[id1];
  const r2 = movieUserRatings[id2];
  
  common.forEach(u => {
    sumAbs += Math.abs(r1[u] - r2[u]);
  });
  return sumAbs;
}

function cosineSimilarity(id1: string, id2: string): number {
  const common = getCommonUsers(id1, id2);
  if (common.length < 5) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const r1 = movieUserRatings[id1];
  const r2 = movieUserRatings[id2];
  
  common.forEach(u => {
    const v1 = r1[u];
    const v2 = r2[u];
    dotProduct += v1 * v2;
    normA += v1 * v1;
    normB += v2 * v2;
  });
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function pearsonCorrelation(id1: string, id2: string): number {
  const common = getCommonUsers(id1, id2);
  if (common.length < 5) return 0;
  
  let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;
  const n = common.length;
  const r1 = movieUserRatings[id1];
  const r2 = movieUserRatings[id2];
  
  common.forEach(u => {
    const v1 = r1[u];
    const v2 = r2[u];
    sum1 += v1;
    sum2 += v2;
    sum1Sq += v1 * v1;
    sum2Sq += v2 * v2;
    pSum += v1 * v2;
  });
  
  const num = pSum - (sum1 * sum2 / n);
  const den = Math.sqrt((sum1Sq - Math.pow(sum1, 2) / n) * (sum2Sq - Math.pow(sum2, 2) / n));
  
  if (den === 0) return 0;
  return num / den;
}

function genomeCosineSimilarity(id1: string, id2: string): number {
  const g1 = movieGenomes[id1];
  const g2 = movieGenomes[id2];
  if (!g1 || !g2) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Genome vectors are fixed 1128 tags, so we can iterate over one and check the other
  for (const tagId in g1) {
    const v1 = g1[tagId];
    const v2 = g2[tagId] || 0;
    dotProduct += v1 * v2;
    normA += v1 * v1;
    normB += v2 * v2;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- K-NN Algorithm ---
function getRecommendations(movieId: string, k: number = 10, metric: string = 'cosine') {
  if (!movies[movieId]) return [];
  
  const movieRatings = movieUserRatings[movieId] || {};
  const viewers = Object.keys(movieRatings);
  
  // Decide if we use Genome or Ratings
  // If user explicitly asks for 'genome' or uses 'cosine' and genome data is available
  const useGenome = metric === 'genome' || (metric === 'cosine' && movieGenomes[movieId]);

  let candidateIds: string[] = [];

  if (useGenome && movieGenomes[movieId]) {
    // CONTENT-BASED: Compare against all movies with avg rating >= 3.0 and that have genome data
    candidateIds = Object.keys(movieGenomes).filter(id => 
      id !== movieId && (movieAvgRatings[id] || 0) >= 3.0
    );
    console.log(`[KNN-Genome] Finding content matches from ${candidateIds.length} high-rated movies`);
  } else {
    // COLLABORATIVE FILTERING: Only movies viewed by same users
    const candidateSet = new Set<string>();
    viewers.forEach(userId => {
      const list = userMovies[userId] || [];
      list.forEach(mId => {
        if (mId !== movieId) candidateSet.add(mId);
      });
    });
    candidateIds = Array.from(candidateSet);
    console.log(`[KNN-CF] Finding collaborative matches from ${candidateIds.length} user-shared movies`);
  }

  const similarities: { movieId: string; score: number }[] = [];
  const calcStart = Date.now();
  
  candidateIds.forEach(otherId => {
    // Quality threshold: establish a taste threshold (Establish a taste threshold)
    if ((movieAvgRatings[otherId] || 0) < 3.0) return;

    let score = -Infinity;
    
    if (useGenome) {
      score = genomeCosineSimilarity(movieId, otherId);
    } else {
      switch (metric) {
        case 'cosine':
          score = cosineSimilarity(movieId, otherId);
          break;
        case 'pearson':
          score = pearsonCorrelation(movieId, otherId);
          break;
        case 'euclidean':
          const distE = euclideanDistance(movieId, otherId);
          score = distE === Infinity ? -Infinity : 1 / (1 + distE);
          break;
        case 'manhattan':
          const distM = manhattanDistance(movieId, otherId);
          score = distM === Infinity ? -Infinity : 1 / (1 + distM);
          break;
      }
    }
    
    if (score !== -Infinity && !isNaN(score) && score > 0) {
      similarities.push({ movieId: otherId, score });
    }
  });

  const duration = Date.now() - calcStart;
  console.log(`[KNN] Metric: ${useGenome ? 'Genome-Cosine' : metric}. Scores computed in ${duration}ms`);

  return similarities
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => ({
      ...movies[s.movieId],
      score: s.score,
      avgRating: movieAvgRatings[s.movieId],
      ratingsCount: movieUserRatings[s.movieId] ? Object.keys(movieUserRatings[s.movieId]).length : 0
    }));
}

// --- Music-to-Movie Mapping Algorithm ---
function getMovieProfile(movie: Movie) {
  if (!movie.genres || movie.genres.length === 0) return null;
  
  let v = 0, e = 0, d = 0, count = 0;
  movie.genres.forEach(genre => {
    const profile = genreProfiles[genre];
    if (profile) {
      v += profile.valence;
      e += profile.energy;
      d += profile.danceability;
      count++;
    }
  });

  if (count === 0) return null;
  return { valence: v / count, energy: e / count, danceability: d / count };
}

function getMusicBasedRecommendations(trackId: string, k: number = 10) {
  const track = musicTracks[trackId];
  if (!track) return [];

  console.log(`[Music-Mapping] Profiling track: ${track.trackName} | V:${track.valence} E:${track.energy} D:${track.danceability}`);

  const candidates: { movieId: string, similarity: number }[] = [];
  
  Object.values(movies).forEach(movie => {
    const movieProfile = getMovieProfile(movie);
    if (!movieProfile) return; // Skip if no genre mapping possible

    // Euclidean distance in 3D space
    const dist = Math.sqrt(
      Math.pow(track.valence - movieProfile.valence, 2) +
      Math.pow(track.energy - movieProfile.energy, 2) +
      Math.pow(track.danceability - movieProfile.danceability, 2)
    );

    // Convert distance to similarity score
    candidates.push({ movieId: movie.movieId, similarity: 1 / (1 + dist) });
  });

  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
    .map(c => ({
      ...movies[c.movieId],
      score: c.similarity,
      avgRating: movieAvgRatings[c.movieId] || 0,
    }));
}

// --- Server Setup ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  // Music Search Endpoint
  app.get('/api/music/search', (req, res) => {
    const query = (req.query.q as string || '').toLowerCase();
    if (!query) return res.json([]);

    const results = Object.values(musicTracks)
      .filter(t => t.trackName.toLowerCase().includes(query) || t.artists.toLowerCase().includes(query))
      .slice(0, 10);
    
    res.json(results);
  });

  // Music Based Recommendations Endpoint
  app.get('/api/music/recommendations/:trackId', (req, res) => {
    const { trackId } = req.params;
    const recs = getMusicBasedRecommendations(trackId);
    if (recs.length === 0) {
      // Check if any movies actually have genres
      const moviesWithGenres = Object.values(movies).some(m => m.genres && m.genres.length > 0);
      if (!moviesWithGenres) {
        return res.status(400).json({ error: 'El dataset de películas no contiene géneros, lo cual es necesario para la recomendación musical.' });
      }
    }
    res.json(recs);
  });

  // Intentar cargar si existen archivos
  if (!fs.existsSync('public/data')) fs.mkdirSync('public/data', { recursive: true });
  
  // Start loading in background to not block port binding
  reloadData().catch(console.error);

  app.get('/api/dataset-status', (req, res) => {
    const hasData = Object.keys(movies).length > 0;
    res.json({ 
      hasData, 
      isReady: loadProgress.status === 'ready',
      isLoading: isDatasetLoading,
      count: Object.keys(movies).length,
      progress: loadProgress
    });
  });

  app.post('/api/reset-dataset', (req, res) => {
    const dataDir = path.join(process.cwd(), 'public/data');
    console.log('[Reset] Deleting dataset and clearing memory state...');
    
    try {
      if (fs.existsSync(dataDir)) {
        // Use recursive rm to ensure even nested folders or hidden files are gone
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // Reset in-memory state completely
      movieUserRatings = {};
      movies = {};
      movieAvgRatings = {};
      userMovies = {};
      movieGenomes = {};

      console.log('[Reset] Success');
      res.json({ success: true, message: 'Dataset deleted and state reset' });
    } catch (err) {
      console.error('[Reset] Error during cleanup:', err);
      res.status(500).json({ error: 'Failed to fully reset dataset directory' });
    }
  });

  app.post('/api/upload-dataset', upload.single('dataset'), async (req, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    console.log(`[Upload] Processing ZIP: ${file.originalname}`);
    try {
      const zip = new AdmZip(file.path);
      const zipEntries = zip.getEntries();
      
      let foundMovies = false;
      let foundRatings = false;
      let foundGenome = false;

      const dataDir = path.join(process.cwd(), 'public/data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      // Clean old files before extracting new ones to avoid collision/stale files
      const existingFiles = fs.readdirSync(dataDir);
      for (const f of existingFiles) {
        fs.unlinkSync(path.join(dataDir, f));
      }

      zipEntries.forEach(entry => {
        if (entry.isDirectory) return;
        
        const fullPath = entry.entryName.toLowerCase();
        const filename = path.basename(fullPath);
        
        console.log(`[Upload] Examining entry: ${fullPath}`);

        // Movies detection (CSV or JSONL)
        if (filename === 'movies.csv' || filename === 'movie.csv' || filename === 'metadata.json' || filename === 'movies.json') {
          console.log(`[Upload] Found Movies: ${fullPath}`);
          foundMovies = true;
          zip.extractEntryTo(entry, dataDir, false, true);
        } 
        // Ratings detection (CSV or JSONL)
        else if (filename === 'ratings.csv' || filename === 'rating.csv' || filename === 'ratings.json') {
          console.log(`[Upload] Found Ratings: ${fullPath}`);
          foundRatings = true;
          zip.extractEntryTo(entry, dataDir, false, true);
        } 
        // Genome scores detection
        else if (filename === 'genome-scores.csv' || filename === 'tagdl.csv' || filename === 'glmer.csv' || filename === 'genome_scores.csv' || filename.includes('genome')) {
          console.log(`[Upload] Found Genome: ${fullPath}`);
          foundGenome = true;
          zip.extractEntryTo(entry, dataDir, false, true);
        }
      });

      if (!foundMovies || !foundRatings) {
        throw new Error(`Dataset incompleto en el ZIP. Se requiere al menos un archivo de películas (movies.csv/metadata.json) y uno de calificaciones (ratings.csv/ratings.json). Encontrados: Películas=${foundMovies}, Ratings=${foundRatings}`);
      }

      console.log(`[Upload] Extraction complete. Triggering background reload...`);

      // Process from disk in background
      reloadData().catch(console.error);

      // Cleanup temp upload
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

      res.json({ message: 'Dataset uploaded and processing has started.' });
    } catch (err: any) {
      console.error('[Upload] Error processing dataset:', err);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(500).json({ error: err.message || 'Failed to process ZIP file' });
    }
  });

  app.post('/api/upload-music', upload.single('dataset'), async (req, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    console.log(`[Music-Upload] Processing ZIP: ${file.originalname}`);
    try {
      const zip = new AdmZip(file.path);
      const zipEntries = zip.getEntries();
      const dataDir = path.join(process.cwd(), 'public/data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      let foundMusic = false;

      zipEntries.forEach(entry => {
        if (entry.isDirectory) return;
        const entryName = entry.entryName.toLowerCase();
        
        // Music detection: search for track_id column in any CSV
        if (entryName.endsWith('.csv')) {
          const content = entry.getData().toString('utf8');
          const firstLine = content.split('\n')[0].toLowerCase();
          if (firstLine.includes('track_id')) {
            console.log(`[Music-Upload] Found Music file: ${entryName}`);
            foundMusic = true;
            // Extract it specifically as spotify_tracks.csv to be found by loader
            fs.writeFileSync(path.join(dataDir, 'spotify_tracks.csv'), entry.getData());
          }
        }
      });

      if (!foundMusic) {
        throw new Error('No se encontró un archivo de música compatible (track_id) dentro del ZIP.');
      }

      console.log(`[Music-Upload] Extraction complete. Triggering background reload...`);
      reloadData().catch(console.error);

      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.json({ message: 'Dataset de música subido y procesándose.' });
    } catch (err: any) {
      console.error('[Music-Upload] Error:', err);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(500).json({ error: err.message || 'Error procesando ZIP de música' });
    }
  });

  app.get('/api/movies', (req, res) => {
    const search = (req.query.search as string || '').toLowerCase();
    console.log(`[Search] Query: "${search}"`);
    const startTime = Date.now();
    
    const movieArray = Object.values(movies);
    if (movieArray.length === 0) return res.json([]);

    let results;
    if (search) {
      results = movieArray.filter(m => m.title.toLowerCase().includes(search)).slice(0, 10);
    } else {
      const shuffled = [...movieArray].sort(() => 0.5 - Math.random());
      results = shuffled.slice(0, 5);
    }
    
    const enrichedResults = results.map(m => ({
      ...m,
      score: 1.0, // High score for direct search matches
      avgRating: movieAvgRatings[m.movieId] || 0,
      ratingsCount: movieUserRatings[m.movieId] ? Object.keys(movieUserRatings[m.movieId]).length : 0
    }));

    const duration = Date.now() - startTime;
    console.log(`[Search] Found ${enrichedResults.length} results in ${duration}ms`);
    res.json(enrichedResults);
  });

  app.get('/api/recommendations/:movieId', (req, res) => {
    const metric = (req.query.metric as string) || 'cosine';
    const movieId = req.params.movieId;
    console.log(`[KNN] Request for: ${movies[movieId]?.title || movieId} | Metric: ${metric}`);
    const startTime = Date.now();
    
    const recs = getRecommendations(movieId, 10, metric);
    
    const duration = Date.now() - startTime;
    console.log(`[KNN] Computed 10 recommendations in ${duration}ms`);
    res.json(recs);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Movie Rec Server running at http://localhost:${PORT}`);
  });
}

startServer();
