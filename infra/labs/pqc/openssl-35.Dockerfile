FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d

RUN apk add --no-cache openssl
RUN addgroup -S lab && adduser -S -G lab lab

WORKDIR /lab
USER lab:lab
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD openssl version >/dev/null || exit 1
CMD ["openssl", "version", "-a"]
