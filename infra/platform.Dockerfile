FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY apps/admin-console/package.json apps/admin-console/package.json
COPY apps/health-worker/package.json apps/health-worker/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "--workspace", "@a2a-platform/api", "run", "start"]
