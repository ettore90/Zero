FROM node:18-alpine
WORKDIR /app

RUN apk add --no-cache git openssh-client bash curl python3 py3-pip alpine-sdk

# The container runs as root while the bind-mounted repos belong to the host
# user (uid 1000), so git refuses them with "detected dubious ownership" and
# every /git/* route fails. Scoped to the paths that are actually mounted
# rather than the blanket '*'; the trailing /* prefix form needs git >= 2.36.
RUN git config --system --add safe.directory '/app' \
 && git config --system --add safe.directory '/uby' \
 && git config --system --add safe.directory '/uby/*'

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_APP_BASE_PATH
ARG VITE_DEV_SERVER_TARGET
ARG VITE_APP_DISPLAY_NAME
ARG VITE_SHARED_ASSETS_PUBLIC_PATH
ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH}
ENV VITE_DEV_SERVER_TARGET=${VITE_DEV_SERVER_TARGET}
ENV VITE_APP_DISPLAY_NAME=${VITE_APP_DISPLAY_NAME}
ENV VITE_SHARED_ASSETS_PUBLIC_PATH=${VITE_SHARED_ASSETS_PUBLIC_PATH}
RUN npm run build


CMD ["node", "server.js"]
