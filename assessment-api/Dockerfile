# Use a modern Node version that supports Vite and Gemini
FROM node:20-alpine

# 1. Set the working directory (created as root)
WORKDIR /usr/src/app

# Copy the entrypoint script and make it executable (must be done by root)
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install Gemini CLI and nodemon globally
RUN npm install -g @google/gemini-cli nodemon && chmod +x $(which nodemon)

# 2. Grant ownership of the workdir to the node user for the build steps
RUN chown -R node:node /usr/src/app

# 3. Switch to the non-root 'node' user
USER node

# 4. Copy and install dependencies as the 'node' user
COPY package*.json ./
RUN npm install

# 5. Copy the rest of the application files
COPY . .

# 6. Ensure local nodemon binary is executable (prevents “Permission denied”)
RUN chmod +x ./node_modules/.bin/nodemon || true

EXPOSE 3000

# 7. Use the entrypoint and run the dev server
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
