# syntax=docker/dockerfile:1
# Build context: repository root (needs the npm workspace + @passman/core).
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json tsconfig*.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY packages/extension/package.json packages/extension/
RUN npm ci --workspace=@passman/core --workspace=@passman/web --include-workspace-root

COPY packages/core packages/core
COPY packages/web packages/web
RUN npm run build --workspace=@passman/core \
 && npm run build --workspace=@passman/web

FROM nginx:1.27-alpine
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
EXPOSE 80
