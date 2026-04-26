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
let userMovies: Record<string, string[]> = {}; 
let movieGenomes: Record<string, Record<string, number>> = {}; // movieId -> { tagId -> relevance }

const upload = multer({ dest: 'uploads/' });

// --- Helper: Line Processor ---
async function processCSVFile(filePath: string, type: 'movies' | 'ratings' | 'genome') {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isHeader = true;
  const ratingsSum: Record<string, number> = {};
  const ratingsCount: Record<string, number> = {};
  let genomeColumns = { movieId: 0, tagId: 1, score: 2 };

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    if (isHeader) {
      isHeader = false;
      const header = line.toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      if (type === 'genome') {
        const mIdx = header.findIndex(h => h === 'movieid' || h === 'item_id');
        const tIdx = header.findIndex(h => h === 'tagid' || h === 'tag');
        const sIdx = header.findIndex(h => h === 'relevance' || h === 'score');
        if (mIdx !== -1) genomeColumns.movieId = mIdx;
        if (tIdx !== -1) genomeColumns.tagId = tIdx;
        if (sIdx !== -1) genomeColumns.score = sIdx;
      }
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
    } else if (type === 'ratings') {
      const [userId, movieId, ratingStr] = row;
      const rating = parseFloat(ratingStr);
      
      if (!movieId || isNaN(rating) || !userId) continue;

      if (!movieUserRatings[movieId]) movieUserRatings[movieId] = {};
      movieUserRatings[movieId][userId] = rating;

      if (!userMovies[userId]) userMovies[userId] = [];
      userMovies[userId].push(movieId);

      ratingsSum[movieId] = (ratingsSum[movieId] || 0) + rating;
      ratingsCount[movieId] = (ratingsCount[movieId] || 0) + 1;
    } else if (type === 'genome') {
      const movieId = row[genomeColumns.movieId];
      const tagId = row[genomeColumns.tagId];
      const relevance = parseFloat(row[genomeColumns.score]);
      if (!movieId || !tagId || isNaN(relevance)) continue;
      
      if (!movieGenomes[movieId]) movieGenomes[movieId] = {};
      movieGenomes[movieId][tagId] = relevance;
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
  const genomePath = path.join(process.cwd(), 'public/data/genome-scores.csv');

  if (!fs.existsSync(moviesPath) || !fs.existsSync(ratingsPath)) {
    console.log('Dataset missing.');
    return;
  }

  console.log('Reloading data from disk...');
  movieUserRatings = {};
  movies = {};
  movieAvgRatings = {};
  userMovies = {};
  movieGenomes = {};

  await processCSVFile(moviesPath, 'movies');
  await processCSVFile(ratingsPath, 'ratings');
  if (fs.existsSync(genomePath)) {
    console.log('Loading Tag Genome...');
    await processCSVFile(genomePath, 'genome');
  }
  console.log(`Loaded ${Object.keys(movies).length} movies and ${Object.keys(movieGenomes).length} genomes.`);
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
      let foundGenome = false;

      const dataDir = path.join(process.cwd(), 'public/data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      zipEntries.forEach(entry => {
        if (entry.isDirectory) return;
        
        const filename = path.basename(entry.entryName).toLowerCase();
        
        if (filename === 'movies.csv') {
          foundMovies = true;
          zip.extractEntryTo(entry, dataDir, false, true);
        } else if (filename === 'ratings.csv') {
          foundRatings = true;
          zip.extractEntryTo(entry, dataDir, false, true);
        } else if (filename === 'genome-scores.csv' || filename === 'tagdl.csv' || filename === 'glmer.csv') {
          foundGenome = true;
          // Normalize to genome-scores.csv so our loader finds it
          const content = entry.getData();
          fs.writeFileSync(path.join(dataDir, 'genome-scores.csv'), content);
        }
      });

      if (!foundMovies || !foundRatings) {
        return res.status(400).json({ error: 'Missing movies.csv or ratings.csv in ZIP' });
      }

      console.log(`Upload processed. Movies: ${foundMovies}, Ratings: ${foundRatings}, Genome: ${foundGenome}`);

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
