# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

---

## Security Architecture & Design Guarantees

Independent Books was built with an **air-gapped security model**:

1. **Loopback Only (`127.0.0.1`)**: The application backend server strictly listens on the local loopback interface (`127.0.0.1`). It never binds to `0.0.0.0` or exposes an open port across your local network.
2. **Host & Origin Validation**: Incoming HTTP requests are validated against localhost host headers to defend against DNS rebinding or malicious website cross-origin requests.
3. **No External Network Calls**: The core application contains zero telemetry, zero analytics beacons, zero cloud sync calls, and no remote dependencies. Your financial ledgers remain strictly on your physical machine.
4. **Desktop Shell Isolation**: In standalone desktop mode, developer tools and right-click context menus are locked down to prevent unauthorized inspection or code injection in shared office environments.

---

## Reporting a Vulnerability

If you discover a security vulnerability or potential accounting data integrity risk, please report it privately:

- **Email**: Send details to `mosoassisstant@gmail.com`
- Please do **not** disclose security vulnerabilities via public GitHub issues until a patch has been published.
- Include a minimal reproduction case or description of the potential exploit.

We will acknowledge receipt within 48 hours and work with you on a patch release.
