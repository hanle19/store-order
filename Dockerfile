FROM node:22-alpine AS client-build
WORKDIR /client

# 使用国内 npm 镜像，设置超时
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-timeout 120000

COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# 确保 UTF-8 编码支持
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# 安装 better-sqlite3 所需的编译工具
RUN apk add --no-cache python3 make g++ sqlite-dev

# 使用国内 npm 镜像
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-timeout 120000

COPY server/package.json server/package-lock.json* ./
RUN npm install --production

# 编译完成后移除构建工具以减小镜像体积
RUN apk del python3 make g++

COPY server/src/ ./src/
COPY --from=client-build /client/dist/ ./public/

RUN mkdir -p /app/data
EXPOSE 3333
CMD ["node", "src/index.js"]
