# --- deps stage (caches node_modules) ---
FROM node:20-alpine AS deps
WORKDIR /app

# Copy only manifests first for layer caching
COPY package*.json ./

# Deterministic install; omit dev deps for smaller image
RUN npm ci --omit=dev

# --- runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Bring node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the app
COPY . .

# Default port used by index.js
EXPOSE 7042

# Run the addon (PORT and RD_TOKEN can be set at runtime)
CMD ["node", "index.js"]