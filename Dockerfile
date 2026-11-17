FROM node:24-alpine
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY lib ./lib
COPY public ./public
COPY server.js ./
RUN mkdir /app/data && chown -R node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/orders.sqlite
EXPOSE 3000
CMD ["node", "server.js"]
