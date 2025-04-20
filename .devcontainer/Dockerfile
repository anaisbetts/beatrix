# DevContainer Dockerfile for Bun + Node.js + Git
FROM oven/bun:latest

# Install git and Node.js (for tooling compatibility)
RUN apt-get update \
	&& apt-get install -y git curl \
	&& curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
	&& apt-get install -y nodejs \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# Default shell
CMD ["sleep", "infinity"] 