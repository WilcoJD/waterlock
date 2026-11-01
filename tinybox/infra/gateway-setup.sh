#!/usr/bin/env bash
# White-label gateway on an Ubuntu 24.04 VM (e.g. on UpCloud) with:
#   eth0 = public interface (your brand's IPs; set reverse DNS to your brand)
#   eth1 = private SDN network shared with customer servers (this box = 10.88.0.1)
# Afterwards set in backend .env: GATEWAY_URL=http://10.88.0.1:8787  GATEWAY_TOKEN=<printed token>
#
# Usage: PUBLIC_HOST=ssh.brand.cloud APPS_DOMAIN=apps.brand.cloud bash gateway-setup.sh
set -euo pipefail
PUBLIC_HOST="${PUBLIC_HOST:?set PUBLIC_HOST}"
APPS_DOMAIN="${APPS_DOMAIN:?set APPS_DOMAIN}"
WAN_IF="${WAN_IF:-eth0}"
LAN_IF="${LAN_IF:-eth1}"
LAN_IP="${LAN_IP:-10.88.0.1}"
LAN_SUBNET="${LAN_SUBNET:-10.88.0.0/16}"
VPN_ADDR="${VPN_ADDR:-10.99.0.1/16}"
PROXMOX_ROUTE="${PROXMOX_ROUTE:-}"   # e.g. "10.77.0.0/16 via 10.88.0.10" to reach LXC containers on a Proxmox node
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

apt-get update -y
apt-get install -y wireguard-tools iptables curl debian-keyring debian-archive-keyring apt-transport-https gnupg
# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y caddy nodejs

cat > /etc/sysctl.d/90-gateway.conf <<SYS
net.ipv4.ip_forward=1
net.ipv4.conf.all.rp_filter=2
SYS
sysctl --system >/dev/null

# Private interface
cat > /etc/netplan/60-private.yaml <<NET
network:
  version: 2
  ethernets:
    ${LAN_IF}:
      addresses: [${LAN_IP}/16]
NET
if [[ -n "$PROXMOX_ROUTE" ]]; then
  read -r PNET _ PVIA <<< "$PROXMOX_ROUTE"
  cat >> /etc/netplan/60-private.yaml <<NET
      routes:
        - to: ${PNET}
          via: ${PVIA}
NET
fi
chmod 600 /etc/netplan/60-private.yaml
netplan apply

# WireGuard
if [[ ! -f /etc/wireguard/wg0.conf ]]; then
  umask 077
  KEY=$(wg genkey)
  cat > /etc/wireguard/wg0.conf <<WG
[Interface]
Address = ${VPN_ADDR}
ListenPort = 51820
PrivateKey = ${KEY}
WG
fi
systemctl enable --now wg-quick@wg0

# Agent
install -d /opt/platform-gateway /var/lib/platform-gateway
cp "$(dirname "$0")/../gateway/agent.js" /opt/platform-gateway/agent.js
TOKEN_FILE=/etc/platform-gateway.env
if [[ ! -f $TOKEN_FILE ]]; then
  cat > $TOKEN_FILE <<ENV
AGENT_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')
LISTEN=${LAN_IP}:8787
PUBLIC_HOST=${PUBLIC_HOST}
APPS_DOMAIN=${APPS_DOMAIN}
WAN_IF=${WAN_IF}
LAN_SUBNET=${LAN_SUBNET}
# Optional wildcard cert for *.${APPS_DOMAIN} via DNS challenge (needs a Caddy build with that DNS module):
# CADDY_DNS_JSON={"name":"cloudflare","api_token":"..."}
ENV
  chmod 600 $TOKEN_FILE
fi
cat > /etc/systemd/system/platform-gateway.service <<UNIT
[Unit]
Description=White-label gateway agent
After=network-online.target wg-quick@wg0.service caddy.service
Wants=network-online.target

[Service]
EnvironmentFile=${TOKEN_FILE}
ExecStart=/usr/bin/node /opt/platform-gateway/agent.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caddy platform-gateway

echo
echo "Gateway ready."
grep AGENT_TOKEN $TOKEN_FILE | sed 's/AGENT_TOKEN/GATEWAY_TOKEN/'
echo "GATEWAY_URL=http://${LAN_IP}:8787"
echo "GATEWAY_PUBLIC_HOST=${PUBLIC_HOST}"
echo "GATEWAY_APPS_DOMAIN=${APPS_DOMAIN}"
echo "DNS: A ${PUBLIC_HOST} and *.${APPS_DOMAIN} -> this server's public IP. Open TCP 22,80,443,40000-49999 and UDP 51820."
