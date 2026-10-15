# Security

This first alpha is intended for local, single-user use. Do not expose its backend
to a network or deploy it as a public web application. Electron sessions authenticate
to a loopback-only backend; browser-only development is not a shared service.

Keep Electron, Python, and dependencies updated. Back up important notebooks before
testing a new release. Treat imported files and API-provider responses as untrusted.
AI assistance sends supplied context to your configured provider only when used.

Please report vulnerabilities privately through the repository's **Security →
Report a vulnerability** feature, rather than publishing exploit details in Issues.
Do not include notebooks, credentials, API keys, or personal images in bug reports.

Only the latest alpha is maintained at this stage. Signed/notarized packages and
a full independent security review are not yet available.

The initial build-tool dependency tree has a moderate `sprintf-js` denial-of-service
advisory through Electron Builder's download tooling. It is not included in the
application runtime; the production npm dependency audit is clean. Track upstream
build-tool updates rather than forcing incompatible dependency replacements.
