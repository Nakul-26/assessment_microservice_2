FROM openjdk:17-slim

WORKDIR /app

# Fetch Gson directly
RUN apt-get update && apt-get install -y wget && \
    wget https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar -P /app/libs && \
    rm -rf /var/lib/apt/lists/*

# Default command
CMD ["java", "-version"]
