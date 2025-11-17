FROM eclipse-temurin:11-jdk-alpine

# Create a non-root user 'judge'
RUN addgroup --system judge && adduser --system --ingroup judge judge

# Set the user
USER judge
