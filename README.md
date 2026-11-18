# Laços e Caprichos — checkout Pix

Checkout do Combo 4 em 1 inspirado na referência fornecida, com valor de **R$ 97,00 à vista no Pix**. Banner superior atualizado para a oferta para 20 pessoas; imagem original de bônus preservada. Sem Apple Pay, cartão, parcelamento ou marca do gateway na interface.

| Seleção | Total |
| --- | ---: |
| Combo | R$ 97,00 |
| Combo + Guia de Atendimento ao Cliente | R$ 116,90 |
| Combo + Guia Prático de Embalagens Criativas | R$ 106,90 |
| Combo + os dois guias | R$ 126,80 |

Os adicionais custam R$ 19,90 e R$ 9,90, estão desmarcados por padrão e também são cobrados no Pix. O servidor calcula os valores em centavos; valores enviados pelo navegador não determinam a cobrança.

## Executar

Requer Node.js 24 e pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

No PowerShell, use `Copy-Item .env.example .env`. Abra `http://127.0.0.1:3000`. Os comandos `pnpm test` e `pnpm check` verificam os fluxos de pagamento e a sintaxe.

## Configuração para cobrar

Defina no ambiente **do servidor**, nunca no navegador:

- `FIREBOT_API_KEY`: chave privada da sua conta FireBot.
- `PUBLIC_ORIGIN`: endereço HTTPS exato do checkout, sem caminho final. Usado como origem permitida e `storeUrl`.
- `WHATSAPP_NUMBER`: número de destino com código do país e DDD, apenas dígitos. Padrão configurado: **5575988393742 — (75) 98839-3742**. Pode ser substituído pela variável de ambiente.
- `WHATSAPP_MESSAGE`: texto pré-preenchido; há uma sugestão em `.env.example`.
- `DATABASE_PATH`: caminho persistente para o banco SQLite de pedidos, apenas na execução local/container.
- `HOST` / `PORT`: interface e porta do servidor; para container use `0.0.0.0`.

A criação de cobrança retorna indisponibilidade quando falta a chave, a URL HTTPS ou o WhatsApp. Nenhuma chave de outro projeto foi copiada. A integração está implementada, mas uma cobrança real paga ainda precisa ser validada após a configuração.

## Integração FireBot

Base: `https://firebotbr.com/api/v1`, autenticação `x-api-key`. Contrato consultado na documentação oficial, em captura local das integrações anteriores de 12–17/11/2026. A página online voltou a exigir login nesta implementação.

- `POST /pix/create`: envia `amount` **em reais**, `productType: DIGITAL`, descrição dos produtos e referência interna, `storeUrl`, `customer.name/email/cpf/phone`, `qrStyle: plain`.
- `GET /pix/{transactionId}`: verifica o ID e o valor bruto recebido. Somente `PAID` libera a página de obrigado com o botão do WhatsApp.
- O QR Code é produzido localmente a partir de `pixCopiaECola`; não encaminhamos esse código a um serviço adicional de imagens.
- A documentação não garante `expiresAt`. Um prazo só é exibido quando a API informa esse campo, sem inventar contagem regressiva.
- A consulta usa polling enquanto a página está aberta e é retomada ao voltar. Não há webhook nem entrega em segundo plano. Ao reabrir no mesmo navegador, a consulta verifica o estado atual.

As chaves e os dados pessoais não são registrados em logs. O banco guarda produtos, total, estado, referência da cobrança e hashes para sessão/idempotência; não guarda nome, e-mail, CPF nem telefone em texto. Proteja e faça backup do volume persistente.

## Retomada e respostas incertas

Cada tentativa tem uma chave de idempotência local e uma reserva persistida **antes** da chamada ao provedor. Cliques repetidos retomam o pedido. Sessões usam cookie HttpOnly/SameSite; outro navegador não consulta o pedido.

Ao alterar dados ou opcionais, o checkout usa uma nova tentativa e uma cobrança com os itens e o total recalculados no servidor. Um Pix pendente só é reutilizado para a mesma seleção e os mesmos dados; envios concorrentes iguais continuam gerando uma única cobrança. Códigos anteriores permanecem vinculados aos seus próprios itens e valores, sem cancelamento presumido no provedor. Pedidos em criação ou com resultado incerto ainda impedem outra cobrança até a situação ser esclarecida.

Se a criação sofrer timeout, erro 5xx ou resposta inválida, o pedido entra em `creation_unknown` e não é reenviado automaticamente: a cobrança pode existir na FireBot. O operador deve conferir no painel a referência `Pedido <id>` incluída na descrição, antes de qualquer nova tentativa. Não foi presumido suporte a cabeçalho de idempotência ou endpoint de cancelamento não documentado. Rejeições HTTP definitivas permitem uma nova tentativa.

## Hospedagem

Na **Vercel**, `api/index.js` executa o servidor em Node.js 24 na região São Paulo (`gru1`). As páginas e imagens são servidas da pasta `public`; `/pagamento` e `/obrigado` têm rotas próprias. O build roda as verificações e os testes antes de publicar.

Conecte um **Vercel Blob privado**, também em `gru1`, ao projeto. A conexão fornece `BLOB_STORE_ID` e autenticação OIDC; não é necessário colocar uma chave de armazenamento no código. Configure `FIREBOT_API_KEY` no ambiente Production. `PUBLIC_ORIGIN` pode informar o domínio definitivo; se ausente, a função usa `VERCEL_PROJECT_PRODUCTION_URL`, fornecida pela Vercel. Ao mudar variáveis, faça um novo deploy.

O armazenamento remoto usa um documento privado por sessão, leituras sem cache e escritas condicionais por ETag. A reserva e a idempotência são atômicas mesmo entre instâncias diferentes da função. Uma falha no armazenamento bloqueia a criação da cobrança. O código Pix fica no armazenamento privado; dados cadastrais não são persistidos. Registros de pedidos não expiram automaticamente; contadores de limite expiram em um dia. O acesso por sessão dura 30 dias.

Na execução local ou em container, o servidor continua usando SQLite persistente. Não use SQLite em disco temporário de funções serverless.

O `Dockerfile` inclui apenas a aplicação e suas dependências de execução. Monte um volume em `/app/data`, forneça as variáveis pelo ambiente e coloque HTTPS na frente do serviço. Ao usar proxy, configure limites de requisição na borda; o limite local usa o endereço do socket, sem confiar em cabeçalhos forjáveis.

## Verificação

22 testes cobrem combinações de preços, adulteração de valores, CPF/CNPJ, ID e valor da transação, concorrência entre funções independentes, reserva atômica remota, retomada, respostas incertas, rejeição definitiva, isolamento de sessões, reembolso e persistência após reabrir o banco. Os testes do Blob usam um serviço simulado com controle de versão.

O fluxo de navegador foi conferido localmente: escolher os dois adicionais → total R$ 126,80 → QR Code/copia e cola → página de obrigado após confirmação simulada → link WhatsApp. Não foi criada nem paga uma cobrança real.

Para repetir a simulação local, execute `node scripts/preview-test.js`. Ela escuta apenas `127.0.0.1:3001`, usa banco em memória e código sem valor financeiro; não usa a chave FireBot. O arquivo `../qa-status.txt` pode conter `pending`, `paid`, `expired` ou `refunded` para exercitar os estados. O número de WhatsApp desse teste é fictício e não é usado pelo servidor real.

## Imagens

`public/assets/bonus.png` e `product.jpg` são as imagens da referência. `banner-pix.png` foi editado com a ferramenta ImageGen integrada. Instrução de edição: substituir somente os valores no balão por “R$ 97”, “à vista no Pix” e “Oferta para 20 pessoas”, preservando a composição e removendo o parcelamento. Fontes: [checkout de referência](https://pay.kiwify.com.br/zFpchuU) e [documentação FireBot](https://firebotbr.com/integracoes/docs).
