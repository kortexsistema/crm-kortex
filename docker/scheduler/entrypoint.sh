#!/bin/sh
# Entrypoint do deskcomm-scheduler: escreve o crontab e entrega o PID 1 ao crond.
#
# Por que gerar em runtime em vez de assar o arquivo na imagem: o INTERNAL_SECRET
# só existe no .env do cliente, e o busybox crond não expande variáveis dentro da
# linha do cron. Então a expansão acontece aqui, uma vez, no start.
#
# O que MUDOU em relação ao `command:` inline do compose: não há mais
# `apk add --no-cache curl tzdata` a cada start. curl e tzdata vêm na imagem. O
# cron do cliente deixa de depender de a VPS ter internet e de o mirror do Alpine
# estar de pé no momento de um restart — que é justamente o momento em que a
# máquina está se recuperando de alguma coisa.
set -eu

if [ -z "${INTERNAL_SECRET:-}" ]; then
  echo "scheduler: INTERNAL_SECRET vazio — os crons responderiam 401 em silêncio." >&2
  echo "scheduler: confira a chave no .env e suba de novo." >&2
  exit 1
fi

# Constante, não configuração: `app` é o nome do serviço na rede interna do
# compose, e o scheduler não fala com mais nada. A primeira versão disto lia um
# `SCHEDULER_APP_ORIGIN` que o compose nunca repassava e nenhum template
# documentava — controle decorativo, que é pior que controle nenhum: quem o
# encontrasse no código o definiria no `.env` e não veria efeito.
APP_ORIGIN="http://app:3000"

# O crond executa cada linha por `/bin/sh -c`, então o segredo é REAVALIADO pelo
# shell na hora de disparar. Interpolá-lo cru dentro de aspas duplas fazia com
# que um `$` no valor virasse expansão de variável (o header sairia truncado, e
# todo cron responderia 401 em silêncio) e uma crase virasse substituição de
# comando — execução arbitrária a cada minuto. Medido com um segredo hostil: a
# versão com aspas duplas entregava `segrafaelmelgacoredo/Users/rafaelmelgaco…`,
# com o `whoami` EXECUTADO. Aqui o valor vai entre aspas SIMPLES, com as aspas
# simples internas escapadas — dentro delas o sh não interpreta nada.
SEGREDO_SEGURO="$(printf '%s' "$INTERNAL_SECRET" | sed "s/'/'\\\\''/g")"

# minuto|delay(s)|timeout(s)|caminho — uma linha por cron. O caminho vai COMPLETO
# de propósito: o literal `api/v1/cron/<rota>` é o contrato que
# tests/unit/cron-routes-scheduled.test.ts (e mais dois) leem por grep — esse
# teste compara a lista com o diretório app/api/v1/cron, e rota criada sem
# agendamento reprova o CI.
#
# ESCALONAMENTO POR SEGUNDO (CORREÇÃO CONTROLADA 01):
# O campo `delay(s)` escalona os disparos ao longo dos 60 segundos de cada minuto
# usando `sleep <delay> && curl ...`. Isso elimina a convergência simultânea no
# segundo :00 (onde até 17 crons disparavam juntos), distribuindo a carga sobre o
# Next.js e o Supavisor/PostgREST.
CRONS="
* * * * *|0|45|api/v1/cron/event-log-drain
* * * * *|12|25|api/v1/cron/routing-worker
* * * * *|24|25|api/v1/cron/agent-dispatcher
* * * * *|36|25|api/v1/cron/followup-flow-worker
* * * * *|48|25|api/v1/cron/recover-stuck-messages
*/5 * * * *|4|25|api/v1/cron/storage-redaction?limit=50
*/5 * * * *|8|60|api/v1/cron/agenda-google-push
*/5 * * * *|16|25|api/v1/cron/snooze-watcher
*/5 * * * *|20|60|api/v1/cron/webhook-log-retention
*/5 * * * *|28|25|api/v1/cron/attendant-heartbeat
*/5 * * * *|40|45|api/v1/cron/channel-health
*/5 * * * *|52|45|api/v1/cron/handoff-watcher
*/10 * * * *|14|60|api/v1/cron/contact-avatars
*/10 * * * *|32|60|api/v1/cron/agenda-google-refresh
*/15 * * * *|22|90|api/v1/cron/agenda-google-sync
*/15 * * * *|44|90|api/v1/cron/appointment-reminders
*/15 * * * *|56|60|api/v1/cron/risk-watcher
*/30 * * * *|26|60|api/v1/cron/contact-phones
*/30 * * * *|38|60|api/v1/cron/google-sheets-sync
17 * * * *|10|60|api/v1/cron/contact-proposals-watcher
0 12 * * *|10|60|api/v1/cron/lgpd-sla-watcher
30 3 * * *|10|120|api/v1/cron/kb-conversations-batch
15 4 * * *|10|60|api/v1/cron/sync-model-catalog
40 4 * * *|10|120|api/v1/cron/data-retention
0 5 * * *|10|60|api/v1/cron/subscription-watcher
"

# CRONTAB_PATH é ponto de injeção do teste (tests/shell/scheduler-entrypoint.test.sh).
# Sem ele este script só seria exercitável dentro de um contêiner — e o único
# artefato executável novo desta entrega ficaria sem gate nenhum, que foi
# exatamente o achado da revisão adversarial.
DESTINO="${CRONTAB_PATH:-/etc/crontabs/root}"

umask 077
: > "$DESTINO"
echo "$CRONS" | while IFS='|' read -r quando delay timeout rota; do
  [ -n "$rota" ] || continue
  if [ -n "$delay" ] && [ "$delay" -gt 0 ] 2>/dev/null; then
    printf '%s sleep %s && curl -fsS -m%s -H '"'"'Authorization: Bearer %s'"'"' "%s/%s" >/dev/null 2>&1\n' \
      "$quando" "$delay" "$timeout" "$SEGREDO_SEGURO" "$APP_ORIGIN" "$rota" >> "$DESTINO"
  else
    printf '%s curl -fsS -m%s -H '"'"'Authorization: Bearer %s'"'"' "%s/%s" >/dev/null 2>&1\n' \
      "$quando" "$timeout" "$SEGREDO_SEGURO" "$APP_ORIGIN" "$rota" >> "$DESTINO"
  fi
done

exec crond -f -l 2
