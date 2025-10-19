FROM maven:3.8.5-openjdk-17-slim

WORKDIR /app

COPY judge-service/wrappers/JavaRunner.java .
COPY judge-service/wrappers/Solution.java .

RUN echo '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>my-app</artifactId><version>1.0-SNAPSHOT</version><dependencies><dependency><groupId>com.google.code.gson</groupId><artifactId>gson</artifactId><version>2.10.1</version></dependency></dependencies></project>' > pom.xml

RUN mvn dependency:copy-dependencies
RUN javac -cp target/dependency/gson-2.10.1.jar JavaRunner.java Solution.java
