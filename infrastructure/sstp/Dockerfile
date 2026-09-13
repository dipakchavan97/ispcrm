# syntax=docker/dockerfile:1
FROM debian:bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        libssl-dev \
        libpcre2-dev \
        libnl-3-dev \
        libnl-genl-3-dev \
        git \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch 1.14.0 https://github.com/accel-ppp/accel-ppp.git /src/accel-ppp

WORKDIR /src/accel-ppp/build
RUN cmake \
        -DBUILD_IPOE_DRIVER=FALSE \
        -DBUILD_VLAN_MON_DRIVER=FALSE \
        -DCMAKE_INSTALL_PREFIX=/usr \
        -DCMAKE_BUILD_TYPE=Release \
        .. && \
    make -j$(nproc) && \
    make install

# Runtime stage
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        openssl \
        iptables \
        iproute2 \
        libpcre2-8-0 \
        libnl-3-200 \
        libnl-genl-3-200 \
        libssl3 \
        ca-certificates \
        procps \
        net-tools \
        curl && \
    rm -rf /var/lib/apt/lists/*

# Copy compiled binaries and libraries from builder
COPY --from=builder /usr/sbin/accel-pppd /usr/sbin/accel-pppd
COPY --from=builder /usr/bin/accel-cmd /usr/bin/accel-cmd
COPY --from=builder /usr/lib64/accel-ppp /usr/lib64/accel-ppp
COPY --from=builder /usr/share/accel-ppp /usr/share/accel-ppp

# Ensure library search path includes /usr/lib64/accel-ppp
RUN echo "/usr/lib64/accel-ppp" > /etc/ld.so.conf.d/accel-ppp.conf && ldconfig

# Directories for logs, configs, certs, and ppp
RUN mkdir -p /var/log/accel-ppp /etc/accel-ppp /etc/ssl/sstp /etc/ppp /var/run/accel-pppd

COPY accel-ppp.conf.template /etc/accel-ppp/accel-ppp.conf.template
COPY accel-ppp.prod.conf.template /etc/accel-ppp.prod.conf
COPY entrypoint.sh /entrypoint.sh
COPY entrypoint.prod.sh /entrypoint.prod.sh
RUN chmod +x /entrypoint.sh /entrypoint.prod.sh

EXPOSE 443 2001

ENTRYPOINT ["/entrypoint.sh"]
