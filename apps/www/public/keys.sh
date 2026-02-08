#!/usr/bin/env bash
set -e

GITHUB_USER="wovalle"
KEYS_URL="https://github.com/${GITHUB_USER}.keys"
SSH_DIR="/root/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

curl -fsSL "$KEYS_URL" > "$AUTH_KEYS"

chmod 600 "$AUTH_KEYS"
chown -R root:root "$SSH_DIR"

if grep -q "^PermitRootLogin" /etc/ssh/sshd_config; then
  sed -i 's/^PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
else
  echo "PermitRootLogin yes" >> /etc/ssh/sshd_config
fi

if grep -q "^PubkeyAuthentication" /etc/ssh/sshd_config; then
  sed -i 's/^PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
else
  echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config
fi

systemctl restart ssh || service ssh restart