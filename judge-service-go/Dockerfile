# Dockerfile (multi-stage) - production-ready
# Builder stage
FROM golang:1.24-alpine AS builder

# Install any native deps needed for build (if using CGO)
RUN apk add --no-cache build-base git

WORKDIR /src
ENV CGO_ENABLED=0
ENV GOFLAGS="-mod=mod"

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags="-s -w" -o /out/go-judge-service .

# Runtime stage (small)
FROM alpine:3.19 AS runtime
RUN apk add --no-cache ca-certificates tzdata
# Create a non-root user
RUN addgroup -S app && adduser -S -G app app

COPY --from=builder /out/go-judge-service /usr/local/bin/go-judge-service
RUN chown app:app /usr/local/bin/go-judge-service

USER app
WORKDIR /app

ENV APP_ENV=production
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/go-judge-service"]

