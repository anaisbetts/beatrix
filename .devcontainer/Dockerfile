# DevContainer Dockerfile for Bun + Node.js + Git
FROM oven/bun:latest

# Install git and Node.js (for tooling compatibility)
RUN apt-get update \
	&& apt-get install -y git curl \
	&& curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
	&& apt-get install -y nodejs \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# Set up a non-root user for VS Code (optional, can use root if preferred)
ARG USERNAME=devcontainer
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
	&& useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
	&& chown -R $USERNAME:$USERNAME /home/$USERNAME

USER $USERNAME
WORKDIR /workspace

# Default shell
CMD ["sleep", "infinity"] 