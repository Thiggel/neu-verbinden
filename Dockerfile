# The API server, its engine and the city data in one image.
#
# The data is baked in rather than mounted: the figures a published plan carries
# must be reproducible, and a container that finds a different dataset than the
# one it was built against would quietly recompute them into something else.
# `HH_DATA_VERSION` pins which files are read, and the version is in the name.

FROM rust:1-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*
# Manifests first, so a change to the source does not re-download every crate.
COPY rust/Cargo.toml rust/Cargo.lock ./
COPY rust/core/Cargo.toml core/
COPY rust/cli/Cargo.toml cli/
COPY rust/server/Cargo.toml server/
COPY rust/wasm/Cargo.toml wasm/
RUN mkdir -p core/src cli/src server/src wasm/src \
 && echo 'fn main(){}' > server/src/main.rs \
 && echo 'fn main(){}' > cli/src/main.rs \
 && touch core/src/lib.rs wasm/src/lib.rs \
 && cargo build --release -p hh-server 2>/dev/null || true
COPY rust/ ./
# The migrations are read at compile time by `sqlx::migrate!`, so they have to
# be present before this build, not only at runtime.
RUN touch server/src/main.rs && cargo build --release -p hh-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 hh
WORKDIR /app
COPY --from=build /src/target/release/hh-server /usr/local/bin/hh-server
COPY data/dist /app/data
USER hh
ENV HH_DATA_DIR=/app/data \
    HH_ENV=production \
    PORT=8080
EXPOSE 8080
# No shell in the entrypoint: signals reach the process directly, so the
# platform's "stopping" actually stops it rather than waiting for a timeout.
ENTRYPOINT ["hh-server"]
