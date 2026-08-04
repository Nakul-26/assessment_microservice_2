FROM eclipse-temurin:11-jdk
# NOTE: eclipse-temurin:11-jdk-alpine is amd64-only (no arm64 manifest), which
# breaks builds on ARM64 hosts with "no match for platform in manifest".
# The Debian/Ubuntu-based (non-alpine) tag is multi-arch, so use that instead.

# Create a non-root user 'judge'
RUN addgroup --system judge && adduser --system --ingroup judge judge

# Download Gson library
ARG GSON_VERSION=2.10.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && wget -O /tmp/gson.jar https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar \
    && mkdir -p /usr/share/java \
    && mv /tmp/gson.jar /usr/share/java/gson.jar \
    && apt-get purge -y --auto-remove wget \
    && rm -rf /var/lib/apt/lists/*

ENV CLASSPATH /usr/share/java/gson.jar:.

# Set the user
USER judge
