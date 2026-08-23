{{- define "a2a-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "a2a-platform.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "a2a-platform.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "a2a-platform.labels" -}}
app.kubernetes.io/name: {{ include "a2a-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
{{- define "a2a-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "a2a-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
