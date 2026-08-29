# Build Stage

ARG NODE_VERSION=24
ARG PYTHON_VERSION=3.13
ARG FUNCTION_DIR="/var/task"

FROM nikolaik/python-nodejs:python${PYTHON_VERSION}-nodejs${NODE_VERSION}-slim AS build

RUN apt-get update && apt-get install -y \
        g++ \
        make \
        cmake \
        unzip \
        xz-utils \
        libcurl4-openssl-dev

ARG FUNCTION_DIR

RUN mkdir -p ${FUNCTION_DIR}

COPY download_model.py build_requirements.txt ./
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src/

COPY package.json package-lock.json ${FUNCTION_DIR}

RUN npm ci
RUN npm run typecheck
RUN npm run build -- --outdir=${FUNCTION_DIR}
RUN npm ci --omit=dev --prefix ${FUNCTION_DIR}

RUN pip install --no-cache-dir -r build_requirements.txt
RUN python download_model.py ${FUNCTION_DIR}

# Deploy Stage

FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13 AS deploy

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}
ENV HOME="/tmp"
ENV ROOT_DIR=${FUNCTION_DIR}

COPY --from=build ${FUNCTION_DIR} ${FUNCTION_DIR}

ENTRYPOINT ["/nodejs/bin/node", "/var/task/node_modules/aws-lambda-ric/index.mjs"]

CMD ["index.handler"]
