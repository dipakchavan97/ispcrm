#!/bin/sh
set -e

echo "[SSTP-PROD] Starting ISPCRM Production SSTP VPN Concentrator..."

# 1. Setup PPP character device node (c 108 0)
if [ ! -c /dev/ppp ]; then
    echo "[SSTP-PROD] Creating /dev/ppp character device node..."
    mknod /dev/ppp c 108 0 2>/dev/null || true
    chmod 600 /dev/ppp 2>/dev/null || true
fi

# 2. Setup TUN/TAP device node (c 10 200)
if [ ! -c /dev/net/tun ]; then
    echo "[SSTP-PROD] Creating /dev/net/tun character device node..."
    mkdir -p /dev/net
    mknod /dev/net/tun c 10 200 2>/dev/null || true
    chmod 666 /dev/net/tun 2>/dev/null || true
fi

# 3. Enable kernel IPv4 forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null || sysctl -w net.ipv4.ip_forward=1 2>/dev/null || true
echo "[SSTP-PROD] Kernel IP Forwarding status: $(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo 'active')"

# 4. Verify Production TLS Certificates
if [ ! -f /etc/ssl/sstp/fullchain.pem ] || [ ! -f /etc/ssl/sstp/privkey.pem ]; then
    echo "[SSTP-PROD] ERROR: Production TLS certificates not found at /etc/ssl/sstp/!"
    echo "[SSTP-PROD] Expected fullchain.pem and privkey.pem (from Let's Encrypt or your Certificate Authority)."
    echo "[SSTP-PROD] Mount them into /etc/ssl/sstp/ before launching the production container."
    exit 1
fi
echo "[SSTP-PROD] Validated production TLS certificates: fullchain.pem and privkey.pem present."

# 5. Initialize chap-secrets if not present
mkdir -p /etc/ppp
if [ ! -f /etc/ppp/chap-secrets ]; then
    echo "[SSTP-PROD] Initializing /etc/ppp/chap-secrets..."
    cat << 'EOF' > /etc/ppp/chap-secrets
# Secrets for authentication using CHAP
# client	server	secret			IP addresses
EOF
    chmod 600 /etc/ppp/chap-secrets
fi

# 6. Initialize ip-up and ip-down scripts
cat << 'EOF' > /etc/ppp/ip-up
#!/bin/sh
echo "[PPP-UP] $(date -u +'%Y-%m-%dT%H:%M:%SZ') Interface $1 opened for client $2 with IP $4 (peer $5)" >> /var/log/accel-ppp/ppp-events.log
exit 0
EOF
chmod +x /etc/ppp/ip-up

cat << 'EOF' > /etc/ppp/ip-down
#!/bin/sh
echo "[PPP-DOWN] $(date -u +'%Y-%m-%dT%H:%M:%SZ') Interface $1 closed for client $2" >> /var/log/accel-ppp/ppp-events.log
exit 0
EOF
chmod +x /etc/ppp/ip-down

# 7. Configure iptables forwarding & NAT rules
mkdir -p /var/log/accel-ppp
iptables -A FORWARD -i sstp+ -o eth0 -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -i eth0 -o sstp+ -j ACCEPT 2>/dev/null || true
iptables -t nat -A POSTROUTING -o sstp+ -j MASQUERADE 2>/dev/null || true

# Forward RADIUS traffic from SSTP tunnel interfaces to FreeRADIUS container
FREERADIUS_IP=$(getent hosts ispcrm-freeradius 2>/dev/null | awk '{ print $1 }' | head -n 1)
[ -z "$FREERADIUS_IP" ] && FREERADIUS_IP="172.23.0.2"

iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 1812 -j DNAT --to-destination ${FREERADIUS_IP}:1812 2>/dev/null || true
iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 1813 -j DNAT --to-destination ${FREERADIUS_IP}:1813 2>/dev/null || true
iptables -t nat -A PREROUTING -i sstp+ -p udp --dport 3799 -j DNAT --to-destination ${FREERADIUS_IP}:3799 2>/dev/null || true

iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 1812 -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 1813 -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -d ${FREERADIUS_IP} -p udp --dport 3799 -j MASQUERADE 2>/dev/null || true

# Copy production configuration template
cp /etc/accel-ppp.prod.conf /etc/accel-ppp.conf

echo "[SSTP-PROD] Launching accel-pppd on port 443 with production TLS..."
exec accel-pppd -c /etc/accel-ppp.conf -p /var/run/accel-pppd.pid
