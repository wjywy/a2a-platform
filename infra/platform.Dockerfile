FROM node:22-alpine AS build
WORKDIR /app
# The runtime image serves API and Worker code only. The console has a separate
# image, so do not build Vite here as well when BuildKit builds services in
# parallel on the release runner.
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package.json ./
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY apps/admin-console/package.json apps/admin-console/package.json
COPY apps/health-worker/package.json apps/health-worker/package.json
RUN npm install
COPY . .
RUN npm --workspace @a2a-platform/api run build \
 && npm --workspace @a2a-platform/health-worker run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "--workspace", "@a2a-platform/api", "run", "start"]
