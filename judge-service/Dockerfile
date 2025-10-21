FROM node:20-alpine

ARG DOCKER_GID=103 # Default to 103, but will be overridden by build-arg

# Create non-root user for this service
RUN addgroup -S judge && adduser -S judge -G judge
# Create docker group with host's docker GID and add judge user to it


WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY src ./src
COPY models ./models

# Ensure correct ownership
RUN chown -R judge:judge /usr/src/app/node_modules
RUN chown -R judge:judge /usr/src/app/src
RUN chown -R judge:judge /usr/src/app/models

USER judge
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
