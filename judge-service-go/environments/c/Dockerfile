FROM gcc:latest

# Install json-c for the C wrapper harness
RUN apt-get update \
    && apt-get install -y --no-install-recommends libjson-c-dev \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user 'judge'
RUN addgroup --system judge && adduser --system --ingroup judge judge

# Set the user
USER judge
