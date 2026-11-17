#!/usr/bin/env bash
#
# Prepara a VM de produção (Ubuntu 24.04) para rodar o compose.prod.yml.
# Idempotente: pode rodar de novo. Executar como o usuário bolsiq, a partir de
# uma cópia de infra/azure no host:
#   scp -r infra/azure bolsiq@<ip>:/tmp/azure && ssh bolsiq@<ip> bash /tmp/azure/setup-vm.sh
# Detalhes em docs/runbooks/infra-azure.md.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -q
sudo apt-get install -yq ca-certificates curl gnupg fail2ban unattended-upgrades
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update -q
sudo apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker containerd fail2ban
sudo usermod -aG docker bolsiq
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null && sudo sysctl -q --system
mkdir -p ~/bolsiq ~/backups
sudo install -m 0644 "$(dirname "$0")/bolsiq.service" /etc/systemd/system/bolsiq.service
sudo systemctl daemon-reload
sudo systemctl enable bolsiq.service
# Backup diário às 22:30 BRT (01:30 UTC), antes do desligamento das 23:00.
( crontab -l 2>/dev/null | grep -v backup-postgres.sh; echo '30 1 * * * /bin/bash $HOME/bolsiq/backup-postgres.sh >> $HOME/backups/backup.log 2>&1' ) | crontab -
docker --version; docker compose version; swapon --show; systemctl is-enabled docker bolsiq fail2ban unattended-upgrades
