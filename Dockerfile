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

RUN mkdir -p ${FUNCTION_DIR}

COPY package.json tsconfig.json src/index.ts ${FUNCTION_DIR}

RUN npm install aws-lambda-ric --prefix ${FUNCTION_DIR}
RUN npm install --prefix ${FUNCTION_DIR}
RUN npm run build --prefix ${FUNCTION_DIR}

# Deploy Stage

FROM node:${NODE_VERSION}-slim AS deploy

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}
ENV ROOT_DIR=${FUNCTION_DIR}

COPY --from=build ${FUNCTION_DIR}/dist/* ${FUNCTION_DIR}

ENTRYPOINT ["npx", "aws-lambda-ric"]

CMD ["index.handler"]
