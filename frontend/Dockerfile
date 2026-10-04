# Stage 1: Builder React
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: lightweight Nginx runtime, as a non-root user (uid 101) listening on 8080
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Turned into /etc/nginx/conf.d/default.conf at startup, with NORNIR_BACKEND_URL substituted
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Address of the backend (docker compose service name; the Helm chart sets its Service)
ENV NORNIR_BACKEND_URL=http://backend:8080
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
