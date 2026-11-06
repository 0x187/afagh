# ═══ Afagh Go backend service image (the strangler edge) ═══
# Static CGO_ENABLED=0 binary — far lower memory footprint than Next.js on the same server
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/afagh ./cmd/afagh

FROM alpine:3.20
RUN adduser -D -H -u 10001 afagh && apk add --no-cache ca-certificates tzdata
COPY --from=build /out/afagh /usr/local/bin/afagh
USER afagh
EXPOSE 8090
ENTRYPOINT ["afagh"]
