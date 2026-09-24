FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /build

RUN corepack enable \
    && corepack prepare pnpm@12.3.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.30.5-alpine3.24@sha256:bf3201ab56f23e5954646379c775d511fc466e9f11376d9725361064ad07ed35

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /build/dist/ /usr/share/nginx/html/

RUN nginx -t

USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/v1/healthz || exit 1

ENTRYPOINT ["/usr/sbin/nginx"]
CMD ["-g", "daemon off;"]
