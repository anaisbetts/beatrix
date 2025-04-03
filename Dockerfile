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

# Define build argument for architecture (defaulting to x64)
ARG ARCH=x64
ENV ARCH=${ARCH}

WORKDIR /dist

# Copy only the dist folder from the builder stage
COPY --from=builder /app/dist /dist

# Keep only the binary for the specified architecture
RUN if [ "$ARCH" = "x64" ]; then \
    rm /dist/beatrix-server-win32-x64.exe /dist/beatrix-server-linux-arm64; \
    elif [ "$ARCH" = "arm64" ]; then \
    rm /dist/beatrix-server-win32-x64.exe /dist/beatrix-server-linux-x64; \
    fi

# Create and set up data volume
ENV DATA_DIR=/data
VOLUME ["${DATA_DIR}"]

# Expose necessary ports
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE ${PORT}

# Run the appropriate binary based on architecture
CMD if [ "$ARCH" = "x64" ]; then \
    /dist/beatrix-server-linux-x64; \
    elif [ "$ARCH" = "arm64" ]; then \
    /dist/beatrix-server-linux-arm64; \
    fi
