#!/bin/sh
set -e

echo "=== APP CERTIFICATE ==="
openssl x509 -in /certs/app/fullchain.pem -noout -subject -issuer -dates -ext subjectAltName

echo "=== APP KEY MATCH CHECK ==="
PUB_CERT_APP=$(openssl x509 -in /certs/app/fullchain.pem -pubkey -noout | sha256sum | awk '{print $1}')
PUB_KEY_APP=$(openssl pkey -in /certs/app/privkey.pem -pubout 2>/dev/null | sha256sum | awk '{print $1}')
echo "App Cert Pubkey SHA256: ${PUB_CERT_APP}"
echo "App Key  Pubkey SHA256: ${PUB_KEY_APP}"
if [ "${PUB_CERT_APP}" = "${PUB_KEY_APP}" ]; then
    echo "[PASS] app.cloudsetup.in certificate matches private key."
else
    echo "[FAIL] app.cloudsetup.in certificate does NOT match private key!"
    exit 1
fi

echo ""
echo "=== SSTP CERTIFICATE ==="
openssl x509 -in /certs/sstp/fullchain.pem -noout -subject -issuer -dates -ext subjectAltName

echo "=== SSTP KEY MATCH CHECK ==="
PUB_CERT_SSTP=$(openssl x509 -in /certs/sstp/fullchain.pem -pubkey -noout | sha256sum | awk '{print $1}')
PUB_KEY_SSTP=$(openssl pkey -in /certs/sstp/privkey.pem -pubout 2>/dev/null | sha256sum | awk '{print $1}')
echo "SSTP Cert Pubkey SHA256: ${PUB_CERT_SSTP}"
echo "SSTP Key  Pubkey SHA256: ${PUB_KEY_SSTP}"
if [ "${PUB_CERT_SSTP}" = "${PUB_KEY_SSTP}" ]; then
    echo "[PASS] vpn.cloudsetup.in certificate matches private key."
else
    echo "[FAIL] vpn.cloudsetup.in certificate does NOT match private key!"
    exit 1
fi

echo ""
echo "=== PUBLIC TRUST CHAIN VERIFICATION ==="
openssl verify -untrusted /certs/app/fullchain.pem /certs/app/fullchain.pem
openssl verify -untrusted /certs/sstp/fullchain.pem /certs/sstp/fullchain.pem

echo "[PASS] All certificate verifications passed successfully."
