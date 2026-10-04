{{/* Name of the chart. */}}
{{- define "nornir.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name, truncated to 63 characters (DNS name limit). */}}
{{- define "nornir.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "nornir.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels. */}}
{{- define "nornir.labels" -}}
helm.sh/chart: {{ include "nornir.chart" . }}
app.kubernetes.io/name: {{ include "nornir.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels of a component: include "nornir.selectorLabels" (list . "backend"). */}}
{{- define "nornir.selectorLabels" -}}
{{- $root := index . 0 -}}
app.kubernetes.io/name: {{ include "nornir.name" $root }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{/* Name of a component's resources: include "nornir.componentName" (list . "backend"). */}}
{{- define "nornir.componentName" -}}
{{- $root := index . 0 }}
{{- printf "%s-%s" (include "nornir.fullname" $root | trunc 54 | trimSuffix "-") (index . 1) }}
{{- end }}

{{/* Image of a component: include "nornir.image" (list . .Values.backend.image). */}}
{{- define "nornir.image" -}}
{{- $root := index . 0 }}
{{- $image := index . 1 }}
{{- printf "%s:%s" $image.repository (default $root.Chart.AppVersion $image.tag) }}
{{- end }}

{{- define "nornir.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "nornir.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Secret holding the GitLab token, empty when there is none. */}}
{{- define "nornir.tokenSecretName" -}}
{{- if .Values.gitlab.existingSecret }}
{{- .Values.gitlab.existingSecret }}
{{- else if .Values.gitlab.token }}
{{- include "nornir.fullname" . }}
{{- end }}
{{- end }}

{{- define "nornir.tokenSecretKey" -}}
{{- if .Values.gitlab.existingSecret }}
{{- .Values.gitlab.existingSecretKey }}
{{- else }}
{{- "GITLAB_TOKEN" }}
{{- end }}
{{- end }}

{{/* Validates privateCA: exactly one source when enabled. */}}
{{- define "nornir.validatePrivateCA" -}}
{{- with .Values.privateCA }}
{{- if .enabled }}
{{- $sources := 0 }}
{{- if .certificates }}{{ $sources = add1 $sources }}{{ end }}
{{- if .existingConfigMap }}{{ $sources = add1 $sources }}{{ end }}
{{- if .existingSecret }}{{ $sources = add1 $sources }}{{ end }}
{{- if ne $sources 1 }}
{{- fail "privateCA.enabled needs exactly one of privateCA.certificates, privateCA.existingConfigMap or privateCA.existingSecret" }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/* Key of the CA bundle in its ConfigMap or Secret. */}}
{{- define "nornir.caKey" -}}
{{- if .Values.privateCA.certificates }}ca.crt{{ else }}{{ .Values.privateCA.key }}{{ end }}
{{- end }}
