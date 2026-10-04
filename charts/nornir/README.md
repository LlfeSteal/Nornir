# Nornir Helm chart

Deploys [Nornir](../../README.md), the Gantt chart of one GitLab group, on Kubernetes:

- **backend**: the Go API (port 8080), which queries GitLab and caches the tree in memory;
- **frontend**: nginx (non-root, port 8080) serving the web app and proxying `/api/` to the backend Service;
- an optional **Ingress** in front of the frontend.

Both containers run as non-root users with a read-only root filesystem, every capability dropped and the `RuntimeDefault` seccomp profile (Pod Security Standard "restricted").

## Images

The chart doesn't build images: build them from the repository and push them to a registry your cluster can pull from.

```bash
docker build -t registry.example.com/nornir-backend:0.2.0 backend
docker build -t registry.example.com/nornir-frontend:0.2.0 frontend
docker push registry.example.com/nornir-backend:0.2.0
docker push registry.example.com/nornir-frontend:0.2.0
```

The tag defaults to the chart's `appVersion` (`0.2.0`).

## Install

Keep the token out of values files: create the Secret yourself (or with sealed-secrets, external-secrets…).

```bash
kubectl create namespace nornir
kubectl -n nornir create secret generic nornir-gitlab --from-literal=GITLAB_TOKEN=glpat-...

helm install nornir charts/nornir -n nornir \
  --set gitlab.group=my-org/my-group \
  --set gitlab.existingSecret=nornir-gitlab \
  --set backend.image.repository=registry.example.com/nornir-backend \
  --set frontend.image.repository=registry.example.com/nornir-frontend

helm test nornir -n nornir      # checks /api/health through the frontend's proxy
```

`gitlab.group` is required: the install fails with a clear message without it. Without any token, the backend answers 401.

### Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    # The first fetch of a large group can take minutes.
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: nornir.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: nornir-tls
      hosts:
        - nornir.example.com
```

The Ingress only targets the frontend: nginx proxies `/api/` to the backend inside the cluster.

### Private certificate authority

For a self-hosted GitLab whose certificate is signed by an internal CA, give the backend that CA. Its certificates are **added** to the system ones: public CAs still work. Pick one source:

```bash
# PEM file, stored by the chart in a ConfigMap (one or more certificates, concatenated)
helm upgrade --install nornir charts/nornir -n nornir --reuse-values \
  --set gitlab.url=https://gitlab.internal.example.com \
  --set privateCA.enabled=true \
  --set-file privateCA.certificates=corp-ca.pem

# Existing ConfigMap (e.g. distributed by trust-manager)
  --set privateCA.enabled=true --set privateCA.existingConfigMap=corp-ca-bundle --set privateCA.key=ca.crt

# Existing Secret (e.g. the ca.crt of a cert-manager certificate)
  --set privateCA.enabled=true --set privateCA.existingSecret=corp-ca --set privateCA.key=ca.crt
```

The bundle is mounted read-only in `/etc/nornir/ca` and `SSL_CERT_DIR` is set to `/etc/ssl/certs:/etc/nornir/ca`. Without it, the backend reports `x509: certificate signed by unknown authority`. A CA given inline restarts the backend when it changes; with an existing ConfigMap or Secret, restart it yourself (`kubectl rollout restart deployment/<release>-nornir-backend`).

## Values

| Key | Default | Description |
|---|---|---|
| `gitlab.url` | `https://gitlab.com` | GitLab instance |
| `gitlab.group` | `""` | **Required.** Full path of the displayed group |
| `gitlab.token` | `""` | `read_api` token, stored in a Secret created by the chart |
| `gitlab.existingSecret` | `""` | Existing Secret holding the token (takes precedence over `gitlab.token`) |
| `gitlab.existingSecretKey` | `GITLAB_TOKEN` | Key of the token in that Secret |
| `privateCA.enabled` | `false` | Trust a private CA for GitLab (needs exactly one source below) |
| `privateCA.certificates` | `""` | PEM certificates, stored in a ConfigMap by the chart |
| `privateCA.existingConfigMap` | `""` | Existing ConfigMap holding the bundle |
| `privateCA.existingSecret` | `""` | Existing Secret holding the bundle |
| `privateCA.key` | `ca.crt` | Key of the bundle in the existing ConfigMap or Secret |
| `backend.replicaCount` | `1` | The cache is per pod: each replica fetches GitLab on its own, one is recommended |
| `backend.image.repository` | `nornir-backend` | Backend image |
| `backend.image.tag` | `""` | Defaults to the chart's `appVersion` |
| `backend.image.pullPolicy` | `IfNotPresent` | |
| `backend.service.type` / `.port` | `ClusterIP` / `8080` | Backend Service |
| `backend.extraEnv` | `[]` | Extra environment variables (`EnvVar` list), e.g. `GIN_MODE=release` |
| `backend.resources` | `{}` | Requests and limits (a large group's tree takes a few hundred MB) |
| `backend.livenessProbe` / `.readinessProbe` | `GET /api/health` | Replace or set to `null` |
| `backend.podAnnotations` / `.podLabels` | `{}` | |
| `backend.nodeSelector` / `.tolerations` / `.affinity` | | Scheduling |
| `frontend.*` | | Same keys as `backend`; image `nornir-frontend`, Service port `80`, probes `GET /` |
| `imagePullSecrets` | `[]` | Secrets to pull the images from a private registry |
| `nameOverride` / `fullnameOverride` | `""` | Resource names |
| `serviceAccount.create` / `.name` / `.annotations` | `true` / `""` / `{}` | Service account of the pods (its API token is never mounted) |
| `podSecurityContext` | non-root, `RuntimeDefault` seccomp | Pod security context of both components |
| `securityContext` | no privilege escalation, read-only root, no capabilities | Container security context of both components |
| `ingress.enabled` | `false` | Create an Ingress to the frontend |
| `ingress.className` | `""` | Ingress class |
| `ingress.annotations` | `{}` | |
| `ingress.hosts` | `nornir.example.com`, `/` | Hosts and paths |
| `ingress.tls` | `[]` | TLS Secrets and hosts |

`values.schema.json` checks the types and rejects unknown keys (typos).
