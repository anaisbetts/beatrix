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
RUN bun run build:all

# Production stage
FROM debian:stable

WORKDIR /dist

# Copy only the dist folder from the builder stage
COPY --from=builder /app/dist /dist

# Remove Windows executable
RUN rm /dist/beatrix-server-win32-x64.exe

# Create and set up data volume
ENV DATA_DIR=/data
VOLUME ["${DATA_DIR}"]

# Create and set up notebook volume
ENV NOTEBOOK_DIR=/notebook
VOLUME ["${NOTEBOOK_DIR}"]

# Expose necessary ports
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE ${PORT}

# Use architecture detection to run the correct binary
CMD if [ "$(uname -m)" = "x86_64" ]; then \
    /dist/beatrix-server-linux-x64 serve -n ${NOTEBOOK_DIR}; \
    elif [ "$(uname -m)" = "aarch64" ]; then \
    /dist/beatrix-server-linux-arm64 -n ${NOTEBOOK_DIR}; \
    else \
    echo "Unsupported architecture: $(uname -m)"; \
    exit 1; \
    fi
