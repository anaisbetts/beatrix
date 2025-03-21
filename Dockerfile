FROM oven/bun:latest

WORKDIR /app

# Copy package.json and lockfile
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Expose any necessary ports
# ENV settings
ENV NODE_ENV=production

# Run the application
CMD ["bun", "run", "src/index.ts"]