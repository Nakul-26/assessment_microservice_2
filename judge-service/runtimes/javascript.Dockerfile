FROM node:18-alpine
WORKDIR /app
COPY judge-service/wrappers/javascript_runner.js .

# Enable ESM mode globally
COPY judge-service/runtimes/javascript/package*.json ./
RUN npm install
COPY . .

# Add "type": "module" dynamically if not in package.json
# RUN jq '. + {"type": "module"}' package.json > temp.json && mv temp.json package.json

CMD ["node", "javascript_runner.js"]
