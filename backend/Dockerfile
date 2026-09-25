# Stage 1: Builder
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o server ./cmd/server

# Stage 2: minimal runtime
FROM alpine:3.20
RUN apk --no-cache add ca-certificates \
    && adduser -D -H -u 10001 app
WORKDIR /app
COPY --from=builder /app/server .
USER app
EXPOSE 8080
CMD ["./server"]
