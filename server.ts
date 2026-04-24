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

// --- Data Storage (Nested Dictionaries for Anti-Sparsity) ---
let movieUserRatings: Record<string, Record<string, number>> = {};
let movies: Record<string, Movie> = {};
let movieAvgRatings: Record<string, number> = {};
let userMovies: Record<string, string[]> = {}; // Inverted index: userId -> movieId[]

const upload = multer({ dest: 'uploads/' });

// --- Helper: Line Processor ---
async function processCSVFile(filePath: string, type: 'movies' | 'ratings') {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isHeader = true;
  const ratingsSum: Record<string, number> = {};
  const ratingsCount: Record<string, number> = {};

  for await (const line of rl) {
    if (isHeader || !line.trim()) {
      isHeader = false;
      continue;
    }

    // Improved CSV splitter that handles quoted fields with commas and allows spaces
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
      const [movieId, title, genres] = row;
      if (!movieId || isNaN(parseInt(movieId))) continue;
      
      const cleanTitle = title ? title.replace(/^"|"$/g, '').trim() : 'Unknown Title';
      
      movies[movieId] = {
        movieId,
        title: cleanTitle,
        genres: genres ? genres.replace(/^"|"$/g, '').split('|') : []
      };
    } else {
      const [userId, movieId, ratingStr] = row;
      const rating = parseFloat(ratingStr);
      
      if (!movieId || isNaN(rating) || !userId) continue;

      if (!movieUserRatings[movieId]) movieUserRatings[movieId] = {};
      movieUserRatings[movieId][userId] = rating;

      if (!userMovies[userId]) userMovies[userId] = [];
      userMovies[userId].push(movieId);

      ratingsSum[movieId] = (ratingsSum[movieId] || 0) + rating;
      ratingsCount[movieId] = (ratingsCount[movieId] || 0) + 1;
    }
  }

  if (type === 'ratings') {
    Object.keys(ratingsSum).forEach(id => {
      movieAvgRatings[id] = ratingsSum[id] / ratingsCount[id];
    });
  }
}

async function reloadData() {
  const moviesPath = path.join(process.cwd(), 'public/data/movies.csv');
  const ratingsPath = path.join(process.cwd(), 'public/data/ratings.csv');

  if (!fs.existsSync(moviesPath) || !fs.existsSync(ratingsPath)) {
    console.log('Dataset missing.');
    return;
  }

  console.log('Reloading data from disk...');
  movieUserRatings = {};
  movies = {};
  movieAvgRatings = {};
  userMovies = {};

  await processCSVFile(moviesPath, 'movies');
  await processCSVFile(ratingsPath, 'ratings');
  console.log(`Loaded ${Object.keys(movies).length} movies.`);
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

// --- K-NN Algorithm ---
function getRecommendations(movieId: string, k: number = 10, metric: string = 'cosine') {
  if (!movies[movieId]) return [];
  
  const movieRatings = movieUserRatings[movieId] || {};
  const viewers = Object.keys(movieRatings);
  
  // Step 1: Find candidates (movies viewed by same users)
  const candidateSet = new Set<string>();
  viewers.forEach(userId => {
    const list = userMovies[userId] || [];
    list.forEach(mId => {
      if (mId !== movieId) candidateSet.add(mId);
    });
  });

  const similarities: { movieId: string; score: number }[] = [];
  
  candidateSet.forEach(otherId => {
    // Only consider movies with average rating > 3.0
    if ((movieAvgRatings[otherId] || 0) <= 3.0) return;

    let score = 0;
    switch(metric) {
      case 'euclidean': 
        const distE = euclideanDistance(movieId, otherId);
        score = distE === Infinity ? -Infinity : -distE;
        break;
      case 'manhattan':
        const distM = manhattanDistance(movieId, otherId);
        score = distM === Infinity ? -Infinity : -distM;
        break;
      case 'pearson':
        score = pearsonCorrelation(movieId, otherId);
        break;
      case 'cosine':
      default:
        score = cosineSimilarity(movieId, otherId);
        break;
    }
    
    if (score !== -Infinity && !isNaN(score) && score !== 0) {
      similarities.push({ movieId: otherId, score });
    }
  });

  similarities.sort((a, b) => b.score - a.score);
  
  return similarities.slice(0, k).map(s => ({
    ...movies[s.movieId],
    score: s.score,
    avgRating: movieAvgRatings[s.movieId]
  }));
}

// --- Server Setup ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  // Intentar cargar si existen archivos
  if (!fs.existsSync('public/data')) fs.mkdirSync('public/data', { recursive: true });
  await reloadData();

  app.get('/api/dataset-status', (req, res) => {
    const hasData = Object.keys(movies).length > 0;
    res.json({ hasData, count: Object.keys(movies).length });
  });

  app.post('/api/upload-dataset', upload.single('dataset'), async (req, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const zip = new AdmZip(file.path);
      const zipEntries = zip.getEntries();
      
      let foundMovies = false;
      let foundRatings = false;

      zipEntries.forEach(entry => {
        if (entry.entryName.toLowerCase() === 'movies.csv') {
          foundMovies = true;
          zip.extractEntryTo(entry, 'public/data', false, true);
        }
        if (entry.entryName.toLowerCase() === 'ratings.csv') {
          foundRatings = true;
          zip.extractEntryTo(entry, 'public/data', false, true);
        }
      });

      if (!foundMovies || !foundRatings) {
        return res.status(400).json({ error: 'Missing movies.csv or ratings.csv in ZIP' });
      }

      // Process from disk
      await reloadData();

      // Cleanup temp upload
      fs.unlinkSync(file.path);

      res.json({ message: 'Dataset uploaded and processed successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to process ZIP file' });
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
    
    const duration = Date.now() - startTime;
    console.log(`[Search] Found ${results.length} results in ${duration}ms`);
    res.json(results);
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
