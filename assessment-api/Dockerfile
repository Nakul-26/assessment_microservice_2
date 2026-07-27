FROM node:20-alpine

WORKDIR /usr/src/app

# Switch to non-root user
RUN chown -R node:node /usr/src/app
USER node

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 5000

CMD ["node", "src/server.js"]
