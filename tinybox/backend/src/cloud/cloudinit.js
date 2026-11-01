'use strict';
/**
 * cloud-init for resold VMs: set the root password/SSH key, route all
 * traffic through the white-label gateway, and remove provider branding.
 */
function cloudInit({ hostname, password, sshKey, brand, gatewayIp, hideMetadata }) {
  const lines = [
    '#cloud-config',
    `hostname: ${hostname}`,
    'manage_etc_hosts: true',
    'ssh_pwauth: true',
    'disable_root: false',
    'chpasswd:',
    '  expire: false',
    '  users:',
    `    - {name: root, password: ${JSON.stringify(password)}, type: text}`,
  ];
  if (sshKey) lines.push('users:', '  - name: root', '    ssh_authorized_keys:', `      - ${JSON.stringify(sshKey)}`);
  const svc = [
    '[Unit]', 'Description=Platform network', 'After=network-online.target cloud-final.service', 'Wants=network-online.target', '',
    '[Service]', 'Type=oneshot', 'RemainAfterExit=yes',
    ...(gatewayIp ? [`ExecStart=/sbin/ip route replace default via ${gatewayIp}`] : []),
    ...(hideMetadata ? ['ExecStart=/bin/sh -c "iptables -C OUTPUT -d 169.254.169.254 -j REJECT 2>/dev/null || iptables -A OUTPUT -d 169.254.169.254 -j REJECT"'] : []),
    '', '[Install]', 'WantedBy=multi-user.target',
  ].join('\n');
  lines.push(
    'write_files:',
    '  - path: /etc/motd',
    `    content: ${JSON.stringify(`\nWelcome to your ${brand} server.\n\n`)}`,
    '  - path: /etc/systemd/system/platform-net.service',
    `    content: ${JSON.stringify(svc)}`,
    'runcmd:',
    '  - [sh, -c, "chmod -x /etc/update-motd.d/* 2>/dev/null || true"]',
    '  - [sh, -c, "rm -f /etc/issue.net; echo ' + brand.replace(/[^A-Za-z0-9 ._-]/g, '') + ' > /etc/issue"]',
    '  - [systemctl, daemon-reload]',
    '  - [systemctl, enable, --now, platform-net.service]',
  );
  return lines.join('\n') + '\n';
}

module.exports = { cloudInit };
