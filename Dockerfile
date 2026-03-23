# Build Stage

ARG NODE_VERSION=24
ARG FUNCTION_DIR="/app/function/"

FROM node:${NODE_VERSION}-slim AS build

RUN apt-get update && apt-get install -y \
    g++ \
    make \
    cmake \
    unzip \
    xz-utils \
    python3 \
    libcurl4-openssl-dev

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}

RUN mkdir -p ${FUNCTION_DIR}

COPY package.json tsconfig.json ./
COPY src ./src/

COPY package.json ${FUNCTION_DIR}

RUN npm install
RUN npm run typecheck
RUN npm run build -- --outdir=${FUNCTION_DIR}/dist
RUN npm install --production --prefix ${FUNCTION_DIR}

# Deploy Stage

FROM node:${NODE_VERSION}-slim AS deploy

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}
ENV HOME="/tmp"
ENV ROOT_DIR=${FUNCTION_DIR}

COPY --from=build ${FUNCTION_DIR} ${FUNCTION_DIR}

ENTRYPOINT ["npx", "aws-lambda-ric"]

CMD ["index.handler"]
