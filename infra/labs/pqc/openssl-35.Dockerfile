FROM alpine:3.21

RUN apk add --no-cache openssl
RUN addgroup -S lab && adduser -S -G lab lab

WORKDIR /lab
USER lab:lab
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD openssl version >/dev/null || exit 1
CMD ["openssl", "version", "-a"]
