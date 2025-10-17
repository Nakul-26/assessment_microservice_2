FROM node:18-alpine

WORKDIR /usr/src/app

# Install compilers and runtimes
RUN apk add --no-cache \
    python3 \
    openjdk17-jdk \
    g++

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
