import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Film, Star, TrendingUp, Upload, AlertCircle, Box, Trash2, Music } from 'lucide-react';
import { RecommendationGraph } from './components/RecommendationGraph';

interface Movie {
  movieId: string;
  title: string;
  genres: string[];
  score: number;
  avgRating: number;
  ratingsCount: number;
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

export default function App() {
  const [activeTab, setActiveTab] = useState<'movies' | 'music'>('movies');
  const [initialMovies, setInitialMovies] = useState<Movie[]>([]);
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [musicSearchTerm, setMusicSearchTerm] = useState('');
  const [musicSearchResults, setMusicSearchResults] = useState<MusicTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [recommendations, setRecommendations] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState('cosine');
  const [hasDataset, setHasDataset] = useState<boolean | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{
    movies: number;
    ratings: number;
    genomes: number;
    music: number;
    status: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const musicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkDatasetStatus();
    const interval = setInterval(checkDatasetStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('dataset', file);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-music', true);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          checkDatasetStatus();
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            alert(err.error || 'Error subiendo dataset de música');
          } catch {
            alert('Error subiendo dataset de música');
          }
        }
        setUploadProgress(0);
        setLoading(false);
      };
      xhr.send(formData);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const checkDatasetStatus = async () => {
    try {
      const res = await fetch('/api/dataset-status');
      const data = await res.json();
      setHasDataset(data.hasData);
      setIsProcessing(data.isLoading);
      if (data.progress) setLoadProgress(data.progress);
      
      if (data.hasData && initialMovies.length === 0 && data.isReady) {
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

  const handleReset = async () => {
    if (!window.confirm('¿Estás seguro de que quieres borrar todo el dataset?')) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/reset-dataset', { method: 'POST' });
      if (res.ok) {
        setHasDataset(false);
        setSearchResults([]);
        setSelectedMovie(null);
        setSelectedTrack(null);
        setRecommendations([]);
        setSearchTerm('');
        setMusicSearchTerm('');
        setMusicSearchResults([]);
      } else {
        alert('Error al resetear el dataset');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm || !hasDataset || isProcessing) return;
    const res = await fetch(`/api/movies?search=${encodeURIComponent(searchTerm)}`);
    const data = await res.json();
    setSearchResults(data);
  };

  const handleMusicSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicSearchTerm || !hasDataset || isProcessing) return;
    const res = await fetch(`/api/music/search?q=${encodeURIComponent(musicSearchTerm)}`);
    const data = await res.json();
    setMusicSearchResults(data);
  };

  const selectMovie = async (movie: Movie) => {
    if (isProcessing) return;
    setSelectedMovie(movie);
    setLoading(true);
    setRecommendations([]);
    try {
      const res = await fetch(`/api/recommendations/${movie.movieId}?metric=${metric}`);
      const data = await res.json();
      setRecommendations(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectTrack = async (track: MusicTrack) => {
    if (isProcessing) return;
    setSelectedTrack(track);
    setLoading(true);
    setRecommendations([]);
    try {
      const res = await fetch(`/api/music/recommendations/${track.trackId}`);
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error al obtener recomendaciones');
        return;
      }
      const data = await res.json();
      setRecommendations(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-editorial-bg text-white font-sans overflow-hidden">
      {/* Editorial Header */}
      <header className="relative flex items-center justify-between px-10 py-5 border-b border-editorial-border shrink-0">
        <div className="flex flex-col">
          <h1 className="font-serif italic text-4xl tracking-tighter leading-none mb-1">
            S.D.R<span className="text-editorial-accent">_</span>
          </h1>
            <div className="flex gap-4">
              <button 
                onClick={() => setActiveTab('movies')}
                className={`text-[9px] uppercase tracking-widest font-bold transition-colors border-b-2 py-1 ${activeTab === 'movies' ? 'text-editorial-accent border-editorial-accent' : 'text-editorial-dim border-transparent hover:border-editorial-border'}`}
              >
                Películas
              </button>
              <button 
                onClick={() => setActiveTab('music')}
                className={`text-[9px] uppercase tracking-widest font-bold transition-colors border-b-2 py-1 ${activeTab === 'music' ? 'text-editorial-accent border-editorial-accent' : 'text-editorial-dim border-transparent hover:border-editorial-border'}`}
              >
                Atmósfera Musical
              </button>
            </div>
        </div>
        
        <div className="flex items-center flex-1 max-w-[600px] mx-10 gap-4">
          <form onSubmit={activeTab === 'movies' ? handleSearch : handleMusicSearch} className="flex-1 relative flex items-center gap-2">
            <div className="relative flex-1">
              <input 
                type="text" 
                value={activeTab === 'movies' ? searchTerm : musicSearchTerm}
                onChange={(e) => activeTab === 'movies' ? setSearchTerm(e.target.value) : setMusicSearchTerm(e.target.value)}
                disabled={!hasDataset}
                placeholder={hasDataset ? (activeTab === 'movies' ? "Buscar película..." : "Buscar canción o artista...") : "Dataset requerido"}
                className={`w-full bg-[#1A1A1A] border border-[#333] pl-5 pr-10 py-3 rounded text-sm text-[#EEE] outline-none transition-colors ${
                  hasDataset ? 'focus:border-editorial-accent' : 'opacity-50 cursor-not-allowed italic'
                }`}
              />
            </div>
            
            <button 
              type="submit"
              disabled={!hasDataset || (activeTab === 'movies' ? !searchTerm : !musicSearchTerm)}
              className="bg-[#222] border border-[#333] p-3 rounded hover:bg-[#333] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Search size={18} />
            </button>
          </form>

          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-2 bg-editorial-accent text-white px-4 py-3 rounded text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all shrink-0 shadow-lg disabled:opacity-50"
          >
            {loading && uploadProgress > 0 && uploadProgress < 100 ? (
               <span className="font-mono">{uploadProgress}%</span>
            ) : (
              <Upload size={16} />
            )}
            {loading ? 'Subiendo...' : 'Dataset (ZIP)'}
          </button>

          <button 
            onClick={() => musicInputRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-2 bg-[#1A1A1A] border border-[#333] text-editorial-dim px-4 py-3 rounded text-xs font-bold uppercase tracking-widest hover:text-editorial-accent hover:border-editorial-accent transition-all shrink-0 shadow-lg disabled:opacity-50"
          >
            {loading && uploadProgress > 0 && uploadProgress < 100 ? (
               <span className="font-mono">{uploadProgress}%</span>
            ) : (
              <Music size={16} />
            )}
            {loading ? 'Subiendo...' : 'Música (ZIP)'}
          </button>
          
          <button 
            onClick={handleReset}
            disabled={loading || !hasDataset}
            className="bg-[#2a2a2a] p-3 rounded hover:bg-[#333] transition-all border border-[#444] disabled:opacity-30"
          >
            <Trash2 size={16} className="text-editorial-dim" />
          </button>

          <input type="file" ref={fileInputRef} onChange={handleUpload} accept=".zip" className="hidden" />
          <input type="file" ref={musicInputRef} onChange={handleMusicUpload} accept=".zip" className="hidden" />
        </div>

        <div className="text-editorial-dim text-[10px] uppercase tracking-[2px] font-bold shrink-0 hidden lg:block">
          {activeTab === 'movies' ? 'Recommendation Engine' : 'Audio Mapping Analysis'}
        </div>

        {uploadProgress > 0 && (
          <div className="absolute bottom-0 left-0 w-full h-[2px] bg-editorial-border overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} className="h-full bg-editorial-accent" />
          </div>
        )}
      </header>

      {/* Main Layout Grid */}
      <div className="flex-1 grid grid-cols-[350px_1fr] overflow-hidden">
        
        {/* Sidebar: Details View */}
        <aside className="border-r border-editorial-border p-10 overflow-y-auto custom-scrollbar">
          {(!hasDataset && hasDataset !== null) ? (
            <div className="h-full flex flex-col items-center justify-center text-editorial-dim text-center gap-4">
              <Upload size={40} strokeWidth={1} className="text-editorial-accent/30 animate-pulse" />
              <div className="font-serif italic text-lg text-white/50">Esperando origen de datos</div>
              <p className="text-[10px] uppercase tracking-widest leading-relaxed">
                Sube el ZIP con <span className="text-editorial-accent">movies.csv</span>, <span className="text-editorial-accent">ratings.csv</span> <br/>
                y opcionalmente <span className="text-editorial-accent">spotify_tracks.csv</span>
              </p>
            </div>
          ) : activeTab === 'movies' ? (
            <AnimatePresence mode="wait">
              {selectedMovie ? (
                <motion.div key={selectedMovie.movieId} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                  <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-5">
                    Análisis de Película
                  </span>
                  <h2 className="font-serif text-5xl leading-[1.1] mb-2">{selectedMovie.title}</h2>
                  <div className="text-editorial-dim text-[11px] uppercase tracking-[1px] mb-8">
                    {selectedMovie.genres.join(' | ') || 'Sin Géneros'}
                  </div>

                  <div className="mt-10 pt-5 border-t border-editorial-border">
                    <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-4">Métrica: {metric}</span>
                    <div className="flex flex-wrap gap-2 mb-8">
                      {['genome', 'cosine', 'pearson', 'euclidean', 'manhattan'].map((m) => (
                        <button key={m} onClick={() => setMetric(m)} className={`text-[9px] uppercase tracking-widest font-bold px-2 py-1 border transition-all ${metric === m ? 'border-editorial-accent text-editorial-accent' : 'border-editorial-border text-editorial-dim hover:text-white'}`}>
                          {m === 'genome' ? 'Tag Genome' : m}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2 font-mono text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-editorial-dim uppercase">Similitud</span>
                        <span className="text-editorial-accent">{(selectedMovie.score || 0).toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-editorial-dim uppercase">Rating Avg</span>
                        <span className="text-editorial-accent">{(selectedMovie.avgRating || 0).toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex items-center justify-center text-editorial-dim text-center italic font-serif">
                  Selecciona una película para ver el análisis colaborativo
                </div>
              )}
            </AnimatePresence>
          ) : (
            <AnimatePresence mode="wait">
              {selectedTrack ? (
                <motion.div key={selectedTrack.trackId} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                  <span className="block text-editorial-dim text-[11px] uppercase tracking-[2px] font-bold mb-5">
                    Perfil de Sonido
                  </span>
                  <h2 className="font-serif text-5xl leading-[1.1] mb-2">{selectedTrack.trackName}</h2>
                  <div className="text-editorial-accent text-[11px] uppercase tracking-[1px] mb-8 font-bold">
                    {selectedTrack.artists}
                  </div>

                  <div className="mt-10 pt-5 border-t border-editorial-border space-y-6">
                    <div>
                      <div className="flex justify-between text-[9px] uppercase tracking-widest text-editorial-dim mb-2">
                        <span>Valence (Emoción)</span>
                        <span>{(selectedTrack.valence * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${selectedTrack.valence * 100}%` }} className="h-full bg-editorial-accent" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[9px] uppercase tracking-widest text-editorial-dim mb-2">
                        <span>Energy (Intensidad)</span>
                        <span>{(selectedTrack.energy * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${selectedTrack.energy * 100}%` }} className="h-full bg-editorial-accent" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[9px] uppercase tracking-widest text-editorial-dim mb-2">
                        <span>Danceability (Ritmo)</span>
                        <span>{(selectedTrack.danceability * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${selectedTrack.danceability * 100}%` }} className="h-full bg-editorial-accent" />
                      </div>
                    </div>

                    <div className="mt-10 p-4 bg-[#111] border border-editorial-border text-[10px] text-editorial-dim font-mono italic">
                      Mapeando características de audio a dimensiones emocionales de géneros cinematográficos...
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex items-center justify-center text-editorial-dim text-center italic font-serif">
                  Selecciona una pista para traducir su atmósfera a cine
                </div>
              )}
            </AnimatePresence>
          )}
        </aside>

        {/* Main Content */}
        <main className="overflow-y-auto custom-scrollbar">
          {isProcessing ? (
            <div className="h-full flex flex-col items-center justify-center p-12 text-center">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full">
                <div className="font-serif italic text-3xl mb-4">Optimizando Motores...</div>
                <div className="space-y-6 w-full max-w-xs mx-auto">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-mono uppercase text-editorial-dim">
                      <span>Cine</span>
                      <span>{loadProgress?.movies.toLocaleString()}</span>
                    </div>
                    <div className="h-[2px] bg-[#222] w-full"><motion.div className="h-full bg-editorial-accent" animate={{ x: ["-100%", "0%"] }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} /></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-mono uppercase text-editorial-dim">
                      <span>Música</span>
                      <span>{loadProgress?.music.toLocaleString()}</span>
                    </div>
                    <div className="h-[2px] bg-[#222] w-full"><motion.div className="h-full bg-editorial-accent" animate={{ x: ["-100%", "0%"] }} transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }} /></div>
                  </div>
                </div>
                <p className="mt-8 text-editorial-dim text-[11px] italic">Indexando vectores para cálculos K-NN en tiempo real.</p>
              </motion.div>
            </div>
          ) : hasDataset ? (
            <div className="px-10 pt-10">
              {activeTab === 'movies' ? (
                <>
                  {selectedMovie && recommendations.length > 0 && !searchTerm && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12">
                      <RecommendationGraph selectedMovie={selectedMovie} recommendations={recommendations} onSelectMovie={selectMovie} />
                    </motion.div>
                  )}
                  <h3 className="text-white text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-editorial-border pb-2 inline-block">
                    {searchTerm ? `Resultados de Cine: ${searchTerm}` : 'Cine Sugerido (Collaborative Filtering)'}
                  </h3>
                  {loading ? (
                    <div className="flex items-center gap-3 py-20 text-editorial-dim font-mono text-xs uppercase animate-pulse">Calculando similitud estadística...</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-20">
                      {(searchTerm ? searchResults : (recommendations.length > 0 ? recommendations : initialMovies)).map((movie, idx) => (
                        <div key={movie.movieId} onClick={() => selectMovie(movie)} className={`flex items-center gap-4 p-4 border cursor-pointer transition-all ${selectedMovie?.movieId === movie.movieId ? 'border-editorial-accent' : 'border-editorial-border hover:border-[#444]'}`}>
                          <span className="font-serif italic text-xl text-editorial-accent min-w-[30px] opacity-40">{(idx + 1).toString().padStart(2, '0')}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-xs truncate uppercase tracking-tighter">{movie.title}</div>
                            <div className="text-[9px] text-editorial-dim uppercase truncate">{movie.genres.join(' | ') || 'N/A'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h3 className="text-white text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-editorial-border pb-2 inline-block">
                    {musicSearchTerm ? `Búsqueda Musical: ${musicSearchTerm}` : 'Traducir Pista a Atmósfera Cinemática'}
                  </h3>
                  
                  {loading ? (
                    <div className="flex items-center gap-3 py-20 text-editorial-dim font-mono text-xs uppercase animate-pulse">Mapeando audio a géneros...</div>
                  ) : (
                    <div className="space-y-4 pb-20">
                      {musicSearchResults.length > 0 && !selectedTrack && (
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           {musicSearchResults.map(track => (
                             <div key={track.trackId} onClick={() => selectTrack(track)} className="p-4 border border-editorial-border hover:border-editorial-accent cursor-pointer transition-all">
                               <div className="font-bold text-xs uppercase truncate">{track.trackName}</div>
                               <div className="text-[9px] text-editorial-accent font-bold uppercase truncate">{track.artists}</div>
                             </div>
                           ))}
                         </div>
                      )}

                      {(selectedTrack || musicSearchResults.length === 0) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(recommendations.length > 0 ? recommendations : initialMovies.slice(0, 10)).map((movie, idx) => (
                             <div key={movie.movieId} onClick={() => selectMovie(movie)} className="flex items-center gap-4 p-4 border border-editorial-border hover:border-editorial-accent cursor-pointer transition-all">
                               <span className="font-serif italic text-xl text-editorial-accent opacity-40">{(idx + 1).toString().padStart(2, '0')}</span>
                               <div className="flex-1 min-w-0">
                                 <div className="font-bold text-xs uppercase truncate tracking-tighter">{movie.title}</div>
                                 <div className="text-[9px] text-editorial-dim uppercase truncate">{movie.genres.join(' | ')}</div>
                               </div>
                               {selectedTrack && (
                                 <div className="text-[9px] font-mono text-editorial-accent">Match: {(movie.score * 100).toFixed(0)}%</div>
                               )}
                             </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-12 text-center">
              <div className="max-w-md">
                <div className="font-serif italic text-4xl mb-6">Sin Dataset Activo</div>
                <p className="text-editorial-dim text-xs leading-relaxed uppercase tracking-widest">Sube un paquete ZIP para iniciar el análisis.</p>
              </div>
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
