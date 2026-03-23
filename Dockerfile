# Build Stage

ARG NODE_VERSION=24
ARG FUNCTION_DIR="/app/function/"

FROM node:${NODE_VERSION}-slim AS build

RUN apt-get update && apt-get install -y \
    g++ \
    make \
    cmake \
    unzip \
    libcurl4-openssl-dev

ARG FUNCTION_DIR

RUN mkdir -p ${FUNCTION_DIR}

#COPY download_model.py build_requirements.txt requirements.txt ./
COPY package.json ./

#RUN pip install --no-cache-dir -r build_requirements.txt
#RUN python download_model.py ${FUNCTION_DIR}
#RUN pip install --no-cache-dir awslambdaric --target ${FUNCTION_DIR}
RUN npm install aws-lambda-ric --prefix ${FUNCTION_DIR}
#RUN pip install --no-cache-dir -r requirements.txt --target ${FUNCTION_DIR}
RUN npm install --prefix ${FUNCTION_DIR}

# Deploy Stage

FROM node:${NODE_VERSION}-slim AS deploy

ARG FUNCTION_DIR

WORKDIR ${FUNCTION_DIR}
ENV ROOT_DIR=${FUNCTION_DIR}

COPY --from=build ${FUNCTION_DIR} ${FUNCTION_DIR}
#COPY server.py processor.py embedder.py models.py ./
COPY src/index.ts tsconfig.json ./

#ENTRYPOINT [ "python", "-m", "awslambdaric"]
ENTRYPOINT ["npx", "aws-lambda-ric"]

#CMD [ "server.lambda_handler" ]
CMD ["index.handler"]
