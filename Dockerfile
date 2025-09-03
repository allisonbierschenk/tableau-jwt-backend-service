# Multi-stage build for faster deployment
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --no-audit --no-fund && npm cache clean --force

# Copy source code from builder
COPY --from=builder /app/server.js ./
COPY --from=builder /app/users.csv ./
COPY --from=builder /app/userStore.csv ./

# Create downloads directory
RUN mkdir -p downloads

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3333

# Start the application
CMD ["node", "server.js"]
