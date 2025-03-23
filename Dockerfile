FROM oven/bun:latest

WORKDIR /app

# Copy package.json and lockfile
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Create and set up data volume
ENV DATA_DIR=/data
VOLUME ["${DATA_DIR}"]

# Expose necessary ports
ENV PORT=5432
ENV NODE_ENV=production
EXPOSE ${PORT}

# Run the application
CMD ["bun", "run", "src/index.ts"]