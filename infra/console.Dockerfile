FROM node:22-alpine AS build
WORKDIR /app
# See platform.Dockerfile: server-side builds run on a small production host.
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package.json ./
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY apps/admin-console/package.json apps/admin-console/package.json
COPY apps/health-worker/package.json apps/health-worker/package.json
RUN npm install
COPY . .
RUN npm --workspace @a2a-platform/console run build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/admin-console/dist /usr/share/nginx/html
COPY infra/console-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
