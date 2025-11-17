FROM eclipse-temurin:11-jdk-alpine

# Create a non-root user 'judge'
RUN addgroup --system judge && adduser --system --ingroup judge judge

# Download Gson library
ARG GSON_VERSION=2.10.1
RUN wget -O /tmp/gson.jar https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar \
    && mkdir -p /usr/share/java \
    && mv /tmp/gson.jar /usr/share/java/gson.jar

# Set the user
USER judge
