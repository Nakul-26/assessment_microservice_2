FROM node:16-bullseye

RUN apt-get update && apt-get install -y docker.io git autoconf bison flex gcc g++ libprotobuf-dev libnl-route-3-dev libtool make pkg-config protobuf-compiler default-jdk maven

RUN git clone --recursive https://github.com/google/nsjail.git && \
    cd nsjail && \
    make && \
    mv ./nsjail /usr/bin/

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY pom.xml ./
RUN mvn dependency:resolve
RUN mvn dependency:copy-dependencies -DoutputDirectory=./dependencies

COPY . .
COPY nsjail.cfg /app/

CMD ["npm", "run", "dev"]
