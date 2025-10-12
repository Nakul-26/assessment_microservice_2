FROM node:18-alpine

# 1. Set the working directory
WORKDIR /usr/src/app

# 2. Switch to the non-root 'node' user *before* copying and installing
# This ensures that all files installed by npm are owned by the 'node' user.
USER node

# 3. Copy only the manifest files and set ownership
# The --chown=node:node is often redundant after the USER command, but it's
# a good defensive practice and necessary if USER was placed later.
COPY package*.json ./

# 4. Install dependencies as the 'node' user
RUN npm install

# 5. Copy the rest of the application files (also owned by 'node')
COPY . .

EXPOSE 3000

# 6. The final command runs as the 'node' user, which now has permission
# to execute the nodemon binary in node_modules/.bin
CMD ["npm", "run", "dev"]