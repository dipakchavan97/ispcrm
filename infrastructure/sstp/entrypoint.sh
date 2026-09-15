#!/bin/sh
set -e

echo "[SSTP-INIT] Starting ISPCRM SSTP VPN Concentrator Initialization..."

# 1. Setup PPP character device node
if [ ! -c /dev/ppp ]; then
    echo "[SSTP-INIT] Creating /dev/ppp character device node (c 108 0)..."
    mknod /dev/ppp c 108 0 2>/dev/null || true
    chmod 600 /dev/ppp 2>/dev/null || true
fi

# 2. Setup TUN/TAP device node if needed
if [ ! -c /dev/net/tun ]; then
    echo "[SSTP-INIT] Creating /dev/net/tun character device node..."
    mkdir -p /dev/net
    mknod /dev/net/tun c 10 200 2>/dev/null || true
    chmod 666 /dev/net/tun 2>/dev/null || true
fi

# 3. Enable kernel IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null || sysctl -w net.ipv4.ip_forward=1 2>/dev/null || true
echo "[SSTP-INIT] IP Forwarding status: $(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo 'unknown')"

# 4. Initialize chap-secrets if not present
mkdir -p /etc/ppp
if [ ! -f /etc/ppp/chap-secrets ]; then
    echo "[SSTP-INIT] Initializing /etc/ppp/chap-secrets..."
    cat << 'EOF' > /etc/ppp/chap-secrets
# Secrets for authentication using CHAP
# client	server	secret			IP addresses
EOF
    chmod 600 /etc/ppp/chap-secrets
fi

# 5. Initialize ip-up and ip-down scripts
cat << 'EOF' > /etc/ppp/ip-up
#!/bin/sh
echo "[PPP-UP] Interface $1 opened for client $2 with IP $4 (peer $5)" >> /var/log/accel-ppp/ppp-events.log
exit 0
EOF
chmod +x /etc/ppp/ip-up

cat << 'EOF' > /etc/ppp/ip-down
#!/bin/sh
echo "[PPP-DOWN] Interface $1 closed for client $2" >> /var/log/accel-ppp/ppp-events.log
exit 0
EOF
chmod +x /etc/ppp/ip-down

# 6. TLS PKI Setup (Root CA + Server Certificate with SAN)
mkdir -p /etc/ssl/sstp
if [ ! -f /etc/ssl/sstp/server.crt ] || [ ! -f /etc/ssl/sstp/server.key ]; then
    echo "[SSTP-INIT] Generating TLS PKI (Root CA + Server Certificate with SAN)..."
    
    # Generate CA private key and self-signed certificate
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout /etc/ssl/sstp/ca.key \
        -out /etc/ssl/sstp/ca.crt \
        -days 3650 \
        -subj "/C=US/ST=State/L=City/O=ISP CRM/OU=VPN Infrastructure/CN=ISPCRM Root CA"

    # Create OpenSSL configuration for Server Certificate with SANs
    cat << 'EOF' > /tmp/openssl-sstp.cnf
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = ISP CRM
OU = SSTP Concentrator
CN = vpn.ispcrm.com

[v3_req]
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = vpn.ispcrm.com
DNS.2 = localhost
DNS.3 = *.ispcrm.local
IP.1 = 127.0.0.1
IP.2 = 172.18.23.172
IP.3 = 103.170.1.22
IP.4 = 10.200.0.1
EOF

    # Generate Server private key and CSR
    openssl req -new -nodes \
        -keyout /etc/ssl/sstp/server.key \
        -out /tmp/server.csr \
        -config /tmp/openssl-sstp.cnf

    # Sign Server Certificate using Root CA
    openssl x509 -req -in /tmp/server.csr \
        -CA /etc/ssl/sstp/ca.crt \
        -CAkey /etc/ssl/sstp/ca.key \
        -CAcreateserial \
        -out /etc/ssl/sstp/server.crt \
        -days 3650 \
        -extfile /tmp/openssl-sstp.cnf \
        -extensions v3_req

    rm -f /tmp/server.csr /tmp/openssl-sstp.cnf
    chmod 600 /etc/ssl/sstp/*.key
    chmod 644 /etc/ssl/sstp/*.crt
    echo "[SSTP-INIT] TLS Certificates generated successfully."
fi

# 7. Setup firewall forwarding and NAT rules
iptables -A FORWARD -i sstp+ -o eth0 -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -i eth0 -o sstp+ -j ACCEPT 2>/dev/null || true
iptables -t nat -A POSTROUTING -o sstp+ -j MASQUERADE 2>/dev/null || true
# Forward RADIUS traffic from SSTP tunnel interfaces to FreeRADIUS container
# Resolve FreeRADIUS IP that is reachable on eth0's local subnet
SSTP_SUBNET_PREFIX=$(ip -o -4 addr show eth0 | awk '{print $4}' | cut -d. -f1-2)
FREERADIUS_IP=$(getent hosts ispcrm-freeradius 2>/dev/null | awk '{ print $1 }' | grep "^${SSTP_SUBNET_PREFIX}\." | head -n 1)
[ -z "$FREERADIUS_IP" ] && FREERADIUS_IP="172.23.0.3"

iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 1812 -j DNAT --to-destination ${FREERADIUS_IP}:1812 2>/dev/null || true
iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 1813 -j DNAT --to-destination ${FREERADIUS_IP}:1813 2>/dev/null || true
iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 3799 -j DNAT --to-destination ${FREERADIUS_IP}:3799 2>/dev/null || true

iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 1812 -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 1813 -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 3799 -j MASQUERADE 2>/dev/null || true

# 8. Copy configuration file
cp /etc/accel-ppp/accel-ppp.conf.template /etc/accel-ppp/accel-ppp.conf

echo "[SSTP-INIT] Launching accel-pppd on port 443..."
exec /usr/sbin/accel-pppd -c /etc/accel-ppp/accel-ppp.conf
