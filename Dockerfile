# PulseRelay Dockerfile
# Multi-stage build for production-ready Node.js application with FFmpeg

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install system dependencies needed for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install FFmpeg and other runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    sqlite \
    tini

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S pulserelay -u 1001

# Set working directory
WORKDIR /app

# Copy built node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY --chown=pulserelay:nodejs . .

# Create necessary directories with proper permissions
RUN mkdir -p data logs temp storage public/uploads && \
    chown -R pulserelay:nodejs data logs temp storage public/uploads

# Ensure config files exist (use templates if actual files not present)
RUN if [ ! -f config.json ]; then cp config.json.template config.json; fi && \
    if [ ! -f secret.json ]; then cp secret.json.template secret.json; fi && \
    chown pulserelay:nodejs config.json secret.json

# Expose ports
# HTTP server
EXPOSE 3000
# RTMP server
EXPOSE 1935

# Switch to non-root user
USER pulserelay

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["npm", "start"]
