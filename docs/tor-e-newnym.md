# Tor e NEWNYM — Guia Completo

---

## 1. O que é o Tor e por que usamos

O Tor (The Onion Router) é uma rede de anonimização que roteia o tráfego de rede através de múltiplos nós voluntários ao redor do mundo, ocultando o endereço IP de origem. Cada conexão sai da rede Tor por um **nó de saída** com um IP público diferente do IP real da máquina.

Nesta ferramenta, usamos o Tor por duas razões:

1. **Anonimização da origem:** as requisições chegam ao INPI com IPs de nós de saída Tor, não com o IP da máquina local ou do servidor.
2. **Rotação de IP para contornar bloqueios por IP:** o INPI limita ou bloqueia requisições repetidas do mesmo IP. Usando múltiplos circuitos e rotacionando-os quando bloqueados, a ferramenta mantém o download em andamento sem precisar de proxies pagos.

---

## 2. Por que múltiplas instâncias Tor

Uma única instância Tor usa poucos circuitos, o que limita o paralelismo de IPs distintos. Para obter **M IPs simultâneos**, subimos **M instâncias Tor**, cada uma com sua própria porta SOCKS e porta Control.

Cada worker da ferramenta usa uma instância diferente:

```
worker_1 → SOCKS porta 9050 → circuito_1 → nó_saída_1 → INPI
worker_2 → SOCKS porta 9052 → circuito_2 → nó_saída_2 → INPI
worker_3 → SOCKS porta 9054 → circuito_3 → nó_saída_3 → INPI
worker_4 → SOCKS porta 9056 → circuito_4 → nó_saída_4 → INPI
```

O script `tor/start-tor.sh` sobe automaticamente N instâncias com base nas listas de portas fornecidas. Os logs de cada instância ficam em `tor/data/tor{porta_socks}.log`.

---

## 3. Isolamento de circuito por worker via usuário SOCKS

O protocolo SOCKS5 permite autenticação por usuário e senha. O Tor, quando configurado com `IsolateSOCKSAuth 1`, garante que conexões com credenciais diferentes usem **circuitos distintos** — ou seja, IPs de saída distintos.

A ferramenta cria cada agente SOCKS com um usuário único por slot:

```js
// tor-pool.js
const user = `slot${i + 1}`;
const agent = new SocksProxyAgent(`socks5h://${user}:x@${torHost}:${socksPort}`);
```

Assim, `slot1:x@127.0.0.1:9050` e `slot2:x@127.0.0.1:9050` usam circuitos separados mesmo que apontem para a mesma instância Tor.

A diretiva `IsolateSOCKSAuth 1` no `torrc.template` é o que habilita esse comportamento no lado do Tor.

---

## 4. O que é o NEWNYM

`NEWNYM` é um sinal enviado ao ControlPort do Tor que instrui a instância a **criar novos circuitos** para conexões futuras. Em termos práticos: após um NEWNYM bem-sucedido, as próximas requisições sairão por um **IP de saída diferente**.

Pontos importantes:

- O NEWNYM **não derruba conexões já abertas** — só afeta novas conexões.
- O Tor impõe um cooldown interno entre NEWNYMs efetivos (controlado por `MaxCircuitDirtiness`). Enviar o sinal antes do cooldown não produz novos circuitos imediatamente.
- O NEWNYM é por instância Tor — afetar o slot 3 (porta 9054) não afeta os demais slots.

---

## 5. Como a ferramenta dispara o NEWNYM

### Protocolo do ControlPort

A comunicação com o ControlPort do Tor é feita via TCP puro (protocolo de texto simples). A sequência exata que o código implementa:

1. Conectar em `127.0.0.1:{ControlPort}`
2. Enviar: `AUTHENTICATE "<senha>"\r\n`
3. Aguardar resposta `250` (OK)
4. Enviar: `SIGNAL NEWNYM\r\nQUIT\r\n`
5. Fechar conexão

**Implementação em `src/tor-pool.js`:**

```js
function newnym(circ) {
  return new Promise((resolve) => {
    if (!podeRotacionar(circ)) return resolve(false);
    const sock = net.connect(circ.controlPort, torHost);
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(5000, () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(false));
    sock.on('connect', () => {
      sock.write(`AUTHENTICATE "${torControlPassword}"\r\n`);
    });
    sock.on('data', (d) => {
      buf += d;
      if (buf.includes('250') && !buf.includes('NEWNYM-SENT')) {
        buf = 'NEWNYM-SENT';
        sock.write('SIGNAL NEWNYM\r\nQUIT\r\n');
        registrarRotacao(circ);
        resolve(true);
      }
    });
    sock.on('close', () => resolve(true));
  });
}
```

### Quando a ferramenta dispara o NEWNYM

O NEWNYM é disparado em `src/runner.js` quando o resultado de uma requisição é classificado como `bloqueio` (HTTP 403, 429 ou timeout equivalente):

```js
if (cls.resultado === 'bloqueio') {
  await pool.newnym(circuito);
  await new Promise(r => setTimeout(r, 1000 * tentativas)); // backoff
  continue; // retenta
}
```

Ou seja: ao detectar bloqueio em um circuito, a ferramenta pede ao Tor que troque o IP de saída daquele circuito e aguarda um backoff progressivo antes de retentar.

---

## 6. Cooldown e MaxCircuitDirtiness

O Tor tem uma proteção interna contra NEWNYMs muito frequentes. A diretiva `MaxCircuitDirtiness 60` no `torrc.template` define que um circuito pode ser "sujo" (usado) por até 60 segundos antes de ser elegível para troca por NEWNYM.

Na ferramenta, o cooldown do lado da aplicação é de **10 segundos** (`cooldownMs = 10000` padrão em `tor-pool.js`). O método `podeRotacionar(circ)` verifica se já passaram pelo menos `cooldownMs` desde a última rotação daquele circuito específico. Se não passou, o NEWNYM não é enviado e a função retorna `false` imediatamente — evitando requisições desnecessárias ao ControlPort e respeitando o ritmo do Tor.

```js
function podeRotacionar(circ, agora = Date.now()) {
  return agora - circ.ultimaRotacao >= cooldownMs;
}
```

---

## 7. O que o `torrc.template` define

O arquivo `tor/torrc.template` é o modelo de configuração aplicado a cada instância Tor. O script `start-tor.sh` substitui os placeholders `__SOCKS__`, `__CONTROL__` e `__DATA__` para cada instância:

```
SocksPort __SOCKS__
ControlPort __CONTROL__
DataDirectory __DATA__
CookieAuthentication 0
IsolateSOCKSAuth 1
MaxCircuitDirtiness 60
```

| Diretiva | Valor | Significado |
|---|---|---|
| `SocksPort` | (variável) | Porta onde a instância aceita conexões SOCKS5 |
| `ControlPort` | (variável) | Porta onde a instância aceita comandos de controle (NEWNYM, etc.) |
| `DataDirectory` | (variável) | Diretório de dados desta instância (chaves, estado de circuitos) |
| `CookieAuthentication 0` | fixo | Desabilita autenticação por cookie; autenticação é por senha (ou sem senha se `TOR_CONTROL_PASSWORD` estiver vazio) |
| `IsolateSOCKSAuth 1` | fixo | Separa circuitos por credenciais SOCKS — essencial para o isolamento por worker |
| `MaxCircuitDirtiness 60` | fixo | Circuitos ficam ativos por até 60 segundos; NEWNYM pode trocar antes |

---

## 8. Operação e troubleshooting

### Subir as instâncias Tor

```bash
# Com as portas padrão (definidas no .env.example)
bash tor/start-tor.sh

# Com portas customizadas
bash tor/start-tor.sh "9060,9062,9064" "9061,9063,9065"
```

O script aguarda 10 segundos para o bootstrap antes de retornar. As instâncias ficam em background.

### Ver logs

Cada instância escreve seu log em `tor/data/tor{porta_socks}.log`:

```bash
# Acompanhar log da instância na porta 9050
tail -f tor/data/tor9050.log

# Ver todos os logs em tempo real
tail -f tor/data/*.log
```

Procure por linhas como `Bootstrapped 100%` para confirmar que a instância conectou à rede Tor.

### Sintomas de bloqueio e como lidar

| Sintoma | Causa provável | Ação |
|---|---|---|
| Muitos `falhou` com `bloqueio` no status | INPI bloqueando os IPs de saída ativos | Reduza `CONCURRENCY` e `RATE_PER_CIRCUIT`; aguarde alguns minutos e re-execute |
| `AUTHENTICATE` retornando erro | `TOR_CONTROL_PASSWORD` diferente do configurado no torrc | Verifique a senha; deixe em branco nos dois lugares se não usar senha |
| Conexão recusada no ControlPort | Instâncias Tor não estão rodando | Execute `bash tor/start-tor.sh` novamente |
| Timeout em todas as requisições | Rede Tor lenta ou bloqueada | Verifique conectividade; reinicie as instâncias Tor |

### Conferir o IP de saída de um circuito

```bash
# Usar curl via SOCKS para verificar qual IP aparece para o INPI
curl --proxy socks5h://slot1:x@127.0.0.1:9050 https://check.torproject.org/api/ip
```

Cada chamada com uma credencial diferente (`slot1`, `slot2`, etc.) deve retornar IPs distintos se o isolamento estiver funcionando corretamente.

### Encerrar as instâncias Tor

```bash
pkill -f "tor -f"
```

Ou, para ser mais seletivo, veja os PIDs nos arquivos de log e encerre individualmente.
