// TRIPGENIE — server/index.ts (Point d'entrée backend)

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';

// Middlewares persos
import { gestionnairreErreurGlobal, AppError } from './lib/AppError.js';

// Spécification OpenAPI (interface Swagger sur /api/docs)
import { openapiSpec } from './docs/openapi.js';

// Routes
import authRoutes from './routes/auth.js';
import tripsRoutes from './routes/trips.js';
import aiRoutes from './routes/ai.js';
import votesRoutes from './routes/votes.js';
import photosRoutes from './routes/photos.js';
import preferencesRoutes from './routes/preferences.js';
import collaboratorsRoutes from './routes/collaborators.js';
import parcoursRoutes from './routes/parcours.js';

// ---- Fail-fast : variables critiques obligatoires ----
// Si JWT_SECRET est absent, jwt.sign/verify échouera silencieusement à l'exécution.
// On préfère un crash immédiat au démarrage — plus honnête et plus sûr.
if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET manquant — définissez-le dans .env avant de démarrer');
}
if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL absent — aucun accès base de données possible');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration ESM pour les chemins statiques
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render (et tout reverse-proxy) ajoute X-Forwarded-For — requis pour que
// express-rate-limit identifie correctement l'IP réelle des clients.
app.set('trust proxy', 1);

// ---- Sécurité HTTP headers ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://images.pexels.com', 'https://cdnjs.cloudflare.com', 'https://server.arcgisonline.com'],
      fontSrc:    ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
    },
  },
}));

// ---- Configuration CORS ----
// En PROD, le front React est servi par CE MÊME serveur Express (même origine) :
// CORS n'est alors pas déclenché. CLIENT_URL ne couvre que le cas où le front
// serait déployé sur un domaine séparé. En DEV, le navigateur tape Vite (3001),
// qui proxifie vers l'API (3000) → même origine également.
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3001',
  credentials: true, // autorise l'envoi du cookie httpOnly
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ---- Middlewares de base ----
app.use(express.json({ limit: '1mb' }));

// Parse automatiquement les cookies envoyés par le navigateur.
// Permet de récupérer facilement le JWT via req.cookies.
app.use(cookieParser());

// Logging : format lisible en dev, compact en prod
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- Routes API ----
app.use('/api/auth', authRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/trips', collaboratorsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/votes', votesRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/parcours', parcoursRoutes);

// Healthcheck pour s'assurer que le backend tourne
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- Documentation interactive de l'API (Swagger UI) ----
// Disponible sur http://localhost:3000/api/docs — on y lit ET teste chaque route.
// CSP dédiée à cette route : le helmet() global interdit l'inline (anti-XSS), mais
// Swagger UI injecte un <script>/<style> inline pour s'initialiser. On relâche donc
// la CSP UNIQUEMENT ici (route de doc), sans toucher à la politique stricte du reste.
const swaggerCsp = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'", "'unsafe-inline'"],
    styleSrc:   ["'self'", "'unsafe-inline'"],
    imgSrc:     ["'self'", 'data:', 'https:'],
    fontSrc:    ["'self'", 'https:', 'data:'],
  },
});
app.use(
  '/api/docs',
  swaggerCsp,
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'TripGenie API — Documentation',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }),
);
// Spec brute (JSON) — utile pour Postman/Insomnia (Import → OpenAPI)
app.get('/api/docs.json', (req, res) => res.json(openapiSpec));

// Gestion Frontend (Mode Production)
// En production, Express joue deux rôles :
// 1- répond aux routes API (/api/...)
// 2- sert également le build React généré par Vite (client-react/dist)
// une seule application Render héberge à la fois le frontend et le backend
// En développement, le frontend est lancé par Vite (localhost:3001) et communique avec Express
if (process.env.NODE_ENV === 'production') {
  console.log('Serveur en mode PRODUCTION - Service des fichiers React statiques');
  
  // Sert les fichiers statiques construits par Vite
  app.use(express.static(path.join(__dirname, '../client-react/dist')));

// Toute route qui n'est pas une API renvoie index.html
// React Router prend ensuite le relais côté navigateur pour afficher la bonne page
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, '../client-react/dist/index.html'));
  });
}

// ---- Gestion des routes non trouvées (404 API) ----
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// ---- Middleware Global d'erreurs ----
app.use(gestionnairreErreurGlobal);

export default app;

// ---- Lancement du serveur (pas en mode test) ----
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`\nServeur backend démarré sur http://localhost:${PORT}`);
    console.log(`Environnement : ${process.env.NODE_ENV || 'development'}`);
    console.log(`PostgreSQL (Prisma ORM) : ${process.env.DATABASE_URL ? 'OUI' : 'NON'}`);
    console.log(`AI Provider: ${process.env.AI_PROVIDER || 'NON DÉFINI'}`);
  });

  // Arrêt propre pour éviter EADDRINUSE lors des redémarrages nodemon
  const shutdown = () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}
