# Build Stage

ARG NODE_VERSION=24
ARG FUNCTION_DIR="/var/task"

FROM node:${NODE_VERSION}-alpine AS build

RUN apk update && apk add \
    g++ \
    make \
    cmake \
    unzip \
    python3 \
    elfutils-dev

ARG FUNCTION_DIR

RUN mkdir -p ${FUNCTION_DIR}

COPY package.json tsconfig.json ./
COPY src ./src/

COPY package.json ${FUNCTION_DIR}

RUN npm install
RUN npm run typecheck
RUN npm run build -- --outdir=${FUNCTION_DIR}
RUN npm install --omit=dev --prefix ${FUNCTION_DIR}

# Deploy Stage

FROM node:${NODE_VERSION}-alpine AS deploy

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}
ENV HOME="/tmp"
ENV ROOT_DIR=${FUNCTION_DIR}

COPY --from=build ${FUNCTION_DIR} ${FUNCTION_DIR}

ENTRYPOINT ["npx", "aws-lambda-ric"]

CMD ["index.handler"]