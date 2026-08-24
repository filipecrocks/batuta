/**
 * O mostrador da chamada — o relatório local do jeito que ele sai no terminal.
 *
 * É EXEMPLO, e a legenda diz isso na cara. A lei 11 do projeto ("número medido, não
 * estimado") vale para o próprio site: nenhum número desta caixa é apresentado como
 * resultado publicado. O que ela mostra é a FORMA do relatório — o funil, a skill
 * fantasma, o custo por tarefa concluída —, que é o argumento da página.
 */
export function Mostrador() {
  return (
    <div className="leitor" aria-label="Exemplo do relatório local do Batuta">
      <div className="leitor-topo">
        <i />
        <i />
        <i />
        <b>relatório local</b>
      </div>
      <pre>
        <code>
          <s>$</s> <u>batuta report --dias 30</u>
          {"\n\n"}
          <q>skill                  rotas  disparo  custo/tarefa</q>
          {"\n"}
          <q>─────────────────────────────────────────────────</q>
          {"\n"}
          <u>systematic-debugging</u>      58     0,79        $0,041{"\n"}
          <u>test-driven-development</u>   31     0,61        $0,038{"\n"}
          <u>ponytail</u>                  19     0,42        $0,052{"\n"}
          <u>stop-slop</u>                 12     0,00   <s>fantasma</s>
          {"\n"}
          <q>─────────────────────────────────────────────────</q>
          {"\n"}
          silêncio em 41% dos turnos{"  ·  "}holdout 5%
        </code>
      </pre>
      <p className="leitor-pe">
        Exemplo da forma do relatório. Os números são de uma máquina de teste — o que
        o Batuta publica só aparece depois de medido, no{" "}
        <a href="/ranking">ranking</a>.
      </p>
    </div>
  );
}
