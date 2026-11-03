FROM node:20-alpine

# Global tools need root, so install them before dropping privileges.
RUN npm install -g serve

# Run as the image's built-in unprivileged "node" user (UID/GID 1000), not
# root. 1000 matches the usual first host user, so files written through the
# ./frontend bind mount (Vite's cache, builds) stay owned by you.
ENV HOME=/home/node
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json* ./
RUN npm install
COPY --chown=node:node . .
RUN npm run build

EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
