FROM node:18-alpine

# 1. Set the working directory (created as root)
WORKDIR /usr/src/app

# Copy the entrypoint script and make it executable (must be done by root)
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 2. Grant ownership of the workdir to the node user for the build steps
# This fixes the EACCES error during 'npm install'
RUN chown -R node:node /usr/src/app

# 3. Switch to the non-root 'node' user
USER node

# 4. Copy and install dependencies as the 'node' user
COPY package*.json ./
RUN npm install

# 5. Copy the rest of the application files
COPY . .

EXPOSE 3000

# 6. Use the entrypoint script to set permissions at runtime 
# (for mounted files) and then run the development command.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
