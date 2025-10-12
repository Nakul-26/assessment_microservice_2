FROM node:18-alpine

# 1. Set the working directory (created as root)
WORKDIR /usr/src/app

# ADD THIS STEP: Change ownership of the WORKDIR to the 'node' user
# The default user in node:alpine is root up until the 'USER node' step.
# We must use root to chown the directory it created.
RUN chown -R node:node /usr/src/app

# 2. Switch to the non-root 'node' user
USER node

# 3. Copy only the manifest files
COPY package*.json ./

# 4. Install dependencies as the 'node' user
# This will now succeed because the 'node' user owns /usr/src/app.
RUN npm install

# 5. Copy the rest of the application files
COPY . .

EXPOSE 3000

# 6. The final command runs as the 'node' user
CMD ["npm", "run", "dev"]