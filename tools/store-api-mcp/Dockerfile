# Hosted MCP server (src/http.js) for Cloud Run. Small and dependency-light:
# production deps only, non-root, listens on $PORT.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
ENV NODE_ENV=production
CMD ["node", "src/http.js"]
