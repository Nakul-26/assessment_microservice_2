FROM node:20-alpine

WORKDIR /usr/src/app

# Copy contracts directory so schema validation works in production
COPY contracts /usr/src/contracts
COPY contracts ./contracts

# Switch to non-root user workspace
RUN chown -R node:node /usr/src/app /usr/src/contracts
USER node

# Install production dependencies only
COPY assessment-api/package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY assessment-api/ .

EXPOSE 5000

CMD ["node", "src/server.js"]
