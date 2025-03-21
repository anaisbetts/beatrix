FROM oven/bun:latest

WORKDIR /app

# Copy package.json and lockfile
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Expose necessary ports
ENV PORT=5432
ENV NODE_ENV=production
EXPOSE ${PORT}

# Run the application
CMD ["bun", "run", "src/index.ts"]