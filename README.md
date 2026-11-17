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
- `DATABASE_PATH`: caminho persistente para o banco SQLite de pedidos.
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

Se a criação sofrer timeout, erro 5xx ou resposta inválida, o pedido entra em `creation_unknown` e não é reenviado automaticamente: a cobrança pode existir na FireBot. O operador deve conferir no painel a referência `Pedido <id>` incluída na descrição, antes de qualquer nova tentativa. Não foi presumido suporte a cabeçalho de idempotência ou endpoint de cancelamento não documentado. Rejeições HTTP definitivas permitem uma nova tentativa.

## Hospedagem

O servidor usa SQLite persistente e foi preparado para **um serviço Node.js com disco persistente**, ou container. Não publique como site somente estático nem use disco temporário de funções serverless para os pedidos. Para Vercel Functions, primeiro substitua `lib/store.js` por um armazenamento remoto com operação atômica de reserva/idempotência.

O `Dockerfile` inclui apenas a aplicação e suas dependências de execução. Monte um volume em `/app/data`, forneça as variáveis pelo ambiente e coloque HTTPS na frente do serviço. Ao usar proxy, configure limites de requisição na borda; o limite local usa o endereço do socket, sem confiar em cabeçalhos forjáveis.

## Verificação

16 testes cobrem combinações de preços, adulteração de valores, CPF/CNPJ, ID e valor da transação, concorrência, retomada, respostas incertas, rejeição definitiva, isolamento de sessões, reembolso e persistência após reabrir o banco.

O fluxo de navegador foi conferido localmente: escolher os dois adicionais → total R$ 126,80 → QR Code/copia e cola → página de obrigado após confirmação simulada → link WhatsApp. Não foi criada nem paga uma cobrança real.

Para repetir a simulação local, execute `node scripts/preview-test.js`. Ela escuta apenas `127.0.0.1:3001`, usa banco em memória e código sem valor financeiro; não usa a chave FireBot. O arquivo `../qa-status.txt` pode conter `pending`, `paid`, `expired` ou `refunded` para exercitar os estados. O número de WhatsApp desse teste é fictício e não é usado pelo servidor real.

## Imagens

`public/assets/bonus.png` e `product.jpg` são as imagens da referência. `banner-pix.png` foi editado com a ferramenta ImageGen integrada. Instrução de edição: substituir somente os valores no balão por “R$ 97”, “à vista no Pix” e “Oferta para 20 pessoas”, preservando a composição e removendo o parcelamento. Fontes: [checkout de referência](https://pay.kiwify.com.br/zFpchuU) e [documentação FireBot](https://firebotbr.com/integracoes/docs).
