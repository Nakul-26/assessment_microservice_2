FROM node:18-alpine

WORKDIR /usr/src/app

# Install compilers and runtimes
RUN apk add --no-cache \
    python3 \
    openjdk17-jdk \
    g++ \
    wget

RUN mkdir -p /usr/local/lib/gson

# Download Gson
RUN wget -O /usr/local/lib/gson/gson-2.10.1.jar https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
