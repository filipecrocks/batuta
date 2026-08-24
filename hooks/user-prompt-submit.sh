#!/usr/bin/env sh
# Batuta — hook UserPromptSubmit.
#
# Contrato do hook, e ele e severo: este script BLOQUEIA o turno do usuario
# enquanto roda, e se estourar o timeout a saida inteira e descartada. Por isso
# aqui nao tem rede, nao tem LLM, nao tem espera. Se o batuta nao estiver no PATH,
# o hook sai calado com 0 — nunca com erro, nunca segurando o turno.
#
# O stdin traz o JSON do agente (campo "prompt"). O stdout entra no contexto.

set -eu

command -v batuta >/dev/null 2>&1 || exit 0

# 300ms e o teto duro. Se a maquina estiver de joelhos, e melhor ficar calado.
if command -v timeout >/dev/null 2>&1; then
  timeout 3 batuta route --stdin-json --modo hook 2>/dev/null || exit 0
else
  batuta route --stdin-json --modo hook 2>/dev/null || exit 0
fi

exit 0
