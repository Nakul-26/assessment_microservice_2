FROM golang:1.25.3-alpine

WORKDIR /app

COPY go.mod .
COPY go.sum .
RUN go mod tidy

# Install compilers and libraries for C and C#
RUN apk add --no-cache build-base mono json-c-dev

# Install air for live reloading
RUN go install github.com/air-verse/air@latest

COPY . .

# Change CMD to run air
# air will watch for changes and automatically rebuild/restart
CMD ["air", "-c", ".air.toml"]