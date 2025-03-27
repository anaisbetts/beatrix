# Build stage
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package.json and lockfile
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the application
RUN bun run build:ci

# Production stage
FROM debian:stable
WORKDIR /dist

# Copy only the dist folder from the builder stage
COPY --from=builder /app/dist /dist

# Create and set up data volume
ENV DATA_DIR=/data
VOLUME ["${DATA_DIR}"]

# Expose necessary ports
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE ${PORT}

# Run the application
CMD ["/dist/server"]
