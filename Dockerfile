# =============================================
# Experience AI — Dockerfile Backend (Express / Node.js)
# =============================================
#
# NOTE — Docker n'est PAS utilisé en production.
# -----------------------------------------------------------------
# Render déploie via le runtime Node natif (render.yaml → `runtime: node`) :
# il exécute directement `buildCommand` puis `startCommand` et IGNORE ce
# Dockerfile. Ce fichier n'a donc AUCUN effet sur le déploiement Render.
#
# Pourquoi le conserver alors ?
#   - Portabilité : permet de lancer Experience AI sur n'importe quelle plateforme
#     de conteneurs (Kubernetes, ECS, Fly.io...) sans réécriture.
#   - Reproductibilité locale : `docker build` fige l'environnement et met fin
#     au « ça marche sur ma machine ».
# Choix pragmatique : ne pas payer la complexité Docker en prod tant que le
# PaaS suffit, tout en gardant la porte ouverte pour plus tard.
# =============================================

FROM node:20-alpine

# Dossier de travail
WORKDIR /app

# Copie des dépendances en premier (optimise le cache Docker)
COPY package*.json ./

# Copie du schéma Prisma AVANT l'install :
# le script "postinstall" lance `prisma generate`, qui lit prisma/schema.prisma
COPY prisma/ ./prisma/

# Installation des dépendances (avec devDependencies pour TypeScript)
RUN npm install

# Copie du code source backend
COPY server/ ./server/
COPY tsconfig.json ./

# Copie et build du frontend React
COPY client-react/ ./client-react/
RUN cd client-react && npm install && npm run build

# Compile TypeScript → dist-server/
RUN npx tsc

# Port exposé
EXPOSE 3000

# Démarrage depuis le dossier compilé
CMD ["node", "dist-server/index.js"]
