FROM rust:1-alpine

RUN apk add --no-cache build-base

# Create a non-root user 'judge'
RUN addgroup -S judge && adduser -S -G judge judge

ENV CARGO_HOME=/tmp/.cargo
WORKDIR /app

USER judge
