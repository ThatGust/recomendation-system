import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Film, Star, TrendingUp, Upload, AlertCircle, Box } from 'lucide-react';
import { RecommendationGraph } from './components/RecommendationGraph';

interface Movie {
  movieId: string;
  title: string;
  genres: string[];
  score: number;
  avgRating: number;
  ratingsCount: number;
}

export default function App() {
  const [initialMovies, setInitialMovies] = useState<Movie[]>([]);
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [recommendations, setRecommendations] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState('cosine');
  const [hasDataset, setHasDataset] = useState<boolean | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkDatasetStatus();
  }, []);

  const checkDatasetStatus = async () => {
    try {
      const res = await fetch('/api/dataset-status');
      const data = await res.json();
      setHasDataset(data.hasData);
      if (data.hasData) {
        fetchInitialMovies();
      }
    } catch (err) {
      setHasDataset(false);
    }
  };

  const fetchInitialMovies = () => {
    fetch('/api/movies')
      .then(res => res.json())
      .then(data => setInitialMovies(data));
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('dataset', file);

    setLoading(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        checkDatasetStatus();
        setUploadProgress(0);
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          alert(error.error || 'Error al subir el archivo');
        } catch {
          alert('Error desconocido al subir');
        }
      }
      setLoading(false);
    });

    xhr.addEventListener('error', () => {
      alert('Error de conexión');
      setLoading(false);
      setUploadProgress(0);
    });

    xhr.open('POST', '/api/upload-dataset');
    xhr.send(formData);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm || !hasDataset) return;
    console.log(`[Frontend] Realizando búsqueda por: "${searchTerm}"`);
    const res = await fetch(`/api/movies?search=${encodeURIComponent(searchTerm)}`);
    const data = await res.json();
    console.log(`[Frontend] Recibidos ${data.length} resultados de búsqueda`);
    setSearchResults(data);
  };

  const selectMovie = async (movie: Movie) => {
    console.log(`[Frontend] Selección de película: ${movie.title} (ID: ${movie.movieId})`);
    setSelectedMovie(movie);
    setLoading(true);
    setRecommendations([]);
    try {
      console.log(`[Frontend] Solicitando recomendaciones usando métrica: ${metric}`);
      const res = await fetch(`/api/recommendations/${movie.movieId}?metric=${metric}`);
      const data = await res.json();
      console.log(`[Frontend] Recibidas ${data.length} recomendaciones`);
      setRecommendations(data);
    } catch (err) {
      console.error('[Frontend] Error al obtener recomendaciones:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-editorial-bg text-white font-sans overflow-hidden">
      {/* Editorial Header */}
      <header className="relative flex items-center justify-between px-10 py-5 border-b border-editorial-border shrink-0">
        <h1 className="font-serif italic text-4xl tracking-tighter leading-none">
          S.D.R<span className="text-editorial-accent">_</span>
        </h1>
        
        <div className="flex items-center flex-1 max-w-[600px] mx-10 gap-4">
          <form onSubmit={handleSearch} className="flex-1 relative flex items-center gap-2">
            <div className="relative flex-1">
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={!hasDataset}
                placeholder={hasDataset ? "Buscar por título..." : "Dataset requerido"}
                className={`w-full bg-[#1A1A1A] border border-[#333] pl-5 pr-32 py-3 rounded text-sm text-[#EEE] outline-none transition-colors ${
                  hasDataset ? 'focus:border-editorial-accent' : 'opacity-50 cursor-not-allowed italic'
                }`}
              />
              {!hasDataset && hasDataset !== null && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-editorial-accent pointer-events-none bg-[#1A1A1A] pl-2">
                  <AlertCircle size={14} />
                  <span className="text-[10px] uppercase font-bold tracking-tight hidden sm:inline whitespace-nowrap">No Dataset</span>
                </div>
              )}
            </div>
            
            <button 
              type="submit"
              disabled={!hasDataset || !searchTerm}
              className="bg-[#222] border border-[#333] p-3 rounded hover:bg-[#333] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Buscar"
            >
              <Search size={18} className="text-white" />
            </button>
          </form>

          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-2 bg-editorial-accent text-white px-4 py-3 rounded text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all shrink-0 shadow-lg shadow-editorial-accent/20 disabled:opacity-50"
          >
            {loading && uploadProgress > 0 && uploadProgress < 100 ? (
               <span className="font-mono">{uploadProgress}%</span>
            ) : (
              <Upload size={16} />
            )}
            {loading ? 'Subiendo...' : 'Subir Dataset (ZIP)'}
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            accept=".zip" 
            className="hidden" 
          />
        </div>

        <div className="text-editorial-dim text-[10px] uppercase tracking-[2px] font-bold shrink-0">
          MovieLens Analysis Engine
        </div>

        {/* Progress Bar Container */}
        {uploadProgress > 0 && (
          <div className="absolute bottom-0 left-0 w-full h-[2px] bg-editorial-border overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress}%` }}
              className="h-full bg-editorial-accent"
            />
          </div>
        )}
      </header>

      {/* Main Layout Grid */}
      <div className="flex-1 grid grid-cols-[350px_1fr] overflow-hidden">
        
        {/* Sidebar: Selected Movie & Metrics */}
        <aside className="border-r border-editorial-border p-10 overflow-y-auto custom-scrollbar">
          {!hasDataset && hasDataset !== null ? (
            <div className="h-full flex flex-col items-center justify-center text-editorial-dim text-center gap-4">
              <Upload size={40} strokeWidth={1} className="text-editorial-accent/30 animate-pulse" />
              <div className="font-serif italic text-lg text-white/50">Esperando origen de datos</div>
              <p className="text-[10px] uppercase tracking-widest leading-relaxed">
                Sube un archivo .zip que contenga<br/>
                <span className="text-editorial-accent">movies.csv</span> y <span className="text-editorial-accent">ratings.csv</span>
              </p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {selectedMovie ? (
                <motion.div
                  key={selectedMovie.movieId}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-5">
                    Seleccionado actualmente
                  </span>
                  <h2 className="font-serif text-5xl leading-[1.1] mb-2">
                    {selectedMovie.title}
                  </h2>
                  <div className="text-editorial-dim text-[11px] uppercase tracking-[1px] mb-8">
                    {selectedMovie.genres.join(' | ')}
                  </div>

                  <div className="mt-10 pt-5 border-t border-editorial-border">
                    <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-4">
                      Similitud: {metric}
                    </span>
                    
                    <div className="flex flex-wrap gap-2 mb-8">
                      {['genome', 'cosine', 'pearson', 'euclidean', 'manhattan'].map((m) => (
                        <button
                          key={m}
                          onClick={() => setMetric(m)}
                          className={`text-[9px] uppercase tracking-widest font-bold px-2 py-1 border transition-all ${
                            metric === m ? 'border-editorial-accent text-editorial-accent' : 'border-editorial-border text-editorial-dim hover:text-white'
                          }`}
                        >
                          {m === 'genome' ? 'Tag Genome' : m}
                        </button>
                      ))}
                    </div>

                    <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-4">
                      Análisis KNN (Normalizado)
                    </span>
                    
                    <div className="space-y-2 font-mono text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-editorial-dim uppercase">Similitud Reciente</span>
                        <span className="text-editorial-accent">{(selectedMovie.score || 0).toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-editorial-dim uppercase">Calificación Avg</span>
                        <span className="text-editorial-accent">{(selectedMovie.avgRating || 0).toFixed(1)} / 5.0</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-editorial-dim uppercase">Votos</span>
                        <span className="text-editorial-accent">{selectedMovie.ratingsCount || 0}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-10 p-4 border border-dashed border-[#444] text-[11px] text-editorial-dim font-mono">
                    Data Structure:<br />
                    dict[movieId][userId] = rating
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex items-center justify-center text-editorial-dim text-center italic font-serif">
                  Selecciona una película para ver el análisis estadístico
                </div>
              )}
            </AnimatePresence>
          )}
        </aside>

        {/* Main Content: Recommendations & Search Results */}
        <main className="overflow-y-auto custom-scrollbar">
          {hasDataset ? (
              <div className="px-10 pt-10">
                {selectedMovie && recommendations.length > 0 && !searchTerm && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-12"
                  >
                    <RecommendationGraph 
                      selectedMovie={selectedMovie} 
                      recommendations={recommendations} 
                      onSelectMovie={selectMovie} 
                    />
                  </motion.div>
                )}

                <h3 className="text-white text-base font-bold uppercase tracking-widest mb-6">
                  {searchTerm && searchResults.length > 0 ? `Resultados: ${searchTerm}` : 'También te gustaría ver...'}
                </h3>

                {loading ? (
                  <div className="flex items-center gap-3 py-20 text-editorial-dim">
                    <div className="w-4 h-4 border-2 border-editorial-accent border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-xs uppercase tracking-widest">Ejecutando K-Nearest Neighbors...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                    {(searchTerm && searchResults.length > 0 ? searchResults : (recommendations.length > 0 ? recommendations : initialMovies)).map((movie, idx) => (
                      <motion.div
                        key={movie.movieId}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        onClick={() => selectMovie(movie)}
                        className={`flex items-center gap-4 p-4 border transition-all cursor-pointer group ${
                          selectedMovie?.movieId === movie.movieId ? 'border-editorial-accent' : 'border-editorial-border hover:border-[#444]'
                        }`}
                      >
                        <span className="font-serif italic text-xl text-editorial-accent min-w-[30px] opacity-50 group-hover:opacity-100 transition-opacity">
                          {(idx + 1).toString().padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate uppercase tracking-tight group-hover:text-editorial-accent transition-colors">
                            {movie.title}
                          </div>
                          <div className="text-[10px] text-editorial-dim uppercase tracking-wider truncate">
                            {movie.genres.join(' | ')}
                          </div>
                        </div>
                        {movie.score !== undefined && (
                          <div className="text-[10px] font-mono text-editorial-accent">
                            {(movie.score).toFixed(3)}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 text-center">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md"
              >
                <div className="font-serif italic text-4xl mb-6 leading-tight">
                  No se ha encontrado un dataset activo para el motor de recomendación.
                </div>
                <p className="text-editorial-dim text-sm leading-relaxed mb-8">
                  El sistema requiere archivos estructurados de MovieLens para ejecutar los cálculos de similitud. 
                  Por favor, sube un archivo ZIP que contenga los CSVs originales.
                </p>
                <div className="flex justify-center">
                   <div className="w-16 h-[1px] bg-editorial-accent" />
                </div>
              </motion.div>
            </div>
          )}
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0A0A0A; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #FF4E00; }
      `}</style>
    </div>
  );
}
