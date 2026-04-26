import React, { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Float, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';

interface MovieData {
  movieId: string;
  title: string;
  score: number;
  avgRating: number;
  ratingsCount: number;
  genres: string[];
}

interface GraphProps {
  selectedMovie: MovieData | null;
  recommendations: MovieData[];
  onSelectMovie: (movie: MovieData) => void;
}

const MovieNode = ({ movie, position, color, isCenter, onClick }: { 
  movie: MovieData; 
  position: [number, number, number]; 
  color: string;
  isCenter?: boolean;
  onClick: () => void;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
      if (isCenter) {
        meshRef.current.position.y = Math.sin(state.clock.elapsedTime) * 0.2;
      }
    }
  });

  const size = isCenter ? 0.6 : Math.max(0.2, (movie.ratingsCount / 5000) * 0.5 + 0.1);

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={onClick}
      >
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color}
          emissiveIntensity={hovered ? 1.5 : 0.4}
        />
      </mesh>
      
      {(hovered || isCenter) && (
        <Text
          position={[0, size + 0.3, 0]}
          fontSize={0.15}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          {movie.title}
          {hovered && !isCenter && `\n(Sim: ${movie.score.toFixed(3)})`}
        </Text>
      )}
    </group>
  );
};

const Connections = ({ items }: { items: [number, number, number][] }) => {
  return (
    <group>
      {items.map((pos, i) => (
        <line key={i}>
          <bufferGeometry attach="geometry">
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([0, 0, 0, ...pos])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial attach="material" color="#444" transparent opacity={0.3} />
        </line>
      ))}
    </group>
  );
};

export const RecommendationGraph: React.FC<GraphProps> = ({ selectedMovie, recommendations, onSelectMovie }) => {
  if (!selectedMovie) return null;

  const moviePositions = useMemo(() => {
    return recommendations.map((movie, index) => {
      // Logic for positioning:
      // Distance from center = 1 - score (normalized roughly)
      // Angle = spread evenly
      const distance = (1.1 - movie.score) * 10;
      const angle = (index / recommendations.length) * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const y = (movie.avgRating - 3) * 3; // Height based on rating
      
      return {
        movie,
        position: [x, y, z] as [number, number, number],
        color: `hsl(${20 + movie.score * 40}, 100%, 50%)` // Shift from orange to yellow based on similarity
      };
    });
  }, [recommendations]);

  const itemPositions = moviePositions.map(p => p.position);

  return (
    <div className="w-full h-[500px] bg-[#050505] border border-editorial-border rounded-sm relative overflow-hidden group">
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <span className="text-[10px] uppercase tracking-widest text-editorial-accent font-bold">Mapa de Similitud 3D</span>
        <p className="text-[9px] text-editorial-dim mt-1 max-w-[200px]">
          Distancia = 1 - Similitud<br />
          Altura (Y) = Calificación Avg<br />
          Tamaño = Popularidad
        </p>
      </div>

      <Canvas dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[0, 5, 15]} fov={50} />
        <OrbitControls 
          enablePan={false} 
          minDistance={5} 
          maxDistance={25} 
          autoRotate 
          autoRotateSpeed={0.5}
        />
        
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <Stars radius={50} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

        {/* Center Movie */}
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
          <MovieNode 
            movie={selectedMovie} 
            position={[0, 0, 0]} 
            color="#ff4d00" 
            isCenter 
            onClick={() => {}}
          />
        </Float>

        {/* Recommendations */}
        {moviePositions.map((p) => (
          <MovieNode 
            key={p.movie.movieId} 
            movie={p.movie} 
            position={p.position} 
            color={p.color}
            onClick={() => onSelectMovie(p.movie)}
          />
        ))}

        <Connections items={itemPositions} />
      </Canvas>

      <div className="absolute bottom-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[9px] text-editorial-dim">PULSA Y ARRASTRA PARA EXPLORAR</span>
      </div>
    </div>
  );
};
