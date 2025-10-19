FROM node:18-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache docker-cli

COPY package*.json ./

RUN npm install

COPY . .



CMD ["npm", "run", "dev"]

